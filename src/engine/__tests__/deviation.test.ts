import { SessionEngine, EngineCommand } from '../sessionEngine';
import type { Coordinate, RouteStep } from '../../types';

// MVP-1 deviation evaluation: deviation → silent reroute → askDeviation after
// the reroute completes → a justified explanation lifts the navigation
// penalty, a manoeuvring error keeps it.

const T0 = 1_700_000_000_000;
const TICK_MS = 2000;

const A: Coordinate = { latitude: -36.84, longitude: 174.76 };
const B: Coordinate = { latitude: -36.845, longitude: 174.76 };
const C: Coordinate = { latitude: -36.845, longitude: 174.765 };
const OFF_ROUTE: Coordinate = { latitude: -36.85, longitude: 174.7625 };

const HEAD_SOUTH: RouteStep = {
  instruction: 'Head south on Jed Street', maneuver: 'straight',
  distance: 555, duration: 40, startLocation: A, endLocation: B, polyline: [A, B],
};
const TURN_LEFT: RouteStep = {
  instruction: 'Turn left onto Yarrow Street', maneuver: 'turn-left',
  distance: 446, duration: 32, startLocation: B, endLocation: C, polyline: [B, C],
};
const RECOVERY: RouteStep = {
  instruction: 'Head east on Tweed Street', maneuver: 'straight',
  distance: 400, duration: 30, startLocation: OFF_ROUTE, endLocation: C, polyline: [OFF_ROUTE, C],
};

/** Drive south so the turn gets announced, then jump off route. */
function driveIntoDeviation() {
  const engine = new SessionEngine({ userId: 'deviation-user', nowMs: T0 });
  engine.setRoute([HEAD_SOUTH, TURN_LEFT]);
  engine.start(T0);

  let tick = 0;
  const feed = (coord: Coordinate, speedKmh: number): EngineCommand[] => {
    tick += 1;
    return engine.handlePosition(coord, speedKmh, T0 + tick * TICK_MS);
  };

  for (let i = 1; i <= 19; i++) {
    feed({ latitude: A.latitude - i * 0.00025, longitude: A.longitude }, 50);
  }
  const offRouteCommands = feed(OFF_ROUTE, 45);
  return { engine, offRouteCommands, now: () => T0 + (tick + 1) * TICK_MS };
}

describe('deviation evaluation flow', () => {
  it('emits askDeviation only after the reroute completes, carrying the missed instruction', () => {
    const { engine, offRouteCommands } = driveIntoDeviation();

    expect(offRouteCommands.map((c) => c.type)).toEqual(['requestReroute']);

    const postReroute = engine.applyReroute([RECOVERY]);
    expect(postReroute).toHaveLength(1);
    expect(postReroute[0].type).toBe('askDeviation');
    expect((postReroute[0] as Extract<EngineCommand, { type: 'askDeviation' }>).instructionGiven).toMatch(/turn left/i);
  });

  it('lifts the navigation penalty when the deviation is justified', () => {
    const { engine, now } = driveIntoDeviation();
    engine.applyReroute([RECOVERY]);

    const ids = engine.recordDeviationExchange(
      'I noticed you went a different way back there. Was there a reason for that?',
      'The street was closed for road works',
      now()
    );
    expect(ids).not.toBeNull();
    engine.applyDeviationEvaluation(ids!, 'justified', 'Good decision to avoid the closure.');

    const session = engine.complete(now());
    expect(session.decisionEvents).toHaveLength(1);
    expect(session.decisionEvents[0].trigger).toBe('off_route');
    expect(session.decisionEvents[0].claudeEvaluation?.quality).toBe('good');
    expect(session.navigationEvents[0].justified).toBe(true);
    expect(session.score!.navigationCompliance).toBe(100);
    expect(session.score!.observations.some((o) => o.includes('judgement'))).toBe(true);
    const navEntry = session.score!.eventLog!.find((e) => e.type === 'navigation');
    expect(navEntry?.severity).toBe('good');
    expect(navEntry?.description).toContain('justified');
  });

  it('keeps the mild penalty for a manoeuvring error', () => {
    const { engine, now } = driveIntoDeviation();
    engine.applyReroute([RECOVERY]);

    const ids = engine.recordDeviationExchange('Was there a reason for that?', 'Sorry, I missed the turn', now());
    engine.applyDeviationEvaluation(ids!, 'manoeuvring_error', 'A missed turn is only a minor error.');

    const session = engine.complete(now());
    expect(session.decisionEvents[0].claudeEvaluation?.quality).toBe('poor');
    expect(session.navigationEvents[0].justified).toBeUndefined();
    expect(session.score!.navigationCompliance).toBe(90);
    const navEntry = session.score!.eventLog!.find((e) => e.type === 'navigation');
    expect(navEntry?.severity).toBe('warning');
  });

  it('asks nothing after a destination-reached reroute or without a pending deviation', () => {
    const engine = new SessionEngine({ userId: 'deviation-user', nowMs: T0 });
    engine.setRoute([HEAD_SOUTH, TURN_LEFT]);
    engine.start(T0);

    expect(engine.applyReroute([RECOVERY])).toEqual([]);
    expect(engine.recordDeviationExchange('Why?', 'no deviation happened', T0 + 1000)).toBeNull();
  });

  it('asks only once per deviation — the pending question is consumed by the exchange', () => {
    const { engine, now } = driveIntoDeviation();
    engine.applyReroute([RECOVERY]);

    const ids = engine.recordDeviationExchange('Was there a reason?', 'Road was blocked', now());
    expect(ids).not.toBeNull();
    expect(engine.recordDeviationExchange('Was there a reason?', 'again', now())).toBeNull();
    expect(engine.applyReroute([RECOVERY])).toEqual([]);
  });
});
