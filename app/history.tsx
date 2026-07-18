import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, SafeAreaView,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getCurrentUserId, fetchSessions } from '../src/services/supabase';

interface SessionRow {
  id: string;
  start_time: string;
  duration_seconds: number;
  total_distance_meters: number;
  average_speed_kmh: number;
  score: {
    overall: number;
    hazardAwareness?: number;
    speedCompliance?: number;
    stopCompliance?: number;
    navigationCompliance?: number;
    knowledgeScore?: number;
  } | null;
  status: string;
}

// ─── Progress helpers ─────────────────────────────────────────────────────────

function computeProgress(sessions: SessionRow[]) {
  const scored = sessions.filter((s) => s.score?.overall != null);
  if (scored.length === 0) return null;

  const scores = scored.map((s) => s.score!.overall);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  // Trend: avg of last 3 vs previous 3
  let trend: 'up' | 'down' | 'flat' = 'flat';
  let trendPts = 0;
  if (scored.length >= 4) {
    const recent = scores.slice(0, 3);
    const prev = scores.slice(3, 6);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const prevAvg = prev.reduce((a, b) => a + b, 0) / prev.length;
    trendPts = Math.round(recentAvg - prevAvg);
    trend = trendPts > 1 ? 'up' : trendPts < -1 ? 'down' : 'flat';
  }

  // Sessions this week
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = sessions.filter((s) => new Date(s.start_time).getTime() > weekAgo).length;

  // Best category (average across sessions with score)
  const catKeys: Array<keyof NonNullable<SessionRow['score']>> = [
    'hazardAwareness', 'speedCompliance', 'stopCompliance', 'navigationCompliance', 'knowledgeScore',
  ];
  const catLabels: Record<string, string> = {
    hazardAwareness: 'Hazard Awareness',
    speedCompliance: 'Speed',
    stopCompliance: 'Stop Signs',
    navigationCompliance: 'Navigation',
    knowledgeScore: 'Road Rules',
  };
  const catAverages: Record<string, number> = {};
  for (const key of catKeys) {
    const vals = scored.map((s) => (s.score as any)[key]).filter((v) => v != null) as number[];
    if (vals.length > 0) catAverages[key] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  const bestCat = Object.entries(catAverages).sort((a, b) => b[1] - a[1])[0];
  const worstCat = Object.entries(catAverages).sort((a, b) => a[1] - b[1])[0];

  // Sparkline — last 8 sessions
  const sparkScores = scores.slice(0, 8).reverse();

  return { avg, trend, trendPts, thisWeek, bestCat, worstCat, catAverages, catLabels, sparkScores };
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ scores }: { scores: number[] }) {
  const max = 100;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 32, marginTop: 4 }}>
      {scores.map((s, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: Math.max(4, (s / max) * 32),
            backgroundColor: s >= 80 ? '#4ade80' : s >= 60 ? '#fbbf24' : '#f87171',
            borderRadius: 2,
          }}
        />
      ))}
    </View>
  );
}

// ─── Progress dashboard ───────────────────────────────────────────────────────

