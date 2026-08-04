export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  startLocation: Coordinate;
  endLocation: Coordinate;
  maneuver?: string;
  /** Decoded step geometry; falls back to [startLocation, endLocation] when absent */
  polyline?: Coordinate[];
}

export interface GPSPoint {
  coordinate: Coordinate;
  timestamp: number;
  speed: number; // m/s
  heading: number;
}

// ─── Session events ──────────────────────────────────────────────────────────

export interface HazardEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  location: Coordinate;
  prompt: string;
  response: string;
  detectedCorrectly: boolean | null;
  claudeEvaluation?: {
    quality: 'good' | 'partial' | 'missed';
    feedback: string;
  };
}

export interface KnowledgeEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  location: Coordinate;
  question: string;
  expectedAnswer: string;
  response: string;
  claudeEvaluation?: {
    quality: 'correct' | 'partial' | 'incorrect';
    feedback: string;
  };
}

export interface DecisionEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  location: Coordinate;
  trigger: 'off_route' | 'stop_complied' | 'speed_change';
  question: string;
  response: string;
  claudeEvaluation?: {
    quality: 'good' | 'poor';
    feedback: string;
  };
}

export interface SpeedViolation {
  id: string;
  sessionId: string;
  timestamp: number;
  location: Coordinate;
  speedKmh: number;
  limitKmh: number;
  severity: 'critical' | 'immediate_fail';
  durationSeconds: number;
}

export interface StopEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  location: Coordinate;
  type: 'stop_sign' | 'railway_crossing' | 'pedestrian_crossing';
  complied: boolean;
  lowestSpeedKmh: number;
}

export interface BrakingEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  location: Coordinate;
  speedFromKmh: number;
  speedToKmh: number;
  deltaKmh: number;
}

export interface NavigationEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  location: Coordinate;
  instructionGiven: string;
  type: 'wrong_turn' | 'off_route';
  /** Deviation excused after the driver's explanation (road closed, obstruction, safety) — no navigation penalty. */
  justified?: boolean;
}

export interface EventLogEntry {
  relativeMinute: number;
  type:
    | 'hazard_good' | 'hazard_partial' | 'hazard_missed'
    | 'speed_violation' | 'stop_complied' | 'stop_violation'
    | 'navigation'
    | 'knowledge_correct' | 'knowledge_partial' | 'knowledge_incorrect'
    | 'decision_good' | 'decision_poor'
    | 'braking' | 'unexpected_stop';
  description: string;
  severity: 'good' | 'warning' | 'violation';
}

// ─── Session ─────────────────────────────────────────────────────────────────

export interface DrivingSession {
  id: string;
  userId: string;
  startTime: number;
  endTime?: number;
  duration: number;
  routeCoordinates: GPSPoint[];
  hazardEvents: HazardEvent[];
  knowledgeEvents: KnowledgeEvent[];
  decisionEvents: DecisionEvent[];
  speedViolations: SpeedViolation[];
  stopEvents: StopEvent[];
  brakingEvents: BrakingEvent[];
  navigationEvents: NavigationEvent[];
  totalDistance: number;
  averageSpeed: number;
  score?: SessionScore;
  feedback?: string;
  status: 'active' | 'completed' | 'abandoned';
}

// ─── NZTA-aligned verdict (ADR-0005) ─────────────────────────────────────────
// Categories and thresholds from the official Full Licence test guide —
// sourced mapping in docs/nzta-error-mapping.md.

export type NZTAErrorCategory =
  | 'excessive_speed'      // immediate fail: ≥10 km/h over any duration, or ≥5 km/h over for ≥5 s
  | 'failure_to_stop'      // immediate fail: no complete stop at a stop sign / railway crossing
  | 'failure_to_give_way'  // immediate fail: did not give way at a pedestrian crossing
  | 'too_fast';            // critical: 5–10 km/h over for under 5 s

export interface NZTAError {
  category: NZTAErrorCategory;
  kind: 'immediate_fail' | 'critical';
  description: string;
  timestamp: number;
}

export interface NZTAVerdict {
  result: 'pass' | 'fail';
  immediateFailErrors: NZTAError[];
  criticalErrors: NZTAError[];
  /** Aspects of the official assessment this app observes. */
  assessed: string[];
  /** Official categories that need sensors the app doesn't have. */
  notAssessed: string[];
}

export interface SessionScore {
  overall: number;
  hazardAwareness: number;
  knowledgeScore: number;
  speedCompliance: number;
  stopCompliance: number;
  navigationCompliance: number;
  sessionCompletion: number;
  observations: string[];
  improvements: string[];
  eventLog: EventLogEntry[];
  /** PASS/FAIL per the NZTA error model — absent on sessions scored before ADR-0005 landed. */
  verdict?: NZTAVerdict;
}

export interface InstructorInstruction {
  text: string;
  type: 'turn' | 'warning' | 'speed' | 'hazard-prompt' | 'encouragement' | 'general';
  urgency: 'immediate' | 'upcoming' | 'info';
  distanceMeters?: number;
}

export type SessionPhase =
  | 'idle'
  | 'requesting-location'
  | 'building-route'
  | 'ready'
  | 'active'
  | 'completing'
  | 'completed';
