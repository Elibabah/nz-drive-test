import { DrivingSession } from '../types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_EVAL = 'claude-haiku-4-5-20251001';     // scoring tasks: fast, cheap, sufficient
const MODEL_FEEDBACK = 'claude-sonnet-4-6';          // narrative feedback: quality matters
const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';

async function callClaude(prompt: string, maxTokens: number, model = MODEL_EVAL): Promise<string> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Claude API error ${response.status}: ${(err as any)?.error?.message ?? 'unknown'}`);
  }
  const data = await response.json();
  return (data.content as { type: string; text: string }[])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// ─── Hazard response evaluation (called async mid-session) ───────────────────

export async function evaluateHazardResponse(
  prompt: string,
  response: string
): Promise<{ quality: 'good' | 'partial' | 'missed'; feedback: string }> {
  if (!response || response.trim().length < 3) {
    return { quality: 'missed', feedback: 'No response was given.' };
  }

  const evalPrompt = `You are evaluating a learner driver's hazard commentary response during a NZ driving test practice session.

Examiner prompt: "${prompt}"
Driver response: "${response}"

NZ examiners expect the "see-think-do" structure: what the driver sees, why it's a hazard, and what they're doing about it. Short but complete is fine.

Respond with ONLY valid JSON in this exact format:
{"quality":"good","feedback":"Brief specific feedback in one sentence."}

quality must be exactly one of: "good", "partial", "missed"
- good: driver identified a real hazard and explained their action
- partial: driver mentioned something relevant but incomplete
- missed: driver said nothing useful or irrelevant`;

  try {
    const text = await callClaude(evalPrompt, 80);
    const match = text.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (['good', 'partial', 'missed'].includes(parsed.quality)) {
        return { quality: parsed.quality, feedback: parsed.feedback ?? '' };
      }
    }
  } catch {
    // Fallback to heuristic
  }

  const quality = response.trim().length > 10 ? 'partial' : 'missed';
  return { quality, feedback: 'Use the see-think-do structure: what you see, why it matters, what you do.' };
}

// ─── Knowledge response evaluation ───────────────────────────────────────────

export async function evaluateKnowledgeResponse(
  question: string,
  expectedAnswer: string,
  response: string
): Promise<{ quality: 'correct' | 'partial' | 'incorrect'; feedback: string }> {
  if (!response || response.trim().length < 3) {
    return { quality: 'incorrect', feedback: 'No response was given.' };
  }

  const evalPrompt = `You are evaluating a learner driver's answer to a NZ road rules question.

Question: "${question}"
Expected answer: "${expectedAnswer}"
Driver's response: "${response}"

Respond with ONLY valid JSON:
{"quality":"correct","feedback":"Brief feedback in one sentence."}

quality must be exactly one of: "correct", "partial", "incorrect"
- correct: response captures the key point of the expected answer
- partial: response is relevant but incomplete or imprecise
- incorrect: response is wrong or unrelated`;

  try {
    const text = await callClaude(evalPrompt, 80);
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (['correct', 'partial', 'incorrect'].includes(parsed.quality)) {
        return { quality: parsed.quality, feedback: parsed.feedback ?? '' };
      }
    }
  } catch { /* fall through */ }

  const quality = response.trim().length > 5 ? 'partial' : 'incorrect';
  return { quality, feedback: 'Review the NZ road rules for this topic.' };
}

// ─── Decision response evaluation ─────────────────────────────────────────────

export async function evaluateDecisionResponse(
  trigger: string,
  question: string,
  response: string
): Promise<{ quality: 'good' | 'poor'; feedback: string }> {
  if (!response || response.trim().length < 3) {
    return { quality: 'poor', feedback: 'No response was given.' };
  }

  const context = {
    off_route: 'The driver took a different route to what was instructed.',
    stop_complied: 'The driver correctly stopped at a stop sign or crossing.',
    speed_change: 'The driver noticeably reduced their speed.',
  }[trigger] ?? 'A driving event occurred.';

  const evalPrompt = `You are evaluating a learner driver's explanation of a driving decision during a NZ driving test.

Context: ${context}
Examiner question: "${question}"
Driver's response: "${response}"

A good response shows awareness of hazards, road rules, or safety reasons. It doesn't need to be long.

Respond with ONLY valid JSON:
{"quality":"good","feedback":"Brief specific feedback in one sentence."}

