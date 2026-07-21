import {
  DrivingSession, GPSPoint, HazardEvent, KnowledgeEvent, DecisionEvent,
  SpeedViolation, StopEvent, BrakingEvent, NavigationEvent, Coordinate,
} from '../types';
import { distanceBetween } from './geo';
import { computeScore } from './scoring';

// Session event log. Instance-based (no module singleton) and clock-injected:
// event timestamps come from the caller, so a replayed GPS track produces an
// identical session byte-for-byte (modulo random id suffixes).

export class SessionLog {
  private session: DrivingSession | null = null;
  private idCounter = 0;

  private nextId(nowMs: number): string {
    return `${nowMs}-${(this.idCounter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  private mustHaveSession(): DrivingSession {
    if (!this.session) throw new Error('No active session');
    return this.session;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  create(userId: string, nowMs: number): DrivingSession {
    this.session = {
      id: this.nextId(nowMs),
      userId,
      startTime: nowMs,
      duration: 0,
      routeCoordinates: [],
      hazardEvents: [], knowledgeEvents: [], decisionEvents: [],
      speedViolations: [], stopEvents: [], brakingEvents: [], navigationEvents: [],
      totalDistance: 0, averageSpeed: 0,
      status: 'active',
    };
    return this.session;
  }

  get active(): DrivingSession | null {
    return this.session;
  }

  complete(nowMs: number): DrivingSession {
    const s = this.mustHaveSession();
    s.endTime = nowMs;
    s.duration = (nowMs - s.startTime) / 1000;
    s.status = 'completed';
    s.score = computeScore(s);
    this.session = null;
    return s;
  }

  abandon(): void {
    if (this.session) {
      this.session.status = 'abandoned';
      this.session = null;
    }
  }

  // ─── GPS ───────────────────────────────────────────────────────────────────

  recordGPSPoint(point: GPSPoint): void {
    if (!this.session) return;
    const prev = this.session.routeCoordinates.at(-1);
    if (prev) this.session.totalDistance += distanceBetween(prev.coordinate, point.coordinate);
    this.session.routeCoordinates.push(point);
    this.session.duration = Math.max(0, (point.timestamp - this.session.startTime) / 1000);
    if (this.session.routeCoordinates.length > 1) {
      const totalSpeed = this.session.routeCoordinates.reduce((s, p) => s + p.speed * 3.6, 0);
      this.session.averageSpeed = totalSpeed / this.session.routeCoordinates.length;
    }
  }

  // ─── Conversation events ───────────────────────────────────────────────────

  recordHazardEvent(location: Coordinate, prompt: string, response: string, nowMs: number): HazardEvent {
    const s = this.mustHaveSession();
    const event: HazardEvent = { id: this.nextId(nowMs), sessionId: s.id, timestamp: nowMs, location, prompt, response, detectedCorrectly: null };
    s.hazardEvents.push(event);
    return event;
  }

  updateHazardEvaluation(eventId: string, quality: 'good' | 'partial' | 'missed', feedback: string): void {
    const e = this.session?.hazardEvents.find((x) => x.id === eventId);
    if (!e) return;
    e.claudeEvaluation = { quality, feedback };
    e.detectedCorrectly = quality !== 'missed';
  }

  recordKnowledgeEvent(location: Coordinate, question: string, expectedAnswer: string, response: string, nowMs: number): KnowledgeEvent {
    const s = this.mustHaveSession();
    const event: KnowledgeEvent = { id: this.nextId(nowMs), sessionId: s.id, timestamp: nowMs, location, question, expectedAnswer, response };
    s.knowledgeEvents.push(event);
    return event;
  }

  updateKnowledgeEvaluation(eventId: string, quality: 'correct' | 'partial' | 'incorrect', feedback: string): void {
    const e = this.session?.knowledgeEvents.find((x) => x.id === eventId);
    if (!e) return;
    e.claudeEvaluation = { quality, feedback };
  }

  recordDecisionEvent(location: Coordinate, trigger: DecisionEvent['trigger'], question: string, response: string, nowMs: number): DecisionEvent {
    const s = this.mustHaveSession();
    const event: DecisionEvent = { id: this.nextId(nowMs), sessionId: s.id, timestamp: nowMs, location, trigger, question, response };
    s.decisionEvents.push(event);
    return event;
  }

  updateDecisionEvaluation(eventId: string, quality: 'good' | 'poor', feedback: string): void {
    const e = this.session?.decisionEvents.find((x) => x.id === eventId);
    if (!e) return;
    e.claudeEvaluation = { quality, feedback };
  }

  // ─── Driving events ────────────────────────────────────────────────────────

  recordSpeedViolation(location: Coordinate, speedKmh: number, limitKmh: number, severity: 'critical' | 'immediate_fail', durationSeconds: number, nowMs: number): SpeedViolation {
    const s = this.mustHaveSession();
    const event: SpeedViolation = { id: this.nextId(nowMs), sessionId: s.id, timestamp: nowMs, location, speedKmh: Math.round(speedKmh), limitKmh, severity, durationSeconds: Math.round(durationSeconds) };
    s.speedViolations.push(event);
    return event;
  }

  recordStopEvent(location: Coordinate, type: 'stop_sign' | 'railway_crossing' | 'pedestrian_crossing', complied: boolean, lowestSpeedKmh: number, nowMs: number): StopEvent {
    const s = this.mustHaveSession();
    const event: StopEvent = { id: this.nextId(nowMs), sessionId: s.id, timestamp: nowMs, location, type, complied, lowestSpeedKmh: Math.round(lowestSpeedKmh) };
    s.stopEvents.push(event);
    return event;
  }

  recordBrakingEvent(location: Coordinate, speedFromKmh: number, speedToKmh: number, deltaKmh: number, nowMs: number): BrakingEvent {
    const s = this.mustHaveSession();
    const event: BrakingEvent = {
      id: this.nextId(nowMs), sessionId: s.id, timestamp: nowMs, location,
      speedFromKmh: Math.round(speedFromKmh), speedToKmh: Math.round(speedToKmh), deltaKmh: Math.round(deltaKmh),
    };
    s.brakingEvents.push(event);
    return event;
  }

  recordNavigationEvent(location: Coordinate, instructionGiven: string, type: 'wrong_turn' | 'off_route', nowMs: number): NavigationEvent {
    const s = this.mustHaveSession();
    const event: NavigationEvent = { id: this.nextId(nowMs), sessionId: s.id, timestamp: nowMs, location, instructionGiven, type };
    s.navigationEvents.push(event);
    return event;
  }
}
