import { RouteStep, Coordinate } from '../types';
import { NZ_DRIVING } from '../constants/nzDriving';

// ─── Speed limit inference ────────────────────────────────────────────────────

export function getSpeedLimitKmh(steps: RouteStep[]): number {
  const instr = (steps[0]?.instruction ?? '').toLowerCase();
  if (instr.includes('school zone')) return 40;
  if (instr.includes('shared zone')) return 10;
  return 50;
}

// ─── Stop requirement detection ───────────────────────────────────────────────

export type StopRequirement = 'stop_sign' | 'railway_crossing' | null;

export function detectStopRequirement(step: RouteStep | undefined): StopRequirement {
  if (!step) return null;
  const instr = step.instruction.toLowerCase();
  if (instr.includes('stop sign') || instr.includes('at the stop')) return 'stop_sign';
  if (instr.includes('level crossing') || instr.includes('railway') || instr.includes('rail crossing')) return 'railway_crossing';
  return null;
}

// ─── Pedestrian crossing detection ───────────────────────────────────────────

export function detectPedestrianCrossing(step: RouteStep | undefined): boolean {
  if (!step) return false;
  const instr = step.instruction.toLowerCase();
  return (
    instr.includes('pedestrian crossing') ||
    instr.includes('zebra crossing') ||
    instr.includes('school crossing') ||
    instr.includes('crosswalk') ||
    instr.includes('pedestrian signal')
  );
}

// ─── Monitoring state ─────────────────────────────────────────────────────────

interface SpeedState {
  overLimitSince: number | null;
  warnedForCurrentIncident: boolean;
  lastWarnedSpeedKmh: number;
}

interface StopState {
  requirement: StopRequirement;
  lowestSpeedKmh: number;
  evaluated: boolean;
}

interface PedestrianState {
  lowestSpeedKmh: number;
  evaluated: boolean;
}

interface BrakingState {
  prevSpeedKmh: number;
  prevTimestamp: number;
  lastWarnedAt: number;
}

interface UnexpectedStopState {
  stoppedSince: number | null;
  lastWarnedAt: number;
}

let speedState: SpeedState = { overLimitSince: null, warnedForCurrentIncident: false, lastWarnedSpeedKmh: 0 };
let stopState: StopState | null = null;
let pedestrianState: PedestrianState | null = null;
let brakingState: BrakingState = { prevSpeedKmh: 0, prevTimestamp: 0, lastWarnedAt: 0 };
let unexpectedStopState: UnexpectedStopState = { stoppedSince: null, lastWarnedAt: 0 };
// Sessions start parked — stop monitoring only arms once the car has moved
let hasMovedSinceStart = false;

export function resetMonitor(): void {
  speedState = { overLimitSince: null, warnedForCurrentIncident: false, lastWarnedSpeedKmh: 0 };
  stopState = null;
  pedestrianState = null;
  brakingState = { prevSpeedKmh: 0, prevTimestamp: 0, lastWarnedAt: 0 };
  unexpectedStopState = { stoppedSince: null, lastWarnedAt: 0 };
  hasMovedSinceStart = false;
}

