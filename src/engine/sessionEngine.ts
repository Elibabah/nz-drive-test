import { Coordinate, DrivingSession, GPSPoint, RouteStep } from '../types';
import { NZ_DRIVING } from '../constants/nzDriving';
import { distanceBetween, distanceToPolyline } from './geo';
import { RoadData } from './roadData';
import { DrivingMonitor } from './monitoring';
import { NavigationAnnouncer } from './navigation';
import { SessionLog } from './recording';

// The exam core (ADR-0006). Pure and deterministic: inputs are plain data
// (positions, timestamps, routes, speech exchanges), outputs are plain data
// (commands + session state). No React, no Expo, no globals, no clocks —
// the adapter (useDrivingSession) owns every side effect.

export const STEP_COMPLETION_RADIUS = 30;
export const OFF_ROUTE_THRESHOLD = 300;
export const REROUTE_DEBOUNCE_MS = 20_000;

export type RerouteReason = 'off_route' | 'destination_reached';

/**
 * Speak priorities are the adapter's contract:
 * - 'safety' and 'navigation' interrupt any ongoing speech
 * - 'coaching' must be dropped if speech is already playing
 */
export type SpeakPriority = 'safety' | 'navigation' | 'coaching';

export type EngineCommand =
  | { type: 'speak'; text: string; priority: SpeakPriority }
  | { type: 'requestReroute'; reason: RerouteReason }
  // Reroute after a deviation completed — the examiner should now ask the
  // driver why they went a different way (MVP-1 deviation evaluation).
  | { type: 'askDeviation'; instructionGiven: string };

export interface EngineNavigationContext {
  position: Coordinate;
  nextStep: RouteStep | null;
  distanceToTurnM: number;
  remainingSteps: RouteStep[];
  timeRemainingMs: number;
  sessionElapsedMs: number;
  speedKmh: number;
}

export class SessionEngine {
  private log = new SessionLog();
  private monitor = new DrivingMonitor();
  private announcer = new NavigationAnnouncer();
  private steps: RouteStep[] = [];
  private driving = false;
  private startedAt = 0;
  private lastRerouteAt = 0;
  private rerouteInFlight = false;
  private lastPosition: Coordinate | null = null;
  private lastSpeedKmh = 0;
  private pendingDeviation: { navEventId: string; instructionGiven: string } | null = null;
  private readonly durationMs: number;

  constructor(opts: { userId: string; nowMs: number; sessionDurationMs?: number }) {
    this.durationMs = opts.sessionDurationMs ?? NZ_DRIVING.SESSION_DURATION_MS;
    this.log.create(opts.userId, opts.nowMs);
  }

  // ─── State accessors ───────────────────────────────────────────────────────

  get session(): DrivingSession | null {
    return this.log.active;
  }

  get remainingSteps(): RouteStep[] {
    return this.steps;
  }

  get isRerouting(): boolean {
    return this.rerouteInFlight;
  }

  timeRemainingMs(nowMs: number): number {
    if (!this.driving) return this.durationMs;
    return Math.max(0, this.durationMs - (nowMs - this.startedAt));
  }

  getNavigationContext(nowMs: number): EngineNavigationContext {
    const pos = this.lastPosition ?? { latitude: 0, longitude: 0 };
    const nextStep = this.steps[0] ?? null;
    return {
      position: pos,
      nextStep,
      distanceToTurnM: nextStep ? distanceBetween(pos, nextStep.endLocation) : 9999,
      remainingSteps: this.steps,
      timeRemainingMs: this.timeRemainingMs(nowMs),
      sessionElapsedMs: this.driving ? nowMs - this.startedAt : 0,
      speedKmh: this.lastSpeedKmh,
    };
  }

  // ─── Route management ──────────────────────────────────────────────────────

  setRoute(steps: RouteStep[]): void {
    this.steps = [...steps];
    this.announcer.resetForNewRoute();
  }

  /** Attach OSM road data (ADR-0004); safe to call any time, replaces prior data. */
  setRoadData(roadData: RoadData): void {
    this.monitor.setRoadData(roadData);
  }

