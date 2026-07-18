import {
  getSpeedLimitKmh, detectStopRequirement, detectPedestrianCrossing,
  processMonitoringUpdate, resetMonitor,
} from '../../services/eventMonitor';
import type { RouteStep } from '../../types';

function step(instruction: string, maneuver?: string): RouteStep {
  return {
    instruction, distance: 200, duration: 30,
    startLocation: { latitude: -36.84, longitude: 174.76 },
    endLocation: { latitude: -36.85, longitude: 174.77 },
    maneuver,
  };
}

const COORD = { latitude: -36.84, longitude: 174.76 };
const FAR = 200; // far enough that stop zones don't activate

beforeEach(() => resetMonitor());

// ─── getSpeedLimitKmh ─────────────────────────────────────────────────────────

describe('getSpeedLimitKmh', () => {
  it('returns 50 for a normal urban step', () => {
    expect(getSpeedLimitKmh([step('Turn left onto Queen Street')])).toBe(50);
  });

  it('returns 40 for a school zone step', () => {
    expect(getSpeedLimitKmh([step('Pass the school zone ahead')])).toBe(40);
  });

  it('returns 10 for a shared zone step', () => {
    expect(getSpeedLimitKmh([step('Enter the shared zone')])).toBe(10);
  });

  it('returns 50 for an empty steps array', () => {
    expect(getSpeedLimitKmh([])).toBe(50);
  });
});

// ─── detectStopRequirement ────────────────────────────────────────────────────

describe('detectStopRequirement', () => {
  it('returns null for undefined', () => {
    expect(detectStopRequirement(undefined)).toBeNull();
  });

  it('returns "stop_sign" for "stop sign"', () => {
    expect(detectStopRequirement(step('At the stop sign, proceed'))).toBe('stop_sign');
  });

  it('returns "stop_sign" for "at the stop"', () => {
    expect(detectStopRequirement(step('Stop at the stop'))).toBe('stop_sign');
  });

  it('returns "railway_crossing" for "level crossing"', () => {
    expect(detectStopRequirement(step('Cross the level crossing'))).toBe('railway_crossing');
  });

  it('returns "railway_crossing" for "railway"', () => {
    expect(detectStopRequirement(step('At the railway, look both ways'))).toBe('railway_crossing');
  });

  it('returns null for a normal turn step', () => {
    expect(detectStopRequirement(step('Turn left onto Main Street'))).toBeNull();
  });
});

// ─── detectPedestrianCrossing ─────────────────────────────────────────────────

describe('detectPedestrianCrossing', () => {
  it('returns false for undefined', () => {
    expect(detectPedestrianCrossing(undefined)).toBe(false);
  });

  it('returns true for "pedestrian crossing"', () => {
    expect(detectPedestrianCrossing(step('Give way at the pedestrian crossing'))).toBe(true);
  });

  it('returns true for "zebra crossing"', () => {
    expect(detectPedestrianCrossing(step('Zebra crossing ahead'))).toBe(true);
  });

  it('returns true for "school crossing"', () => {
    expect(detectPedestrianCrossing(step('School crossing — slow down'))).toBe(true);
  });

  it('returns false for a normal step', () => {
    expect(detectPedestrianCrossing(step('Continue straight on Queen Street'))).toBe(false);
  });
});

// ─── processMonitoringUpdate — speed ─────────────────────────────────────────

describe('processMonitoringUpdate — speed monitoring', () => {
  const steps = [step('Continue on Queen Street')];

  it('no warning when driving at the limit (50 km/h)', () => {
    expect(processMonitoringUpdate(COORD, 50, steps, FAR, false).speedWarning).toBeNull();
  });

  it('no warning when 5 km/h over (within buffer)', () => {
    expect(processMonitoringUpdate(COORD, 55, steps, FAR, false).speedWarning).toBeNull();
  });

  it('immediate_fail warning when >10 km/h over limit', () => {
    const result = processMonitoringUpdate(COORD, 61, steps, FAR, false);
    expect(result.speedWarning).not.toBeNull();
    expect(result.speedWarning!.severity).toBe('immediate_fail');
    expect(result.speedWarning!.speedKmh).toBe(61);
    expect(result.speedWarning!.limitKmh).toBe(50);
  });

  it('does not re-warn at same speed (warnedForCurrentIncident)', () => {
    processMonitoringUpdate(COORD, 61, steps, FAR, false);
    expect(processMonitoringUpdate(COORD, 61, steps, FAR, false).speedWarning).toBeNull();
  });

  it('warns again if speed increases beyond last warned speed', () => {
    processMonitoringUpdate(COORD, 61, steps, FAR, false);
    const result = processMonitoringUpdate(COORD, 70, steps, FAR, false);
    expect(result.speedWarning).not.toBeNull();
    expect(result.speedWarning!.speedKmh).toBe(70);
  });

  it('clears incident state when back under limit, allowing fresh warning', () => {
    processMonitoringUpdate(COORD, 61, steps, FAR, false);
    processMonitoringUpdate(COORD, 50, steps, FAR, false); // back under — clears state
    const result = processMonitoringUpdate(COORD, 61, steps, FAR, false);
    expect(result.speedWarning).not.toBeNull();
  });
});

// ─── processMonitoringUpdate — stop sign ─────────────────────────────────────

