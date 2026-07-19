// AI proxy — Supabase Edge Function (Deno runtime)
// ADR-0001: the client never holds provider keys. This function verifies the
// caller's Supabase JWT, enforces a per-user rate limit, and forwards the
// request to Anthropic (chat) or OpenAI (TTS).
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=... OPENAI_API_KEY=...
//   supabase functions deploy ai-proxy
//
// Client calls:
//   POST {SUPABASE_URL}/functions/v1/ai-proxy
//   Authorization: Bearer <supabase access token>
//   { "provider": "anthropic", "payload": { model, max_tokens, system?, messages } }
//   { "provider": "openai-tts", "payload": { input, voice?, speed? } }

import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Rate limits (per user). A 20-min session makes ~15-25 AI calls.
const MAX_CALLS_PER_HOUR = 120;

const ALLOWED_ANTHROPIC_MODELS = new Set([
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  // ── Auth: verify the caller's Supabase JWT ────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "missing bearer token" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: authError } = await admin.auth.getUser(token);
  if (authError || !userData.user) return json(401, { error: "invalid token" });
  const userId = userData.user.id;

  // ── Rate limit: count this user's calls in the last hour ──────────────────
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count, error: countError } = await admin
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);

  if (!countError && (count ?? 0) >= MAX_CALLS_PER_HOUR) {
    return json(429, { error: "rate limit exceeded" });
  }

  // ── Parse and validate the request ────────────────────────────────────────
  let body: { provider?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  const { provider, payload } = body;
  if (!provider || !payload) return json(400, { error: "provider and payload required" });

  let upstream: Response;

  if (provider === "anthropic") {
    const model = String(payload.model ?? "");
    if (!ALLOWED_ANTHROPIC_MODELS.has(model)) {
      return json(400, { error: `model not allowed: ${model}` });
    }
    const maxTokens = Math.min(Number(payload.max_tokens ?? 120), 1024);
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(payload.system ? { system: payload.system } : {}),
        messages: payload.messages,
      }),
    });
  } else if (provider === "openai-tts") {
    const input = String(payload.input ?? "");
    if (!input || input.length > 600) return json(400, { error: "input required (max 600 chars)" });
    upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: String(payload.voice ?? "onyx"),
        speed: Number(payload.speed ?? 0.92),
        input,
      }),
    });
  } else {
    return json(400, { error: `unknown provider: ${provider}` });
  }

  // ── Log usage (fire-and-forget; failures must not block the response) ─────
  admin
    .from("ai_usage")
    .insert({ user_id: userId, provider, status: upstream.status })
    .then(() => {}, () => {});

  // Pass the upstream response through (JSON for Anthropic, audio/mpeg for TTS)
  const contentType = upstream.headers.get("Content-Type") ?? "application/json";
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...CORS, "Content-Type": contentType },
  });
});
