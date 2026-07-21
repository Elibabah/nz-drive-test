import { RouteStep, Coordinate } from '../types';
import { NZ_DRIVING } from '../constants/nzDriving';

// Driving-behaviour monitoring: speed, stop/crossing compliance, harsh
// braking, unexpected stops. Instance-based and clock-injected (nowMs) so the
// engine is deterministic and replayable.

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

// ─── Result ───────────────────────────────────────────────────────────────────

export interface MonitorResult {
  speedWarning: { text: string; severity: 'critical' | 'immediate_fail'; speedKmh: number; limitKmh: number; duration: number } | null;
  stopViolation: { complied: boolean; lowestSpeedKmh: number; type: StopRequirement | 'pedestrian_crossing' } | null;
  brakingEvent: { text: string; deltaKmh: number; prevSpeedKmh: number } | null;
  unexpectedStopWarning: { text: string } | null;
}

// ─── Monitor ──────────────────────────────────────────────────────────────────

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

export class DrivingMonitor {
  private speedState: SpeedState = { overLimitSince: null, warnedForCurrentIncident: false, lastWarnedSpeedKmh: 0 };
  private stopState: StopState | null = null;
  private pedestrianState: PedestrianState | null = null;
  private brakingPrevSpeedKmh = 0;
  private brakingPrevTimestamp = 0;
  private brakingLastWarnedAt = 0;
  private stoppedSince: number | null = null;
  private unexpectedStopLastWarnedAt = 0;
  // Sessions start parked — stop monitoring only arms once the car has moved
  private hasMovedSinceStart = false;

  reset(): void {
    this.speedState = { overLimitSince: null, warnedForCurrentIncident: false, lastWarnedSpeedKmh: 0 };
    this.stopState = null;
    this.pedestrianState = null;
    this.brakingPrevSpeedKmh = 0;
    this.brakingPrevTimestamp = 0;
    this.brakingLastWarnedAt = 0;
    this.stoppedSince = null;
    this.unexpectedStopLastWarnedAt = 0;
    this.hasMovedSinceStart = false;
  }

  clearStepMonitoring(): void {
    this.stopState = null;
    this.pedestrianState = null;
  }