describe('processMonitoringUpdate — stop sign compliance', () => {
  const stopSteps = [step('At the stop sign, turn left')];

  it('complied=true when driver slows to ≤2 km/h before step completion', () => {
    processMonitoringUpdate(COORD, 20, stopSteps, 40, false);
    processMonitoringUpdate(COORD, 1, stopSteps, 20, false);
    const result = processMonitoringUpdate(COORD, 1, stopSteps, 5, true);
    expect(result.stopViolation).not.toBeNull();
    expect(result.stopViolation!.complied).toBe(true);
    expect(result.stopViolation!.type).toBe('stop_sign');
  });

  it('complied=false when rolling through at 10 km/h', () => {
    processMonitoringUpdate(COORD, 10, stopSteps, 40, false);
    processMonitoringUpdate(COORD, 10, stopSteps, 20, false);
    const result = processMonitoringUpdate(COORD, 10, stopSteps, 5, true);
    expect(result.stopViolation!.complied).toBe(false);
    expect(result.stopViolation!.lowestSpeedKmh).toBe(10);
  });

  it('no trigger when outside 50m zone', () => {
    processMonitoringUpdate(COORD, 30, stopSteps, 60, false);
    const result = processMonitoringUpdate(COORD, 5, stopSteps, 60, true);
    expect(result.stopViolation).toBeNull();
  });
});

// ─── processMonitoringUpdate — railway crossing ───────────────────────────────

describe('processMonitoringUpdate — railway crossing', () => {
  const railSteps = [step('Cross the level crossing — stop and check')];

  it('uses 80m zone and 20 km/h threshold for railway crossings', () => {
    processMonitoringUpdate(COORD, 30, railSteps, 70, false);
    processMonitoringUpdate(COORD, 18, railSteps, 30, false);
    const result = processMonitoringUpdate(COORD, 18, railSteps, 10, true);
    expect(result.stopViolation!.type).toBe('railway_crossing');
    expect(result.stopViolation!.complied).toBe(true); // 18 ≤ 20
  });

  it('non-complied when not slowing below 20 km/h', () => {
    processMonitoringUpdate(COORD, 25, railSteps, 70, false);
    processMonitoringUpdate(COORD, 25, railSteps, 30, false);
    const result = processMonitoringUpdate(COORD, 25, railSteps, 10, true);
    expect(result.stopViolation!.complied).toBe(false);
  });
});

// ─── processMonitoringUpdate — pedestrian crossing ───────────────────────────

describe('processMonitoringUpdate — pedestrian crossing', () => {
  const pedSteps = [step('Give way at the pedestrian crossing ahead')];

  it('complied=true when below 20 km/h', () => {
    processMonitoringUpdate(COORD, 15, pedSteps, 40, false);
    const result = processMonitoringUpdate(COORD, 15, pedSteps, 10, true);
    expect(result.stopViolation!.complied).toBe(true);
    expect(result.stopViolation!.type).toBe('pedestrian_crossing');
  });

  it('complied=false when above 20 km/h', () => {
    processMonitoringUpdate(COORD, 25, pedSteps, 40, false);
    const result = processMonitoringUpdate(COORD, 25, pedSteps, 10, true);
    expect(result.stopViolation!.complied).toBe(false);
  });
});

// ─── processMonitoringUpdate — harsh braking ─────────────────────────────────

describe('processMonitoringUpdate — harsh braking', () => {
  const steps = [step('Continue on Queen Street')];

  it('no braking event on first call (no previous state)', () => {
    expect(processMonitoringUpdate(COORD, 50, steps, FAR, false).brakingEvent).toBeNull();
  });

  it('detects harsh braking: 50→30 km/h delta=20 (above threshold 15)', () => {
    processMonitoringUpdate(COORD, 50, steps, FAR, false);
    const result = processMonitoringUpdate(COORD, 30, steps, FAR, false);
    expect(result.brakingEvent).not.toBeNull();
    expect(result.brakingEvent!.deltaKmh).toBe(20);
    expect(result.brakingEvent!.prevSpeedKmh).toBe(50);
  });

  it('no event for delta 10 km/h (below threshold)', () => {
    processMonitoringUpdate(COORD, 50, steps, FAR, false);
    expect(processMonitoringUpdate(COORD, 40, steps, FAR, false).brakingEvent).toBeNull();
  });

  it('no event when within stop zone (expected braking — distToStepEnd < 80)', () => {
    const stopSteps = [step('At the stop sign, turn left')];
    processMonitoringUpdate(COORD, 50, stopSteps, FAR, false);
    // distToStepEnd=60 < 80 → isAtKnownStopForBraking=true
    expect(processMonitoringUpdate(COORD, 25, stopSteps, 60, false).brakingEvent).toBeNull();
  });
});

// ─── resetMonitor ─────────────────────────────────────────────────────────────

describe('resetMonitor', () => {
  it('clears speed warning state so the next call can warn fresh', () => {
    const steps = [step('Continue')];
    processMonitoringUpdate(COORD, 61, steps, FAR, false); // sets warnedForCurrentIncident
    resetMonitor();
    expect(processMonitoringUpdate(COORD, 61, steps, FAR, false).speedWarning).not.toBeNull();
  });
});
