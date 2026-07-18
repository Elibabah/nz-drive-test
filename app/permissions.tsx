import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import { supabase } from '../src/services/supabase';
import { requestSpeechPermission } from '../src/services/voiceRecognition';

export default function PermissionsScreen() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestPermissions() {
    setLoading(true);
    setError(null);

    const [locPerm, audioPerm] = await Promise.all([
      Location.requestForegroundPermissionsAsync(),
      Audio.requestPermissionsAsync(),
    ]);

    if (locPerm.status !== 'granted' || audioPerm.status !== 'granted') {
      setLoading(false);
      setError('Location and microphone access are required to use the app. Please enable them in Settings.');
      return;
    }

    // Trigger iOS speech recognition permission dialog
    await requestSpeechPermission();

    setLoading(false);

    const { data } = await supabase.auth.getSession();
    router.replace(data.session ? '/' : '/login');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.icon}>🎙 📍</Text>
        <Text style={styles.title}>Permissions needed</Text>

        <View style={styles.permRow}>
          <Text style={styles.permIcon}>📍</Text>
          <View style={styles.permText}>
            <Text style={styles.permTitle}>Location</Text>
            <Text style={styles.permDesc}>To track your route and give turn-by-turn instructions in real time.</Text>
          </View>
        </View>

        <View style={styles.permRow}>
          <Text style={styles.permIcon}>🎙</Text>
          <View style={styles.permText}>
            <Text style={styles.permTitle}>Microphone</Text>
            <Text style={styles.permDesc}>To capture your voice during conversation with the AI instructor.</Text>
          </View>
        </View>

        <View style={styles.permRow}>
          <Text style={styles.permIcon}>🗣</Text>
          <View style={styles.permText}>
            <Text style={styles.permTitle}>Speech Recognition</Text>
            <Text style={styles.permDesc}>To understand what you say so the instructor can respond naturally.</Text>
          </View>
        </View>

        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => Linking.openSettings()}>
              <Text style={styles.settingsLink}>Open Settings →</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={requestPermissions}
          disabled={loading}
        >
          <Text style={styles.btnText}>{loading ? 'Requesting...' : 'Grant permissions'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0f1e' },
  container: { flex: 1, padding: 32, justifyContent: 'center', gap: 24 },
  icon: { fontSize: 48, textAlign: 'center' },
  title: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center' },
  permRow: { flexDirection: 'row', gap: 16, backgroundColor: '#131929', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  permIcon: { fontSize: 28 },
  permText: { flex: 1, gap: 4 },
  permTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  permDesc: { color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 20 },
  errorCard: { backgroundColor: 'rgba(248,113,113,0.1)', borderRadius: 12, padding: 16, gap: 10, borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)' },
  errorText: { color: '#f87171', fontSize: 14, lineHeight: 20 },
  settingsLink: { color: '#60a5fa', fontSize: 14, fontWeight: '600' },
  btn: { backgroundColor: '#16a34a', borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
