import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-community/voice';
import { isTTSPlaying } from './audioState';

// ─── One-shot listening (legacy, kept for compatibility) ──────────────────────

type RecognitionCallback = (text: string) => void;
type ErrorCallback = (error: string) => void;

let oneShotResultCallback: RecognitionCallback | null = null;
let oneShotErrorCallback: ErrorCallback | null = null;
let silenceTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Continuous listening state ───────────────────────────────────────────────

let continuousEnabled = false;
let continuousPaused = false;
let continuousSpeechCallback: ((text: string) => void) | null = null;
let isCurrentlyRecognizing = false;

function clearSilenceTimer() {
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
}

async function restartContinuous() {
  if (!continuousEnabled || continuousPaused || isTTSPlaying() || isCurrentlyRecognizing) return;
  try {
    await Voice.start('en-NZ');
    isCurrentlyRecognizing = true;
  } catch {
    try {
      await Voice.start('en-AU');
      isCurrentlyRecognizing = true;
    } catch {
      isCurrentlyRecognizing = false;
      // retry after short delay
      setTimeout(() => restartContinuous(), 1000);
    }
  }
}

// ─── Voice event handlers ─────────────────────────────────────────────────────

Voice.onSpeechResults = (event: SpeechResultsEvent) => {
  const results = event.value ?? [];
  if (results.length === 0) return;
  const best = results[0];

  if (continuousEnabled && continuousSpeechCallback) {
    isCurrentlyRecognizing = false;
    continuousSpeechCallback(best);
    // STT does NOT auto-restart here — caller does it via resumeContinuousListening
  } else if (oneShotResultCallback) {
    clearSilenceTimer();
    oneShotResultCallback(best);
    stopListening();
  }
};

Voice.onSpeechPartialResults = () => {
  if (!continuousEnabled) {
    clearSilenceTimer();
    silenceTimer = setTimeout(() => stopListening(), 5000);
  }
};

Voice.onSpeechError = (event: SpeechErrorEvent) => {
  isCurrentlyRecognizing = false;
  if (continuousEnabled) {
    setTimeout(() => restartContinuous(), 800);
    return;
  }
  const errorMsg = event.error?.message ?? 'Speech recognition error';
  if (oneShotErrorCallback) oneShotErrorCallback(errorMsg);
  clearSilenceTimer();
};

Voice.onSpeechEnd = () => {
  isCurrentlyRecognizing = false;
  if (continuousEnabled) {
    setTimeout(() => restartContinuous(), 300);
    return;
  }
  setTimeout(() => {
    if (oneShotResultCallback) { oneShotResultCallback(''); }
  }, 500);
};

// ─── Continuous listening API ─────────────────────────────────────────────────

export async function requestSpeechPermission(): Promise<void> {
  try {
    await Voice.start('en-NZ');
    isCurrentlyRecognizing = true;
    await new Promise((r) => setTimeout(r, 400));
    await Voice.stop();
    isCurrentlyRecognizing = false;
  } catch {
    isCurrentlyRecognizing = false;
  }
}

export async function startContinuousListening(onSpeech: (text: string) => void): Promise<void> {
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
  try { await Voice.stop(); } catch {}
}

export function pauseContinuousListening(): void {
  continuousPaused = true;
  isCurrentlyRecognizing = false;
  try { Voice.stop(); } catch {}
}

export async function resumeContinuousListening(): Promise<void> {
  continuousPaused = false;
  await restartContinuous();
}

export function getIsRecognizing(): boolean {
  return isCurrentlyRecognizing;
}

// ─── One-shot listening API (kept for any legacy callers) ─────────────────────

export async function startListening(
  onResult: RecognitionCallback,
  onError: ErrorCallback
): Promise<void> {
  if (isCurrentlyRecognizing) return;
  oneShotResultCallback = onResult;
  oneShotErrorCallback = onError;

  silenceTimer = setTimeout(() => {
    oneShotResultCallback?.('');
    stopListening();
  }, 5000);

  try {
    await Voice.start('en-NZ');
    isCurrentlyRecognizing = true;
  } catch {
    try {
      await Voice.start('en-AU');
      isCurrentlyRecognizing = true;
    } catch (err: any) {
      isCurrentlyRecognizing = false;
      clearSilenceTimer();
      onError(err?.message ?? 'Could not start voice recognition');
    }
  }
}

export async function stopListening(): Promise<void> {
  isCurrentlyRecognizing = false;
  clearSilenceTimer();
  try { await Voice.stop(); } catch {}
}

export async function destroyVoice(): Promise<void> {
  isCurrentlyRecognizing = false;
  continuousEnabled = false;
  continuousSpeechCallback = null;
  oneShotResultCallback = null;
  oneShotErrorCallback = null;
  clearSilenceTimer();
  try { await Voice.destroy(); } catch {}
}
