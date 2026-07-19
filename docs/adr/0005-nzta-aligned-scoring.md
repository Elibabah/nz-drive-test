# ADR-0005: Scoring modeled on official NZTA error categories

- **Status:** Accepted (2026-07-18)
- **Context:** `computeScore` produces a weighted percentage from invented weights (hazard 30%, speed 20%, …). The real Full Licence practical is assessed by counting **critical errors** and **immediate fail errors** across assessed tasks; getting lost is not an error, disobeying signs/markings is. A percentage cannot answer the user's actual question: "would I have passed?"
- **Decision:** The engine maps recorded events to NZTA-style categories: immediate fail errors (e.g., sustained speeding, failing to stop at a stop sign, dangerous action) and critical errors (e.g., late signalling, harsh braking pattern, incorrect road position), and applies pass/fail thresholds mirroring the official assessment guide. The session verdict is **PASS / FAIL + error tally**. The existing numeric score is retained as a secondary progress metric for trends, not as the verdict.
- **Consequences:**
  - Requires an explicit, sourced mapping table (docs/) from app events → NZTA error categories, kept up to date against the current assessment guide.
  - Deviation handling depends on the justified/error classification (see ROADMAP MVP-1): justified deviations produce no error.
  - Some official categories (mirror checks, head checks, signalling) are unobservable without extra sensors — the verdict must state what was and wasn't assessed.