  applyReroute(steps: RouteStep[]): EngineCommand[] {
    this.steps = [...steps];
    this.announcer.resetForNewRoute();
    this.rerouteInFlight = false;
    // A deviation reroute is silent; once the new route is in place the
    // examiner asks for the reason (justified vs manoeuvring error).
    if (this.pendingDeviation) {
      return [{ type: 'askDeviation', instructionGiven: this.pendingDeviation.instructionGiven }];
    }
    return [];
  }

  rerouteFailed(): void {
    // Keep the existing steps; debounce timer still applies from beginReroute
    this.rerouteInFlight = false;
  }

  // ─── Driving lifecycle ─────────────────────────────────────────────────────

  start(nowMs: number): void {
    this.driving = true;
    this.startedAt = nowMs;
    this.lastRerouteAt = nowMs;
    this.monitor.reset();
  }

  complete(nowMs: number): DrivingSession {
    this.driving = false;
    return this.log.complete(nowMs);
  }

  abandon(): void {
    this.driving = false;
    this.log.abandon();
  }

  // ─── Position processing ───────────────────────────────────────────────────

  recordGpsPoint(point: GPSPoint): void {
    this.log.recordGPSPoint(point);
  }

  handlePosition(coord: Coordinate, speedKmh: number, nowMs: number): EngineCommand[] {
    this.lastPosition = coord;
    this.lastSpeedKmh = speedKmh;

    if (!this.driving) return [];

    const commands: EngineCommand[] = [];
    const canReroute = !this.rerouteInFlight && nowMs - this.lastRerouteAt > REROUTE_DEBOUNCE_MS;

    if (this.steps.length === 0) {
      if (canReroute) commands.push(...this.beginReroute('destination_reached', coord, nowMs));
      return commands;
    }

    // Google's step model: steps[0] is the segment being driven; its END is
    // the next maneuver point, and steps[1] describes what to do there.
    const currentStep = this.steps[0];
    const distToManeuver = distanceBetween(coord, currentStep.endLocation);
    const stepCompleted = distToManeuver <= STEP_COMPLETION_RADIUS;
    // Off-route = far from the step's actual geometry, not from its endpoints
    const stepPath = currentStep.polyline ?? [currentStep.startLocation, currentStep.endLocation];
    const offRoute = distanceToPolyline(coord, stepPath) > OFF_ROUTE_THRESHOLD;

    const m = this.monitor.update(coord, speedKmh, this.steps, distToManeuver, stepCompleted, nowMs);

    if (m.speedWarning) {
      const { text, severity, speedKmh: spd, limitKmh, duration } = m.speedWarning;
      // An active immediate-fail overspeed must interrupt; a critical is
      // reported after the incident ended, so it can wait its turn.
      commands.push({ type: 'speak', text, priority: severity === 'immediate_fail' ? 'safety' : 'coaching' });
      this.log.recordSpeedViolation(coord, spd, limitKmh, severity, duration, nowMs);
    }

    if (m.stopViolation?.type) {
      const { complied, lowestSpeedKmh, type } = m.stopViolation;
      this.log.recordStopEvent(coord, type as 'stop_sign' | 'railway_crossing' | 'pedestrian_crossing', complied, lowestSpeedKmh, nowMs);
      if (!complied) {
        const text =
          type === 'stop_sign' ? 'At the stop sign, you must come to a complete stop before proceeding.'
          : type === 'railway_crossing' ? 'At a railway crossing, you must slow right down and check both directions.'
          : 'You must give way to pedestrians at a pedestrian crossing.';
        commands.push({ type: 'speak', text, priority: 'safety' });
      }
    }

    if (m.brakingEvent) {
      const { text, deltaKmh, prevSpeedKmh } = m.brakingEvent;
      this.log.recordBrakingEvent(coord, prevSpeedKmh, speedKmh, deltaKmh, nowMs);
      commands.push({ type: 'speak', text, priority: 'coaching' });
    }

    if (m.unexpectedStopWarning) {
      commands.push({ type: 'speak', text: m.unexpectedStopWarning.text, priority: 'coaching' });
    }

    if (stepCompleted) {
      // Advance locally — no network round-trip, no debounce (the field bug
      // where a fresh route per step meant turns never got announced).
      this.steps = this.steps.slice(1);
      this.monitor.clearStepMonitoring();
      if (this.steps.length === 0 && canReroute) {
        commands.push(...this.beginReroute('destination_reached', coord, nowMs));
      }
      return commands;
    }
    if (offRoute && canReroute) {
      commands.push(...this.beginReroute('off_route', coord, nowMs));
      return commands;
    }

    // Announce the NEXT maneuver (steps[1], happening at currentStep's end).
    // On the final step there is no maneuver left — the destination flow
    // regenerates the route when it is reached.
    const maneuverStep = this.steps[1];
    if (!this.rerouteInFlight && maneuverStep) {
      for (const text of this.announcer.update(maneuverStep, distToManeuver)) {
        commands.push({ type: 'speak', text, priority: 'navigation' });
      }
    }

    return commands;
  }

