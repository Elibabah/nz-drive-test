# App events → NZTA error categories (ADR-0005)

> Sources: NZTA Full Licence test guide — [immediate failure errors](https://nzta.govt.nz/driver-licences/getting-a-licence/take-your-test/practical-tests/full-licence-test-guide/immediate-failure-errors), [critical errors](https://nzta.govt.nz/driver-licences/getting-a-licence/take-your-test/practical-tests/full-licence-test-guide/critical-errors), [test structure overview](https://www.nzta.govt.nz/driver-licences/getting-a-licence/take-your-test/practical-tests/full-licence-test-guide/overview-of-the-structure-of-the-full-licence-test); critical-error allowance corroborated by [drivingtests.co.nz](https://www.drivingtests.co.nz/resources/critical-immediate-fail-errors-driving-test/). Last checked 2026-08-04.

## Verdict rule

**FAIL** = any immediate-fail error, **or** more than one critical error. Otherwise **PASS**.
Implemented in `src/engine/nztaVerdict.ts`; thresholds enforced in `src/engine/monitoring.ts`.

## Speed (official thresholds)

| Situation | Official category | App event |
|---|---|---|
| ≥10 km/h over the limit, any duration | Immediate fail — excessive speed | `SpeedViolation` severity `immediate_fail` (emitted the moment it happens) |
| ≥5 km/h over for ≥5 s | Immediate fail — excessive speed | `SpeedViolation` severity `immediate_fail` (emitted when the 5 s elapse) |
| 5–10 km/h over, ends within 5 s | Critical — too fast | `SpeedViolation` severity `critical` (emitted when the incident ends — its class isn't knowable earlier) |

GPS-noise caveat: the guide counts from exactly 5 km/h over; a single noisy reading at +5 can log a critical error. Accepted for fidelity — revisit after field validation.

## Compulsory stops and crossings

| Situation | Official category | App event |
|---|---|---|
| No complete stop at a stop sign | Immediate fail — failure to stop | `StopEvent` `stop_sign`, `complied: false` (lowest speed > 2 km/h through the control point) |
| No effective stop/check at a railway crossing | Immediate fail — failure to stop | `StopEvent` `railway_crossing`, `complied: false` |
| Not giving way at a pedestrian crossing | Immediate fail — failure to give way | `StopEvent` `pedestrian_crossing`, `complied: false` |

## Deliberately unmapped

- **Navigation deviations** — getting lost is not an error on the real test. Justified deviations (road closed, obstruction, safety) are excused entirely; manoeuvring errors keep a mild penalty in the *progress score* only, never in the verdict.
- **Harsh braking / unexpected stops** — not an official error category; coaching nudges + progress score only.
- **Hazard commentary & knowledge questions** — training features; the real practical doesn't score them. Progress score only.

## Official categories the app cannot observe (listed in `verdict.notAssessed`)

Mirror/blind-spot/head checks, indicator use, lane position and following distance, vehicle control (stalling, kerb contact), give-way at uncontrolled intersections, red/yellow traffic-light stops (no signal-state data), TO intervention, collision.
