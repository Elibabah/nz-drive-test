# NZ Drive Practice — Product & Engineering Roadmap

> Last updated: 2026-07-18. This document is the working agreement for what gets built and in what order. Each MVP has explicit exit criteria — an MVP is not "done" until all of them hold.

## North star

**"A NZ driving examiner in your pocket."** The user opens the app, mounts the phone in the car, and for 20+ minutes a voice examiner directs them along a real route generated from their live location, silently re-routes when they deviate (and distinguishes a safety-justified deviation from a manoeuvring error), quizzes them on hazards and road rules, and finishes with a verdict aligned to the official NZ Full Licence assessment (critical errors / immediate fails) plus an improvement plan. **The phone is never touched during a session.** Progress history is kept for Google-signed-in users; guests get full sessions with ephemeral results.

## Guiding constraints

1. **Hands-free is non-negotiable.** Any feature that requires looking at or touching the screen mid-session is a design failure (and a road-safety liability).
2. **No secrets in the client.** All AI/TTS calls go through our backend. `EXPO_PUBLIC_*` is only for genuinely public config (Supabase URL/anon key, Maps key restricted by bundle ID).
3. **Credibility over breadth.** The app should evaluate the things a real NZTA examiner evaluates, scored the way they score them — before it grows new features.
4. **Engineering evidence.** This repo doubles as an AI-driven-engineering work sample: ADRs for every load-bearing decision, CI green on main, deterministic replay tests for the exam engine.

---

## MVP-0 — Foundations (make it publishable and trustworthy)

No new user-facing features. The app does what it does today, but safely and reliably.

**Deliverables**
- Supabase Edge Function proxy for Anthropic (and OpenAI TTS while it remains): client sends user JWT, server holds provider keys, per-user rate limiting and per-session cost cap. Client keys removed from `.env`/bundle.
- Schema v2: tables for all recorded event types (knowledge, decision, speed, stop, braking, navigation events), FK to `auth.users`, RLS with explicit `WITH CHECK`. Incremental session persistence (checkpoint every N minutes / on each event batch) so a crash at minute 18 loses nothing.
- Off-route detection measured as distance to the route polyline, not to step endpoints (fixes false reroutes on steps > 600 m).
- Test suite fixed: the flaky `useDrivingSession` start test passes deterministically; suite runs in < 60 s locally (jest-expo transform caching / config).
- CI: GitHub Actions running typecheck + jest on every PR.
- Docs truth pass: CLAUDE.md matches the code; `simulate_drive.sh` regenerated or replaced (see MVP-4 replayer).

