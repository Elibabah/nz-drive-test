# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NZ Drive Practice — a React Native app that simulates the New Zealand practical driving exam. An AI examiner ("Sam") gives real-time turn-by-turn directions by voice, asks hazard-awareness and road-rules questions, and monitors speed/stops/braking. The user responds by voice. Sessions are 20 minutes on urban roads only.

**Roadmap and architecture decisions live in [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/adr/](docs/adr/).** Read them before proposing structural changes.

## Commands

```bash
# Start Metro dev server (JS-only changes — no rebuild needed)
npx expo start --clear

# Full native rebuild (required when changing native deps, app.config.js, or iOS files)
npx expo run:ios

# Regenerate iOS native files from app.config.js (run before expo run:ios when config changes)
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=$(grep EXPO_PUBLIC_GOOGLE_MAPS_API_KEY .env | cut -d= -f2) \
  npx expo prebuild --platform ios --no-install

# Reinstall pods after npm changes
cd ios && pod install

# Simulator location simulation (run in a separate terminal during a session)
bash simulate_drive.sh
```

## Architecture

### Native build requirement

`expo-speech-recognition` is a native module — the app cannot run in Expo Go. Always use `npx expo run:ios` (development build). The `ios/` folder is **gitignored** (regenerated via `expo prebuild`) and managed via CocoaPods locally.

### API key injection

`app.config.js` (not `app.json`) reads `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` from `.env` and injects it into `ios/NZDrivePractice/AppDelegate.swift` via `expo prebuild`. If the map tiles are blank, the prebuild hasn't run with the correct key — run the prebuild command above, then rebuild.

### Exam engine (`src/engine/`) + session adapter (`src/hooks/useDrivingSession.ts`)

**All exam logic lives in the pure engine** (ADR-0006): `sessionEngine.ts` (state + command emission), `monitoring.ts` (speed/stops/braking), `navigation.ts` (instruction builders + dedup), `recording.ts` (event log), `scoring.ts`, `geo.ts`. No React/Expo/globals/clocks — timestamps are injected, so sessions replay deterministically (`engine/__tests__/replay.test.ts` drives a full synthetic session).

The engine emits commands; the adapter executes them: `speak` with priority (`safety`/`navigation` interrupt, `coaching` is dropped if TTS is playing) and `requestReroute` (adapter fetches, then `applyReroute`/`rerouteFailed`).

`useDrivingSession` is the thin adapter: device APIs (GPS, TTS, network, checkpoints) + React state. Phases: `idle → requesting-location → building-route → ready → active → completing → completed`.

**Position updates**: `onUserLocationChange` on the MapView is the authoritative source of position during a session — `watchPositionAsync` is a fallback. `MapView.animateCamera` is called from this event; `followsUserLocation` prop is intentionally not used (unreliable with `PROVIDER_GOOGLE`).

### Navigation logic (`src/services/instructor.ts` + `src/services/googleDirections.ts`)

The app pre-fetches a full route (origin → random destination) at session start using Google Directions API. Scripted instructions fire when:
- Within 80–300 m of the next turn end → "upcoming" announcement (`buildUpcomingInstruction`)
- Within 8–80 m → "immediate" announcement (`buildImmediateInstruction`)

