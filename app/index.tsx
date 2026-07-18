import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, SafeAreaView, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getCurrentUserId, fetchSessions, supabase, signOut } from '../src/services/supabase';
import { NZ_DRIVING } from '../src/constants/nzDriving';

interface SessionSummary {
  id: string;
  start_time: string;
  duration_seconds: number;
  score: { overall: number } | null;
  status: string;
}

export default function HomeScreen() {
  const router = useRouter();
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
    loadUser();
  }, []);

  async function loadUser() {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      setUserName(data.user.user_metadata?.full_name ?? data.user.email ?? null);
      setAvatarUrl(data.user.user_metadata?.avatar_url ?? null);
    }
  }

  async function loadSessions() {
    try {
      const userId = await getCurrentUserId();
      if (userId) {
        const sessions = await fetchSessions(userId);
        setRecentSessions(sessions.slice(0, 3));
      }
    } catch {
      // Offline
    } finally {
      setLoading(false);
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-NZ', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* User row */}
        {userName && (
          <View style={styles.userRow}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{userName[0].toUpperCase()}</Text>
              </View>
            )}
            <Text style={styles.userName} numberOfLines={1}>{userName}</Text>
            <TouchableOpacity onPress={async () => {
              try { await signOut(); } catch { /* session cleared locally even on network error */ }
            }}>
              <Text style={styles.signOut}>Sign out</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.flag}>🇳🇿</Text>
          <Text style={styles.title}>NZ Drive Practice</Text>
          <Text style={styles.subtitle}>Prepare for your practical test</Text>
        </View>

        {/* Session Info */}
        <View style={styles.infoCard}>
          <InfoRow icon="⏱" label="Session duration" value={`${NZ_DRIVING.SESSION_DURATION_MINUTES} minutes`} />
          <InfoRow icon="🗺" label="Route type" value="Urban roads (no highway)" />
          <InfoRow icon="🎙" label="Hazard checks" value="Every ~3 minutes" />
          <InfoRow icon="📊" label="Feedback" value="AI analysis after each session" />
        </View>

        {/* Start Button */}
        <TouchableOpacity
          style={styles.startButton}
          onPress={() => router.push('/session')}
          activeOpacity={0.85}
        >
          <Text style={styles.startIcon}>▶</Text>
          <Text style={styles.startText}>Start Driving Session</Text>
          <Text style={styles.startHint}>Make sure you're in a safe location to begin</Text>
        </TouchableOpacity>

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Sessions</Text>
              <TouchableOpacity onPress={() => router.push('/history')}>
                <Text style={styles.sectionLink}>See all</Text>
              </TouchableOpacity>
            </View>
            {recentSessions.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={styles.sessionCard}
                onPress={() => router.push(`/feedback/${s.id}`)}
              >
                <View style={styles.sessionLeft}>
                  <Text style={styles.sessionDate}>{formatDate(s.start_time)}</Text>
                  <Text style={styles.sessionDuration}>{formatDuration(s.duration_seconds)}</Text>
                </View>
                <View style={styles.sessionRight}>
                  {s.score ? (
                    <View style={styles.scoreBadge}>
                      <Text style={styles.scoreText}>{s.score.overall}</Text>
                      <Text style={styles.scoreLabel}>/100</Text>
                    </View>
                  ) : (
                    <Text style={styles.noScore}>—</Text>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Tip */}
        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>NZ Driving Tip</Text>
          <Text style={styles.tipText}>
            In New Zealand you drive on the LEFT. At roundabouts, give way to vehicles already on the roundabout. Always check mirrors before changing speed or direction.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoIcon}>{icon}</Text>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0f1e' },
  container: { padding: 20, gap: 20, paddingBottom: 40 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  avatarPlaceholder: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#16a34a', justifyContent: 'center', alignItems: 'center' },
  avatarInitial: { color: '#fff', fontSize: 14, fontWeight: '700' },
  userName: { flex: 1, color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  signOut: { color: 'rgba(255,255,255,0.3)', fontSize: 13 },
  header: {
    alignItems: 'center',
    paddingTop: 24,
    gap: 8,
  },
  flag: { fontSize: 48 },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '400',
  },
  infoCard: {
    backgroundColor: '#131929',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoIcon: { fontSize: 16, width: 22 },
  infoLabel: { flex: 1, color: 'rgba(255,255,255,0.55)', fontSize: 13 },
  infoValue: { color: '#ffffff', fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  startButton: {
    backgroundColor: '#16a34a',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 6,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  startIcon: { fontSize: 32 },
  startText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  startHint: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    textAlign: 'center',
  },
  section: { gap: 12 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
  sectionLink: { color: '#60a5fa', fontSize: 14, fontWeight: '600' },
  sessionCard: {
    backgroundColor: '#131929',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  sessionLeft: { flex: 1, gap: 4 },
  sessionDate: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  sessionDuration: { color: 'rgba(255,255,255,0.45)', fontSize: 13 },
  sessionRight: { alignItems: 'center' },
  scoreBadge: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  scoreText: { color: '#4ade80', fontSize: 24, fontWeight: '800' },
  scoreLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
  noScore: { color: 'rgba(255,255,255,0.3)', fontSize: 20 },
  tipCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
  },
  tipTitle: { color: '#60a5fa', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  tipText: { color: 'rgba(255,255,255,0.65)', fontSize: 14, lineHeight: 20 },
});
