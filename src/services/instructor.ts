import { Audio } from 'expo-av';
import { speakNavigation, stopAllSpeech, initTTSVoice } from './tts';

export { speakNavigation as speak, stopAllSpeech as stopSpeaking };
// Instruction builders live in the pure engine (ADR-0006); re-exported here
// for existing callers and tests.
export { buildImmediateInstruction, buildUpcomingInstruction } from '../engine/navigation';

export async function initAudioMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: true,
      staysActiveInBackground: false,
    });
  } catch {}
}

export async function initVoice(): Promise<void> {
  await initTTSVoice();
}
