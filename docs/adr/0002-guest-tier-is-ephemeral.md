# ADR-0002: Guest tier is fully ephemeral

- **Status:** Accepted (2026-07-18)
- **Context:** Product requires the app to be usable without any account, "sin trackear ningún progreso". Two viable semantics: (a) ephemeral — session runs fully in memory, feedback shown once, nothing persisted; (b) local-only persistence with migration to the account on later sign-in.
- **Decision:** Option (a), ephemeral. Guests get the complete session experience and the full AI debrief, but nothing is stored server-side and nothing survives app restart. Wanting to keep progress becomes the natural incentive to sign in with Google.
- **Consequences:**
  - Simplest privacy story (no guest rows, no migration/merge logic, no orphaned data).
  - Guest AI usage is still metered by the proxy (ADR-0001) via a device-scoped quota (e.g., N sessions/day) to bound free-tier cost.
  - Local→account history migration is explicitly deferred; it can be added later as a conversion feature without schema changes.
- **Alternatives considered:** Supabase anonymous auth with later identity linking — heavier, creates server-side data for users who asked not to be tracked.
