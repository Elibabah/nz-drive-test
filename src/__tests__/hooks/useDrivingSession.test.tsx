import { renderHook, act } from '@testing-library/react-native';
import { useDrivingSession } from '../../hooks/useDrivingSession';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: -36.8485, longitude: 174.7633, speed: 0, heading: 0 },
  }),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  Accuracy: { BestForNavigation: 6, Balanced: 3 },
}));

jest.mock('expo-constants', () => ({
  default: { expoConfig: { ios: { config: { googleMapsApiKey: 'test-key' } } } },
  expoConfig: { ios: { config: { googleMapsApiKey: 'test-key' } } },
}));

jest.mock('../../services/tts', () => ({
  speak: jest.fn().mockResolvedValue(undefined),
  speakNavigation: jest.fn().mockResolvedValue(undefined),
  stopAllSpeech: jest.fn().mockResolvedValue(undefined),
  onTTSInterrupt: jest.fn(() => jest.fn()),
  initTTSVoice: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/voiceRecognition', () => ({
  destroyVoice: jest.fn().mockResolvedValue(undefined),
  startListening: jest.fn().mockResolvedValue(undefined),
  stopListening: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/claudeFeedback', () => ({
  evaluateHazardResponse: jest.fn().mockResolvedValue({ quality: 'good', feedback: 'OK' }),
  evaluateKnowledgeResponse: jest.fn().mockResolvedValue({ quality: 'correct', feedback: 'OK' }),
}));

jest.mock('../../services/supabase', () => ({
  getCurrentUserId: jest.fn().mockResolvedValue('11111111-2222-3333-4444-555555555555'),
}));

jest.mock('../../services/sessionPersistence', () => ({
  checkpointSession: jest.fn().mockResolvedValue({ ok: true, errors: [] }),
}));

function mockRouteResponse() {
  jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      status: 'OK',
      routes: [{
        legs: [{
          steps: [{
            html_instructions: 'Turn left onto Queen Street',
            distance: { value: 300 },
            duration: { value: 60 },
            start_location: { lat: -36.84, lng: 174.76 },
            end_location: { lat: -36.845, lng: 174.763 },
            maneuver: 'turn-left',
          }],
          distance: { value: 300 },
          duration: { value: 60 },
          start_address: 'Start, Auckland',
          end_address: 'End, Auckland',
        }],
        overview_polyline: { points: '' },
      }],
    }),
  } as Response);
}

afterEach(() => jest.restoreAllMocks());

describe('useDrivingSession — phase transitions', () => {
  it('starts in "idle" phase', () => {
    const { result } = renderHook(() => useDrivingSession('user-1'));
    expect(result.current.phase).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('idle → ready on startSession() with valid location and route', async () => {
    mockRouteResponse();
    const { result } = renderHook(() => useDrivingSession('user-1'));
    await act(async () => { await result.current.startSession(); });
    expect(result.current.phase).toBe('ready');
    expect(result.current.route).not.toBeNull();
    expect(result.current.remainingSteps).toHaveLength(1);
  });

  it('sets error and returns to idle when location permission denied', async () => {
    const Location = require('expo-location');
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });

    const { result } = renderHook(() => useDrivingSession('user-1'));
    await act(async () => { await result.current.startSession(); });

    expect(result.current.phase).toBe('idle');
    expect(result.current.error).toMatch(/location permission/i);
  });

  it('sets error and returns to idle when route fetch fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ZERO_RESULTS', routes: [] }),
    } as Response);

    const { result } = renderHook(() => useDrivingSession('user-1'));
    await act(async () => { await result.current.startSession(); });

    expect(result.current.phase).toBe('idle');
    expect(result.current.error).toBeDefined();
  });

  it('ready → active on beginDriving()', async () => {
    mockRouteResponse();
    const Location = require('expo-location');
    Location.watchPositionAsync.mockResolvedValueOnce({ remove: jest.fn() });

    const { result } = renderHook(() => useDrivingSession('user-1'));
    await act(async () => { await result.current.startSession(); });
    await act(async () => { await result.current.beginDriving(); });

    expect(result.current.phase).toBe('active');
  });

  it('active → completed on finishSession()', async () => {
    mockRouteResponse();
    const Location = require('expo-location');
    Location.watchPositionAsync.mockResolvedValueOnce({ remove: jest.fn() });

    const { result } = renderHook(() => useDrivingSession('user-1'));
    await act(async () => { await result.current.startSession(); });
    await act(async () => { await result.current.beginDriving(); });
    await act(async () => { await result.current.finishSession(); });

    expect(result.current.phase).toBe('completed');
    expect(result.current.session?.status).toBe('completed');
    expect(result.current.session?.score).toBeDefined();
  });

  it('cancelSession resets to idle and clears route', async () => {
    mockRouteResponse();
    const Location = require('expo-location');
    Location.watchPositionAsync.mockResolvedValueOnce({ remove: jest.fn() });

    const { result } = renderHook(() => useDrivingSession('user-1'));
    await act(async () => { await result.current.startSession(); });
    await act(async () => { await result.current.cancelSession(); });

    expect(result.current.phase).toBe('idle');
    expect(result.current.route).toBeNull();
    expect(result.current.session).toBeNull();
  });
});
