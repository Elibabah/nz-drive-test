import { buildImmediateInstruction, buildUpcomingInstruction } from '../../services/instructor';
import type { RouteStep } from '../../types';

// instructor → tts → aiTransport → supabase: mock the native-dependent tail
jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}));

function step(instruction: string, maneuver?: string): RouteStep {
  return {
    instruction,
    distance: 200,
    duration: 30,
    startLocation: { latitude: -36.84, longitude: 174.76 },
    endLocation: { latitude: -36.85, longitude: 174.77 },
    maneuver,
  };
}

// ─── buildImmediateInstruction ────────────────────────────────────────────────

describe('buildImmediateInstruction', () => {
  describe('boundary conditions', () => {
    it('returns null at exactly 80 m (boundary ≥80 is exclusive)', () => {
      expect(buildImmediateInstruction(step('Turn left', 'turn-left'), 80)).toBeNull();
    });

    it('fires at 79 m', () => {
      expect(buildImmediateInstruction(step('Turn left', 'turn-left'), 79)).not.toBeNull();
    });

    it('returns null at 7 m (too close, < 8 guard)', () => {
      expect(buildImmediateInstruction(step('Turn left', 'turn-left'), 7)).toBeNull();
    });

    it('fires at exactly 8 m (8 < 8 is false, guard does not exclude)', () => {
      expect(buildImmediateInstruction(step('Turn left', 'turn-left'), 8)).toBe('Turn left here.');
    });

    it('returns null at 200 m (too far)', () => {
      expect(buildImmediateInstruction(step('Turn left', 'turn-left'), 200)).toBeNull();
    });
  });

  describe('turn-left', () => {
    it('maneuver "turn-left" at 40 m → "Turn left here."', () => {
      expect(buildImmediateInstruction(step('At junction', 'turn-left'), 40)).toBe('Turn left here.');
    });

    it('instruction text "turn left" (no maneuver) → "Turn left here."', () => {
      expect(buildImmediateInstruction(step('Turn left at the lights'), 40)).toBe('Turn left here.');
    });
  });

  describe('turn-right', () => {
    it('maneuver "turn-right" → includes give way reminder', () => {
      expect(buildImmediateInstruction(step('At junction', 'turn-right'), 50)).toBe(
        'Turn right here. Give way to oncoming traffic.'
      );
    });

    it('instruction text "turn right" → includes give way reminder', () => {
      expect(buildImmediateInstruction(step('Turn right here'), 50)).toBe(
        'Turn right here. Give way to oncoming traffic.'
      );
    });
  });

  describe('roundabout', () => {
    it('2nd exit → "Roundabout — take the second exit."', () => {
      expect(buildImmediateInstruction(step('At the roundabout, take the 2nd exit'), 30)).toBe(
        'Roundabout — take the second exit.'
      );
    });

    it('1st exit → "Roundabout — take the first exit."', () => {
      expect(buildImmediateInstruction(step('At the roundabout, take the 1st exit'), 30)).toBe(
        'Roundabout — take the first exit.'
      );
    });

    it('"straight" in roundabout → "Roundabout — go straight ahead."', () => {
      expect(buildImmediateInstruction(step('At the roundabout, go straight ahead'), 30)).toBe(
        'Roundabout — go straight ahead.'
      );
    });

    it('"left" in roundabout → "Roundabout — turn left."', () => {
      expect(buildImmediateInstruction(step('At the roundabout, turn left'), 30)).toBe(
        'Roundabout — turn left.'
      );
    });

    it('roundabout maneuver with no sub-type → "Roundabout — take the next exit."', () => {
      expect(buildImmediateInstruction(step('Enter the roundabout', 'roundabout-right'), 30)).toBe(
        'Roundabout — take the next exit.'
      );
    });
  });

  describe('keep-left and merge', () => {
    it('maneuver "keep-left" → "Keep left."', () => {
      expect(buildImmediateInstruction(step('Keep left', 'keep-left'), 20)).toBe('Keep left.');
    });

    it('instruction "merge" → "Merge left. Check your mirrors."', () => {
      expect(buildImmediateInstruction(step('Merge onto the motorway'), 40)).toBe(
        'Merge left. Check your mirrors.'
      );
    });
  });

  describe('generic turn fallback', () => {
    it('maneuver "turn" appends the instruction text with period', () => {
      const s = step('Take the sharp turn', 'turn');
      expect(buildImmediateInstruction(s, 40)).toBe('Take the sharp turn.');
    });
  });

  describe('non-maneuver steps return null', () => {
    it('straight-ahead step → null', () => {
      expect(buildImmediateInstruction(step('Continue on Main Street'), 40)).toBeNull();
    });

    it('step with no maneuver and no direction words → null', () => {
      expect(buildImmediateInstruction(step('Head northwest on Queen Street'), 40)).toBeNull();
    });
  });
});

// ─── buildUpcomingInstruction ─────────────────────────────────────────────────

describe('buildUpcomingInstruction', () => {
  describe('boundary conditions', () => {
    it('returns null at exactly 80 m (boundary ≤80 is exclusive)', () => {
      expect(buildUpcomingInstruction(step('Turn left', 'turn-left'), 80)).toBeNull();
    });

    it('fires at 81 m', () => {
      expect(buildUpcomingInstruction(step('Turn left', 'turn-left'), 81)).not.toBeNull();
    });

    it('fires at exactly 300 m', () => {
      expect(buildUpcomingInstruction(step('Turn left', 'turn-left'), 300)).not.toBeNull();
    });

    it('returns null at 301 m (too far)', () => {
      expect(buildUpcomingInstruction(step('Turn left', 'turn-left'), 301)).toBeNull();
    });
  });

  describe('turn-left', () => {
    it('at 150 m → "In 150 metres, turn left."', () => {
      expect(buildUpcomingInstruction(step('Turn left', 'turn-left'), 150)).toBe('In 150 metres, turn left.');
    });

    it('at 90 m (rounds to 100) → "In 100 metres, turn left."', () => {
      expect(buildUpcomingInstruction(step('Turn left', 'turn-left'), 90)).toBe('In 100 metres, turn left.');
    });

    it('at 275 m (rounds to 300) → "In 300 metres, turn left."', () => {
      expect(buildUpcomingInstruction(step('Turn left', 'turn-left'), 275)).toBe('In 300 metres, turn left.');
    });
  });

  describe('turn-right', () => {
    it('at 200 m → "In 200 metres, turn right."', () => {
      expect(buildUpcomingInstruction(step('Turn right', 'turn-right'), 200)).toBe('In 200 metres, turn right.');
    });
  });

  describe('roundabout', () => {
    it('at 250 m → "Roundabout in 250 metres."', () => {
      expect(buildUpcomingInstruction(step('At the roundabout, take the 2nd exit'), 250)).toBe(
        'Roundabout in 250 metres.'
      );
    });
  });

  describe('non-significant steps return null', () => {
    it('straight-on → null', () => {
      expect(buildUpcomingInstruction(step('Continue on Dominion Road'), 200)).toBeNull();
    });
  });
});