**Rerouting is implemented** (`triggerReroute` in `useDrivingSession.ts`): fires on step completion, off-route detection (> 300 m from both the current step's start and end — known false-positive on steps > 600 m; fix tracked in ROADMAP MVP-0), or destination reached, with a 20 s debounce.

### Event monitoring (`src/engine/monitoring.ts`)

Speed, stop-sign/railway/pedestrian-crossing compliance, harsh braking, unexpected stops (armed only after first real movement). **Real road data via OSM** (ADR-0004): `src/services/osmRoadData.ts` fetches a corridor from Overpass at route build (speed limits, stop signs, traffic signals, give-way, level/pedestrian crossings) → `engine/roadData.ts` control points evaluated by GPS proximity. Signals/give-way suppress the unexpected-stop and harsh-braking nudges (red-light queues). Falls back to instruction-text heuristics + 50 km/h default when Overpass is unreachable.

### Voice (`src/services/voiceRecognition.ts`, `src/hooks/useVoiceConversation.ts`)

Wraps `expo-speech-recognition` (replaced the abandoned `@react-native-community/voice`, which crashed with an AVAudioPCMBuffer exception whenever the mic opened after TTS playback — see ADR-0003). Current mode is **one-shot**: the mic opens after examiner questions (8 s window) or via tap-to-speak on the examiner bar. A continuous-listening API exists in `voiceRecognition.ts` but is not wired up (hands-free strategy pending ADR-0003 spike). TTS is OpenAI TTS (`tts.ts`, voice "onyx") with expo-speech en-NZ fallback; `speakNavigation` interrupts conversation TTS via the `onTTSInterrupt` listener system.

### AI examiner (`src/services/aiInstructor.ts`)

Conversational examiner "Sam" on Claude Haiku with a rolling 8-exchange history: session start message, hazard prompts, knowledge questions, free-form driver responses. All calls have scripted fallbacks on error.

### Backend (`src/services/supabase.ts`)

**Google OAuth via Supabase** (`signInWithGoogle`, expo-auth-session PKCE flow); login is currently required by `app/_layout.tsx`. **Schema v2**: every event type has its own table with per-operation RLS, and `src/services/sessionPersistence.ts` checkpoints the full session state every 60 s during an active session (idempotent upserts — a crash loses ≤ 1 min). `saveSession` delegates to the same checkpoint; falls back to `AsyncStorage` cache when unauthenticated/offline. Schema is in `supabase/schema.sql` (re-runnable; apply via SQL editor).

### AI feedback (`src/services/claudeFeedback.ts`)

Hazard/knowledge/decision answers are evaluated mid-session (Claude Haiku); the full debrief is generated once at session end (Claude Sonnet). Uses `fetch` directly to `api.anthropic.com/v1/messages` (not the Anthropic SDK, which requires Node.js). **Note:** provider keys are currently `EXPO_PUBLIC_*` in the client bundle — moving them behind a Supabase Edge Function proxy is ROADMAP MVP-0 (ADR-0001).

## Key constants

- Session duration: 20 min (`NZ_DRIVING.SESSION_DURATION_MS`)
- Hazard prompts: every ~3 min ± 30 s; knowledge questions every ~6 min ± 30 s (hardcoded in `useVoiceConversation.ts` — `NZ_DRIVING.HAZARD_PROMPT_INTERVAL_MS` says 2.5 min but is not the value actually used)
- Step completion radius: 30 m (position must be within 30 m of a step's end to advance)
- Off-route threshold: 300 m; reroute debounce: 20 s
- NZ drives on the LEFT — all instruction templates account for this

## Environment variables (`.env`)

```
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=   # Maps SDK for iOS + Directions API
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=  # Google OAuth
ANTHROPIC_API_KEY=                 # Server-side only — lives in Edge Function secrets, NOT bundled
OPENAI_API_KEY=                    # Same — set both via `supabase secrets set`
EXPO_PUBLIC_DEV_DEST_LAT=          # Optional: fixes route destination for simulator testing
EXPO_PUBLIC_DEV_DEST_LNG=          # Remove for production (enables random destinations)
```

All AI calls (Claude conversation/evaluation, OpenAI TTS) go through the `ai-proxy` Edge Function via `src/services/aiTransport.ts` (ADR-0001) — the client authenticates with the user's Supabase JWT and holds no provider keys.

## Testing

- `npm test` — 9 jest suites (jest-expo). Known issues: suite is very slow (~10 min, fix tracked in ROADMAP MVP-0) and jest worker IPC hangs under the Claude Code sandbox — run jest with the sandbox disabled.
- `simulate_drive.sh` (GPS simulation via `xcrun simctl location`) is referenced historically but **does not exist in the repo** — a route replayer replaces it in ROADMAP MVP-4.
