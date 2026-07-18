import { Audio } from 'expo-av';
import { RouteStep } from '../types';
import { speakNavigation, stopAllSpeech, initTTSVoice } from './tts';

export { speakNavigation as speak, stopAllSpeech as stopSpeaking };

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

// ─── Scripted navigation (brief, instant, no API call) ────────────────────────

function ordinal(n: number): string {
  return ['first', 'second', 'third', 'fourth', 'fifth'][n - 1] ?? `${n}th`;
}

/**
 * Returns a brief scripted instruction when within 80m of a turn, null otherwise.
 * Designed to be called on every position update — returns null when no action needed.
 */
export function buildImmediateInstruction(step: RouteStep, distanceM: number): string | null {
  if (distanceM >= 80 || distanceM < 8) return null;

  const maneuver = (step.maneuver ?? '').toLowerCase();
  const instr = step.instruction.toLowerCase();

  if (maneuver.includes('roundabout') || instr.includes('roundabout')) {
    const match = instr.match(/(\d+)(?:st|nd|rd|th)?\s*exit/);
    if (match) return `Roundabout — take the ${ordinal(parseInt(match[1]))} exit.`;
    if (instr.includes('straight')) return 'Roundabout — go straight ahead.';
    if (instr.includes('left')) return 'Roundabout — turn left.';
    return 'Roundabout — take the next exit.';
  }

  if (maneuver.includes('turn-left') || instr.includes('turn left')) {
    return 'Turn left here.';
  }
  if (maneuver.includes('turn-right') || instr.includes('turn right')) {
    return 'Turn right here. Give way to oncoming traffic.';
  }
  if (maneuver.includes('keep-left') || instr.includes('keep left')) {
    return 'Keep left.';
  }
  if (instr.includes('merge')) {
    return 'Merge left. Check your mirrors.';
  }
  // Only announce when it's an actual maneuver (not a straight continue)
  if (maneuver.includes('turn') || instr.includes('turn')) {
    return step.instruction + '.';
  }
  return null;
}

/**
 * Returns an upcoming warning at 150–300m for significant maneuvers only.
 */
export function buildUpcomingInstruction(step: RouteStep, distanceM: number): string | null {
  if (distanceM > 300 || distanceM <= 80) return null;

  const maneuver = (step.maneuver ?? '').toLowerCase();
  const instr = step.instruction.toLowerCase();
  const dist = `${Math.round(distanceM / 50) * 50} metres`;

  if (maneuver.includes('roundabout') || instr.includes('roundabout')) {
    return `Roundabout in ${dist}.`;
  }
  if (maneuver.includes('turn-left') || instr.includes('turn left')) {
    return `In ${dist}, turn left.`;
  }
  if (maneuver.includes('turn-right') || instr.includes('turn right')) {
    return `In ${dist}, turn right.`;
  }
  // Don't announce straights or minor steps
  return null;
}
