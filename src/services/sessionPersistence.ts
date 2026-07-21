import { supabase } from './supabase';
import { DrivingSession } from '../types';

// Incremental, idempotent session persistence (ROADMAP MVP-0).
// checkpointSession() is called every minute during an active session and once
// at completion — every write is an upsert (or duplicate-ignoring insert for
// GPS), so replays are safe and a crash at minute 18 loses at most a minute.

const GPS_CHUNK = 500;

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

const iso = (ms: number) => new Date(ms).toISOString();

// ─── Pure row mappers (unit-tested) ──────────────────────────────────────────

export function buildSessionRow(s: DrivingSession) {
  return {
    id: s.id,
    user_id: s.userId,
    start_time: iso(s.startTime),
    end_time: s.endTime ? iso(s.endTime) : null,
    duration_seconds: Math.round(s.duration),
    total_distance_meters: Math.round(s.totalDistance),
    average_speed_kmh: Math.round(s.averageSpeed),
    status: s.status,
    score: s.score ?? null,
    feedback: s.feedback ?? null,
  };
}

export function buildGpsRows(s: DrivingSession, fromSequence = 0) {
  return s.routeCoordinates.slice(fromSequence).map((p, i) => ({
    session_id: s.id,
    sequence: fromSequence + i,
    latitude: p.coordinate.latitude,
    longitude: p.coordinate.longitude,
    speed_ms: p.speed,
    heading: p.heading,
    recorded_at: iso(p.timestamp),
  }));
}

const base = (e: { id: string; sessionId: string; timestamp: number; location: { latitude: number; longitude: number } }) => ({
  id: e.id,
  session_id: e.sessionId,
  occurred_at: iso(e.timestamp),
  latitude: e.location.latitude,
  longitude: e.location.longitude,
});

export function buildHazardRows(s: DrivingSession) {
  return s.hazardEvents.map((e) => ({
    ...base(e),
    prompt: e.prompt,
    response: e.response,
    detected_correctly: e.detectedCorrectly,
    evaluation_quality: e.claudeEvaluation?.quality ?? null,
    evaluation_feedback: e.claudeEvaluation?.feedback ?? null,
  }));
}

export function buildKnowledgeRows(s: DrivingSession) {
  return s.knowledgeEvents.map((e) => ({
    ...base(e),
    question: e.question,
    expected_answer: e.expectedAnswer,
    response: e.response,
    evaluation_quality: e.claudeEvaluation?.quality ?? null,
    evaluation_feedback: e.claudeEvaluation?.feedback ?? null,
  }));
}

export function buildDecisionRows(s: DrivingSession) {
  return s.decisionEvents.map((e) => ({
    ...base(e),
    trigger: e.trigger,
    question: e.question,
    response: e.response,
    evaluation_quality: e.claudeEvaluation?.quality ?? null,
    evaluation_feedback: e.claudeEvaluation?.feedback ?? null,
  }));
}

export function buildSpeedRows(s: DrivingSession) {
  return s.speedViolations.map((e) => ({
    ...base(e),
    speed_kmh: e.speedKmh,
    limit_kmh: e.limitKmh,
    severity: e.severity,
    duration_seconds: e.durationSeconds,
  }));
}

export function buildStopRows(s: DrivingSession) {
  return s.stopEvents.map((e) => ({
    ...base(e),
    type: e.type,
    complied: e.complied,
    lowest_speed_kmh: e.lowestSpeedKmh,
  }));
}

export function buildBrakingRows(s: DrivingSession) {
  return s.brakingEvents.map((e) => ({
    ...base(e),
    speed_from_kmh: e.speedFromKmh,
    speed_to_kmh: e.speedToKmh,
    delta_kmh: e.deltaKmh,
  }));
}

export function buildNavigationRows(s: DrivingSession) {
  return s.navigationEvents.map((e) => ({
    ...base(e),
    instruction_given: e.instructionGiven,
    type: e.type,
  }));
}

// ─── Checkpoint ──────────────────────────────────────────────────────────────

export interface CheckpointResult {
  ok: boolean;
  skipped?: 'unauthenticated';
  errors: string[];
}

/**
 * Persist the full current state of a session. Idempotent: session row and
 * event rows are upserted on their primary key; GPS rows are inserted with
 * duplicates ignored on (session_id, sequence).
 */
export async function checkpointSession(session: DrivingSession): Promise<CheckpointResult> {
  // Guest / not-yet-resolved auth: sessions.user_id is a FK to auth.users —
  // never send non-UUID ids (this was the source of the v1 save errors).
  if (!isUuid(session.userId)) {
    return { ok: false, skipped: 'unauthenticated', errors: [] };
  }

  const errors: string[] = [];

  const { error: sessionError } = await supabase.from('sessions').upsert(buildSessionRow(session));
  if (sessionError) {
    // Without the session row, event FKs cannot resolve — stop here.
    return { ok: false, errors: [`sessions: ${sessionError.message}`] };
  }

  const gpsRows = buildGpsRows(session);
  for (let i = 0; i < gpsRows.length; i += GPS_CHUNK) {
    const { error } = await supabase
      .from('gps_tracks')
      .upsert(gpsRows.slice(i, i + GPS_CHUNK), { onConflict: 'session_id,sequence', ignoreDuplicates: true });
    if (error) { errors.push(`gps_tracks: ${error.message}`); break; }
  }

  const eventBatches: [string, Record<string, unknown>[]][] = [
    ['hazard_events', buildHazardRows(session)],
    ['knowledge_events', buildKnowledgeRows(session)],
    ['decision_events', buildDecisionRows(session)],
    ['speed_violations', buildSpeedRows(session)],
    ['stop_events', buildStopRows(session)],
    ['braking_events', buildBrakingRows(session)],
    ['navigation_events', buildNavigationRows(session)],
  ];

  for (const [table, rows] of eventBatches) {
    if (rows.length === 0) continue;
    const { error } = await supabase.from(table).upsert(rows);
    if (error) errors.push(`${table}: ${error.message}`);
  }

  return { ok: errors.length === 0, errors };
}
