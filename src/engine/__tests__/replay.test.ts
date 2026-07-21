import { SessionEngine, EngineCommand } from '../sessionEngine';
import type { Coordinate, RouteStep } from '../../types';

// ADR-0006 flagship: replay a full synthetic drive through the pure engine and
// assert the exact examiner behaviour — instructions fire once, reroutes obey
// the debounce, violations are recorded, and the whole run is deterministic.

const T0 = 1_700_000_000_000;
const TICK_MS = 2000; // GPS cadence

// Route geometry: south along Jed St, left turn, then east along Yarrow St.
// 0.00025° lat ≈ 27.8 m ≈ one 2 s tick at 50 km/h.
const A: Coordinate = { latitude: -36.84, longitude: 174.76 };
const B: Coordinate = { latitude: -36.845, longitude: 174.76 };   // ~555 m south of A
const C: Coordinate = { latitude: -36.845, longitude: 174.765 };  // ~446 m east of B

const STEP_1: RouteStep = {
  instruction: 'Turn left onto Yarrow Street', maneuver: 'turn-left',
  distance: 555, duration: 40, startLocation: A, endLocation: B, polyline: [A, B],
};
const STEP_2: RouteStep = {
  instruction: 'Turn right onto Spey Street', maneuver: 'turn-right',
  distance: 446, duration: 32, startLocation: B, endLocation: C, polyline: [B, C],
};

interface TranscriptEntry { tick: number; commands: EngineCommand[] }

function runReplay() {
  const engine = new SessionEngine({ userId: 'replay-user', nowMs: T0 });
  engine.setRoute([STEP_1, STEP_2]);
  engine.start(T0);

  const transcript: TranscriptEntry[] = [];
  let tick = 0;
  const feed = (coord: Coordinate, speedKmh: number) => {
    tick += 1;
    const commands = engine.handlePosition(coord, speedKmh, T0 + tick * TICK_MS);
    if (commands.length > 0) transcript.push({ tick, commands });
    return commands;
  };

  // ── Leg 1: drive south towards the left turn, one speeding burst ──────────
  for (let i = 1; i <= 19; i++) {
    const lat = A.latitude - i * 0.00025;
    const speed = i === 5 || i === 6 ? 65 : 50; // >10 over the 50 limit
    const commands = feed({ latitude: lat, longitude: A.longitude }, speed);
    // The harness plays the adapter: apply the new route when asked
    if (commands.some((c) => c.type === 'requestReroute')) {
      engine.applyReroute([STEP_2]);
    }
  }

  // ── Leg 2: east along Yarrow St until past the reroute debounce ───────────
  for (let i = 1; i <= 13; i++) {
    const lng = B.longitude + i * 0.0003;
    feed({ latitude: B.latitude, longitude: lng }, 45);
  }

  // ── Detour: ~555 m south of the step-2 geometry → off-route ───────────────
  const offRouteCommands = feed({ latitude: -36.85, longitude: 174.7625 }, 45);
  // Simulate the reroute fetch failing: engine keeps the old steps
  if (offRouteCommands.some((c) => c.type === 'requestReroute')) {
    engine.rerouteFailed();
  }

  const session = engine.complete(T0 + (tick + 1) * TICK_MS);
  return { transcript, session };
}

const speaks = (t: TranscriptEntry[]) =>
  t.flatMap((e) => e.commands).filter((c): c is Extract<EngineCommand, { type: 'speak' }> => c.type === 'speak');
const reroutes = (t: TranscriptEntry[]) =>
  t.flatMap((e) => e.commands).filter((c): c is Extract<EngineCommand, { type: 'requestReroute' }> => c.type === 'requestReroute');

describe('full-session replay', () => {
  const { transcript, session } = runReplay();

  it('announces the upcoming and immediate instruction exactly once per step', () => {
    const texts = speaks(transcript).map((s) => s.text);
    expect(texts.filter((t) => /In \d+ metres, turn left/.test(t))).toHaveLength(1);
    expect(texts.filter((t) => t === 'Turn left here.')).toHaveLength(1);
    expect(texts.filter((t) => /In \d+ metres, turn right/.test(t))).toHaveLength(1);
  });

  it('warns for the speeding burst once, with safety priority', () => {
    const warnings = speaks(transcript).filter((s) => s.text === 'You must reduce your speed immediately.');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].priority).toBe('safety');
  });

  it('requests a reroute on step completion and again on the off-route detour', () => {
    const reasons = reroutes(transcript).map((r) => r.reason);
    expect(reasons).toEqual(['step_complete', 'off_route']);
  });

  it('tells the driver which instruction they missed when going off route', () => {
    const offRouteMsg = speaks(transcript).find((s) => s.text.startsWith('I asked you to'));
    expect(offRouteMsg?.text).toBe('I asked you to turn right. I will give you new directions from here.');
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
