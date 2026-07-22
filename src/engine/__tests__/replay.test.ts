import { SessionEngine, EngineCommand } from '../sessionEngine';
import type { Coordinate, RouteStep } from '../../types';

// ADR-0006 flagship: replay a full synthetic drive through the pure engine and
// assert the exact examiner behaviour. The route mirrors Google's real step
// model — steps[0] is a compass "Head …" segment and the maneuver lives in
// steps[1], happening at steps[0]'s end — the exact shape that exposed the
// 2026-07-22 field bug where turns were never announced.

const T0 = 1_700_000_000_000;
const TICK_MS = 2000; // GPS cadence

// Geometry: south along Jed St to the Yarrow St corner, then east.
// 0.00025° lat ≈ 27.8 m ≈ one 2 s tick at 50 km/h.
const A: Coordinate = { latitude: -36.84, longitude: 174.76 };
const B: Coordinate = { latitude: -36.845, longitude: 174.76 };   // ~555 m south of A
const C: Coordinate = { latitude: -36.845, longitude: 174.765 };  // ~446 m east of B

const HEAD_SOUTH: RouteStep = {
  instruction: 'Head south on Jed Street', maneuver: 'straight',
  distance: 555, duration: 40, startLocation: A, endLocation: B, polyline: [A, B],
};
const TURN_LEFT: RouteStep = {
  instruction: 'Turn left onto Yarrow Street', maneuver: 'turn-left',
  distance: 446, duration: 32, startLocation: B, endLocation: C, polyline: [B, C],
};

interface TranscriptEntry { tick: number; commands: EngineCommand[] }

function runReplay() {
  const engine = new SessionEngine({ userId: 'replay-user', nowMs: T0 });
  engine.setRoute([HEAD_SOUTH, TURN_LEFT]);
  engine.start(T0);

  const transcript: TranscriptEntry[] = [];
  let tick = 0;
  const feed = (coord: Coordinate, speedKmh: number) => {
    tick += 1;
    const commands = engine.handlePosition(coord, speedKmh, T0 + tick * TICK_MS);
    if (commands.length > 0) transcript.push({ tick, commands });
    return commands;
  };

  // ── Leg 1: south towards the corner, one speeding burst ───────────────────
  for (let i = 1; i <= 19; i++) {
    const lat = A.latitude - i * 0.00025;
    const speed = i === 5 || i === 6 ? 65 : 50; // >10 over the 50 limit
    feed({ latitude: lat, longitude: A.longitude }, speed);
  }
  const stepsAfterCorner = engine.remainingSteps;

  // ── Leg 2: east along Yarrow St (final step — no maneuver left) ───────────
  for (let i = 1; i <= 13; i++) {
    const lng = B.longitude + i * 0.0003;
    feed({ latitude: B.latitude, longitude: lng }, 45);
  }

  // ── Detour: ~555 m south of the Yarrow St geometry → off-route ────────────
  const offRouteCommands = feed({ latitude: -36.85, longitude: 174.7625 }, 45);
  // Simulate the reroute fetch failing: engine keeps the old steps
  if (offRouteCommands.some((c) => c.type === 'requestReroute')) {
    engine.rerouteFailed();
  }

  const session = engine.complete(T0 + (tick + 1) * TICK_MS);
  return { transcript, session, stepsAfterCorner };
}

const speaks = (t: TranscriptEntry[]) =>
  t.flatMap((e) => e.commands).filter((c): c is Extract<EngineCommand, { type: 'speak' }> => c.type === 'speak');
const reroutes = (t: TranscriptEntry[]) =>
  t.flatMap((e) => e.commands).filter((c): c is Extract<EngineCommand, { type: 'requestReroute' }> => c.type === 'requestReroute');

