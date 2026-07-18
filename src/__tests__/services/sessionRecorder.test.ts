import {
  createSession, completeSession, abandonSession, getActiveSession,
  recordHazardEvent, updateHazardEvaluation,
  recordKnowledgeEvent, updateKnowledgeEvaluation,
  recordSpeedViolation, recordStopEvent, recordBrakingEvent,
  recordNavigationEvent,
} from '../../services/sessionRecorder';

const COORD = { latitude: -36.84, longitude: 174.76 };

beforeEach(() => {
  abandonSession();
  createSession('user-test-123');
});

afterEach(() => {
  abandonSession();
});

// ─── Session lifecycle ────────────────────────────────────────────────────────

describe('createSession', () => {
  it('creates a session with status "active"', () => {
    expect(getActiveSession()!.status).toBe('active');
  });

  it('assigns the provided userId', () => {
    expect(getActiveSession()!.userId).toBe('user-test-123');
  });

  it('generates a unique id on each call', () => {
    const s1 = createSession('u1');
    const s2 = createSession('u2');
    expect(s1.id).not.toBe(s2.id);
    abandonSession();
    createSession('user-test-123'); // restore for afterEach
  });

  it('initialises with empty event arrays', () => {
    const s = getActiveSession()!;
    expect(s.hazardEvents).toHaveLength(0);
    expect(s.speedViolations).toHaveLength(0);
    expect(s.stopEvents).toHaveLength(0);
  });
});

describe('completeSession', () => {
  it('returns the session with status "completed"', () => {
    const completed = completeSession();
    expect(completed.status).toBe('completed');
  });

  it('sets endTime and non-negative duration', () => {
    const completed = completeSession();
    expect(completed.endTime).toBeDefined();
    expect(completed.duration).toBeGreaterThanOrEqual(0);
  });

  it('attaches a score object', () => {
    const completed = completeSession();
    expect(completed.score).toBeDefined();
    createSession('user-test-123');
  });

  it('throws if no active session', () => {
    completeSession();
    expect(() => completeSession()).toThrow('No active session');
    createSession('user-test-123');
  });

  it('clears the active session', () => {
    completeSession();
    expect(getActiveSession()).toBeNull();
    createSession('user-test-123');
  });
});

describe('abandonSession', () => {
  it('sets active session to null', () => {
    abandonSession();
    expect(getActiveSession()).toBeNull();
    createSession('user-test-123');
  });
});

// ─── Hazard events ────────────────────────────────────────────────────────────

describe('recordHazardEvent', () => {
  it('appends to hazardEvents', () => {
    recordHazardEvent(COORD, 'What do you see?', 'A car pulling out');
    expect(getActiveSession()!.hazardEvents).toHaveLength(1);
  });

  it('stores correct prompt, response, and detectedCorrectly=null', () => {
    recordHazardEvent(COORD, 'Hazards?', 'Cyclist on left');
    const ev = getActiveSession()!.hazardEvents[0];
    expect(ev.prompt).toBe('Hazards?');
    expect(ev.response).toBe('Cyclist on left');
    expect(ev.detectedCorrectly).toBeNull();
  });

  it('throws when no active session', () => {
    abandonSession();
    expect(() => recordHazardEvent(COORD, 'p', 'r')).toThrow('No active session');
    createSession('user-test-123');
  });
});

describe('updateHazardEvaluation', () => {
  it('updates the event quality and detectedCorrectly=true for "good"', () => {
    const ev = recordHazardEvent(COORD, 'prompt', 'response');
    updateHazardEvaluation(ev.id, 'good', 'Great use of see-think-do.');
    const updated = getActiveSession()!.hazardEvents.find((e) => e.id === ev.id)!;
    expect(updated.claudeEvaluation?.quality).toBe('good');
    expect(updated.detectedCorrectly).toBe(true);
  });

  it('sets detectedCorrectly=false for "missed"', () => {
    const ev = recordHazardEvent(COORD, 'p', 'r');
    updateHazardEvaluation(ev.id, 'missed', 'No response given.');
    expect(getActiveSession()!.hazardEvents[0].detectedCorrectly).toBe(false);
  });

  it('does not throw for an unknown eventId', () => {
    expect(() => updateHazardEvaluation('nonexistent', 'good', 'fb')).not.toThrow();
  });
});

