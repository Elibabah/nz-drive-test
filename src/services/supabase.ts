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
  const { checkpointSession } = await import('./sessionPersistence');
  const result = await checkpointSession(session);
  if (!result.ok) {
    if (result.errors.length > 0) console.warn('Session save errors:', result.errors.join('; '));
    await cacheSessionLocally(session);
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
