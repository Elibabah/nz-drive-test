import { RouteStep, Coordinate } from '../types';
import { callAIProxy } from './aiTransport';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_HISTORY_PAIRS = 8;

export interface NavigationContext {
  position: Coordinate;
  nextStep: RouteStep | null;
  distanceToTurnM: number;
  remainingSteps: RouteStep[];
  timeRemainingMs: number;
  sessionElapsedMs: number;
  speedKmh: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

let history: Message[] = [];

const SYSTEM_PROMPT = `You are Sam, a calm and professional New Zealand driving examiner conducting a 20-minute Class 1 Full Licence practice session. You speak in New Zealand English.

CRITICAL RULES:
- New Zealand drives on the LEFT side of the road
- Keep ALL responses under 25 words unless the driver asks a detailed question
- Never start a response with "I"
- Never repeat the last instruction already given unless asked
- Be direct, specific, and encouraging

YOUR ROLE DURING THE SESSION:
- Give clear turn-by-turn navigation instructions before turns
- Periodically ask hazard awareness questions (e.g. "What hazards can you see?")
- Ask road rules knowledge questions when prompted
- Respond naturally and briefly to anything the driver says
- Comment on good driving or note violations calmly`;

function buildContextPrefix(ctx: NavigationContext): string {
  const dist = ctx.distanceToTurnM < 1000
    ? `${Math.round(ctx.distanceToTurnM)}m`
    : `${(ctx.distanceToTurnM / 1000).toFixed(1)}km`;
  const nextDesc = ctx.nextStep
    ? `${ctx.nextStep.instruction} in ${dist}`
    : 'approaching destination';
  const minsLeft = Math.ceil(ctx.timeRemainingMs / 60000);
  const speedStr = `${Math.round(ctx.speedKmh)} km/h`;
  return `[${minsLeft} min left | ${speedStr} | Next: ${nextDesc}]`;
}

async function callClaude(userMessage: string): Promise<string> {
  const messages: Message[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const response = await callAIProxy('anthropic', {
    model: MODEL,
    max_tokens: 120,
    system: SYSTEM_PROMPT,
    messages,
  });

  const data = await response.json();
  const text = (data.content as { type: string; text: string }[])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  history = [
    ...history,
    { role: 'user' as const, content: userMessage },
    { role: 'assistant' as const, content: text },
  ].slice(-(MAX_HISTORY_PAIRS * 2));

  return text;
}

// ─── Exported functions ───────────────────────────────────────────────────────

export async function getSessionStartMessage(): Promise<string> {
  try {
    return await callClaude(
      "Start the 20-minute driving practice session. Welcome the driver briefly and tell them to drive on when ready. Under 20 words."
    );
  } catch {
    return "Starting your 20-minute driving practice. Keep left at all times. Drive on when you're ready.";
  }
}

export async function getHazardPrompt(ctx: NavigationContext): Promise<string> {
  const prefix = buildContextPrefix(ctx);
  try {
    return await callClaude(
      `${prefix}\nAsk a hazard awareness question. Keep it under 12 words. Vary from previous questions.`
    );
  } catch {
    const prompts = [
      'Tell me what hazards you can see.',
      'What are you watching out for ahead?',
      'What is your main concern at the moment?',
      'Describe any hazards you can see right now.',
    ];
    return prompts[Math.floor(Math.random() * prompts.length)];
  }
}

export async function getKnowledgeQuestion(ctx: NavigationContext): Promise<{ question: string; expectedAnswer: string }> {
  const prefix = buildContextPrefix(ctx);
  try {
    const raw = await callClaude(
      `${prefix}\nAsk a New Zealand road rules knowledge question. Respond with ONLY valid JSON: {"question":"...","expectedAnswer":"..."}`
    );
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.question && parsed.expectedAnswer) return parsed;
    }
  } catch {}
  // fallback
  const questions = [
    { question: 'What is the speed limit in a school zone?', expectedAnswer: '40 km/h' },
    { question: 'At a roundabout, who has right of way?', expectedAnswer: 'vehicles already on the roundabout' },
    { question: 'How many seconds following distance in dry conditions?', expectedAnswer: '2 seconds' },
  ];
  return questions[Math.floor(Math.random() * questions.length)];
}

export async function respondToDriver(speech: string, ctx: NavigationContext): Promise<string> {
  const prefix = buildContextPrefix(ctx);
  try {
    return await callClaude(
      `${prefix}\nThe driver said: "${speech}"\nRespond naturally as the examiner. Under 20 words.`
    );
  } catch {
    return 'Good, keep going.';
  }
}

export async function getOffRouteMessage(ctx: NavigationContext, lastInstruction: string): Promise<string> {
  const prefix = buildContextPrefix(ctx);
  try {
    return await callClaude(
      `${prefix}\nThe driver went off route. Last instruction was: "${lastInstruction}". Tell them you will recalculate. Under 15 words.`
    );
  } catch {
    return 'You have gone off route. I will give you new directions from here.';
  }
}

export async function getSessionEndSoonMessage(ctx: NavigationContext): Promise<string> {
  const prefix = buildContextPrefix(ctx);
  try {
    return await callClaude(
      `${prefix}\nTell the driver they have about two minutes remaining and should find a safe place to finish. Under 20 words.`
    );
  } catch {
    return 'You have approximately two minutes remaining. Begin looking for a safe place to pull over on the left.';
  }
}

export function resetConversation(): void {
  history = [];
}
