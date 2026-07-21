import { DrivingSession, EventLogEntry } from '../types';

export type SessionScore = NonNullable<DrivingSession['score']>;

// Weighted progress score + event timeline. NZTA-aligned pass/fail verdict is
// the next MVP-1 step (ADR-0005); this score then becomes a secondary metric.

export function computeScore(session: DrivingSession): SessionScore {
  const sessionStartMs = session.startTime;
  const sessionMinutes = session.duration / 60;

  // Hazard awareness
  let hazardScore = 75;
  if (session.hazardEvents.length > 0) {
    const qualityMap = { good: 100, partial: 60, missed: 0 };
    const scored = session.hazardEvents.filter((e) => e.claudeEvaluation);
    if (scored.length > 0) {
      hazardScore = Math.round(scored.reduce((s, e) => s + (qualityMap[e.claudeEvaluation!.quality] ?? 0), 0) / scored.length);
    } else {
      const detected = session.hazardEvents.filter((e) => (e.response?.trim().length ?? 0) > 5).length;
      hazardScore = Math.round((detected / session.hazardEvents.length) * 100);
    }
  }

  // Knowledge score
  let knowledgeScore = 100;
  if (session.knowledgeEvents.length > 0) {
    const qualityMap = { correct: 100, partial: 60, incorrect: 0 };
    const scored = session.knowledgeEvents.filter((e) => e.claudeEvaluation);
    if (scored.length > 0) {
      knowledgeScore = Math.round(scored.reduce((s, e) => s + (qualityMap[e.claudeEvaluation!.quality] ?? 0), 0) / scored.length);
    } else {
      const answered = session.knowledgeEvents.filter((e) => e.response?.trim().length > 3).length;
      knowledgeScore = Math.round((answered / session.knowledgeEvents.length) * 100);
    }
  }

  // Speed compliance
  const immediateFailCount = session.speedViolations.filter((v) => v.severity === 'immediate_fail').length;
  const criticalCount = session.speedViolations.filter((v) => v.severity === 'critical').length;
  const speedScore = Math.max(0, 100 - immediateFailCount * 20 - criticalCount * 8);

  // Stop compliance
  const stopScore = session.stopEvents.length === 0 ? 100
    : Math.round((session.stopEvents.filter((e) => e.complied).length / session.stopEvents.length) * 100);

  // Navigation compliance
  const navScore = Math.max(0, 100 - session.navigationEvents.length * 10);

  // Session completion
  const sessionCompletion = sessionMinutes >= 18 ? 100 : Math.round((sessionMinutes / 20) * 100);

  const overall = Math.round(
    hazardScore * 0.30 +
    knowledgeScore * 0.10 +
    speedScore * 0.20 +
    stopScore * 0.15 +
    navScore * 0.10 +
    sessionCompletion * 0.15
  );

  // Build event log for timeline
  const allEvents: { timestamp: number; entry: EventLogEntry }[] = [];

  const relMin = (ts: number) => Math.min(20, Math.round((ts - sessionStartMs) / 60000));

  for (const e of session.hazardEvents) {
    const q = e.claudeEvaluation?.quality;
    const type = q === 'good' ? 'hazard_good' : q === 'partial' ? 'hazard_partial' : 'hazard_missed';
    const severity = q === 'good' ? 'good' : q === 'partial' ? 'warning' : 'violation';
    allEvents.push({ timestamp: e.timestamp, entry: { relativeMinute: relMin(e.timestamp), type, description: `Hazard check: "${e.prompt.slice(0, 40)}"`, severity } });
  }

  for (const e of session.knowledgeEvents) {
    const q = e.claudeEvaluation?.quality;
    const type = q === 'correct' ? 'knowledge_correct' : q === 'partial' ? 'knowledge_partial' : 'knowledge_incorrect';
    const severity = q === 'correct' ? 'good' : q === 'partial' ? 'warning' : 'violation';
    allEvents.push({ timestamp: e.timestamp, entry: { relativeMinute: relMin(e.timestamp), type, description: `Knowledge: "${e.question.slice(0, 50)}"`, severity } });
  }

  for (const e of session.decisionEvents) {
    const q = e.claudeEvaluation?.quality;
    const type = q === 'good' ? 'decision_good' : 'decision_poor';
    const severity = q === 'good' ? 'good' : 'warning';
    allEvents.push({ timestamp: e.timestamp, entry: { relativeMinute: relMin(e.timestamp), type, description: `Decision question after ${e.trigger.replace('_', ' ')}`, severity } });
  }

  for (const e of session.speedViolations) {
    allEvents.push({ timestamp: e.timestamp, entry: { relativeMinute: relMin(e.timestamp), type: 'speed_violation', description: `${e.speedKmh} km/h in ${e.limitKmh} km/h zone (${e.severity === 'immediate_fail' ? 'immediate fail' : 'critical'})`, severity: 'violation' } });
  }

  for (const e of session.stopEvents) {
    const type = e.complied ? 'stop_complied' : 'stop_violation';
    const severity = e.complied ? 'good' : 'violation';
    const label = e.type === 'stop_sign' ? 'Stop sign' : 'Railway crossing';
    allEvents.push({ timestamp: e.timestamp, entry: { relativeMinute: relMin(e.timestamp), type, description: `${label}: ${e.complied ? 'complied' : `did not stop (min ${e.lowestSpeedKmh} km/h)`}`, severity } });
  }

  for (const e of session.brakingEvents) {
    allEvents.push({ timestamp: e.timestamp, entry: { relativeMinute: relMin(e.timestamp), type: 'braking', description: `Harsh braking: ${e.speedFromKmh} → ${e.speedToKmh} km/h (−${e.deltaKmh} km/h)`, severity: 'warning' } });
  }

  for (const e of session.navigationEvents) {
    allEvents.push({ timestamp: e.timestamp, entry: { relativeMinute: relMin(e.timestamp), type: 'navigation', description: `${e.type === 'wrong_turn' ? 'Wrong turn' : 'Off route'} after "${e.instructionGiven.slice(0, 40)}"`, severity: 'warning' } });
  }

  allEvents.sort((a, b) => a.timestamp - b.timestamp);
  const eventLog: EventLogEntry[] = allEvents.map((x) => x.entry);

  const observations: string[] = [];
  const improvements: string[] = [];

  if (hazardScore >= 80) observations.push('Good hazard awareness throughout the session.');
  if (knowledgeScore >= 80 && session.knowledgeEvents.length > 0) observations.push('Good knowledge of road rules.');
  if (speedScore === 100) observations.push('Speed was well managed throughout.');
  if (stopScore === 100 && session.stopEvents.length > 0) observations.push('Good compliance at stop signs and crossings.');
  if (session.brakingEvents.length > 0) observations.push(`${session.brakingEvents.length} harsh braking event${session.brakingEvents.length > 1 ? 's' : ''} detected — aim for smoother, progressive braking.`);

  if (immediateFailCount > 0) improvements.push(`Speed exceeded the limit significantly on ${immediateFailCount} occasion${immediateFailCount > 1 ? 's' : ''} — this would be an immediate fail on the real test.`);
  if (criticalCount > 0) improvements.push(`Speed was marginally over the limit on ${criticalCount} occasion${criticalCount > 1 ? 's' : ''}.`);
  if (stopScore < 80) improvements.push('Practice coming to a complete stop at stop signs and railway crossings.');
  if (navScore < 80) improvements.push(`Navigation instructions were not followed on ${session.navigationEvents.length} occasion${session.navigationEvents.length > 1 ? 's' : ''}.`);
  if (hazardScore < 70) improvements.push('Work on hazard commentary — use the see-think-do structure.');
  if (knowledgeScore < 70 && session.knowledgeEvents.length > 0) improvements.push('Review NZ road rules, especially give-way rules, speed limits, and roundabout procedures.');
  if (sessionMinutes < 18) improvements.push('Try to complete the full 20-minute session for a thorough assessment.');

  return { overall, hazardAwareness: hazardScore, knowledgeScore, speedCompliance: speedScore, stopCompliance: stopScore, navigationCompliance: navScore, sessionCompletion, observations, improvements, eventLog };
}