// ─── Knowledge events ─────────────────────────────────────────────────────────

describe('recordKnowledgeEvent', () => {
  it('stores question, expectedAnswer, and response', () => {
    recordKnowledgeEvent(COORD, 'Speed limit school zone?', '40 km/h', 'forty');
    const ev = getActiveSession()!.knowledgeEvents[0];
    expect(ev.question).toBe('Speed limit school zone?');
    expect(ev.expectedAnswer).toBe('40 km/h');
    expect(ev.response).toBe('forty');
  });
});

// ─── recordSpeedViolation / recordStopEvent / recordBrakingEvent ──────────────

describe('recordSpeedViolation', () => {
  it('rounds speed values', () => {
    recordSpeedViolation(COORD, 61.4, 50, 'immediate_fail', 2.7);
    const v = getActiveSession()!.speedViolations[0];
    expect(v.speedKmh).toBe(61);
    expect(v.durationSeconds).toBe(3);
    expect(v.severity).toBe('immediate_fail');
  });
});

describe('recordStopEvent', () => {
  it('rounds lowestSpeedKmh', () => {
    recordStopEvent(COORD, 'stop_sign', true, 0.5);
    const ev = getActiveSession()!.stopEvents[0];
    expect(ev.complied).toBe(true);
    expect(ev.lowestSpeedKmh).toBe(1); // Math.round(0.5) === 1 in JS
    expect(ev.type).toBe('stop_sign');
  });
});

describe('recordBrakingEvent', () => {
  it('rounds speed values', () => {
    recordBrakingEvent(COORD, 49.9, 29.1, 20.8);
    const ev = getActiveSession()!.brakingEvents[0];
    expect(ev.speedFromKmh).toBe(50);
    expect(ev.speedToKmh).toBe(29);
    expect(ev.deltaKmh).toBe(21);
  });
});

// ─── Scoring (via completeSession) ────────────────────────────────────────────

describe('scoring — speed compliance', () => {
  it('no violations → speedCompliance = 100', () => {
    const s = completeSession();
    expect(s.score!.speedCompliance).toBe(100);
    createSession('user-test-123');
  });

  it('one immediate_fail → speedCompliance = 80 (100 - 1×20)', () => {
    recordSpeedViolation(COORD, 65, 50, 'immediate_fail', 2);
    const s = completeSession();
    expect(s.score!.speedCompliance).toBe(80);
    createSession('user-test-123');
  });

  it('two immediate_fail → speedCompliance = 60', () => {
    recordSpeedViolation(COORD, 65, 50, 'immediate_fail', 2);
    recordSpeedViolation(COORD, 70, 50, 'immediate_fail', 3);
    const s = completeSession();
    expect(s.score!.speedCompliance).toBe(60);
    createSession('user-test-123');
  });

  it('speedCompliance floors at 0', () => {
    for (let i = 0; i < 10; i++) recordSpeedViolation(COORD, 70, 50, 'immediate_fail', 1);
    const s = completeSession();
    expect(s.score!.speedCompliance).toBe(0);
    createSession('user-test-123');
  });
});

