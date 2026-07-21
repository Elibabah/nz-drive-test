import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { isTTSPlaying } from './audioState';

// Speech-to-text on expo-speech-recognition. Replaces the abandoned
// @react-native-community/voice, whose unhandled AVAudioPCMBuffer exception
// crashed the app whenever the mic opened after TTS playback had reconfigured
// the iOS audio session (see docs/adr/0003-audio-duplex-strategy.md).
//
// The public API is unchanged: one-shot listening (current product behaviour)
// plus a continuous API for the ADR-0003 hands-free work.

type RecognitionCallback = (text: string) => void;
type ErrorCallback = (error: string) => void;

const LANG_PRIMARY = 'en-NZ';

// ─── State ────────────────────────────────────────────────────────────────────

let oneShotResultCallback: RecognitionCallback | null = null;
let oneShotErrorCallback: ErrorCallback | null = null;
let silenceTimer: ReturnType<typeof setTimeout> | null = null;

let continuousEnabled = false;
let continuousPaused = false;
let continuousSpeechCallback: ((text: string) => void) | null = null;
let isCurrentlyRecognizing = false;
let listenersReady = false;
let lastTranscript = '';

function clearSilenceTimer() {
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
}

function startEngine(): void {
  ExpoSpeechRecognitionModule.start({
    lang: LANG_PRIMARY,
    interimResults: true,
    continuous: continuousEnabled,
  });
}

async function restartContinuous(): Promise<void> {
  if (!continuousEnabled || continuousPaused || isTTSPlaying() || isCurrentlyRecognizing) return;
  try {
    startEngine();
    isCurrentlyRecognizing = true;
  } catch {
    isCurrentlyRecognizing = false;
    setTimeout(() => restartContinuous(), 1000);
  }
}

// ─── Event wiring (installed once, on first use) ──────────────────────────────

function ensureListeners(): void {
  if (listenersReady) return;
  listenersReady = true;

  ExpoSpeechRecognitionModule.addListener('result', (event) => {
    const transcript = event.results?.[0]?.transcript ?? '';
    if (!transcript) return;

    if (!event.isFinal) {
      lastTranscript = transcript;
      // Driver is talking — extend the one-shot silence window
      if (!continuousEnabled && oneShotResultCallback) {
        clearSilenceTimer();
        silenceTimer = setTimeout(() => stopListening(), 5000);
      }
      return;
    }

    lastTranscript = '';
    if (continuousEnabled && continuousSpeechCallback) {
      isCurrentlyRecognizing = false;
      continuousSpeechCallback(transcript);
      // No auto-restart here — caller resumes via resumeContinuousListening
    } else if (oneShotResultCallback) {
      clearSilenceTimer();
      const cb = oneShotResultCallback;
      oneShotResultCallback = null;
      cb(transcript);
      stopListening();
    }
  });

  ExpoSpeechRecognitionModule.addListener('error', (event) => {
    isCurrentlyRecognizing = false;
    if (continuousEnabled) {
      setTimeout(() => restartContinuous(), 800);
      return;
    }
    clearSilenceTimer();
    const cb = oneShotErrorCallback;
    oneShotResultCallback = null;
    oneShotErrorCallback = null;
    cb?.(event.message ?? event.error ?? 'Speech recognition error');
  });

  ExpoSpeechRecognitionModule.addListener('end', () => {
    isCurrentlyRecognizing = false;
    if (continuousEnabled) {
      setTimeout(() => restartContinuous(), 300);
      return;
    }
    // One-shot: engine ended without a final result → report best-effort text
    setTimeout(() => {
      if (oneShotResultCallback) {
        const cb = oneShotResultCallback;
        oneShotResultCallback = null;
        clearSilenceTimer();
        cb(lastTranscript);
        lastTranscript = '';
      }
    }, 500);
  });
}

// ─── Permissions ─────────────────────────────────────────────────────────────

export async function requestSpeechPermission(): Promise<void> {
  try {
    await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  } catch {}
}

// ─── Continuous listening API (ADR-0003) ─────────────────────────────────────

export async function startContinuousListening(onSpeech: (text: string) => void): Promise<void> {
  ensureListeners();
  continuousEnabled = true;
  continuousPaused = false;
  continuousSpeechCallback = onSpeech;
  await restartContinuous();
}

export async function stopContinuousListening(): Promise<void> {
  continuousEnabled = false;
  continuousPaused = false;
  continuousSpeechCallback = null;
  isCurrentlyRecognizing = false;
  try { ExpoSpeechRecognitionModule.stop(); } catch {}
}

export function pauseContinuousListening(): void {
  continuousPaused = true;
  isCurrentlyRecognizing = false;
  try { ExpoSpeechRecognitionModule.stop(); } catch {}
}

export async function resumeContinuousListening(): Promise<void> {
  continuousPaused = false;
  await restartContinuous();
}

export function getIsRecognizing(): boolean {
  return isCurrentlyRecognizing;
}

// ─── One-shot listening API ──────────────────────────────────────────────────

export async function startListening(
  onResult: RecognitionCallback,
  onError: ErrorCallback
): Promise<void> {
  if (isCurrentlyRecognizing) return;
  ensureListeners();
  oneShotResultCallback = onResult;
  oneShotErrorCallback = onError;
  lastTranscript = '';

  silenceTimer = setTimeout(() => {
    const cb = oneShotResultCallback;
    oneShotResultCallback = null;
    cb?.('');
    stopListening();
  }, 5000);

  try {
    startEngine();
    isCurrentlyRecognizing = true;
  } catch (err: any) {
    isCurrentlyRecognizing = false;
    clearSilenceTimer();
    oneShotResultCallback = null;
    oneShotErrorCallback = null;
    onError(err?.message ?? 'Could not start voice recognition');
  }
}

export async function stopListening(): Promise<void> {
  isCurrentlyRecognizing = false;
  clearSilenceTimer();
  try { ExpoSpeechRecognitionModule.stop(); } catch {}
}

export async function destroyVoice(): Promise<void> {
  isCurrentlyRecognizing = false;
  continuousEnabled = false;
  continuousSpeechCallback = null;
  oneShotResultCallback = null;
  oneShotErrorCallback = null;
  clearSilenceTimer();
  try { ExpoSpeechRecognitionModule.abort(); } catch {}
}
