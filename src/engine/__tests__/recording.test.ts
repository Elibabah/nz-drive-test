import { SessionLog } from '../recording';

const COORD = { latitude: -36.84, longitude: 174.76 };
const T0 = 1_700_000_000_000;

let log: SessionLog;

beforeEach(() => {
  log = new SessionLog();
  log.create('user-test-123', T0);
});

// ─── Session lifecycle ────────────────────────────────────────────────────────

describe('create', () => {
  it('creates a session with status "active"', () => {
    expect(log.active!.status).toBe('active');
  });

  it('assigns the provided userId', () => {
    expect(log.active!.userId).toBe('user-test-123');
  });

  it('generates a unique id on each call', () => {
    const s1 = new SessionLog().create('u1', T0);
    const s2 = new SessionLog().create('u2', T0);
    expect(s1.id).not.toBe(s2.id);
  });

  it('initialises with empty event arrays', () => {
    const s = log.active!;
    expect(s.hazardEvents).toHaveLength(0);
    expect(s.speedViolations).toHaveLength(0);
    expect(s.stopEvents).toHaveLength(0);
  });
});

describe('complete', () => {
  it('returns the session with status "completed"', () => {
    expect(log.complete(T0 + 60_000).status).toBe('completed');
  });

  it('sets endTime and duration from the injected clock', () => {
    const completed = log.complete(T0 + 90_000);
    expect(completed.endTime).toBe(T0 + 90_000);
    expect(completed.duration).toBe(90);
  });

  it('attaches a score object', () => {
    expect(log.complete(T0 + 1000).score).toBeDefined();
  });

  it('throws if no active session', () => {
    log.complete(T0 + 1000);
    expect(() => log.complete(T0 + 2000)).toThrow('No active session');
  });

  it('clears the active session', () => {
    log.complete(T0 + 1000);
    expect(log.active).toBeNull();
  });
});

describe('abandon', () => {
  it('sets active session to null', () => {
    log.abandon();
    expect(log.active).toBeNull();
  });
});

// ─── Hazard events ────────────────────────────────────────────────────────────

describe('recordHazardEvent', () => {
  it('appends to hazardEvents', () => {
    log.recordHazardEvent(COORD, 'What do you see?', 'A car pulling out', T0 + 1000);
    expect(log.active!.hazardEvents).toHaveLength(1);
  });

  it('stores correct prompt, response, timestamp, and detectedCorrectly=null', () => {
    log.recordHazardEvent(COORD, 'Hazards?', 'Cyclist on left', T0 + 5000);
    const ev = log.active!.hazardEvents[0];
    expect(ev.prompt).toBe('Hazards?');
    expect(ev.response).toBe('Cyclist on left');
    expect(ev.timestamp).toBe(T0 + 5000);
    expect(ev.detectedCorrectly).toBeNull();
  });

  it('throws when no active session', () => {
    log.abandon();
    expect(() => log.recordHazardEvent(COORD, 'p', 'r', T0)).toThrow('No active session');
  });
});

describe('updateHazardEvaluation', () => {
  it('updates the event quality and detectedCorrectly=true for "good"', () => {
    const ev = log.recordHazardEvent(COORD, 'prompt', 'response', T0);
    log.updateHazardEvaluation(ev.id, 'good', 'Great use of see-think-do.');
    const updated = log.active!.hazardEvents.find((e) => e.id === ev.id)!;
    expect(updated.claudeEvaluation?.quality).toBe('good');
    expect(updated.detectedCorrectly).toBe(true);
  });

  it('sets detectedCorrectly=false for "missed"', () => {
    const ev = log.recordHazardEvent(COORD, 'p', 'r', T0);
    log.updateHazardEvaluation(ev.id, 'missed', 'No response given.');
    expect(log.active!.hazardEvents[0].detectedCorrectly).toBe(false);
  });

  it('does not throw for an unknown eventId', () => {
    expect(() => log.updateHazardEvaluation('nonexistent', 'good', 'fb')).not.toThrow();
  });
});