function ProgressDashboard({ sessions }: { sessions: SessionRow[] }) {
  const p = computeProgress(sessions);
  if (!p) return null;

  const trendIcon = p.trend === 'up' ? '↑' : p.trend === 'down' ? '↓' : '→';
  const trendColor = p.trend === 'up' ? '#4ade80' : p.trend === 'down' ? '#f87171' : 'rgba(255,255,255,0.4)';

  return (
    <View style={dash.card}>
      {/* Row 1: total + average + trend */}
      <View style={dash.topRow}>
        <View>
          <Text style={dash.bigNum}>{sessions.length}</Text>
          <Text style={dash.label}>sessions</Text>
        </View>
        <View style={dash.divider} />
        <View style={{ alignItems: 'center' }}>
          <Text style={dash.bigNum}>{p.avg}<Text style={dash.outOf}>/100</Text></Text>
          <Text style={dash.label}>average</Text>
        </View>
        <View style={dash.divider} />
        <View style={{ alignItems: 'center' }}>
          <Text style={[dash.trendNum, { color: trendColor }]}>
            {trendIcon} {Math.abs(p.trendPts) > 0 ? `${Math.abs(p.trendPts)} pts` : '—'}
          </Text>
          <Text style={dash.label}>trend</Text>
        </View>
      </View>

      {/* Week count */}
      <Text style={dash.weekText}>
        {p.thisWeek === 0 ? 'No sessions this week'
          : p.thisWeek === 1 ? '1 session this week'
          : `${p.thisWeek} sessions this week`}
      </Text>

      {/* Category bars */}
      {Object.entries(p.catAverages).slice(0, 4).map(([key, val]) => (
        <View key={key} style={dash.catRow}>
          <Text style={dash.catLabel}>{p.catLabels[key]}</Text>
          <View style={dash.catBarBg}>
            <View style={[dash.catBarFill, {
              width: `${val}%`,
              backgroundColor: val >= 80 ? '#4ade80' : val >= 60 ? '#fbbf24' : '#f87171',
            }]} />
          </View>
          <Text style={[dash.catVal, { color: val >= 80 ? '#4ade80' : val >= 60 ? '#fbbf24' : '#f87171' }]}>
            {val}
          </Text>
        </View>
      ))}

      {/* Sparkline */}
      {p.sparkScores.length > 1 && (
        <View style={{ marginTop: 8 }}>
          <Text style={dash.sparkLabel}>Score — last {p.sparkScores.length} sessions</Text>
          <Sparkline scores={p.sparkScores} />
        </View>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const userId = await getCurrentUserId();
      if (userId) setSessions(await fetchSessions(userId));
    } catch { /* offline */ } finally {
      setLoading(false);
    }
  }

  function scoreColor(score: number | null): string {
    if (!score) return 'rgba(255,255,255,0.3)';
    if (score >= 80) return '#4ade80';
    if (score >= 60) return '#fbbf24';
    return '#f87171';
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-NZ', {
      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function formatDuration(s: number): string {
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color="#4ade80" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {sessions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🚗</Text>
            <Text style={styles.emptyTitle}>No sessions yet</Text>
            <Text style={styles.emptySubtitle}>Complete your first driving session to see your history.</Text>
            <TouchableOpacity style={styles.startBtn} onPress={() => router.push('/session')}>
              <Text style={styles.startBtnText}>Start First Session</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <ProgressDashboard sessions={sessions} />
            <Text style={styles.count}>{sessions.length} sessions</Text>
            {sessions.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={styles.card}
                onPress={() => router.push(`/feedback/${s.id}`)}
                activeOpacity={0.75}
              >
                <View style={styles.cardLeft}>
                  <Text style={styles.cardDate}>{formatDate(s.start_time)}</Text>
                  <View style={styles.cardMeta}>
                    <Text style={styles.cardMetaText}>{formatDuration(s.duration_seconds)}</Text>
                    <Text style={styles.cardMetaSep}>·</Text>
                    <Text style={styles.cardMetaText}>{(s.total_distance_meters / 1000).toFixed(1)} km</Text>
                    <Text style={styles.cardMetaSep}>·</Text>
                    <Text style={styles.cardMetaText}>{s.average_speed_kmh} km/h avg</Text>
                  </View>
                </View>
                <View style={styles.cardRight}>
                  <Text style={[styles.cardScore, { color: scoreColor(s.score?.overall ?? null) }]}>
                    {s.score?.overall ?? '—'}
                  </Text>
                  <Text style={styles.cardScoreLabel}>/100</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const dash = StyleSheet.create({
  card: { backgroundColor: '#131929', borderRadius: 20, padding: 20, gap: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 4 },
  topRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  bigNum: { color: '#ffffff', fontSize: 28, fontWeight: '900', textAlign: 'center' },
  outOf: { color: 'rgba(255,255,255,0.3)', fontSize: 14, fontWeight: '400' },
  trendNum: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  label: { color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'center', marginTop: 2 },
  divider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.08)' },
  weekText: { color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center' },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12, width: 90 },
  catBarBg: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' },
  catBarFill: { height: '100%', borderRadius: 3 },
  catVal: { fontSize: 12, fontWeight: '700', width: 24, textAlign: 'right' },
  sparkLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 11, marginBottom: 4 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0f1e' },
  centered: { flex: 1, backgroundColor: '#0a0f1e', justifyContent: 'center', alignItems: 'center' },
  container: { padding: 20, gap: 12, paddingBottom: 40 },
  count: { color: 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  card: { backgroundColor: '#131929', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  cardLeft: { flex: 1, gap: 6 },
  cardDate: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardMetaText: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  cardMetaSep: { color: 'rgba(255,255,255,0.2)', fontSize: 12 },
  cardRight: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  cardScore: { fontSize: 26, fontWeight: '800' },
  cardScoreLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 13 },
  empty: { alignItems: 'center', gap: 14, paddingTop: 80 },
  emptyIcon: { fontSize: 64 },
  emptyTitle: { color: '#ffffff', fontSize: 20, fontWeight: '700' },
  emptySubtitle: { color: 'rgba(255,255,255,0.45)', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  startBtn: { backgroundColor: '#16a34a', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14, marginTop: 8 },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