  update(
    coord: Coordinate,
    speedKmh: number,
    steps: RouteStep[],
    distToStepEnd: number,
    stepJustCompleted: boolean,
    nowMs: number
  ): MonitorResult {
    const result: MonitorResult = { speedWarning: null, stopViolation: null, brakingEvent: null, unexpectedStopWarning: null };
    const limitKmh = getSpeedLimitKmh(steps);
    const requirement = detectStopRequirement(steps[0]);
    const isPedestrian = detectPedestrianCrossing(steps[0]);

    // ── Speed monitoring ─────────────────────────────────────────────────────
    const overBy = speedKmh - limitKmh;

    if (overBy > 10) {
      if (!this.speedState.warnedForCurrentIncident || this.speedState.lastWarnedSpeedKmh < speedKmh) {
        const duration = this.speedState.overLimitSince ? (nowMs - this.speedState.overLimitSince) / 1000 : 0;
        result.speedWarning = { text: 'You must reduce your speed immediately.', severity: 'immediate_fail', speedKmh, limitKmh, duration };
        this.speedState.warnedForCurrentIncident = true;
        this.speedState.lastWarnedSpeedKmh = speedKmh;
      }
      if (!this.speedState.overLimitSince) this.speedState.overLimitSince = nowMs;
    } else if (overBy > 5) {
      if (!this.speedState.overLimitSince) this.speedState.overLimitSince = nowMs;
      const elapsed = (nowMs - this.speedState.overLimitSince) / 1000;
      if (elapsed > 3 && !this.speedState.warnedForCurrentIncident) {
        result.speedWarning = { text: 'Reduce your speed — you are slightly over the limit.', severity: 'critical', speedKmh, limitKmh, duration: elapsed };
        this.speedState.warnedForCurrentIncident = true;
        this.speedState.lastWarnedSpeedKmh = speedKmh;
      }
    } else {
      this.speedState.overLimitSince = null;
      this.speedState.warnedForCurrentIncident = false;
      this.speedState.lastWarnedSpeedKmh = 0;
    }

    // ── Stop sign / railway crossing monitoring ──────────────────────────────
    const stopZoneDistance = requirement === 'railway_crossing' ? 80 : 50;

    if (requirement && distToStepEnd < stopZoneDistance) {
      if (!this.stopState || this.stopState.requirement !== requirement) {
        this.stopState = { requirement, lowestSpeedKmh: speedKmh, evaluated: false };
      } else {
        this.stopState.lowestSpeedKmh = Math.min(this.stopState.lowestSpeedKmh, speedKmh);
      }
    }

    if (stepJustCompleted && this.stopState && !this.stopState.evaluated) {
      this.stopState.evaluated = true;
      const threshold = this.stopState.requirement === 'railway_crossing' ? 20 : 2;
      result.stopViolation = { complied: this.stopState.lowestSpeedKmh <= threshold, lowestSpeedKmh: this.stopState.lowestSpeedKmh, type: this.stopState.requirement };
      this.stopState = null;
    }

    // ── Pedestrian crossing monitoring ───────────────────────────────────────
    if (isPedestrian && distToStepEnd < 50) {
      if (!this.pedestrianState) {
        this.pedestrianState = { lowestSpeedKmh: speedKmh, evaluated: false };
      } else {
        this.pedestrianState.lowestSpeedKmh = Math.min(this.pedestrianState.lowestSpeedKmh, speedKmh);
      }
    }

    if (stepJustCompleted && this.pedestrianState && !this.pedestrianState.evaluated && !result.stopViolation) {
      this.pedestrianState.evaluated = true;
      result.stopViolation = { complied: this.pedestrianState.lowestSpeedKmh < 20, lowestSpeedKmh: this.pedestrianState.lowestSpeedKmh, type: 'pedestrian_crossing' };
      this.pedestrianState = null;
    }

    // ── Harsh braking ────────────────────────────────────────────────────────
    // Exclude expected braking at stops/crossings
    const isAtKnownStopForBraking = distToStepEnd < 80 || requirement !== null || isPedestrian;

    if (this.brakingPrevTimestamp > 0) {
      const timeDelta = (nowMs - this.brakingPrevTimestamp) / 1000;
      const delta = this.brakingPrevSpeedKmh - speedKmh;
      if (
        !isAtKnownStopForBraking &&
        timeDelta <= 2.5 &&
        delta > NZ_DRIVING.HARSH_BRAKING_THRESHOLD_KMH &&
        this.brakingPrevSpeedKmh > NZ_DRIVING.HARSH_BRAKING_MIN_SPEED_KMH &&
        nowMs - this.brakingLastWarnedAt > NZ_DRIVING.HARSH_BRAKING_COOLDOWN_MS
      ) {
        this.brakingLastWarnedAt = nowMs;
        result.brakingEvent = {
          text: 'Try to brake smoothly and progressively.',
          deltaKmh: delta,
          prevSpeedKmh: this.brakingPrevSpeedKmh,
        };
      }
    }
    this.brakingPrevSpeedKmh = speedKmh;
    this.brakingPrevTimestamp = nowMs;

    // ── Unexpected stopping ──────────────────────────────────────────────────
    if (speedKmh >= 10) this.hasMovedSinceStart = true;
    const isAtKnownStop = distToStepEnd < 40 || requirement !== null || isPedestrian;

    if (!this.hasMovedSinceStart) {
      // Never driven yet (session start, stationary testing) — nothing to warn about
      this.stoppedSince = null;
    } else if (speedKmh < 2) {
      if (!this.stoppedSince) this.stoppedSince = nowMs;
      const duration = nowMs - this.stoppedSince;
      if (
        duration > NZ_DRIVING.UNEXPECTED_STOP_DURATION_MS &&
        !isAtKnownStop &&
        nowMs - this.unexpectedStopLastWarnedAt > 30_000
      ) {
        this.unexpectedStopLastWarnedAt = nowMs;
        this.stoppedSince = nowMs; // reset clock so warning doesn't repeat
        result.unexpectedStopWarning = { text: 'Unless it is safe and necessary, avoid stopping in the carriageway.' };
      }
    } else {
      this.stoppedSince = null;
    }

    return result;
  }
}
