import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/services/supabase';

interface EventLogEntry {
  relativeMinute: number;
  type: string;
  description: string;
  severity: 'good' | 'warning' | 'violation';
}

interface SessionData {
  id: string;
  start_time: string;
  duration_seconds: number;
  total_distance_meters: number;
  average_speed_kmh: number;
  score: {
    overall: number;
    hazardAwareness: number;
    knowledgeScore: number;
    speedCompliance: number;
    stopCompliance: number;
    navigationCompliance: number;
    sessionCompletion: number;
    observations: string[];
    improvements: string[];
    eventLog?: EventLogEntry[];
  } | null;
  feedback: string | null;
  status: string;
}

export default function FeedbackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSession();
  }, [id]);

  async function loadSession() {
    try {
      const { data } = await supabase.from('sessions').select('*').eq('id', id).single();
      if (data) setSession(data);
    } catch {
      // Try local state if Supabase unavailable
    } finally {
      setLoading(false);
    }
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m} min ${s} sec`;
  }

  function scoreColor(score: number): string {
    if (score >= 80) return '#4ade80';
    if (score >= 60) return '#fbbf24';
    return '#f87171';
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#4ade80" />
        <Text style={styles.loadingText}>Loading feedback...</Text>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>Session not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/')}>
          <Text style={styles.backBtnText}>Go Home</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const score = session.score;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Session Complete</Text>
          <Text style={styles.date}>
            {new Date(session.start_time).toLocaleDateString('en-NZ', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </Text>
        </View>

        {/* Overall Score */}
        {score && (
          <View style={styles.scoreCard}>
            <View style={[styles.scoreCircle, { borderColor: scoreColor(score.overall) }]}>
              <Text style={[styles.scoreNumber, { color: scoreColor(score.overall) }]}>
                {score.overall}
              </Text>
              <Text style={styles.scoreMax}>/100</Text>
            </View>
            <Text style={styles.scoreLabel}>Overall Score</Text>
          </View>
        )}

        {/* Stats */}
        <View style={styles.statsGrid}>
          <StatCard
            label="Duration"
            value={formatDuration(session.duration_seconds)}
            icon="⏱"
          />
          <StatCard
            label="Distance"
            value={`${(session.total_distance_meters / 1000).toFixed(1)} km`}
            icon="📍"
          />
          <StatCard
            label="Avg Speed"
            value={`${session.average_speed_kmh} km/h`}
            icon="🚗"
          />
        </View>

        {/* Score Breakdown */}
        {score && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Score Breakdown</Text>
            <ScoreBar label="Hazard Awareness" value={score.hazardAwareness} color={scoreColor(score.hazardAwareness)} />
            <ScoreBar label="Road Rules Knowledge" value={score.knowledgeScore ?? 100} color={scoreColor(score.knowledgeScore ?? 100)} />
            <ScoreBar label="Speed Compliance" value={score.speedCompliance} color={scoreColor(score.speedCompliance)} />
            <ScoreBar label="Stop Compliance" value={score.stopCompliance} color={scoreColor(score.stopCompliance)} />
            <ScoreBar label="Navigation" value={score.navigationCompliance} color={scoreColor(score.navigationCompliance)} />
            <ScoreBar label="Session Completion" value={score.sessionCompletion} color={scoreColor(score.sessionCompletion)} />
          </View>
        )}

        {/* AI Feedback */}
        {session.feedback && (
          <View style={styles.feedbackCard}>
            <View style={styles.feedbackHeader}>
              <Text style={styles.feedbackIcon}>🤖</Text>
              <Text style={styles.feedbackTitle}>Instructor Feedback</Text>
            </View>
            <Text style={styles.feedbackText}>{session.feedback}</Text>
          </View>
        )}

        {/* Event Timeline */}
        {score?.eventLog && score.eventLog.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Session Timeline</Text>
            {score.eventLog.map((entry, i) => (
              <TimelineEntry key={i} entry={entry} />
            ))}
          </View>
        )}

        {/* Observations */}
        {score?.observations && score.observations.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Observations</Text>
            {score.observations.map((obs, i) => (
              <View key={i} style={styles.listItem}>
                <Text style={styles.listBullet}>✓</Text>
                <Text style={styles.listText}>{obs}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Improvements */}
        {score?.improvements && score.improvements.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Areas to Improve</Text>
            {score.improvements.map((imp, i) => (
              <View key={i} style={styles.listItem}>
                <Text style={styles.listBullet}>→</Text>
                <Text style={styles.listText}>{imp}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace('/session')}
          >
            <Text style={styles.primaryBtnText}>Drive Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/')}>
            <Text style={styles.secondaryBtnText}>Go Home</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const TIMELINE_ICONS: Record<string, string> = {
  hazard_good: '✓', hazard_partial: '~', hazard_missed: '✗',
  knowledge_correct: '✓', knowledge_partial: '~', knowledge_incorrect: '✗',
  decision_good: '✓', decision_poor: '~',
  speed_violation: '⚠', stop_complied: '✓', stop_violation: '✗',
  navigation: '↻', braking: '!', unexpected_stop: '‼',
};

function TimelineEntry({ entry }: { entry: EventLogEntry }) {
  const color = entry.severity === 'good' ? '#4ade80' : entry.severity === 'warning' ? '#fbbf24' : '#f87171';
  const icon = TIMELINE_ICONS[entry.type] ?? '·';
  return (
    <View style={styles.timelineRow}>
      <Text style={[styles.timelineMin, { color }]}>{entry.relativeMinute}m</Text>
      <View style={[styles.timelineDot, { backgroundColor: color }]} />
      <Text style={[styles.timelineIcon, { color }]}>{icon}</Text>
      <Text style={styles.timelineDesc} numberOfLines={2}>{entry.description}</Text>
    </View>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.scoreBarContainer}>
      <View style={styles.scoreBarHeader}>
        <Text style={styles.scoreBarLabel}>{label}</Text>
        <Text style={[styles.scoreBarValue, { color }]}>{value}</Text>
      </View>
      <View style={styles.scoreBarTrack}>
        <View
          style={[styles.scoreBarFill, { width: `${value}%`, backgroundColor: color }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0f1e' },
  centered: {
    flex: 1,
    backgroundColor: '#0a0f1e',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: { color: 'rgba(255,255,255,0.6)', fontSize: 15 },
  errorText: { color: '#f87171', fontSize: 16 },
  backBtn: {
    backgroundColor: '#131929',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backBtnText: { color: '#fff', fontWeight: '600' },
  container: { padding: 20, gap: 20, paddingBottom: 40 },
  header: { alignItems: 'center', gap: 6, paddingTop: 8 },
  title: { color: '#ffffff', fontSize: 26, fontWeight: '800' },
  date: { color: 'rgba(255,255,255,0.45)', fontSize: 14 },
  scoreCard: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  scoreCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'baseline' as any,
    flexDirection: 'row',
    backgroundColor: '#131929',
  },
  scoreNumber: { fontSize: 42, fontWeight: '900' },
  scoreMax: { color: 'rgba(255,255,255,0.4)', fontSize: 16, marginBottom: 6 },
  scoreLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 15 },
  statsGrid: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: '#131929',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  statIcon: { fontSize: 20 },
  statValue: { color: '#ffffff', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  statLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'center' },
  section: { gap: 12 },
  sectionTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
  scoreBarContainer: { gap: 8 },
  scoreBarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scoreBarLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  scoreBarValue: { fontSize: 16, fontWeight: '700' },
  scoreBarTrack: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  scoreBarFill: { height: '100%', borderRadius: 4 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  timelineMin: { fontSize: 11, fontWeight: '700', width: 24, textAlign: 'right' },
  timelineDot: { width: 8, height: 8, borderRadius: 4 },
  timelineIcon: { fontSize: 12, fontWeight: '800', width: 14, textAlign: 'center' },
  timelineDesc: { flex: 1, color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 18 },
  feedbackCard: {
    backgroundColor: '#0f1f2e',
    borderRadius: 16,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.3)',
  },
  feedbackHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  feedbackIcon: { fontSize: 22 },
  feedbackTitle: { color: '#60a5fa', fontSize: 16, fontWeight: '700' },
  feedbackText: { color: 'rgba(255,255,255,0.8)', fontSize: 15, lineHeight: 24 },
  listItem: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  listBullet: { color: '#4ade80', fontSize: 14, fontWeight: '700', marginTop: 2 },
  listText: { flex: 1, color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 21 },
  actions: { gap: 12, paddingTop: 8 },
  primaryBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  secondaryBtn: {
    backgroundColor: '#131929',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  secondaryBtnText: { color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '600' },
});
