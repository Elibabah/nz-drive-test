import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { DrivingSession } from '../types';

// Required for expo-web-browser OAuth flow on Android
WebBrowser.maybeCompleteAuthSession();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// --- Auth ---

export async function signInWithGoogle(): Promise<string | null> {
  const redirectUri = makeRedirectUri({ scheme: 'nzdrive', path: 'auth/callback' });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectUri, skipBrowserRedirect: true },
  });

  if (error || !data?.url) throw error ?? new Error('No OAuth URL returned');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return null; // user cancelled — not an error
  }
  if (result.type !== 'success') {
    throw new Error(`OAuth browser ended unexpectedly (type="${result.type}").`);
  }

  const url = new URL(result.url);

  // PKCE flow: code in query params
  const code = url.searchParams.get('code');
  if (code) {
    const { data: session, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw exchangeError;
    return session?.user?.id ?? null;
  }

  // Implicit flow: tokens in hash fragment
  const hashParams = new URLSearchParams(url.hash.slice(1));
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token') ?? '';
  if (accessToken) {
    const { data: session, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) throw sessionError;
    return session?.user?.id ?? null;
  }

  throw new Error('No auth tokens found in redirect URL.');
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// --- Sessions ---

export async function saveSession(session: DrivingSession): Promise<void> {
  const { routeCoordinates, hazardEvents, ...sessionMeta } = session;

  const { error: sessionError } = await supabase.from('sessions').upsert({
    id: session.id,
    user_id: session.userId,
    start_time: new Date(session.startTime).toISOString(),
    end_time: session.endTime ? new Date(session.endTime).toISOString() : null,
    duration_seconds: Math.round(session.duration),
    total_distance_meters: Math.round(session.totalDistance),
    average_speed_kmh: Math.round(session.averageSpeed),
    status: session.status,
    score: session.score ?? null,
    feedback: session.feedback ?? null,
  });

  if (sessionError) {
    console.warn('Session save error:', sessionError.message);
    await cacheSessionLocally(session);
    return;
  }

  // Save GPS track in chunks
  if (routeCoordinates.length > 0) {
    const trackRows = routeCoordinates.map((p, i) => ({
      session_id: session.id,
      sequence: i,
      latitude: p.coordinate.latitude,
      longitude: p.coordinate.longitude,
      speed_ms: p.speed,
      heading: p.heading,
      recorded_at: new Date(p.timestamp).toISOString(),
    }));

    // Insert in chunks of 500
    for (let i = 0; i < trackRows.length; i += 500) {
      const { error: trackError } = await supabase.from('gps_tracks').insert(trackRows.slice(i, i + 500));
      if (trackError) console.warn('GPS track insert error:', trackError.message);
    }
  }

  // Save hazard events
  if (hazardEvents.length > 0) {
    const hazardRows = hazardEvents.map((h) => ({
      id: h.id,
      session_id: h.sessionId,
      occurred_at: new Date(h.timestamp).toISOString(),
      latitude: h.location.latitude,
      longitude: h.location.longitude,
      prompt: h.prompt,
      response: h.response,
      detected_correctly: h.detectedCorrectly,
    }));

    await supabase.from('hazard_events').insert(hazardRows);
  }
}

export async function fetchSessions(userId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('start_time', { ascending: false })
    .limit(20);

  if (error) {
    console.warn('Fetch sessions error:', error.message);
    return getLocalSessions();
  }

  return data ?? [];
}

export async function updateSessionFeedback(sessionId: string, feedback: string): Promise<void> {
  await supabase.from('sessions').update({ feedback }).eq('id', sessionId);
}

// --- Local cache fallback ---

async function cacheSessionLocally(session: DrivingSession): Promise<void> {
  const existing = await getLocalSessions();
  existing.unshift(session);
  await AsyncStorage.setItem('cached_sessions', JSON.stringify(existing.slice(0, 20)));
}

async function getLocalSessions(): Promise<any[]> {
  try {
    const data = await AsyncStorage.getItem('cached_sessions');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}