describe('scoring — stop compliance', () => {
  it('no stops → stopCompliance = 100', () => {
    const s = completeSession();
    expect(s.score!.stopCompliance).toBe(100);
    createSession('user-test-123');
  });

  it('one stop violated → stopCompliance = 0', () => {
    recordStopEvent(COORD, 'stop_sign', false, 10);
    const s = completeSession();
    expect(s.score!.stopCompliance).toBe(0);
    createSession('user-test-123');
  });

  it('2 stops, 1 complied → stopCompliance = 50', () => {
    recordStopEvent(COORD, 'stop_sign', true, 0);
    recordStopEvent(COORD, 'railway_crossing', false, 15);
    const s = completeSession();
    expect(s.score!.stopCompliance).toBe(50);
    createSession('user-test-123');
  });

  it('all stops complied → stopCompliance = 100', () => {
    recordStopEvent(COORD, 'stop_sign', true, 0);
    recordStopEvent(COORD, 'pedestrian_crossing', true, 5);
    const s = completeSession();
    expect(s.score!.stopCompliance).toBe(100);
    createSession('user-test-123');
  });
});

describe('scoring — navigation compliance', () => {
  it('no nav events → navigationCompliance = 100', () => {
    const s = completeSession();
    expect(s.score!.navigationCompliance).toBe(100);
    createSession('user-test-123');
  });

  it('3 nav events → navigationCompliance = 70 (100 - 3×10)', () => {
    for (let i = 0; i < 3; i++) recordNavigationEvent(COORD, 'Turn left', 'wrong_turn');
    const s = completeSession();
    expect(s.score!.navigationCompliance).toBe(70);
    createSession('user-test-123');
  });

  it('navigationCompliance floors at 0', () => {
    for (let i = 0; i < 15; i++) recordNavigationEvent(COORD, 'Turn left', 'wrong_turn');
    const s = completeSession();
    expect(s.score!.navigationCompliance).toBe(0);
    createSession('user-test-123');
  });
});

describe('scoring — hazard awareness', () => {
  it('all "good" evaluations → hazardAwareness = 100', () => {
    for (let i = 0; i < 3; i++) {
      const ev = recordHazardEvent(COORD, `prompt ${i}`, 'response');
      updateHazardEvaluation(ev.id, 'good', 'Great.');
    }
    const s = completeSession();
    expect(s.score!.hazardAwareness).toBe(100);
    createSession('user-test-123');
  });

  it('1 good + 1 missed → hazardAwareness = 50', () => {
    const e1 = recordHazardEvent(COORD, 'p1', 'r1');
    updateHazardEvaluation(e1.id, 'good', 'Well done.');
    const e2 = recordHazardEvent(COORD, 'p2', 'r2');
    updateHazardEvaluation(e2.id, 'missed', 'No response.');
    const s = completeSession();
    expect(s.score!.hazardAwareness).toBe(50); // (100 + 0) / 2
    createSession('user-test-123');
  });

  it('all "partial" → hazardAwareness = 60', () => {
    for (let i = 0; i < 2; i++) {
      const ev = recordHazardEvent(COORD, `p${i}`, 'r');
      updateHazardEvaluation(ev.id, 'partial', 'Incomplete.');
    }
    const s = completeSession();
    expect(s.score!.hazardAwareness).toBe(60);
    createSession('user-test-123');
  });
});

describe('scoring — knowledge', () => {
  it('all correct → knowledgeScore = 100', () => {
    const ev = recordKnowledgeEvent(COORD, 'Speed limit?', '50', 'fifty');
    updateKnowledgeEvaluation(ev.id, 'correct', 'Correct.');
    const s = completeSession();
    expect(s.score!.knowledgeScore).toBe(100);
    createSession('user-test-123');
  });

  it('all incorrect → knowledgeScore = 0', () => {
    const ev = recordKnowledgeEvent(COORD, 'Q', 'A', 'wrong');
    updateKnowledgeEvaluation(ev.id, 'incorrect', 'Wrong.');
    const s = completeSession();
    expect(s.score!.knowledgeScore).toBe(0);
    createSession('user-test-123');
  });
});

describe('scoring — overall is bounded', () => {
  it('overall score is between 0 and 100', () => {
    const s = completeSession();
    expect(s.score!.overall).toBeGreaterThanOrEqual(0);
    expect(s.score!.overall).toBeLessThanOrEqual(100);
    createSession('user-test-123');
  });
});