**Exit criteria**
- [x] No provider API key extractable from the app bundle. *(2026-07-20: ai-proxy live, verified on device — 17 proxied calls in `ai_usage`)*
- [x] Killing the app mid-session and reopening shows the partial session in history. *(2026-07-21: verified on device — 60 s checkpoint upserts; schema v2 applied to production)*
- [x] A 1 km straight step does not trigger a reroute when driven normally. *(2026-07-20: off-route now measured against step polyline; unit-tested)*
- [x] CI green; suite < 60 s. *(2026-07-21: GitHub Actions green — typecheck + 174 tests in ~4 s with persisted jest cache; react renderer/dom pinned to Expo 54's react 19.1.0 for strict `npm ci`)*

## MVP-1 — A credible exam (evaluate what examiners evaluate)

**Deliverables**
- ✅ **Pure session engine** extracted from the React layer (2026-07-21): state machine + event monitor + scoring as a dependency-free TypeScript module. React hook is a thin adapter; deterministic replay test in `engine/__tests__/replay.test.ts`.
- ✅ **Navigation that actually guides** (2026-07-22, from field test): announcements now target the *next maneuver* (`steps[1]` at `steps[0]`'s end — Google's step model puts the turn at the step *start*), and step completion advances locally instead of refetching a route per step (which the 20 s debounce silenced). Field bug: Sam never gave directions.
- **Real road data from OSM** (Overpass) prefetched along the route polyline at session start: `maxspeed`, stop signs, level crossings, pedestrian crossings, roundabouts. Replaces the hardcoded 50 km/h and the instruction-text sniffing that never fires.
- **Deviation evaluation flow** (wire up the existing dead code): deviation → silent reroute → after reroute completes, examiner asks why → Claude classifies `justified` (road closed, obstruction, safety — no penalty, positive judgement note) vs `manoeuvring error` (mild navigation penalty). Getting lost is not a fail on the real test; disobeying signs is.
- **NZTA-aligned scoring**: model critical errors and immediate-fail errors per the official assessment guide; produce a pass/fail verdict plus the existing numeric progress score as a secondary metric.
- Destination/route validation: destination snapped to the urban road network (no sea, no motorway, no unformed roads).

**Exit criteria**
- [ ] A replayed real-drive GPS track produces identical event streams across runs.
- [ ] Driving past a mapped stop sign at 15 km/h produces a stop violation; a compliant full stop produces a compliant event.
- [ ] A deviation with a spoken justification ("the street was closed") does not reduce the navigation score.
- [ ] Session summary shows PASS / FAIL with the error tally, mirroring NZTA categories.

## MVP-2 — Truly hands-free

**Preceded by a timeboxed spike (1–2 days)**: continuous STT on iOS with interleaved TTS — echo behaviour, Apple recognizer session limits, audio-session interruptions. Outcome recorded in ADR-0003; plan B is strict half-duplex (mic always open except while the examiner speaks).

**Deliverables**
- Continuous listening (or wake-word / half-duplex per spike outcome) — no tap-to-speak during a session.
- Keep-awake + background audio + background location: session survives screen lock and phone in pocket/mount.
- Audio-first session UI: minimal glanceable screen; every piece of information is also spoken.
- Voice-controlled session start/finish ("I'm ready", "end the session").

**Exit criteria**
- [ ] A full 20-minute session completes with zero screen touches after "start".
- [ ] Session survives 5 minutes with the screen locked.
- [ ] Examiner never talks over the driver; driver speech during TTS is handled (barge-in or graceful ignore, per spike).

## MVP-3 — User tiers

**Deliverables**
- **Ephemeral guest mode** (ADR-0002): full session + feedback without any account; nothing persisted server-side; feedback viewable once. Free-tier abuse control via device-scoped session quota enforced by the proxy.
- Google sign-in tier (exists — polish): progress history, per-category trends, "test readiness" indicator derived from recent verdicts.
- Privacy surface: retention policy, account + data deletion (required for App Store anyway).

**Exit criteria**
- [ ] Fresh install → full session → feedback, with zero accounts created and zero rows written server-side.
- [ ] Signed-in user sees history and trends; deleting the account removes all rows.

## MVP-4 — Product quality

**Deliverables**
- E2E with **Maestro** driven by a GPS **route replayer** (successor to `simulate_drive.sh`): golden scenarios — clean session, justified deviation, speeding, abandoned session.
- Accessibility: `accessibilityLabel`/`role` assertions in component tests + a VoiceOver manual pass per release. (A hands-free app is near-accessible by design — treat it as a feature.)
- Crash/error telemetry (Sentry), AI cost telemetry per session.
- TestFlight beta.

## MVP-5 — Research & expansion (not committed)

- Camera-based hazard detection ("eyes") as a research beta — voice hazard commentary already matches what the real test assesses.
- Android port (the pure engine from MVP-1 ports as-is; audio stack is the platform-specific part).
- Premium voice (OpenAI TTS) if a paid tier ever exists — see ADR-0006.

---

## Backlog — known issues & follow-ups (not MVP-blocking)

Found during MVP-0 field testing (July 2026). Each item is self-contained; none blocks MVP-1.

| Item | Detail | Suggested slot |
|---|---|---|
| UI pass | Feedback screen shows raw markdown (`##`, `**`) from the AI debrief; general contrast/truncation audit of all screens | Before MVP-2 (audio-first UI redesigns this screen anyway) |
| Navigation camera mode | Field request 2026-07-22: session map is 2D north-up with a dot — no turn-by-turn feel. Add a chase camera (heading-up via GPS heading, slight pitch, route line ahead) like Google Maps navigation, using the existing `animateCamera` path | MVP-2 (with the audio-first session UI) |
| Map theme: auto day/night | Session map is hardcoded dark (fixed 2026-07-21, see ADR discussion in commit history). Dark is correct for night driving (glare, night vision) but not universally best — bright daylight glare can wash out a dark theme, and the OS system theme is the wrong proxy (reflects general preference, not ambient daylight). Switch to automatic light/dark by local sunrise/sunset (simple lat/lng calc, no extra API), with manual override as a lower-priority nice-to-have | MVP-2 (alongside the audio-first UI work) |
| Quiet TTS at session start | `allowsRecordingIOS: true` at launch puts iOS in play-and-record → first utterances route to the earpiece. Enable record mode only around open-mic windows | With ADR-0003 spike |
| TTS fallback telemetry | Proxy TTS failures silently fall back to the robotic on-device voice (observed once in field). Log occurrences (client event or `ai_usage` status) to measure frequency | MVP-4 (telemetry) |
| npm audit | 26 vulnerabilities reported (2 critical) at last install — triage which are real for a client app | MVP-4 |
| jest-expo 55 vs expo 54 | Version mismatch works but is accidental; align on next SDK upgrade | Next SDK bump |
| `claude-sonnet-4-6` model id | Debrief model pinned in client + proxy allowlist; review against current Anthropic lineup (sonnet-5) when touching aiTransport | MVP-1 (while in the code) |
| Decision-questions dead code | `DecisionEvent` flow exists but nothing triggers it — being wired as part of MVP-1 deviation evaluation | MVP-1 (planned) |

## Decision log

| ADR | Decision | Status |
|---|---|---|
| [0001](adr/0001-api-keys-behind-edge-function-proxy.md) | All AI provider calls proxied through Supabase Edge Functions | Accepted |
| [0002](adr/0002-guest-tier-is-ephemeral.md) | Guest tier = ephemeral sessions, nothing persisted | Accepted |
| [0003](adr/0003-audio-duplex-strategy.md) | Continuous STT vs half-duplex — pending spike | Proposed |
| [0004](adr/0004-osm-as-road-data-source.md) | OSM/Overpass as source of speed limits and control points | Accepted |
| [0005](adr/0005-nzta-aligned-scoring.md) | Scoring modeled on official NZTA error categories | Accepted |
| [0006](adr/0006-pure-session-engine.md) | Exam logic extracted to a pure TS engine with replay | Accepted |
