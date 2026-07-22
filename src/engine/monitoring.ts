import { RouteStep, Coordinate } from '../types';
import { NZ_DRIVING } from '../constants/nzDriving';
import { distanceBetween } from './geo';
import { RoadData, EMPTY_ROAD_DATA, speedLimitAt } from './roadData';

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

// Control-point compliance rules (ADR-0004): entry radius for tracking and the
// lowest-speed threshold that counts as complied. Signals/give-way have no
// compliance rule — they only suppress stop/braking nudges.
const CP_RULES: Partial<Record<string, { enterM: number; thresholdKmh: number }>> = {
  stop_sign: { enterM: 50, thresholdKmh: 2 },
  railway_crossing: { enterM: 80, thresholdKmh: 20 },
  pedestrian_crossing: { enterM: 50, thresholdKmh: 20 },
};
/** Passed the point and moving away by this much → evaluate compliance. */
const CP_EXIT_HYSTERESIS_M = 25;
/** Any control point within this distance suppresses the unexpected-stop nudge (red-light queues). */
const CP_SUPPRESS_STOP_M = 60;
/** Any control point within this distance excludes braking from harshness checks. */
const CP_SUPPRESS_BRAKING_M = 80;

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
  // Road data (ADR-0004): control-point tracking by proximity
  private roadData: RoadData = EMPTY_ROAD_DATA;
  private cpTracking = new Map<number, { lowestKmh: number; minDistM: number }>();
  private cpEvaluated = new Set<number>();

  setRoadData(roadData: RoadData): void {
    this.roadData = roadData;
    this.cpTracking.clear();
    this.cpEvaluated.clear();
  }

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
    this.cpTracking.clear();
    this.cpEvaluated.clear();
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
    // Real limit from OSM speed zones when available; instruction-text fallback otherwise
    const limitKmh = speedLimitAt(this.roadData, coord, getSpeedLimitKmh(steps));
    const requirement = detectStopRequirement(steps[0]);
    const isPedestrian = detectPedestrianCrossing(steps[0]);
    const hasRoadData = this.roadData.controlPoints.length > 0;

    // ── Control-point scan (ADR-0004) ────────────────────────────────────────
    // Proximity flags for nudge suppression + compliance tracking windows.
    let nearCpStopSuppress = false;
    let nearCpBrakingSuppress = false;
    this.roadData.controlPoints.forEach((cp, i) => {
      const d = distanceBetween(coord, cp.location);
      if (d < CP_SUPPRESS_STOP_M) nearCpStopSuppress = true;
      if (d < CP_SUPPRESS_BRAKING_M) nearCpBrakingSuppress = true;

      const rule = CP_RULES[cp.kind];
      if (!rule || this.cpEvaluated.has(i)) return;
      const tracked = this.cpTracking.get(i);
      if (tracked && d > tracked.minDistM + CP_EXIT_HYSTERESIS_M) {
        // Passed the point and moving away → evaluate compliance
        this.cpEvaluated.add(i);
        this.cpTracking.delete(i);
        if (!result.stopViolation) {
          result.stopViolation = {
            complied: tracked.lowestKmh <= rule.thresholdKmh,
            lowestSpeedKmh: tracked.lowestKmh,
            type: cp.kind as 'stop_sign' | 'railway_crossing' | 'pedestrian_crossing',
          };
        }
      } else if (d < rule.enterM) {
        if (!tracked) {
          this.cpTracking.set(i, { lowestKmh: speedKmh, minDistM: d });
        } else {
          tracked.lowestKmh = Math.min(tracked.lowestKmh, speedKmh);
          tracked.minDistM = Math.min(tracked.minDistM, d);
        }
      }
    });

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

    // ── Stop sign / railway crossing monitoring (legacy text path) ───────────
    // Only when no OSM control points exist — the CP scan above is authoritative
    const stopZoneDistance = requirement === 'railway_crossing' ? 80 : 50;

    if (!hasRoadData && requirement && distToStepEnd < stopZoneDistance) {
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

    // ── Pedestrian crossing monitoring (legacy text path) ────────────────────
    if (!hasRoadData && isPedestrian && distToStepEnd < 50) {
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
    // Exclude expected braking at stops/crossings (OSM control points included)
    const isAtKnownStopForBraking = distToStepEnd < 80 || requirement !== null || isPedestrian || nearCpBrakingSuppress;

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
    // Suppressed near ANY control point — waiting at a red light or queueing
    // at a stop sign is correct driving (field test 2026-07-22)
    if (speedKmh >= 10) this.hasMovedSinceStart = true;
    const isAtKnownStop = distToStepEnd < 40 || requirement !== null || isPedestrian || nearCpStopSuppress;

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
