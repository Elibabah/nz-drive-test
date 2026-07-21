import {
  getSpeedLimitKmh, detectStopRequirement, detectPedestrianCrossing, DrivingMonitor,
} from '../monitoring';
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
const T0 = 1_700_000_000_000;

let monitor: DrivingMonitor;
let now: number;
// Each call advances the injected clock 2 s — matches the GPS update cadence
const drive = (speedKmh: number, steps: RouteStep[], dist = FAR, completed = false) => {
  now += 2000;
  return monitor.update(COORD, speedKmh, steps, dist, completed, now);
};

beforeEach(() => {
  monitor = new DrivingMonitor();
  now = T0;
});

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

// ─── Speed monitoring ─────────────────────────────────────────────────────────

describe('speed monitoring', () => {
  const steps = [step('Continue on Queen Street')];

  it('no warning when driving at the limit (50 km/h)', () => {
    expect(drive(50, steps).speedWarning).toBeNull();
  });

  it('no warning when 5 km/h over (within buffer)', () => {
    expect(drive(55, steps).speedWarning).toBeNull();
  });

  it('immediate_fail warning when >10 km/h over limit', () => {
    const result = drive(61, steps);
    expect(result.speedWarning).not.toBeNull();
    expect(result.speedWarning!.severity).toBe('immediate_fail');
    expect(result.speedWarning!.speedKmh).toBe(61);
    expect(result.speedWarning!.limitKmh).toBe(50);
  });

  it('does not re-warn at same speed (warnedForCurrentIncident)', () => {
    drive(61, steps);
    expect(drive(61, steps).speedWarning).toBeNull();
  });

  it('warns again if speed increases beyond last warned speed', () => {
    drive(61, steps);
    const result = drive(70, steps);
    expect(result.speedWarning).not.toBeNull();
    expect(result.speedWarning!.speedKmh).toBe(70);
  });

  it('clears incident state when back under limit, allowing fresh warning', () => {
    drive(61, steps);
    drive(50, steps); // back under — clears state
    expect(drive(61, steps).speedWarning).not.toBeNull();
  });
});

// ─── Stop sign compliance ─────────────────────────────────────────────────────

describe('stop sign compliance', () => {
  const stopSteps = [step('At the stop sign, turn left')];

  it('complied=true when driver slows to ≤2 km/h before step completion', () => {
    drive(20, stopSteps, 40);
    drive(1, stopSteps, 20);
    const result = drive(1, stopSteps, 5, true);
    expect(result.stopViolation).not.toBeNull();
    expect(result.stopViolation!.complied).toBe(true);
    expect(result.stopViolation!.type).toBe('stop_sign');
  });

  it('complied=false when rolling through at 10 km/h', () => {
    drive(10, stopSteps, 40);
    drive(10, stopSteps, 20);
    const result = drive(10, stopSteps, 5, true);
    expect(result.stopViolation!.complied).toBe(false);
    expect(result.stopViolation!.lowestSpeedKmh).toBe(10);
  });

  it('no trigger when outside 50m zone', () => {
    drive(30, stopSteps, 60);
    const result = drive(5, stopSteps, 60, true);
    expect(result.stopViolation).toBeNull();
  });
});

// ─── Railway crossing ─────────────────────────────────────────────────────────

describe('railway crossing', () => {
  const railSteps = [step('Cross the level crossing — stop and check')];

  it('uses 80m zone and 20 km/h threshold for railway crossings', () => {
    drive(30, railSteps, 70);
    drive(18, railSteps, 30);
    const result = drive(18, railSteps, 10, true);
    expect(result.stopViolation!.type).toBe('railway_crossing');
    expect(result.stopViolation!.complied).toBe(true); // 18 ≤ 20
  });

  it('non-complied when not slowing below 20 km/h', () => {
    drive(25, railSteps, 70);
    drive(25, railSteps, 30);
    const result = drive(25, railSteps, 10, true);
    expect(result.stopViolation!.complied).toBe(false);
  });
});

// ─── Pedestrian crossing ──────────────────────────────────────────────────────

describe('pedestrian crossing', () => {
  const pedSteps = [step('Give way at the pedestrian crossing ahead')];

  it('complied=true when below 20 km/h', () => {
    drive(15, pedSteps, 40);
    const result = drive(15, pedSteps, 10, true);
    expect(result.stopViolation!.complied).toBe(true);
    expect(result.stopViolation!.type).toBe('pedestrian_crossing');
  });

  it('complied=false when above 20 km/h', () => {
    drive(25, pedSteps, 40);
    const result = drive(25, pedSteps, 10, true);
    expect(result.stopViolation!.complied).toBe(false);
  });
});

// ─── Harsh braking ────────────────────────────────────────────────────────────

describe('harsh braking', () => {
  const steps = [step('Continue on Queen Street')];

  it('no braking event on first call (no previous state)', () => {
    expect(drive(50, steps).brakingEvent).toBeNull();
  });

  it('detects harsh braking: 50→30 km/h delta=20 (above threshold 15)', () => {
    drive(50, steps);
    const result = drive(30, steps);
    expect(result.brakingEvent).not.toBeNull();
    expect(result.brakingEvent!.deltaKmh).toBe(20);
    expect(result.brakingEvent!.prevSpeedKmh).toBe(50);
  });

  it('no event for delta 10 km/h (below threshold)', () => {
    drive(50, steps);
    expect(drive(40, steps).brakingEvent).toBeNull();
  });

  it('no event when within stop zone (expected braking — distToStepEnd < 80)', () => {
    const stopSteps = [step('At the stop sign, turn left')];
    drive(50, stopSteps);
    // distToStepEnd=60 < 80 → isAtKnownStopForBraking=true
    expect(drive(25, stopSteps, 60).brakingEvent).toBeNull();
  });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('clears speed warning state so the next call can warn fresh', () => {
    const steps = [step('Continue')];
    drive(61, steps); // sets warnedForCurrentIncident
    monitor.reset();
    expect(drive(61, steps).speedWarning).not.toBeNull();
  });
});

// ─── Unexpected stop: armed only after first movement ────────────────────────

describe('unexpected stop monitoring', () => {
  const steps = [step('Continue on Yarrow Street')];

  it('never warns while stationary before the car has ever moved (session start / desk testing)', () => {
    for (let i = 0; i < 10; i++) {
      expect(drive(0, steps).unexpectedStopWarning).toBeNull();
    }
  });

  it('warns when stopping mid-carriageway after having driven', () => {
    drive(30, steps); // arms the monitor
    drive(0, steps);  // stop begins
    now += 5000;      // > UNEXPECTED_STOP_DURATION_MS
    const result = drive(0, steps);
    expect(result.unexpectedStopWarning).not.toBeNull();
  });

  it('does not warn for a stop shorter than the threshold', () => {
    drive(30, steps);
    drive(0, steps);
    // next drive() advances only 2 s — still under the 4 s threshold
    expect(drive(0, steps).unexpectedStopWarning).toBeNull();
  });
});