describe('full-session replay', () => {
  const { transcript, session, stepsAfterCorner } = runReplay();

  it('announces the upcoming and immediate turn exactly once, from the "Head …" segment', () => {
    const texts = speaks(transcript).map((s) => s.text);
    expect(texts.filter((t) => /In \d+ metres, turn left/.test(t))).toHaveLength(1);
    expect(texts.filter((t) => t === 'Turn left here.')).toHaveLength(1);
  });

  it('advances to the next step locally at the corner — no reroute round-trip', () => {
    expect(stepsAfterCorner).toEqual([TURN_LEFT]);
    expect(reroutes(transcript).map((r) => r.reason)).not.toContain('step_complete');
  });

  it('warns for the speeding burst once, with safety priority', () => {
    const warnings = speaks(transcript).filter((s) => s.text === 'You must reduce your speed immediately.');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].priority).toBe('safety');
  });

  it('requests a reroute only for the off-route detour', () => {
    expect(reroutes(transcript).map((r) => r.reason)).toEqual(['off_route']);
  });

  it('tells the driver which instruction they missed when going off route', () => {
    const offRouteMsg = speaks(transcript).find((s) => s.text.startsWith('I asked you to'));
    expect(offRouteMsg?.text).toBe('I asked you to turn left. I will give you new directions from here.');
  });

  it('records the speeding violation and the wrong turn on the session', () => {
    expect(session.speedViolations).toHaveLength(1);
    expect(session.speedViolations[0].severity).toBe('immediate_fail');
    expect(session.navigationEvents).toHaveLength(1);
    expect(session.navigationEvents[0].type).toBe('wrong_turn');
  });

  it('scores the session from the recorded events', () => {
    expect(session.score!.speedCompliance).toBe(80);   // 1 immediate_fail
    expect(session.score!.navigationCompliance).toBe(90); // 1 nav event
    expect(session.score!.stopCompliance).toBe(100);
    expect(session.status).toBe('completed');
  });

  it('is deterministic: an identical replay produces an identical transcript and score', () => {
    const second = runReplay();
    expect(second.transcript).toEqual(transcript);
    expect(second.session.score).toEqual(session.score);
  });
});

// ─── Replay with OSM road data (ADR-0004) ────────────────────────────────────

describe('replay with road data: stop sign + traffic light', () => {
  function runRoadDataReplay() {
    const engine = new SessionEngine({ userId: 'replay-user', nowMs: T0 });
    engine.setRoute([HEAD_SOUTH, TURN_LEFT]);
    engine.setRoadData({
      controlPoints: [
        { kind: 'stop_sign', location: B },                              // at the corner
        { kind: 'traffic_signals', location: { latitude: B.latitude, longitude: 174.7618 } }, // ~160 m into Yarrow St
      ],
      speedZones: [],
    });
    engine.start(T0);

    const transcript: TranscriptEntry[] = [];
    let tick = 0;
    const feed = (coord: Coordinate, speedKmh: number) => {
      tick += 1;
      const commands = engine.handlePosition(coord, speedKmh, T0 + tick * TICK_MS);
      if (commands.length > 0) transcript.push({ tick, commands });
      return commands;
    };

    // South to the corner at a constant 50 — rolling through the stop sign
    for (let i = 1; i <= 19; i++) {
      feed({ latitude: A.latitude - i * 0.00025, longitude: A.longitude }, 50);
    }
    // East along Yarrow St up to the traffic light
    for (let i = 1; i <= 6; i++) {
      feed({ latitude: B.latitude, longitude: B.longitude + i * 0.0003 }, 45);
    }
    // Waiting at the red light (~12 s stationary, right on the signal)
    for (let i = 0; i < 6; i++) {
      feed({ latitude: B.latitude, longitude: 174.7618 }, 0);
    }
    // Light turns green, carry on east
    for (let i = 7; i <= 12; i++) {
      feed({ latitude: B.latitude, longitude: B.longitude + i * 0.0003 }, 40);
    }

    const session = engine.complete(T0 + (tick + 1) * TICK_MS);
    return { transcript, session };
  }

  const { transcript, session } = runRoadDataReplay();
  const texts = speaks(transcript).map((s) => s.text);

  it('catches the stop-sign roll-through via GPS proximity (no instruction text involved)', () => {
    expect(texts).toContain('At the stop sign, you must come to a complete stop before proceeding.');
    expect(session.stopEvents).toHaveLength(1);
    expect(session.stopEvents[0].type).toBe('stop_sign');
    expect(session.stopEvents[0].complied).toBe(false);
    expect(session.score!.stopCompliance).toBe(0);
  });

  it('does NOT scold the driver for waiting at the red light (field bug 2026-07-22)', () => {
    expect(texts.filter((t) => t.includes('avoid stopping in the carriageway'))).toHaveLength(0);
  });

  it('does NOT flag braking for the light as harsh braking', () => {
    expect(texts.filter((t) => t.includes('brake smoothly'))).toHaveLength(0);
    expect(session.brakingEvents).toHaveLength(0);
  });
});
