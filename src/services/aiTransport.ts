import { supabase } from './supabase';

// All AI provider calls go through the Supabase Edge Function proxy (ADR-0001).
// The client never holds provider keys — it authenticates with the user's JWT
// and the proxy (supabase/functions/ai-proxy) forwards to Anthropic / OpenAI.

const FUNCTION_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/ai-proxy`;

export type AIProvider = 'anthropic' | 'openai-tts';

/**
 * POST to the ai-proxy Edge Function. Returns the raw Response so callers can
 * parse JSON (anthropic) or bytes (openai-tts). Throws on missing session,
 * timeout, or non-2xx — callers already have scripted fallbacks for that.
 */
export async function callAIProxy(
  provider: AIProvider,
  payload: Record<string, unknown>,
  timeoutMs = 10_000
): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('ai-proxy: no authenticated session');

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ provider, payload }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(fetchTimeout);
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`ai-proxy ${response.status}: ${(err as any)?.error ?? 'unknown'}`);
  }

  return response;
}
