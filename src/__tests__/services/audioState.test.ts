import { isTTSPlaying, setTTSPlaying } from '../../services/audioState';

beforeEach(() => {
  setTTSPlaying(false);
});

describe('audioState', () => {
  it('isTTSPlaying returns false by default', () => {
    expect(isTTSPlaying()).toBe(false);
  });

  it('setTTSPlaying(true) makes isTTSPlaying return true', () => {
    setTTSPlaying(true);
    expect(isTTSPlaying()).toBe(true);
  });

  it('setTTSPlaying(false) after true returns false', () => {
    setTTSPlaying(true);
    setTTSPlaying(false);
    expect(isTTSPlaying()).toBe(false);
  });

  it('calling setTTSPlaying(true) twice is idempotent', () => {
    setTTSPlaying(true);
    setTTSPlaying(true);
    expect(isTTSPlaying()).toBe(true);
  });
});
