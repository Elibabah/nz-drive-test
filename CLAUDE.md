# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NZ Drive Practice — a React Native app that simulates the New Zealand practical driving exam. The instructor gives real-time turn-by-turn directions and hazard-detection prompts by voice. The user responds by voice. Sessions are 20 minutes on urban roads only.

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

`@react-native-community/voice` is a native module — the app cannot run in Expo Go. Always use `npx expo run:ios` (development build). The `ios/` folder is committed and managed via CocoaPods.

### API key injection

`app.config.js` (not `app.json`) reads `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` from `.env` and injects it into `ios/NZDrivePractice/AppDelegate.swift` via `expo prebuild`. If the map tiles are blank, the prebuild hasn't run with the correct key — run the prebuild command above, then rebuild.

### Session state machine (`src/hooks/useDrivingSession.ts`)

The entire session lifecycle lives here. Phases: `idle → requesting-location → building-route → ready → active ↔ hazard-prompt ↔ listening → completing → completed`.

**Critical pattern**: Navigation callbacks use `useRef` mirrors of state (`phaseRef`, `remainingStepsRef`, `timeRemainingMsRef`) to avoid stale closures inside `processPosition`. Any callback that runs asynchronously during a session must read from refs, not state.

**Position updates**: `onUserLocationChange` on the MapView is the authoritative source of position during a session — `watchPositionAsync` is a fallback. `MapView.animateCamera` is called from this event; `followsUserLocation` prop is intentionally not used (unreliable with `PROVIDER_GOOGLE`).

### Navigation logic (`src/services/instructor.ts` + `src/services/googleDirections.ts`)

The app pre-fetches a full route (origin → random destination) at session start using Google Directions API. Instructions fire when:
- Within 300 m of the next turn end → "upcoming" announcement
- Within 80 m → "immediate" announcement
- Within 40 m of a step's start location → step-entry announcement
- 3% random chance when > 500 m from any turn → mirrors reminder

**Known MVP1 architectural gap**: The route is fixed at session start. If the user deviates, instructions do not reroute. Rerouting (re-calling `getRoute` from current position when off-route) is the next major feature.

### Voice (`src/services/voiceRecognition.ts`)

Wraps `@react-native-community/voice`. Only used for hazard-response capture (not turn-by-turn). Hazard prompts are spoken by TTS (`expo-speech`, en-NZ locale), then the mic opens for 5 s. Empty response = user said nothing.

### Backend (`src/services/supabase.ts`)

Anonymous Supabase auth (no signup). User ID is persisted in `AsyncStorage`. All data (sessions, GPS tracks, hazard events) is written to Supabase with RLS — users only see their own rows. Falls back to `AsyncStorage` cache if offline. Schema is in `supabase/schema.sql`.

### AI feedback (`src/services/claudeFeedback.ts`)

Called once at session end. Uses `fetch` directly to `api.anthropic.com/v1/messages` (not the Anthropic SDK, which requires Node.js). Model: `claude-sonnet-4-6`.

## Key constants

- Session duration: 20 min (`NZ_DRIVING.SESSION_DURATION_MS`)
- Hazard prompts: every 2.5 min ± 30 s
- Step completion radius: 30 m (position must be within 30 m of a step's end to advance)
- NZ drives on the LEFT — all instruction templates account for this

## Environment variables (`.env`)

```
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=   # Maps SDK for iOS + Directions API
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_ANTHROPIC_API_KEY=
EXPO_PUBLIC_DEV_DEST_LAT=          # Optional: fixes route destination for simulator testing
EXPO_PUBLIC_DEV_DEST_LNG=          # Remove for production (enables random destinations)
```

## Simulator testing

`simulate_drive.sh` calls `xcrun simctl location set` every 2 s to move the simulator's GPS along a real Auckland street route fetched from the Directions API. It must use the same origin and destination as the app — if `EXPO_PUBLIC_DEV_DEST_*` is set, the script and the app use the same fixed destination. Regenerate the script if the destination changes.
