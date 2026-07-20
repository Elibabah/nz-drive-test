import {
  getSessionStartMessage, getHazardPrompt, getKnowledgeQuestion,
  respondToDriver, resetConversation,
} from '../../services/aiInstructor';
import type { NavigationContext } from '../../services/aiInstructor';

// aiTransport authenticates against Supabase — mock the session out
jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}));

const CTX: NavigationContext = {
  position: { latitude: -36.84, longitude: 174.76 },
  nextStep: {
    instruction: 'Turn left onto Queen Street',
    distance: 200, duration: 30,
    startLocation: { latitude: -36.84, longitude: 174.76 },
    endLocation: { latitude: -36.85, longitude: 174.77 },
    maneuver: 'turn-left',
  },
  distanceToTurnM: 150,
  remainingSteps: [],
  timeRemainingMs: 10 * 60 * 1000,
  sessionElapsedMs: 5 * 60 * 1000,
  speedKmh: 45,
};

function mockFetchOk(text: string) {
  return jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }] }),
  } as Response);
}

function mockFetchFail() {
  return jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: false,
    status: 500,
    json: async () => ({ error: { message: 'Server error' } }),
  } as Response);
}

beforeEach(() => {
  resetConversation();
  jest.restoreAllMocks();
});

// ─── getSessionStartMessage ───────────────────────────────────────────────────

describe('getSessionStartMessage', () => {
  it('returns Claude response text on success', async () => {
    mockFetchOk('Welcome! Drive on when ready.');
    expect(await getSessionStartMessage()).toBe('Welcome! Drive on when ready.');
  });

  it('returns fallback string when fetch fails', async () => {
    mockFetchFail();
    const msg = await getSessionStartMessage();
    expect(msg).toContain('20-minute');
  });

  it('calls the ai-proxy Edge Function, never a provider API directly', async () => {
    const spy = mockFetchOk('hello');
    await getSessionStartMessage();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/ai-proxy'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('sends provider + haiku model in the proxy payload', async () => {
    const spy = mockFetchOk('hello');
    await getSessionStartMessage();
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.provider).toBe('anthropic');
    expect(body.payload.model).toContain('haiku');
  });
});

// ─── getHazardPrompt ──────────────────────────────────────────────────────────

describe('getHazardPrompt', () => {
  it('returns Claude response text', async () => {
    mockFetchOk('What hazards are ahead?');
    expect(await getHazardPrompt(CTX)).toBe('What hazards are ahead?');
  });

  it('returns a fallback from the prompts array on failure', async () => {
    mockFetchFail();
    const prompt = await getHazardPrompt(CTX);
    const FALLBACKS = [
      'Tell me what hazards you can see.',
      'What are you watching out for ahead?',
      'What is your main concern at the moment?',
      'Describe any hazards you can see right now.',
    ];
    expect(FALLBACKS).toContain(prompt);
  });
});

// ─── getKnowledgeQuestion ─────────────────────────────────────────────────────

describe('getKnowledgeQuestion', () => {
  it('parses valid JSON response', async () => {
    mockFetchOk('{"question":"Speed limit?","expectedAnswer":"50 km/h"}');
    const result = await getKnowledgeQuestion(CTX);
    expect(result.question).toBe('Speed limit?');
    expect(result.expectedAnswer).toBe('50 km/h');
  });

  it('returns fallback when Claude returns non-JSON', async () => {
    mockFetchOk('This is not JSON at all');
    const result = await getKnowledgeQuestion(CTX);
    expect(result.question).toBeDefined();
    expect(result.expectedAnswer).toBeDefined();
  });

  it('returns fallback when JSON is missing expectedAnswer field', async () => {
    mockFetchOk('{"question":"Only a question without answer"}');
    const result = await getKnowledgeQuestion(CTX);
    const FALLBACK_QUESTIONS = [
      'What is the speed limit in a school zone?',
      'At a roundabout, who has right of way?',
      'How many seconds following distance in dry conditions?',
    ];
    expect(FALLBACK_QUESTIONS).toContain(result.question);
  });

  it('returns fallback on fetch failure', async () => {
    mockFetchFail();
    const result = await getKnowledgeQuestion(CTX);
    expect(result.question).toBeDefined();
  });
});

// ─── respondToDriver ──────────────────────────────────────────────────────────

describe('respondToDriver', () => {
  it('returns Claude response', async () => {
    mockFetchOk('Good observation. Carry on.');
    expect(await respondToDriver('I see a cyclist', CTX)).toBe('Good observation. Carry on.');
  });

  it('returns "Good, keep going." fallback on failure', async () => {
    mockFetchFail();
    expect(await respondToDriver('test', CTX)).toBe('Good, keep going.');
  });
});

// ─── conversation history ─────────────────────────────────────────────────────

describe('conversation history', () => {
  it('second call includes history from first call (messages.length ≥ 3)', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Reply.' }] }),
    } as Response);

    await getSessionStartMessage();
    await respondToDriver('test', CTX);

    const secondBody = JSON.parse((spy.mock.calls[1][1] as RequestInit).body as string);
    // history has user+assistant from first call, plus current user message
    expect(secondBody.payload.messages.length).toBeGreaterThanOrEqual(3);
  });

  it('resetConversation clears history so next call has only 1 message', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Reply.' }] }),
    } as Response);

    await getSessionStartMessage();
    resetConversation();
    await getSessionStartMessage();

    const afterResetBody = JSON.parse((spy.mock.calls[1][1] as RequestInit).body as string);
    expect(afterResetBody.payload.messages).toHaveLength(1);
  });
});
