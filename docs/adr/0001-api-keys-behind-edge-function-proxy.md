# ADR-0001: All AI provider calls go through a Supabase Edge Function proxy

- **Status:** Accepted (2026-07-18)
- **Context:** `EXPO_PUBLIC_ANTHROPIC_API_KEY` and `EXPO_PUBLIC_OPENAI_API_KEY` are embedded in the client bundle. Anyone can extract them from the IPA and run up unbounded provider bills. This blocks any distribution (including TestFlight). A free tier with unmetered client-side AI calls is also economically unbounded.
- **Decision:** The client never holds provider keys. A Supabase Edge Function (`/ai`) receives requests authenticated with the user's Supabase JWT (or an anonymous device token for guests), applies per-user/device rate limits and a per-session cost cap, and forwards to Anthropic (and OpenAI TTS while it remains). Provider keys live in Edge Function secrets.
- **Consequences:**
  - `claudeFeedback.ts`, `aiInstructor.ts`, and `tts.ts` change transport only; prompts and parsing stay client-side for now.
  - Adds one network hop (~tens of ms; negligible vs model latency).
  - The proxy becomes the single metering point for cost telemetry and the guest-quota enforcement point (MVP-3).
  - `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` stays client-side but must be restricted by iOS bundle ID in Google Cloud Console.
- **Alternatives considered:** direct provider calls with "obfuscated" keys (no real protection); a dedicated Node backend (more surface than needed — we already run Supabase).
