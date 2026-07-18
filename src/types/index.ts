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
