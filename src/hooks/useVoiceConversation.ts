import { useState, useRef, useEffect, useCallback } from 'react';
import {
  NavigationContext, resetConversation,
  getSessionStartMessage, getHazardPrompt, getKnowledgeQuestion, respondToDriver,
} from '../services/aiInstructor';
import { speak, onTTSInterrupt, stopAllSpeech } from '../services/tts';
import { startListening, stopListening, destroyVoice } from '../services/voiceRecognition';

// ─── State machine ────────────────────────────────────────────────────────────
// idle      → examiner is quiet, mic closed
// speaking  → examiner TTS playing, mic closed
// open      → mic listening for driver response
// processing → driver spoke, generating AI reply

type ConvState = 'idle' | 'speaking' | 'open' | 'processing';

const MIC_TIMEOUT_MS = 8000; // close mic after 8s of silence

interface UseVoiceConversationOptions {
  getContext: () => NavigationContext;
  isActive: boolean;
  recordHazardExchange: (prompt: string, response: string) => void;
  recordKnowledgeExchange: (question: string, expectedAnswer: string, response: string) => void;
}

export function useVoiceConversation({
  getContext,
  isActive,
  recordHazardExchange,
  recordKnowledgeExchange,
}: UseVoiceConversationOptions) {
  const [convState, setConvState] = useState<ConvState>('idle');
  const [instructorText, setInstructorText] = useState('');

  const convStateRef = useRef<ConvState>('idle');
  const isActiveRef = useRef(false);
  const micTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hazardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knowledgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track what question is pending (to correctly record driver response)
  const pendingHazardRef = useRef<string | null>(null);
  const pendingKnowledgeRef = useRef<{ question: string; expectedAnswer: string } | null>(null);

  function setState(s: ConvState) {
    convStateRef.current = s;
    setConvState(s);
  }

  function clearMicTimer() {
    if (micTimerRef.current) { clearTimeout(micTimerRef.current); micTimerRef.current = null; }
  }

  // ─── Open mic for driver ────────────────────────────────────────────────────

  function openMic() {
    if (!isActiveRef.current) return;
    setState('open');
    clearMicTimer();

    micTimerRef.current = setTimeout(() => {
      if (convStateRef.current === 'open') {
        stopListening().catch(() => {});
        setState('idle');
      }
    }, MIC_TIMEOUT_MS);

    startListening(
      (text) => {
        clearMicTimer();
        if (convStateRef.current !== 'open') return;
        handleDriverSpeech(text);
      },
      () => {
        clearMicTimer();
        if (convStateRef.current === 'open') setState('idle');
      }
    ).catch(() => {
      clearMicTimer();
      setState('idle');
    });
  }

  // ─── Examiner speaks, then optionally opens mic ─────────────────────────────

  async function examinerSay(text: string, openMicAfter: boolean) {
    if (!isActiveRef.current) return;
    if (convStateRef.current === 'speaking' || convStateRef.current === 'processing') return;

    setState('speaking');
    setInstructorText(text);

    await speak(text);

    if (!isActiveRef.current) return;

    if (openMicAfter) {
      openMic();
    } else {
      setState('idle');
    }
  }

  // ─── Driver speech handler ──────────────────────────────────────────────────

  async function handleDriverSpeech(text: string) {
    if (!isActiveRef.current) return;
    if (!text.trim()) { setState('idle'); return; }

    setState('processing');

    const ctx = getContext();
    const response = await respondToDriver(text, ctx).catch(() => 'Good. Carry on.');

    // Record if responding to a pending prompt
    if (pendingHazardRef.current) {
      recordHazardExchange(pendingHazardRef.current, text);
      pendingHazardRef.current = null;
    } else if (pendingKnowledgeRef.current) {
      const { question, expectedAnswer } = pendingKnowledgeRef.current;
      recordKnowledgeExchange(question, expectedAnswer, text);
      pendingKnowledgeRef.current = null;
    }

    // If nav interrupted while we were processing, abort
    if (!isActiveRef.current) return;
    if ((convStateRef.current as ConvState) !== 'processing') return;

    setState('speaking');
    setInstructorText(response);
    await speak(response);

    if (isActiveRef.current && convStateRef.current === 'speaking') {
      setState('idle');
    }
  }

  // ─── Manual tap-to-speak (called from UI) ────────────────────────────────────

  const tapToSpeak = useCallback(() => {
    if (convStateRef.current === 'idle' && isActiveRef.current) {
      openMic();
    }
  }, []);

  // ─── Periodic hazard prompts ────────────────────────────────────────────────

  function scheduleHazard(retryShort = false) {
    if (hazardTimerRef.current) clearTimeout(hazardTimerRef.current);
    const delay = retryShort
      ? 15_000
      : 3 * 60 * 1000 + (Math.random() - 0.5) * 60 * 1000;
    hazardTimerRef.current = setTimeout(async () => {
      if (!isActiveRef.current) return;
      if (convStateRef.current !== 'idle') {
        scheduleHazard(true); // retry soon — don't lose the question
        return;
      }
      const ctx = getContext();
      const prompt = await getHazardPrompt(ctx).catch(() => 'What hazards can you see ahead?');
      pendingHazardRef.current = prompt;
      await examinerSay(prompt, true);
      scheduleHazard();
    }, delay);
  }

  // ─── Periodic knowledge prompts ─────────────────────────────────────────────

  function scheduleKnowledge(retryShort = false) {
    if (knowledgeTimerRef.current) clearTimeout(knowledgeTimerRef.current);
    const delay = retryShort
      ? 15_000
      : 6 * 60 * 1000 + (Math.random() - 0.5) * 60 * 1000;
    knowledgeTimerRef.current = setTimeout(async () => {
      if (!isActiveRef.current) return;
      if (convStateRef.current !== 'idle') {
        scheduleKnowledge(true);
        return;
      }
      const ctx = getContext();
      const { question, expectedAnswer } = await getKnowledgeQuestion(ctx).catch(() => ({
        question: 'What is the speed limit in an urban area?',
        expectedAnswer: '50 km/h',
      }));
      pendingKnowledgeRef.current = { question, expectedAnswer };
      await examinerSay(question, true);
      scheduleKnowledge(); // next cycle at full interval
    }, delay);
  }

  // ─── Reset on navigation interrupt ───────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = onTTSInterrupt(() => {
      clearMicTimer();
      stopListening().catch(() => {});
      // Reset any active conversation state — navigation takes priority
      if (convStateRef.current !== 'idle') {
        setState('idle');
      }
    });
    return unsubscribe;
  }, []);

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  useEffect(() => {
    isActiveRef.current = isActive;

    if (isActive) {
      resetConversation();
      pendingHazardRef.current = null;
      pendingKnowledgeRef.current = null;

      const announce = async () => {
        const text = await getSessionStartMessage().catch(
          () => "Starting your 20-minute practice. Keep left at all times. Drive on when ready."
        );
        await examinerSay(text, false);
      };
      announce();

      scheduleHazard();
      scheduleKnowledge();
    } else {
      clearMicTimer();
      if (hazardTimerRef.current) clearTimeout(hazardTimerRef.current);
      if (knowledgeTimerRef.current) clearTimeout(knowledgeTimerRef.current);
      stopListening().catch(() => {});
      stopAllSpeech().catch(() => {});
      setState('idle');
    }
  }, [isActive]);

  useEffect(() => {
    return () => {
      isActiveRef.current = false;
      clearMicTimer();
      if (hazardTimerRef.current) clearTimeout(hazardTimerRef.current);
      if (knowledgeTimerRef.current) clearTimeout(knowledgeTimerRef.current);
      stopListening().catch(() => {});
      destroyVoice().catch(() => {});
    };
  }, []);

  return {
    convState,
    instructorText,
    isListening: convState === 'open',
    isSpeaking: convState === 'speaking',
    tapToSpeak,
  };
}