  private beginReroute(reason: RerouteReason, coord: Coordinate, nowMs: number): EngineCommand[] {
    const out: EngineCommand[] = [];
    this.monitor.clearStepMonitoring();

    if (reason === 'off_route') {
      // Silent reroute (ROADMAP MVP-1): no scolding at the moment of the
      // deviation — record it, reroute, and ask for the reason afterwards.
      // Getting lost is not a fail on the real test; disobeying signs is.
      const instrWas = this.announcer.lastInstructionGiven;
      if (instrWas) {
        const lower = instrWas.toLowerCase();
        const navEvent = this.log.recordNavigationEvent(coord, instrWas, lower.includes('turn') ? 'wrong_turn' : 'off_route', nowMs);
        this.pendingDeviation = { navEventId: navEvent.id, instructionGiven: instrWas };
      }
    }

    this.rerouteInFlight = true;
    this.lastRerouteAt = nowMs;
    out.push({ type: 'requestReroute', reason });
    return out;
  }

  // ─── Conversation exchanges (from the voice layer) ────────────────────────

  recordHazardExchange(prompt: string, response: string, nowMs: number): string | null {
    if (!this.lastPosition) return null;
    return this.log.recordHazardEvent(this.lastPosition, prompt, response, nowMs).id;
  }

  applyHazardEvaluation(eventId: string, quality: 'good' | 'partial' | 'missed', feedback: string): void {
    this.log.updateHazardEvaluation(eventId, quality, feedback);
  }

  recordKnowledgeExchange(question: string, expectedAnswer: string, response: string, nowMs: number): string | null {
    if (!this.lastPosition) return null;
    return this.log.recordKnowledgeEvent(this.lastPosition, question, expectedAnswer, response, nowMs).id;
  }

  applyKnowledgeEvaluation(eventId: string, quality: 'correct' | 'partial' | 'incorrect', feedback: string): void {
    this.log.updateKnowledgeEvaluation(eventId, quality, feedback);
  }

  /**
   * The driver answered the post-reroute "why did you go a different way?"
   * question. Links the decision event to the deviation's navigation event so
   * a justified explanation can lift the penalty.
   */
  recordDeviationExchange(question: string, response: string, nowMs: number): { decisionEventId: string; navEventId: string } | null {
    const pending = this.pendingDeviation;
    if (!pending || !this.lastPosition) return null;
    this.pendingDeviation = null;
    const event = this.log.recordDecisionEvent(this.lastPosition, 'off_route', question, response, nowMs);
    return { decisionEventId: event.id, navEventId: pending.navEventId };
  }

  applyDeviationEvaluation(
    ids: { decisionEventId: string; navEventId: string },
    classification: 'justified' | 'manoeuvring_error',
    feedback: string
  ): void {
    this.log.updateDecisionEvaluation(ids.decisionEventId, classification === 'justified' ? 'good' : 'poor', feedback);
    if (classification === 'justified') {
      this.log.markNavigationEventJustified(ids.navEventId);
    }
  }
}