export function clearStepMonitoring(): void {
  stopState = null;
  pedestrianState = null;
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface MonitorResult {
  speedWarning: { text: string; severity: 'critical' | 'immediate_fail'; speedKmh: number; limitKmh: number; duration: number } | null;
  stopViolation: { complied: boolean; lowestSpeedKmh: number; type: StopRequirement | 'pedestrian_crossing' } | null;
  brakingEvent: { text: string; deltaKmh: number; prevSpeedKmh: number } | null;
  unexpectedStopWarning: { text: string } | null;
}

// ─── Main update ──────────────────────────────────────────────────────────────

export function processMonitoringUpdate(
  coord: Coordinate,
  speedKmh: number,
  steps: RouteStep[],
  distToStepEnd: number,
  stepJustCompleted: boolean
): MonitorResult {
  const result: MonitorResult = { speedWarning: null, stopViolation: null, brakingEvent: null, unexpectedStopWarning: null };
  const limitKmh = getSpeedLimitKmh(steps);
  const now = Date.now();
  const requirement = detectStopRequirement(steps[0]);
  const isPedestrian = detectPedestrianCrossing(steps[0]);

  // ── Speed monitoring ───────────────────────────────────────────────────────
  const overBy = speedKmh - limitKmh;

  if (overBy > 10) {
    if (!speedState.warnedForCurrentIncident || speedState.lastWarnedSpeedKmh < speedKmh) {
      const duration = speedState.overLimitSince ? (now - speedState.overLimitSince) / 1000 : 0;
      result.speedWarning = { text: 'You must reduce your speed immediately.', severity: 'immediate_fail', speedKmh, limitKmh, duration };
      speedState.warnedForCurrentIncident = true;
      speedState.lastWarnedSpeedKmh = speedKmh;
    }
    if (!speedState.overLimitSince) speedState.overLimitSince = now;
  } else if (overBy > 5) {
    if (!speedState.overLimitSince) speedState.overLimitSince = now;
    const elapsed = (now - speedState.overLimitSince) / 1000;
    if (elapsed > 3 && !speedState.warnedForCurrentIncident) {
      result.speedWarning = { text: 'Reduce your speed — you are slightly over the limit.', severity: 'critical', speedKmh, limitKmh, duration: elapsed };
      speedState.warnedForCurrentIncident = true;
      speedState.lastWarnedSpeedKmh = speedKmh;
    }
  } else {
    speedState.overLimitSince = null;
    speedState.warnedForCurrentIncident = false;
    speedState.lastWarnedSpeedKmh = 0;
  }

  // ── Stop sign / railway crossing monitoring ────────────────────────────────
  const stopZoneDistance = requirement === 'railway_crossing' ? 80 : 50;

  if (requirement && distToStepEnd < stopZoneDistance) {
    if (!stopState || stopState.requirement !== requirement) {
      stopState = { requirement, lowestSpeedKmh: speedKmh, evaluated: false };
    } else {
      stopState.lowestSpeedKmh = Math.min(stopState.lowestSpeedKmh, speedKmh);
    }
  }

  if (stepJustCompleted && stopState && !stopState.evaluated) {
    stopState.evaluated = true;
    const threshold = stopState.requirement === 'railway_crossing' ? 20 : 2;
    result.stopViolation = { complied: stopState.lowestSpeedKmh <= threshold, lowestSpeedKmh: stopState.lowestSpeedKmh, type: stopState.requirement };
    stopState = null;
  }

  // ── Pedestrian crossing monitoring ─────────────────────────────────────────
  if (isPedestrian && distToStepEnd < 50) {
    if (!pedestrianState) {
      pedestrianState = { lowestSpeedKmh: speedKmh, evaluated: false };
    } else {
      pedestrianState.lowestSpeedKmh = Math.min(pedestrianState.lowestSpeedKmh, speedKmh);
    }
  }

  if (stepJustCompleted && pedestrianState && !pedestrianState.evaluated && !result.stopViolation) {
    pedestrianState.evaluated = true;
    result.stopViolation = { complied: pedestrianState.lowestSpeedKmh < 20, lowestSpeedKmh: pedestrianState.lowestSpeedKmh, type: 'pedestrian_crossing' };
    pedestrianState = null;
  }

  // ── Harsh braking ──────────────────────────────────────────────────────────
  // isAtKnownStop already computed above — exclude expected braking at stops/crossings
  const isAtKnownStopForBraking = distToStepEnd < 80 || requirement !== null || isPedestrian;

  if (brakingState.prevTimestamp > 0) {
    const timeDelta = (now - brakingState.prevTimestamp) / 1000;
    const delta = brakingState.prevSpeedKmh - speedKmh;
    if (
      !isAtKnownStopForBraking &&
      timeDelta <= 2.5 &&
      delta > NZ_DRIVING.HARSH_BRAKING_THRESHOLD_KMH &&
      brakingState.prevSpeedKmh > NZ_DRIVING.HARSH_BRAKING_MIN_SPEED_KMH &&
      now - brakingState.lastWarnedAt > NZ_DRIVING.HARSH_BRAKING_COOLDOWN_MS
    ) {
      brakingState.lastWarnedAt = now;
      result.brakingEvent = {
        text: 'Try to brake smoothly and progressively.',
        deltaKmh: delta,
        prevSpeedKmh: brakingState.prevSpeedKmh,
      };
    }
  }
  brakingState.prevSpeedKmh = speedKmh;
  brakingState.prevTimestamp = now;

  // ── Unexpected stopping ────────────────────────────────────────────────────
  if (speedKmh >= 10) hasMovedSinceStart = true;
  const isAtKnownStop = distToStepEnd < 40 || requirement !== null || isPedestrian;

  if (!hasMovedSinceStart) {
    // Never driven yet (session start, stationary testing) — nothing to warn about
    unexpectedStopState.stoppedSince = null;
  } else if (speedKmh < 2) {
    if (!unexpectedStopState.stoppedSince) unexpectedStopState.stoppedSince = now;
    const duration = now - unexpectedStopState.stoppedSince;
    if (
      duration > NZ_DRIVING.UNEXPECTED_STOP_DURATION_MS &&
      !isAtKnownStop &&
      now - unexpectedStopState.lastWarnedAt > 30_000
    ) {
      unexpectedStopState.lastWarnedAt = now;
      unexpectedStopState.stoppedSince = now; // reset clock so warning doesn't repeat
      result.unexpectedStopWarning = { text: 'Unless it is safe and necessary, avoid stopping in the carriageway.' };
    }
  } else {
    unexpectedStopState.stoppedSince = null;
  }

  return result;
}
