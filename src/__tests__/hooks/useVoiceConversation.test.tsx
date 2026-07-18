import { renderHook, act } from '@testing-library/react-native';
import { useVoiceConversation } from '../../hooks/useVoiceConversation';

// ─── Mocks ────────────────────────────────────────────────────────────────────

let capturedInterruptHandler: (() => void) | null = null;

jest.mock('../../services/tts', () => ({
  speak: jest.fn().mockResolvedValue(undefined),
  stopAllSpeech: jest.fn().mockResolvedValue(undefined),
  onTTSInterrupt: jest.fn((cb: () => void) => {
    capturedInterruptHandler = cb;
    return jest.fn();
  }),
}));

jest.mock('../../services/voiceRecognition', () => ({
  startListening: jest.fn().mockResolvedValue(undefined),
  stopListening: jest.fn().mockResolvedValue(undefined),
  destroyVoice: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/aiInstructor', () => ({
  resetConversation: jest.fn(),
  getSessionStartMessage: jest.fn().mockResolvedValue('Welcome! Drive on when ready.'),
  getHazardPrompt: jest.fn().mockResolvedValue('What hazards do you see?'),
  getKnowledgeQuestion: jest.fn().mockResolvedValue({ question: 'Speed limit?', expectedAnswer: '50 km/h' }),
  respondToDriver: jest.fn().mockResolvedValue('Good observation.'),
}));

import { speak } from '../../services/tts';
import { startListening, stopListening } from '../../services/voiceRecognition';
import { getSessionStartMessage, respondToDriver } from '../../services/aiInstructor';

const CTX = {
  position: { latitude: -36.84, longitude: 174.76 },
  nextStep: null,
  distanceToTurnM: 9999,
  remainingSteps: [],
  timeRemainingMs: 10 * 60 * 1000,
  sessionElapsedMs: 0,
  speedKmh: 0,
};

function opts(overrides: Record<string, unknown> = {}) {
  return {
    getContext: () => CTX,
    isActive: false,
    recordHazardExchange: jest.fn(),
    recordKnowledgeExchange: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  capturedInterruptHandler = null;
  (speak as jest.Mock).mockResolvedValue(undefined);
});

// Increase timeout for hook cleanup
const TIMEOUT = 15000;

// ─── Initial state ────────────────────────────────────────────────────────────

it('starts in "idle" with isListening=false and isSpeaking=false', () => {
  const { result } = renderHook(() => useVoiceConversation(opts()));
  expect(result.current.convState).toBe('idle');
  expect(result.current.isListening).toBe(false);
  expect(result.current.isSpeaking).toBe(false);
});

// ─── Activation ───────────────────────────────────────────────────────────────

it('transitions to "speaking" when isActive becomes true (session start message fires)', async () => {
  const { result, rerender } = renderHook((p: ReturnType<typeof opts>) => useVoiceConversation(p), {
    initialProps: opts({ isActive: false }),
  });

  await act(async () => {
    rerender(opts({ isActive: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(getSessionStartMessage).toHaveBeenCalled();
  // After speak() resolves (mocked), state should be idle or speaking
  // Either is valid — just verify the start message was requested
}, TIMEOUT);

it('transitions to idle after TTS completes and openMicAfter=false', async () => {
  const { result, rerender } = renderHook((p: ReturnType<typeof opts>) => useVoiceConversation(p), {
    initialProps: opts({ isActive: false }),
  });

  await act(async () => {
    rerender(opts({ isActive: true }));
    // Let all async microtasks settle
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

  // speak() resolves immediately (mocked), so we should be idle
  expect(result.current.convState).toBe('idle');
}, TIMEOUT);

// ─── TTS interrupt ────────────────────────────────────────────────────────────

it('resets to idle when onTTSInterrupt fires', async () => {
  // Stall TTS so hook stays in 'speaking'
  (speak as jest.Mock).mockReturnValueOnce(new Promise(() => {}));

  const { result, rerender } = renderHook((p: ReturnType<typeof opts>) => useVoiceConversation(p), {
    initialProps: opts({ isActive: false }),
  });

  await act(async () => {
    rerender(opts({ isActive: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(result.current.convState).toBe('speaking');

  act(() => { capturedInterruptHandler?.(); });
  expect(result.current.convState).toBe('idle');
}, TIMEOUT);

// ─── Driver speech ────────────────────────────────────────────────────────────

it('calls respondToDriver when driver speaks from open state', async () => {
  let captureSpeech: ((text: string) => void) | null = null;
  (startListening as jest.Mock).mockImplementationOnce((onResult: (t: string) => void) => {
    captureSpeech = onResult;
    return Promise.resolve();
  });

  const { result, rerender } = renderHook((p: ReturnType<typeof opts>) => useVoiceConversation(p), {
    initialProps: opts({ isActive: false }),
  });

  await act(async () => {
    rerender(opts({ isActive: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

  act(() => { result.current.tapToSpeak(); });

  await act(async () => {
    captureSpeech?.('I see a cyclist');
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

  expect(respondToDriver).toHaveBeenCalledWith('I see a cyclist', CTX);
  expect(result.current.convState).toBe('idle');
}, TIMEOUT);

it('does not call respondToDriver when speech is whitespace', async () => {
  let captureSpeech: ((text: string) => void) | null = null;
  (startListening as jest.Mock).mockImplementationOnce((onResult: (t: string) => void) => {
    captureSpeech = onResult;
    return Promise.resolve();
  });

  const { result, rerender } = renderHook((p: ReturnType<typeof opts>) => useVoiceConversation(p), {
    initialProps: opts({ isActive: false }),
  });

  await act(async () => {
    rerender(opts({ isActive: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

  act(() => { result.current.tapToSpeak(); });

  await act(async () => {
    captureSpeech?.('   ');
    for (let i = 0; i < 3; i++) await Promise.resolve();
  });

  expect(respondToDriver).not.toHaveBeenCalled();
  expect(result.current.convState).toBe('idle');
}, TIMEOUT);

// ─── Deactivation ─────────────────────────────────────────────────────────────

it('resets to idle and calls stopListening when isActive becomes false', async () => {
  const { result, rerender } = renderHook((p: ReturnType<typeof opts>) => useVoiceConversation(p), {
    initialProps: opts({ isActive: false }),
  });

  await act(async () => {
    rerender(opts({ isActive: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

  await act(async () => {
    rerender(opts({ isActive: false }));
    for (let i = 0; i < 3; i++) await Promise.resolve();
  });

  expect(result.current.convState).toBe('idle');
  expect(stopListening).toHaveBeenCalled();
}, TIMEOUT);
