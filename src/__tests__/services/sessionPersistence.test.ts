import {
  isUuid, buildSessionRow, buildGpsRows, buildHazardRows, buildKnowledgeRows,
  buildSpeedRows, buildStopRows, buildBrakingRows, buildNavigationRows,
  checkpointSession,
} from '../../services/sessionPersistence';
import { DrivingSession } from '../../types';

const mockUpsert = jest.fn(async () => ({ error: null }));
jest.mock('../../services/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({ upsert: mockUpsert })),
  },
}));

const USER_ID = '11111111-2222-3333-4444-555555555555';
const LOC = { latitude: -36.8485, longitude: 174.7633 };

function makeSession(overrides: Partial<DrivingSession> = {}): DrivingSession {
  return {
    id: 'sess-1',
    userId: USER_ID,
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_600_000,
    duration: 600,
    routeCoordinates: [
      { coordinate: LOC, timestamp: 1_700_000_000_000, speed: 10, heading: 90 },
      { coordinate: { latitude: -36.849, longitude: 174.764 }, timestamp: 1_700_000_002_000, speed: 11, heading: 92 },
    ],
    hazardEvents: [{
      id: 'h1', sessionId: 'sess-1', timestamp: 1_700_000_100_000, location: LOC,
      prompt: 'What hazards?', response: 'A cyclist', detectedCorrectly: true,
      claudeEvaluation: { quality: 'good', feedback: 'Nice' },
    }],
    knowledgeEvents: [{
      id: 'k1', sessionId: 'sess-1', timestamp: 1_700_000_200_000, location: LOC,
      question: 'Speed limit?', expectedAnswer: '50 km/h', response: 'fifty',
    }],
    decisionEvents: [],
    speedViolations: [{
      id: 'sv1', sessionId: 'sess-1', timestamp: 1_700_000_300_000, location: LOC,
      speedKmh: 63, limitKmh: 50, severity: 'immediate_fail', durationSeconds: 4,
    }],
    stopEvents: [{
      id: 'st1', sessionId: 'sess-1', timestamp: 1_700_000_350_000, location: LOC,
      type: 'stop_sign', complied: false, lowestSpeedKmh: 12,
    }],
    brakingEvents: [{
      id: 'b1', sessionId: 'sess-1', timestamp: 1_700_000_400_000, location: LOC,
      speedFromKmh: 50, speedToKmh: 20, deltaKmh: 30,
    }],
    navigationEvents: [{
      id: 'n1', sessionId: 'sess-1', timestamp: 1_700_000_450_000, location: LOC,
      instructionGiven: 'Turn left here.', type: 'wrong_turn',
    }],
    totalDistance: 5000,
    averageSpeed: 30,
    status: 'completed',
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

// ─── isUuid ──────────────────────────────────────────────────────────────────

describe('isUuid', () => {
  it('accepts a valid uuid', () => expect(isUuid(USER_ID)).toBe(true));
  it('rejects the v1 "anon" placeholder', () => expect(isUuid('anon')).toBe(false));
  it('rejects empty string', () => expect(isUuid('')).toBe(false));
});

// ─── Row mappers ─────────────────────────────────────────────────────────────

describe('row mappers', () => {
  const s = makeSession();

  it('buildSessionRow maps to snake_case with ISO dates', () => {
    const row = buildSessionRow(s);
    expect(row).toMatchObject({
      id: 'sess-1', user_id: USER_ID, status: 'completed',
      duration_seconds: 600, total_distance_meters: 5000, average_speed_kmh: 30,
    });
    expect(row.start_time).toBe(new Date(s.startTime).toISOString());
  });

  it('buildGpsRows assigns sequential sequence numbers', () => {
    const rows = buildGpsRows(s);
    expect(rows.map((r) => r.sequence)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({ session_id: 'sess-1', speed_ms: 10, heading: 90 });
  });

  it('buildGpsRows(fromSequence) slices and keeps absolute sequences', () => {
    const rows = buildGpsRows(s, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].sequence).toBe(1);
  });

  it('buildHazardRows flattens the AI evaluation', () => {
    expect(buildHazardRows(s)[0]).toMatchObject({
      id: 'h1', prompt: 'What hazards?', evaluation_quality: 'good', evaluation_feedback: 'Nice',
    });
  });

  it('buildKnowledgeRows maps null evaluation when absent', () => {
    expect(buildKnowledgeRows(s)[0]).toMatchObject({
      id: 'k1', expected_answer: '50 km/h', evaluation_quality: null,
    });
  });

  it('speed/stop/braking/navigation rows carry their metrics', () => {
    expect(buildSpeedRows(s)[0]).toMatchObject({ speed_kmh: 63, limit_kmh: 50, severity: 'immediate_fail' });
    expect(buildStopRows(s)[0]).toMatchObject({ type: 'stop_sign', complied: false, lowest_speed_kmh: 12 });
    expect(buildBrakingRows(s)[0]).toMatchObject({ speed_from_kmh: 50, speed_to_kmh: 20, delta_kmh: 30 });
    expect(buildNavigationRows(s)[0]).toMatchObject({ instruction_given: 'Turn left here.', type: 'wrong_turn' });
  });
});

// ─── checkpointSession ───────────────────────────────────────────────────────

describe('checkpointSession', () => {
  it('skips entirely for non-UUID user ids (guest / unresolved auth)', async () => {
    const result = await checkpointSession(makeSession({ userId: 'anon' }));
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe('unauthenticated');
    const { supabase } = require('../../services/supabase');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('upserts the session row plus every non-empty event table', async () => {
    const result = await checkpointSession(makeSession());
    expect(result.ok).toBe(true);
    const { supabase } = require('../../services/supabase');
    const tables = (supabase.from as jest.Mock).mock.calls.map((c: string[]) => c[0]);
    expect(tables).toEqual(expect.arrayContaining([
      'sessions', 'gps_tracks', 'hazard_events', 'knowledge_events',
      'speed_violations', 'stop_events', 'braking_events', 'navigation_events',
    ]));
    // decision_events is empty in the fixture — must not be written
    expect(tables).not.toContain('decision_events');
  });

  it('stops before events when the session row fails (FK would break)', async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: 'boom' } as any });
    const result = await checkpointSession(makeSession());
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('sessions: boom');
    const { supabase } = require('../../services/supabase');
    expect((supabase.from as jest.Mock).mock.calls).toHaveLength(1);
  });
});