// ─── Knowledge events ─────────────────────────────────────────────────────────

describe('recordKnowledgeEvent', () => {
  it('stores question, expectedAnswer, and response', () => {
    log.recordKnowledgeEvent(COORD, 'Speed limit school zone?', '40 km/h', 'forty', T0);
    const ev = log.active!.knowledgeEvents[0];
    expect(ev.question).toBe('Speed limit school zone?');
    expect(ev.expectedAnswer).toBe('40 km/h');
    expect(ev.response).toBe('forty');
  });
});

// ─── Speed / stop / braking rounding ─────────────────────────────────────────

describe('recordSpeedViolation', () => {
  it('rounds speed values', () => {
    log.recordSpeedViolation(COORD, 61.4, 50, 'immediate_fail', 2.7, T0);
    const v = log.active!.speedViolations[0];
    expect(v.speedKmh).toBe(61);
    expect(v.durationSeconds).toBe(3);
    expect(v.severity).toBe('immediate_fail');
  });
});

describe('recordStopEvent', () => {
  it('rounds lowestSpeedKmh', () => {
    log.recordStopEvent(COORD, 'stop_sign', true, 0.5, T0);
    const ev = log.active!.stopEvents[0];
    expect(ev.complied).toBe(true);
    expect(ev.lowestSpeedKmh).toBe(1); // Math.round(0.5) === 1 in JS
    expect(ev.type).toBe('stop_sign');
  });
});

describe('recordBrakingEvent', () => {
  it('rounds speed values', () => {
    log.recordBrakingEvent(COORD, 49.9, 29.1, 20.8, T0);
    const ev = log.active!.brakingEvents[0];
    expect(ev.speedFromKmh).toBe(50);
    expect(ev.speedToKmh).toBe(29);
    expect(ev.deltaKmh).toBe(21);
  });
});

// ─── GPS aggregation ──────────────────────────────────────────────────────────

describe('recordGPSPoint', () => {
  it('accumulates distance and derives duration from point timestamps', () => {
    log.recordGPSPoint({ coordinate: { latitude: -36.8400, longitude: 174.7600 }, timestamp: T0 + 2000, speed: 10, heading: 0 });
    log.recordGPSPoint({ coordinate: { latitude: -36.8409, longitude: 174.7600 }, timestamp: T0 + 12_000, speed: 10, heading: 0 });
    const s = log.active!;
    expect(s.routeCoordinates).toHaveLength(2);
    expect(s.totalDistance).toBeGreaterThan(90); // ~100 m of latitude
    expect(s.totalDistance).toBeLessThan(110);
    expect(s.duration).toBe(12);
  });
});

// ─── Scoring (via complete) ───────────────────────────────────────────────────

describe('scoring — speed compliance', () => {
  it('no violations → speedCompliance = 100', () => {
    expect(log.complete(T0 + 1000).score!.speedCompliance).toBe(100);
  });

  it('one immediate_fail → speedCompliance = 80 (100 - 1×20)', () => {
    log.recordSpeedViolation(COORD, 65, 50, 'immediate_fail', 2, T0);
    expect(log.complete(T0 + 1000).score!.speedCompliance).toBe(80);
  });

  it('two immediate_fail → speedCompliance = 60', () => {
    log.recordSpeedViolation(COORD, 65, 50, 'immediate_fail', 2, T0);
    log.recordSpeedViolation(COORD, 70, 50, 'immediate_fail', 3, T0);
    expect(log.complete(T0 + 1000).score!.speedCompliance).toBe(60);
  });

  it('speedCompliance floors at 0', () => {
    for (let i = 0; i < 10; i++) log.recordSpeedViolation(COORD, 70, 50, 'immediate_fail', 1, T0);
    expect(log.complete(T0 + 1000).score!.speedCompliance).toBe(0);
  });
});

