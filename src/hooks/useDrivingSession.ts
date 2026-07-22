import { useState, useRef, useCallback, useEffect } from 'react';
import * as Location from 'expo-location';
import { Coordinate, RouteStep, SessionPhase, DrivingSession } from '../types';
import {
  getRoute, rerouteFromPosition, getDestinationAhead, DirectionsResult,
} from '../services/googleDirections';
import { speak, stopSpeaking } from '../services/instructor';
import { destroyVoice } from '../services/voiceRecognition';
import { checkpointSession } from '../services/sessionPersistence';
import { fetchRoadData } from '../services/osmRoadData';
import { getCurrentUserId } from '../services/supabase';
import { isTTSPlaying } from '../services/audioState';
import {
  evaluateHazardResponse, evaluateKnowledgeResponse,
} from '../services/claudeFeedback';
import { NavigationContext } from '../services/aiInstructor';
import { SessionEngine, EngineCommand, RerouteReason } from '../engine/sessionEngine';
import { NZ_DRIVING } from '../constants/nzDriving';
import { GOOGLE_MAPS_API_KEY } from '../constants/config';

const LOCATION_UPDATE_INTERVAL = 2000;

function randomBearing(): number {
  const b = [0, 45, 90, 135, 180, 225, 270, 315];
  return b[Math.floor(Math.random() * b.length)];
}

/**
 * Thin adapter around the pure SessionEngine (ADR-0006): owns device APIs
 * (GPS, TTS, network, persistence) and React state; every exam decision lives
 * in the engine.
 */
