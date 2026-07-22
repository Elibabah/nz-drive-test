# ADR-0004: OpenStreetMap as the source of speed limits and control points

- **Status:** Accepted (2026-07-18)
- **Context:** `eventMonitor.ts` currently hardcodes a 50 km/h limit and detects stop signs / crossings by searching Google Directions instruction text — strings that in practice never occur, so those checks silently never fire while still contributing perfect sub-scores. Google's Speed Limits API is enterprise-gated; the Directions steps carry no control-point data.
- **Decision:** At route-build time, query OSM Overpass for a corridor along the route polyline and prefetch: `maxspeed`, `highway=stop`, `highway=traffic_signals`, `highway=give_way`, `railway=level_crossing`, `crossing=*`, and roundabout geometry. The session engine consumes these as typed control points with coordinates; monitoring matches by proximity to the GPS fix, not by instruction text. Traffic signals additionally **suppress the unexpected-stop nudge** near intersections — field test 2026-07-22: the examiner scolded the driver for waiting at a red light.
- **Consequences:**
  - One extra network call at session start (cacheable per area); sessions degrade gracefully to default urban limits if Overpass is unreachable.
  - NZ OSM coverage of maxspeed/controls is good in urban areas but not perfect — feedback wording must avoid asserting violations with false precision where data is absent.
  - Opens the door to NZTA open data as a secondary source later.
- **Alternatives considered:** Google Roads/Speed Limits (paywalled), Mapbox (new vendor + billing), instruction-text parsing (status quo — demonstrably non-functional).