quality must be exactly one of: "good", "poor"`;

  try {
    const text = await callClaude(evalPrompt, 80);
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (['good', 'poor'].includes(parsed.quality)) {
        return { quality: parsed.quality, feedback: parsed.feedback ?? '' };
      }
    }
  } catch { /* fall through */ }

  return { quality: response.trim().length > 5 ? 'good' : 'poor', feedback: 'Try to explain your reasoning clearly when asked.' };
}

// ─── Full session feedback ────────────────────────────────────────────────────

export async function generateSessionFeedback(session: DrivingSession): Promise<string> {
  const { score, hazardEvents, knowledgeEvents, decisionEvents, speedViolations, stopEvents, navigationEvents, duration, averageSpeed, totalDistance } = session;

  const durationMin = Math.round(duration / 60);
  const distKm = (totalDistance / 1000).toFixed(1);

  // Hazard summary
  const hazardSummary = hazardEvents.length > 0
    ? hazardEvents.map((h, i) => {
        const eval_ = h.claudeEvaluation;
        const evalText = eval_ ? ` [${eval_.quality.toUpperCase()}${eval_.feedback ? `: ${eval_.feedback}` : ''}]` : ` [response: "${h.response || '(none)'}"]`;
        return `${i + 1}. "${h.prompt}"${evalText}`;
      }).join('\n')
    : 'No hazard prompts recorded.';

  // Speed violations
  const speedSummary = speedViolations.length === 0
    ? 'No speed violations recorded.'
    : speedViolations.map((v) =>
        `- ${v.severity === 'immediate_fail' ? 'IMMEDIATE FAIL' : 'Critical'}: ${v.speedKmh} km/h in ${v.limitKmh} km/h zone (${v.durationSeconds}s)`
      ).join('\n');

  // Stop compliance
  const stopSummary = stopEvents.length === 0
    ? 'No stop signs or railway crossings recorded.'
    : stopEvents.map((e) =>
        `- ${e.type === 'stop_sign' ? 'Stop sign' : 'Railway crossing'}: ${e.complied ? 'complied' : 'VIOLATION'} (lowest speed: ${e.lowestSpeedKmh} km/h)`
      ).join('\n');

  // Navigation
  const navSummary = navigationEvents.length === 0
    ? 'Driver followed all navigation instructions.'
    : `${navigationEvents.length} navigation deviation${navigationEvents.length > 1 ? 's' : ''} recorded:\n` +
      navigationEvents.map((e) => `- ${e.type === 'wrong_turn' ? 'Wrong turn' : 'Off route'} after: "${e.instructionGiven}"`).join('\n');

  // Knowledge questions summary
  const knowledgeSummary = knowledgeEvents.length === 0
    ? 'No knowledge questions asked.'
    : knowledgeEvents.map((e, i) => {
        const ev = e.claudeEvaluation;
        const evalText = ev ? ` [${ev.quality.toUpperCase()}: ${ev.feedback}]` : ` [response: "${e.response || '(none)'}"]`;
        return `${i + 1}. "${e.question}"${evalText}`;
      }).join('\n');

  // Decision questions summary
  const decisionSummary = decisionEvents.length === 0
    ? 'No decision questions asked.'
    : decisionEvents.map((e, i) => {
        const ev = e.claudeEvaluation;
        const evalText = ev ? ` [${ev.quality.toUpperCase()}: ${ev.feedback}]` : ` [response: "${e.response || '(none)'}"]`;
        return `${i + 1}. [${e.trigger}] "${e.question}"${evalText}`;
      }).join('\n');

  const prompt = `You are an expert NZ driving instructor reviewing a learner's 20-minute practice session for the Class 1 Full Licence test.

Session data:
- Duration: ${durationMin} minutes | Distance: ${distKm} km | Average speed: ${Math.round(averageSpeed)} km/h
- Overall score: ${score?.overall ?? 'N/A'}/100

Scores breakdown:
- Hazard awareness: ${score?.hazardAwareness ?? 'N/A'}/100
- Knowledge of road rules: ${score?.knowledgeScore ?? 'N/A'}/100
- Speed compliance: ${score?.speedCompliance ?? 'N/A'}/100
- Stop compliance: ${score?.stopCompliance ?? 'N/A'}/100
- Navigation compliance: ${score?.navigationCompliance ?? 'N/A'}/100

Hazard commentary (${hazardEvents.length} prompts):
${hazardSummary}

Road rules knowledge (${knowledgeEvents.length} questions):
${knowledgeSummary}

Decision-making questions (${decisionEvents.length}):
${decisionSummary}

Speed violations:
${speedSummary}

Stop sign / crossing compliance:
${stopSummary}

Navigation:
${navSummary}

Write a warm, specific, actionable debrief in under 320 words. Structure:
1. Opening (1-2 sentences, encouraging)
2. What went well (specific)
3. Areas to work on — reference the actual events above (be specific, e.g. "At the stop sign you were still doing X km/h")
4. Top 2-3 things to practise before the test
5. Closing sentence

Use NZ English spelling. Remember NZ drives on the LEFT. Address the driver directly as "you". Do not use bullet points — write in paragraphs.`;

  return callClaude(prompt, 700, MODEL_FEEDBACK);
}