export function useDrivingSession(userId: string) {
  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [currentPosition, setCurrentPosition] = useState<Coordinate | null>(null);
  const [route, setRoute] = useState<DirectionsResult | null>(null);
  const [remainingSteps, setRemainingSteps] = useState<RouteStep[]>([]);
  const [session, setSession] = useState<DrivingSession | null>(null);
  const [timeRemainingMs, setTimeRemainingMs] = useState(NZ_DRIVING.SESSION_DURATION_MS);
  const [isRerouting, setIsRerouting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const engineRef = useRef<SessionEngine | null>(null);
  const phaseRef = useRef<SessionPhase>('idle');
  const sessionDestinationRef = useRef<Coordinate | null>(null);
  const currentPositionRef = useRef<Coordinate | null>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkpointTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setPhaseWithRef = useCallback((p: SessionPhase) => { phaseRef.current = p; setPhase(p); }, []);

  // ─── Navigation context (read by useVoiceConversation) ────────────────────────

  const getNavigationContext = useCallback((): NavigationContext => {
    const engine = engineRef.current;
    if (!engine) {
      return {
        position: currentPositionRef.current ?? { latitude: 0, longitude: 0 },
        nextStep: null, distanceToTurnM: 9999, remainingSteps: [],
        timeRemainingMs: NZ_DRIVING.SESSION_DURATION_MS, sessionElapsedMs: 0, speedKmh: 0,
      };
    }
    return engine.getNavigationContext(Date.now());
  }, []);

  // ─── Recording callbacks (called from useVoiceConversation) ──────────────────

  const recordHazardExchange = useCallback((prompt: string, response: string) => {
    const engine = engineRef.current;
    const eventId = engine?.recordHazardExchange(prompt, response, Date.now());
    if (!engine || !eventId) return;
    evaluateHazardResponse(prompt, response)
      .then(({ quality, feedback }) => engine.applyHazardEvaluation(eventId, quality, feedback))
      .catch(() => {});
  }, []);

  const recordKnowledgeExchange = useCallback((question: string, expectedAnswer: string, response: string) => {
    const engine = engineRef.current;
    const eventId = engine?.recordKnowledgeExchange(question, expectedAnswer, response, Date.now());
    if (!engine || !eventId) return;
    evaluateKnowledgeResponse(question, expectedAnswer, response)
      .then(({ quality, feedback }) => engine.applyKnowledgeEvaluation(eventId, quality, feedback))
      .catch(() => {});
  }, []);

  // ─── Command execution (the adapter side of the engine contract) ─────────────

  const performReroute = useCallback(async (_reason: RerouteReason) => {
    const engine = engineRef.current;
    const origin = currentPositionRef.current;
    const destination = sessionDestinationRef.current;
    if (!engine || !origin || !destination) { engine?.rerouteFailed(); return; }

    setIsRerouting(true);
    try {
      const newRoute = await rerouteFromPosition(origin, destination, GOOGLE_MAPS_API_KEY);
      engine.applyReroute(newRoute.steps);
      setRoute(newRoute);
      setRemainingSteps(newRoute.steps);
      // Refresh the OSM corridor for the new geometry (fire-and-forget)
      fetchRoadData(newRoute.polylineCoordinates)
        .then((rd) => engineRef.current?.setRoadData(rd))
        .catch(() => {});
    } catch {
      engine.rerouteFailed();
    } finally {
      setIsRerouting(false);
    }
  }, []);

  const executeCommands = useCallback((commands: EngineCommand[]) => {
    for (const cmd of commands) {
      if (cmd.type === 'speak') {
        // Engine contract: coaching never talks over ongoing speech;
        // safety/navigation interrupt (speak = speakNavigation).
        if (cmd.priority === 'coaching' && isTTSPlaying()) continue;
        speak(cmd.text);
      } else if (cmd.type === 'requestReroute') {
        performReroute(cmd.reason);
      }
    }
  }, [performReroute]);

  // ─── Position processing ──────────────────────────────────────────────────────

  const processPosition = useCallback((coord: Coordinate, speedKmh: number) => {
    setCurrentPosition(coord);
    currentPositionRef.current = coord;
    const engine = engineRef.current;
    if (!engine || phaseRef.current !== 'active') return;
    executeCommands(engine.handlePosition(coord, speedKmh, Date.now()));
    // The engine advances steps locally on completion — keep the HUD in sync.
    // Same array reference when unchanged, so React skips the re-render.
    setRemainingSteps(engine.remainingSteps);
  }, [executeCommands]);

  const updatePositionFromMap = useCallback((coord: Coordinate, speedKmh = 0) => {
    processPosition(coord, speedKmh);
  }, [processPosition]);

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  const cleanup = useCallback(async () => {
    locationSubscription.current?.remove();
    if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
    if (checkpointTimerRef.current) clearInterval(checkpointTimerRef.current);
    await stopSpeaking();
    await destroyVoice();
  }, []);

  // ─── Session lifecycle ────────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    try {
      setError(null);
      setPhaseWithRef('requesting-location');

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setError('Location permission is required.'); setPhaseWithRef('idle'); return; }

      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      const coords: Coordinate = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      setCurrentPosition(coords);
      currentPositionRef.current = coords;
      setPhaseWithRef('building-route');

      const devDestLat = process.env.EXPO_PUBLIC_DEV_DEST_LAT;
      const devDestLng = process.env.EXPO_PUBLIC_DEV_DEST_LNG;
      const destination = devDestLat && devDestLng
        ? { latitude: parseFloat(devDestLat), longitude: parseFloat(devDestLng) }
        : getDestinationAhead(coords, randomBearing(), 5);
      sessionDestinationRef.current = destination;

      const routeData = await getRoute(coords, destination, GOOGLE_MAPS_API_KEY);
      setRoute(routeData);
      setRemainingSteps(routeData.steps);

      // Resolve auth at creation time — the userId prop may still hold its
      // placeholder while auth loads (the v1 'anon'-in-uuid save bug).
      const resolvedUserId = (await getCurrentUserId().catch(() => null)) ?? userId;
      const engine = new SessionEngine({ userId: resolvedUserId, nowMs: Date.now() });
      engine.setRoute(routeData.steps);
      engineRef.current = engine;
      setSession(engine.session);
      setPhaseWithRef('ready');

      // OSM road data for the corridor (ADR-0004) — fire-and-forget; the
      // engine falls back to instruction-text heuristics until it arrives
      fetchRoadData(routeData.polylineCoordinates)
        .then((rd) => engineRef.current?.setRoadData(rd))
        .catch(() => {});
    } catch (err: any) {
      setError(err?.message ?? 'Failed to start session. Check your internet connection.');
      setPhaseWithRef('idle');
    }
  }, [userId, setPhaseWithRef]);

  const finishSession = useCallback(async () => {
    setPhaseWithRef('completing');
    await cleanup();
    const engine = engineRef.current;
    if (engine) setSession(engine.complete(Date.now()));
    setPhaseWithRef('completed');
  }, [cleanup, setPhaseWithRef]);

  const beginDriving = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setPhaseWithRef('active');
    engine.start(Date.now());

    locationSubscription.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: LOCATION_UPDATE_INTERVAL, distanceInterval: 0 },
      (loc) => {
        const coord: Coordinate = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        const speedKmh = Math.max(0, (loc.coords.speed ?? 0) * 3.6);
        processPosition(coord, speedKmh);
        engineRef.current?.recordGpsPoint({
          coordinate: coord,
          timestamp: loc.timestamp,
          speed: Math.max(0, loc.coords.speed ?? 0),
          heading: loc.coords.heading ?? 0,
        });
      }
    );

    sessionTimerRef.current = setInterval(() => {
      const remaining = engineRef.current?.timeRemainingMs(Date.now()) ?? 0;
      setTimeRemainingMs(remaining);
      if (remaining <= 0) finishSession();
    }, 1000);

    // Incremental persistence: checkpoint every minute so a crash mid-session
    // loses at most ~1 min of data (ROADMAP MVP-0). Fire-and-forget.
    checkpointTimerRef.current = setInterval(() => {
      const active = engineRef.current?.session;
      if (active) checkpointSession(active).catch(() => {});
    }, 60_000);
  }, [setPhaseWithRef, processPosition, finishSession]);

  const cancelSession = useCallback(async () => {
    await cleanup();
    engineRef.current?.abandon();
    engineRef.current = null;
    setSession(null);
    setPhaseWithRef('idle');
    setRoute(null);
    setRemainingSteps([]);
    setTimeRemainingMs(NZ_DRIVING.SESSION_DURATION_MS);
    sessionDestinationRef.current = null;
  }, [cleanup, setPhaseWithRef]);

  useEffect(() => { return () => { cleanup(); }; }, [cleanup]);

  return {
    phase,
    currentPosition,
    route,
    remainingSteps,
    session,
    timeRemainingMs,
    isRerouting,
    error,
    startSession,
    beginDriving,
    finishSession,
    cancelSession,
    updatePositionFromMap,
    getNavigationContext,
    recordHazardExchange,
    recordKnowledgeExchange,
  };
}
