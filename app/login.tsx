import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { signInWithGoogle } from '../src/services/supabase';

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
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.flag}>🇳🇿</Text>
          <Text style={styles.title}>NZ Drive Practice</Text>
          <Text style={styles.subtitle}>Sign in to save your progress and track your improvement over time.</Text>
        </View>

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
        >
          {loading ? (
            <ActivityIndicator color="#000" size="small" />
          ) : (
            <>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Your sessions are stored securely and linked to your Google account. No personal data beyond your name and email is collected.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0f1e' },
  container: { flex: 1, padding: 32, justifyContent: 'center', gap: 28 },
  header: { alignItems: 'center', gap: 12 },
  flag: { fontSize: 56 },
  title: { color: '#ffffff', fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  errorCard: { backgroundColor: 'rgba(248,113,113,0.1)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)' },
  errorText: { color: '#f87171', fontSize: 14 },
  googleBtn: {
    backgroundColor: '#ffffff', borderRadius: 16, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  btnDisabled: { opacity: 0.6 },
  googleIcon: { fontSize: 20, fontWeight: '900', color: '#4285F4' },
  googleText: { color: '#000000', fontSize: 17, fontWeight: '700' },
  disclaimer: { color: 'rgba(255,255,255,0.25)', fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
