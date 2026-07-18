import { evaluateHazardResponse, evaluateKnowledgeResponse } from '../../services/claudeFeedback';

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
    json: async () => ({}),
  } as Response);
}

beforeEach(() => jest.restoreAllMocks());

// ─── evaluateHazardResponse ───────────────────────────────────────────────────

describe('evaluateHazardResponse', () => {
  describe('short-circuit on blank/short responses (no fetch)', () => {
    it('empty string → quality="missed" without calling fetch', async () => {
      const spy = jest.spyOn(global, 'fetch');
      const result = await evaluateHazardResponse('What do you see?', '');
      expect(result.quality).toBe('missed');
      expect(result.feedback).toBe('No response was given.');
      expect(spy).not.toHaveBeenCalled();
    });

    it('whitespace-only → "missed" without fetch', async () => {
      const spy = jest.spyOn(global, 'fetch');
      const result = await evaluateHazardResponse('Q', '   ');
      expect(result.quality).toBe('missed');
      expect(spy).not.toHaveBeenCalled();
    });

    it('2-char response (< 3 threshold) → "missed" without fetch', async () => {
      const spy = jest.spyOn(global, 'fetch');
      const result = await evaluateHazardResponse('Q', 'hi');
      expect(result.quality).toBe('missed');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('successful Claude evaluation', () => {
    it('parses quality="good"', async () => {
      mockFetchOk('{"quality":"good","feedback":"Great see-think-do structure."}');
      const result = await evaluateHazardResponse('Hazards?', 'I see a cyclist, they might swerve, slowing down');
      expect(result.quality).toBe('good');
      expect(result.feedback).toBe('Great see-think-do structure.');
    });

    it('parses quality="partial"', async () => {
      mockFetchOk('{"quality":"partial","feedback":"Hazard identified but no action stated."}');
      const result = await evaluateHazardResponse('Q', 'A car is pulling out');
      expect(result.quality).toBe('partial');
    });

    it('parses quality="missed"', async () => {
      mockFetchOk('{"quality":"missed","feedback":"No hazard identified."}');
      const result = await evaluateHazardResponse('Q', 'The road seems fine I think');
      expect(result.quality).toBe('missed');
    });

    it('handles JSON surrounded by prose text', async () => {
      mockFetchOk('My evaluation: {"quality":"good","feedback":"Well done."} End of response.');
      const result = await evaluateHazardResponse('Q', 'some response here that is long enough');
      expect(result.quality).toBe('good');
    });
  });

  describe('fallback heuristic on fetch failure', () => {
    // heuristic: response.trim().length > 10 → 'partial', else 'missed'
    it('response > 10 chars → "partial" heuristic', async () => {
      mockFetchFail();
      const result = await evaluateHazardResponse('Q', 'This is a decent response');
      expect(result.quality).toBe('partial');
      expect(result.feedback).toContain('see-think-do');
    });

    it('response ≤ 10 chars → "missed" heuristic', async () => {
      mockFetchFail();
      // 'short one' = 9 chars
      const result = await evaluateHazardResponse('Q', 'short one');
      expect(result.quality).toBe('missed');
    });
  });

  describe('fallback heuristic on malformed Claude response', () => {
    it('non-JSON text → falls through to heuristic', async () => {
      mockFetchOk('I cannot evaluate this right now.');
      const result = await evaluateHazardResponse('Q', 'A fairly long response here about hazards');
      expect(result.quality).toBe('partial');
    });

    it('JSON with invalid quality value → falls through to heuristic', async () => {
      mockFetchOk('{"quality":"excellent","feedback":"Perfect!"}');
      // 'excellent' is not in ['good','partial','missed']
      const result = await evaluateHazardResponse('Q', 'Some response longer than ten chars');
      expect(result.quality).toBe('partial');
    });
  });
});

// ─── evaluateKnowledgeResponse ────────────────────────────────────────────────

describe('evaluateKnowledgeResponse', () => {
  describe('short-circuit on blank responses', () => {
    it('empty string → "incorrect" without fetch', async () => {
      const spy = jest.spyOn(global, 'fetch');
      const result = await evaluateKnowledgeResponse('Q', 'A', '');
      expect(result.quality).toBe('incorrect');
      expect(result.feedback).toBe('No response was given.');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('successful Claude evaluation', () => {
    it('parses "correct"', async () => {
      mockFetchOk('{"quality":"correct","feedback":"Exactly right."}');
      const result = await evaluateKnowledgeResponse('Speed limit?', '50 km/h', 'fifty km per hour');
      expect(result.quality).toBe('correct');
    });

    it('parses "incorrect"', async () => {
      mockFetchOk('{"quality":"incorrect","feedback":"Wrong — it is 50 km/h."}');
      const result = await evaluateKnowledgeResponse('Speed limit?', '50 km/h', 'sixty');
      expect(result.quality).toBe('incorrect');
    });
  });

  describe('fallback heuristic on failure', () => {
    // heuristic: response.trim().length > 5 → 'partial', else 'incorrect'
    it('response > 5 chars → "partial" when fetch fails', async () => {
      mockFetchFail();
      const result = await evaluateKnowledgeResponse('Q', 'A', 'Long enough answer here');
      expect(result.quality).toBe('partial');
    });

    it('response ≤ 5 chars → "incorrect" when fetch fails', async () => {
      mockFetchFail();
      // 'nope' = 4 chars
      const result = await evaluateKnowledgeResponse('Q', 'A', 'nope');
      expect(result.quality).toBe('incorrect');
    });
  });
});