describe('scoring — stop compliance', () => {
  it('no stops → stopCompliance = 100', () => {
    expect(log.complete(T0 + 1000).score!.stopCompliance).toBe(100);
  });

  it('one stop violated → stopCompliance = 0', () => {
    log.recordStopEvent(COORD, 'stop_sign', false, 10, T0);
    expect(log.complete(T0 + 1000).score!.stopCompliance).toBe(0);
  });

  it('2 stops, 1 complied → stopCompliance = 50', () => {
    log.recordStopEvent(COORD, 'stop_sign', true, 0, T0);
    log.recordStopEvent(COORD, 'railway_crossing', false, 15, T0);
    expect(log.complete(T0 + 1000).score!.stopCompliance).toBe(50);
  });

  it('all stops complied → stopCompliance = 100', () => {
    log.recordStopEvent(COORD, 'stop_sign', true, 0, T0);
    log.recordStopEvent(COORD, 'pedestrian_crossing', true, 5, T0);
    expect(log.complete(T0 + 1000).score!.stopCompliance).toBe(100);
  });
});

describe('scoring — navigation compliance', () => {
  it('no nav events → navigationCompliance = 100', () => {
    expect(log.complete(T0 + 1000).score!.navigationCompliance).toBe(100);
  });

  it('3 nav events → navigationCompliance = 70 (100 - 3×10)', () => {
    for (let i = 0; i < 3; i++) log.recordNavigationEvent(COORD, 'Turn left', 'wrong_turn', T0);
    expect(log.complete(T0 + 1000).score!.navigationCompliance).toBe(70);
  });

  it('navigationCompliance floors at 0', () => {
    for (let i = 0; i < 15; i++) log.recordNavigationEvent(COORD, 'Turn left', 'wrong_turn', T0);
    expect(log.complete(T0 + 1000).score!.navigationCompliance).toBe(0);
  });
});

describe('scoring — hazard awareness', () => {
  it('all "good" evaluations → hazardAwareness = 100', () => {
    for (let i = 0; i < 3; i++) {
      const ev = log.recordHazardEvent(COORD, `prompt ${i}`, 'response', T0);
      log.updateHazardEvaluation(ev.id, 'good', 'Great.');
    }
    expect(log.complete(T0 + 1000).score!.hazardAwareness).toBe(100);
  });

  it('1 good + 1 missed → hazardAwareness = 50', () => {
    const e1 = log.recordHazardEvent(COORD, 'p1', 'r1', T0);
    log.updateHazardEvaluation(e1.id, 'good', 'Well done.');
    const e2 = log.recordHazardEvent(COORD, 'p2', 'r2', T0);
    log.updateHazardEvaluation(e2.id, 'missed', 'No response.');
    expect(log.complete(T0 + 1000).score!.hazardAwareness).toBe(50); // (100 + 0) / 2
  });

  it('all "partial" → hazardAwareness = 60', () => {
    for (let i = 0; i < 2; i++) {
      const ev = log.recordHazardEvent(COORD, `p${i}`, 'r', T0);
      log.updateHazardEvaluation(ev.id, 'partial', 'Incomplete.');
    }
    expect(log.complete(T0 + 1000).score!.hazardAwareness).toBe(60);
  });
});

describe('scoring — knowledge', () => {
  it('all correct → knowledgeScore = 100', () => {
    const ev = log.recordKnowledgeEvent(COORD, 'Speed limit?', '50', 'fifty', T0);
    log.updateKnowledgeEvaluation(ev.id, 'correct', 'Correct.');
    expect(log.complete(T0 + 1000).score!.knowledgeScore).toBe(100);
  });

  it('all incorrect → knowledgeScore = 0', () => {
    const ev = log.recordKnowledgeEvent(COORD, 'Q', 'A', 'wrong', T0);
    log.updateKnowledgeEvaluation(ev.id, 'incorrect', 'Wrong.');
    expect(log.complete(T0 + 1000).score!.knowledgeScore).toBe(0);
  });
});

describe('scoring — overall is bounded', () => {
  it('overall score is between 0 and 100', () => {
    const s = log.complete(T0 + 1000);
    expect(s.score!.overall).toBeGreaterThanOrEqual(0);
    expect(s.score!.overall).toBeLessThanOrEqual(100);
  });
});
