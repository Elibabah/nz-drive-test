import { computeVerdict } from '../nztaVerdict';
import type { DrivingSession, SpeedViolation, StopEvent, NavigationEvent } from '../../types';

const LOC = { latitude: -36.84, longitude: 174.76 };
const T0 = 1_700_000_000_000;

function makeSession(partial: Partial<DrivingSession>): DrivingSession {
  return {
    id: 's1', userId: 'u1', startTime: T0, duration: 1200,
    routeCoordinates: [], hazardEvents: [], knowledgeEvents: [], decisionEvents: [],
    speedViolations: [], stopEvents: [], brakingEvents: [], navigationEvents: [],
    totalDistance: 8000, averageSpeed: 40, status: 'completed',
    ...partial,
  };
}

const speedViolation = (severity: SpeedViolation['severity'], over = 12): SpeedViolation => ({
  id: 'v1', sessionId: 's1', timestamp: T0 + 60_000, location: LOC,
  speedKmh: 50 + over, limitKmh: 50, severity, durationSeconds: severity === 'immediate_fail' ? 6 : 3,
});

const stopEvent = (type: StopEvent['type'], complied: boolean): StopEvent => ({
  id: 'st1', sessionId: 's1', timestamp: T0 + 120_000, location: LOC,
  type, complied, lowestSpeedKmh: complied ? 0 : 15,
});

describe('computeVerdict', () => {
  it('passes a clean session', () => {
    const v = computeVerdict(makeSession({}));
    expect(v.result).toBe('pass');
    expect(v.immediateFailErrors).toHaveLength(0);
    expect(v.criticalErrors).toHaveLength(0);
  });

  it('allows exactly one critical error (NZTA: fail on the second)', () => {
    const one = computeVerdict(makeSession({ speedViolations: [speedViolation('critical', 7)] }));
    expect(one.result).toBe('pass');
    expect(one.criticalErrors).toHaveLength(1);

    const two = computeVerdict(makeSession({
      speedViolations: [speedViolation('critical', 7), { ...speedViolation('critical', 6), id: 'v2' }],
    }));
    expect(two.result).toBe('fail');
  });

  it('fails on any immediate-fail speed violation', () => {
    const v = computeVerdict(makeSession({ speedViolations: [speedViolation('immediate_fail')] }));
    expect(v.result).toBe('fail');
    expect(v.immediateFailErrors[0].category).toBe('excessive_speed');
  });

  it('maps stop-sign and railway non-compliance to failure_to_stop, pedestrian to failure_to_give_way', () => {
    const stop = computeVerdict(makeSession({ stopEvents: [stopEvent('stop_sign', false)] }));
    expect(stop.result).toBe('fail');
    expect(stop.immediateFailErrors[0].category).toBe('failure_to_stop');

    const ped = computeVerdict(makeSession({ stopEvents: [stopEvent('pedestrian_crossing', false)] }));
    expect(ped.immediateFailErrors[0].category).toBe('failure_to_give_way');
  });

  it('ignores complied stops', () => {
    const v = computeVerdict(makeSession({ stopEvents: [stopEvent('stop_sign', true)] }));
    expect(v.result).toBe('pass');
  });

  it('never counts navigation deviations — justified or not — in the verdict', () => {
    const navEvents: NavigationEvent[] = [
      { id: 'n1', sessionId: 's1', timestamp: T0, location: LOC, instructionGiven: 'Turn left here.', type: 'wrong_turn' },
      { id: 'n2', sessionId: 's1', timestamp: T0, location: LOC, instructionGiven: 'Turn right here.', type: 'off_route', justified: true },
    ];
    const v = computeVerdict(makeSession({ navigationEvents: navEvents }));
    expect(v.result).toBe('pass');
    expect(v.immediateFailErrors).toHaveLength(0);
    expect(v.criticalErrors).toHaveLength(0);
  });

  it('declares what is and is not assessed', () => {
    const v = computeVerdict(makeSession({}));
    expect(v.assessed.length).toBeGreaterThan(0);
    expect(v.notAssessed.join(' ')).toMatch(/mirror/i);
  });
});
