import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { signInWithGoogle } from '../src/services/supabase';

// Landing + sign-in. Light theme by design: this is the one screen shown in
// daylight before driving (the session UI stays dark for night-driving glare).
// Guest entry is intentionally absent — ephemeral guest mode is MVP-3
// (ADR-0002) and offering it before it exists would dead-end the user.

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const FEATURES: {
  icon: IconName;
  iconColor: string;
  tint: string;
  border: string;
  title: string;
  body: string;
}[] = [
  {
    icon: 'locate-outline',
    iconColor: '#1d4ed8',
    tint: '#dbeafe',
    border: '#bfdbfe',
    title: 'Live GPS routing',
    body: 'Runs a real test-style route near you.',
  },
  {
    icon: 'mic-outline',
    iconColor: '#047857',
    tint: '#d1fae5',
    border: '#a7f3d0',
    title: 'AI voice examiner',
    body: 'Speaks directions and asks you to call hazards.',
  },
  {
    icon: 'shield-checkmark-outline',
    iconColor: '#1d4ed8',
    tint: '#dbeafe',
    border: '#bfdbfe',
    title: 'Road Code scoring',
    body: 'Marked against official NZ full-licence test criteria.',
  },
];

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleLogin() {
    setLoading(true);
    setError(null);
    try {
      const userId = await signInWithGoogle();
      if (!userId) setError('Sign-in was cancelled or failed. Please try again.');
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Overrides the app-wide light status bar — this screen is light */}
      <StatusBar style="dark" />

      <View style={styles.container}>
        <View style={styles.badge}>
          <Ionicons name="swap-horizontal" size={15} color="#1663c7" />
          <Text style={styles.badgeText}>Overseas full licence → NZ full licence</Text>
        </View>

        <Text style={styles.title}>Pass your NZ practical test.</Text>
        <Text style={styles.subtitle}>
          A full simulation of the real NZ full-licence test. An AI examiner directs the drive,
          questions your hazards, and marks you against the exact same criteria as the official test.
        </Text>

        <View style={styles.features}>
          {FEATURES.map((f, i) => (
            <View key={f.title}>
              {i > 0 && <View style={styles.divider} />}
              <View style={styles.featureRow}>
                <View style={[styles.featureIconBox, { backgroundColor: f.tint, borderColor: f.border }]}>
                  <Ionicons name={f.icon} size={24} color={f.iconColor} />
                </View>
                <View style={styles.featureCopy}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureBody}>{f.body}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.googleBtn, loading && styles.btnDisabled]}
            onPress={handleGoogleLogin}
            disabled={loading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            accessibilityState={{ disabled: loading, busy: loading }}
          >
            {loading ? (
              <ActivityIndicator color="#0b1220" size="small" />
            ) : (
              <>
                <Ionicons name="logo-google" size={20} color="#4285F4" />
                <Text style={styles.googleText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            Sessions are saved to your Google account. Nothing beyond your name and email is collected.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#eef2f8' },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },

  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e4edfb',
    borderWidth: 1,
    borderColor: '#c3dbf7',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  badgeText: {
    flexShrink: 1,
    color: '#1663c7',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    lineHeight: 17,
  },

  title: {
    color: '#0b1220',
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -1.4,
    lineHeight: 48,
    marginTop: 24,
  },
  subtitle: {
    color: '#56657a',
    fontSize: 17,
    lineHeight: 25,
    marginTop: 16,
  },

  features: { marginTop: 36 },
  divider: { height: 1, backgroundColor: '#dbe2ed' },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 18 },
  featureIconBox: {
    width: 52,
    height: 52,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCopy: { flex: 1, gap: 3 },
  featureTitle: { color: '#0b1220', fontSize: 17, fontWeight: '700' },
  featureBody: { color: '#56657a', fontSize: 15, lineHeight: 21 },

  footer: { marginTop: 'auto', gap: 14 },
  errorCard: {
    backgroundColor: '#fdeaea',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#f3bdbd',
  },
  errorText: { color: '#b42323', fontSize: 14 },
  googleBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#0b1220',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  btnDisabled: { opacity: 0.6 },
  googleText: { color: '#0b1220', fontSize: 17, fontWeight: '700' },
  disclaimer: {
    color: '#697687',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: 8,
  },
});
