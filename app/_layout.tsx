import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import { supabase } from '../src/services/supabase';
import { initAudioMode } from '../src/services/instructor';
import { initTTSVoice } from '../src/services/tts';

export default function RootLayout() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const bootstrapped = useRef(false);

  useEffect(() => {
    bootstrap();
  }, []);

  async function bootstrap() {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    await initAudioMode().catch(() => {});
    initTTSVoice().catch(() => {}); // warm up expo-speech fallback voice

    // Check permissions
    const [locPerm, audioPerm] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Audio.getPermissionsAsync(),
    ]);

    if (locPerm.status !== 'granted' || audioPerm.status !== 'granted') {
      setReady(true);
      router.replace('/permissions');
      return;
    }

    // Check auth
    const { data } = await supabase.auth.getSession();
    setReady(true);
    if (!data.session) {
      router.replace('/login');
    }
  }

  // React to sign-in / sign-out after bootstrap
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!bootstrapped.current) return;
      if (session) {
        router.replace('/');
      } else {
        router.replace('/login');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0a0f1e' },
          headerTintColor: '#ffffff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#0a0f1e' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'NZ Drive Practice', headerShown: false }} />
        <Stack.Screen name="permissions" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen
          name="session"
          options={{ title: 'Driving Session', headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen
          name="feedback/[id]"
          options={{ title: 'Session Feedback', presentation: 'modal' }}
        />
        <Stack.Screen name="history" options={{ title: 'Past Sessions' }} />
      </Stack>

      {/* Splash overlay — hides the Stack until bootstrap is done to prevent flicker */}
      {!ready && (
        <View style={styles.splash}>
          <ActivityIndicator color="#4ade80" size="large" />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0f1e',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
});
