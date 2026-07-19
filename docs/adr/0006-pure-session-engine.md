# ADR-0006: Exam logic extracted into a pure TypeScript engine with deterministic replay

- **Status:** Accepted (2026-07-18)
- **Context:** Exam logic is spread across a ~350-line React hook (`useDrivingSession`) with `useRef` mirrors to dodge stale closures, plus module-level singletons (`sessionRecorder`, `eventMonitor`, `aiInstructor` history). This makes tests slow (jest-expo renders hooks; suite ~10 min), reset semantics fragile, and the logic untestable without React.
- **Decision:** Extract a dependency-free TypeScript module (`src/engine/`): explicit state machine + event monitor + scoring. Inputs are plain data — GPS fixes, clock ticks, speech exchanges, route/control-point data. Outputs are plain data — events, utterance requests, state transitions. No React, no Expo, no globals: engine instances own all state. `useDrivingSession` becomes a thin adapter wiring device APIs to the engine.
- **Consequences:**
  - **Deterministic replay:** a recorded GPS track + transcript replays the entire session in a millisecond-fast unit test — the only realistic way to test exam logic without driving. Real drives become regression fixtures.
  - Suite speed target (< 60 s, MVP-0) becomes achievable: engine tests need no React renderer.
  - Android port (MVP-5) reuses the engine unchanged; only device adapters (GPS, STT, TTS) are per-platform.
  - AI calls are invoked through an injected port interface, so the engine is testable with a fake examiner.
- **Alternatives considered:** XState (fine, but a hand-rolled explicit machine keeps the dependency count at zero and the logic transparent); keeping hook-based logic with more refs (status quo — the source of the current flake).
