import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import { NZ_DRIVING } from '../constants/nzDriving';
import { setTTSPlaying } from './audioState';

const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';
const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';

let selectedVoiceId: string | undefined;
let activeSound: Audio.Sound | null = null;
let activeCallId = 0;

// Listeners that fire when navigation/safety interrupts conversation TTS
type InterruptListener = () => void;
const interruptListeners: Set<InterruptListener> = new Set();

export function onTTSInterrupt(listener: InterruptListener): () => void {
  interruptListeners.add(listener);
  return () => interruptListeners.delete(listener);
}

// ─── Voice init (expo-speech fallback quality) ────────────────────────────────

export async function initTTSVoice(): Promise<void> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const candidate =
      voices.find((v) => v.language === 'en-NZ' && v.quality === Speech.VoiceQuality.Enhanced) ||
      voices.find(
        (v) =>
          v.language.startsWith('en-AU') &&
          v.quality === Speech.VoiceQuality.Enhanced &&
          ['Karen', 'Catherine'].some((n) => v.name.includes(n))
      );
    if (!candidate) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 2000);
      Speech.speak('', {
        voice: candidate.identifier,
        onDone: () => { clearTimeout(t); selectedVoiceId = candidate.identifier; resolve(); },
        onError: () => { clearTimeout(t); resolve(); },
      });
    });
  } catch {}
}

// ─── OpenAI TTS ───────────────────────────────────────────────────────────────

async function speakOpenAI(text: string, callId: number): Promise<void> {
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 8000);

  let resp: Response;
  try {
    resp = await fetch(OPENAI_TTS_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', voice: 'onyx', input: text, speed: 0.92 }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(fetchTimeout);
  }
  if (!resp.ok) throw new Error(`OpenAI TTS ${resp.status}`);
  if (activeCallId !== callId) return; // was interrupted

  const buffer = await resp.arrayBuffer();
  if (activeCallId !== callId) return;

  // Convert ArrayBuffer → base64 in chunks (avoids slow string concat)
  const bytes = new Uint8Array(buffer);
  const parts: string[] = [];
  const CHUNK = 1024;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))));
  }
  const uri = `data:audio/mpeg;base64,${btoa(parts.join(''))}`;

  if (activeCallId !== callId) return;

  if (activeSound) {
    await activeSound.stopAsync().catch(() => {});
    await activeSound.unloadAsync().catch(() => {});
    activeSound = null;
  }

  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true, volume: 1.0 });
  if (activeCallId !== callId) { sound.unloadAsync().catch(() => {}); return; }
  activeSound = sound;

  await new Promise<void>((resolve) => {
    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) return;
      if (status.didJustFinish || (status as any).error) {
        sound.unloadAsync().catch(() => {});
        if (activeSound === sound) activeSound = null;
        resolve();
      }
    });
  });
}

// ─── expo-speech fallback ─────────────────────────────────────────────────────

function speakNative(text: string, callId: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => { if (!settled) { settled = true; resolve(); } };
    // Hang-guard: also polls for interrupt (activeCallId changes when speakNavigation fires)
    const hang = setTimeout(settle, 4_000);
    const pollInterrupt = setInterval(() => {
      if (activeCallId !== callId) { clearInterval(pollInterrupt); settle(); }
    }, 200);
    Speech.speak(text, {
      language: NZ_DRIVING.INSTRUCTOR_VOICE.language,
      rate: NZ_DRIVING.INSTRUCTOR_VOICE.rate,
      pitch: NZ_DRIVING.INSTRUCTOR_VOICE.pitch,
      volume: 1.0,
      ...(selectedVoiceId ? { voice: selectedVoiceId } : {}),
      onDone: () => { clearTimeout(hang); clearInterval(pollInterrupt); settle(); },
      onError: () => { clearTimeout(hang); clearInterval(pollInterrupt); settle(); },
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Speak text. Returns when audio finishes. Yields to navigation interrupts. */
export async function speak(text: string): Promise<void> {
  const myId = ++activeCallId;
  setTTSPlaying(true);
  try {
    if (OPENAI_KEY) {
      await speakOpenAI(text, myId).catch(() => {
        if (activeCallId === myId) return speakNative(text, myId);
      });
    } else {
      await speakNative(text, myId);
    }
  } finally {
    if (activeCallId === myId) setTTSPlaying(false);
  }
}

/**
 * Navigation / safety speak — interrupts any ongoing conversation TTS.
 * Notifies useVoiceConversation to reset its state.
 */
export async function speakNavigation(text: string): Promise<void> {
  // Invalidate any running speak() call
  activeCallId++;
  setTTSPlaying(false);
  // Stop current sound / speech
  if (activeSound) {
    await activeSound.stopAsync().catch(() => {});
    await activeSound.unloadAsync().catch(() => {});
    activeSound = null;
  }
  try { Speech.stop(); } catch {}
  // Notify conversation hook to reset
  interruptListeners.forEach((l) => l());
  // Speak navigation
  await speak(text);
}

export async function stopAllSpeech(): Promise<void> {
  activeCallId++;
  setTTSPlaying(false);
  if (activeSound) {
    await activeSound.stopAsync().catch(() => {});
    await activeSound.unloadAsync().catch(() => {});
    activeSound = null;
  }
  try { Speech.stop(); } catch {}
}
