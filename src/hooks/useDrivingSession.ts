import { useState, useRef, useCallback, useEffect } from 'react';
import * as Location from 'expo-location';
import { Coordinate, RouteStep, SessionPhase, DrivingSession, GPSPoint } from '../types';
import {
  getRoute, rerouteFromPosition, getDestinationAhead, DirectionsResult, distanceBetween, distanceToPolyline,
} from '../services/googleDirections';
import { speak, stopSpeaking, buildImmediateInstruction, buildUpcomingInstruction } from '../services/instructor';
import { destroyVoice } from '../services/voiceRecognition';
import {
  createSession, getActiveSession, recordGPSPoint,
  recordHazardEvent, updateHazardEvaluation,
  recordKnowledgeEvent, updateKnowledgeEvaluation,
  recordNavigationEvent,
  recordSpeedViolation, recordStopEvent, recordBrakingEvent,
  completeSession, abandonSession,
} from '../services/sessionRecorder';
import { checkpointSession } from '../services/sessionPersistence';
import { getCurrentUserId } from '../services/supabase';
import { processMonitoringUpdate, resetMonitor, clearStepMonitoring } from '../services/eventMonitor';
import { isTTSPlaying } from '../services/audioState';
import {
  evaluateHazardResponse, evaluateKnowledgeResponse,
} from '../services/claudeFeedback';
import { NavigationContext } from '../services/aiInstructor';
import { NZ_DRIVING } from '../constants/nzDriving';
import { GOOGLE_MAPS_API_KEY } from '../constants/config';

const LOCATION_UPDATE_INTERVAL = 2000;
const STEP_COMPLETION_RADIUS = 30;
const OFF_ROUTE_THRESHOLD = 300;
const REROUTE_DEBOUNCE_MS = 20_000;

function randomBearing(): number {
  const b = [0, 45, 90, 135, 180, 225, 270, 315];
  return b[Math.floor(Math.random() * b.length)];
}

export function useDrivingSession(userId: string) {
  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [currentPosition, setCurrentPosition] = useState<Coordinate | null>(null);
  const [route, setRoute] = useState<DirectionsResult | null>(null);
  const [remainingSteps, setRemainingSteps] = useState<RouteStep[]>([]);
  const [session, setSession] = useState<DrivingSession | null>(null);
  const [timeRemainingMs, setTimeRemainingMs] = useState(NZ_DRIVING.SESSION_DURATION_MS);
  const [isRerouting, setIsRerouting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phaseRef = useRef<SessionPhase>('idle');
  const remainingStepsRef = useRef<RouteStep[]>([]);
  const timeRemainingMsRef = useRef(NZ_DRIVING.SESSION_DURATION_MS);
  const sessionDestinationRef = useRef<Coordinate | null>(null);
  const lastInstructionRef = useRef('');
  const sessionStartTimeRef = useRef(0);
  const isReroutingRef = useRef(false);
  const lastRerouteTimeRef = useRef(0);
  const currentPositionRef = useRef<Coordinate | null>(null);
  const currentSpeedRef = useRef(0);
  // Navigation instruction dedup
  const lastNavInstrRef = useRef('');
  const navImmediateFiredRef = useRef(false);
  const navUpcomingFiredRef = useRef(false);
  const navStepKeyRef = useRef('');
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkpointTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setPhaseWithRef = useCallback((p: SessionPhase) => { phaseRef.current = p; setPhase(p); }, []);
  const setRemainingStepsWithRef = useCallback((steps: RouteStep[]) => { remainingStepsRef.current = steps; setRemainingSteps(steps); }, []);

  // ─── Navigation context (read by useVoiceConversation) ────────────────────────

  const getNavigationContext = useCallback((): NavigationContext => {
    const pos = currentPositionRef.current ?? { latitude: 0, longitude: 0 };
    const steps = remainingStepsRef.current;
    const nextStep = steps[0] ?? null;
    return {
      position: pos,
      nextStep,
      distanceToTurnM: nextStep ? distanceBetween(pos, nextStep.endLocation) : 9999,
      remainingSteps: steps,
      timeRemainingMs: timeRemainingMsRef.current,
      sessionElapsedMs: sessionStartTimeRef.current ? Date.now() - sessionStartTimeRef.current : 0,
      speedKmh: currentSpeedRef.current,
    };
  }, []);

  // ─── Recording callbacks (called from useVoiceConversation) ──────────────────

  const recordHazardExchange = useCallback((prompt: string, response: string) => {
    const pos = currentPositionRef.current;
    if (!pos) return;
    const event = recordHazardEvent(pos, prompt, response);
    evaluateHazardResponse(prompt, response)
      .then(({ quality, feedback }) => updateHazardEvaluation(event.id, quality, feedback))
      .catch(() => {});
  }, []);

  const recordKnowledgeExchange = useCallback((question: string, expectedAnswer: string, response: string) => {
    const pos = currentPositionRef.current;
    if (!pos) return;
    const event = recordKnowledgeEvent(pos, question, expectedAnswer, response);
    evaluateKnowledgeResponse(question, expectedAnswer, response)
      .then(({ quality, feedback }) => updateKnowledgeEvaluation(event.id, quality, feedback))
      .catch(() => {});
  }, []);

  // ─── Re-routing ─────────────────────────────────────────────────────────────

  const triggerReroute = useCallback(async (coord: Coordinate, reason: 'step_complete' | 'off_route' | 'destination_reached') => {
    if (!sessionDestinationRef.current) return;
    clearStepMonitoring();

    if (reason === 'off_route' && lastInstructionRef.current) {
      const instrWas = lastInstructionRef.current;
      recordNavigationEvent(coord, instrWas, instrWas.toLowerCase().includes('turn') ? 'wrong_turn' : 'off_route');
      const msg = instrWas.toLowerCase().includes('turn left')
        ? 'I asked you to turn left. I will give you new directions from here.'
        : instrWas.toLowerCase().includes('turn right')
        ? 'I asked you to turn right. I will give you new directions from here.'
        : 'You have gone off route. I will give you new directions from here.';
      speak(msg);
    }

    isReroutingRef.current = true;
    lastRerouteTimeRef.current = Date.now();
    setIsRerouting(true);

    try {
      const newRoute = await rerouteFromPosition(coord, sessionDestinationRef.current, GOOGLE_MAPS_API_KEY);
      setRemainingStepsWithRef(newRoute.steps);
      setRoute(newRoute);
      lastInstructionRef.current = '';
      // Force nav dedup reset so new steps always get their instructions
      navStepKeyRef.current = '';
      navImmediateFiredRef.current = false;
      navUpcomingFiredRef.current = false;
    } catch { /* keep existing steps */ } finally {
      isReroutingRef.current = false;
      setIsRerouting(false);
    }
  }, [setRemainingStepsWithRef]);

  // ─── Core position processing ────────────────────────────────────────────────

  const processPosition = useCallback((coord: Coordinate, speedKmh: number) => {
    setCurrentPosition(coord);
    currentPositionRef.current = coord;
    currentSpeedRef.current = speedKmh;

    if (phaseRef.current !== 'active') return;

    const steps = remainingStepsRef.current;
    const canRerouteNow =
      !isReroutingRef.current &&
      Date.now() - lastRerouteTimeRef.current > REROUTE_DEBOUNCE_MS;

    if (steps.length === 0) {
      if (canRerouteNow) triggerReroute(coord, 'destination_reached');
      return;
    }

    const nextStep = steps[0];
    const distToEnd = distanceBetween(coord, nextStep.endLocation);
    const stepCompleted = distToEnd <= STEP_COMPLETION_RADIUS;
    // Off-route = far from the step's actual geometry, not from its endpoints —
    // endpoint distance false-positives on any step longer than 2× the threshold.
    const stepPath = nextStep.polyline ?? [nextStep.startLocation, nextStep.endLocation];
    const offRoute = distanceToPolyline(coord, stepPath) > OFF_ROUTE_THRESHOLD;

    const monitorResult = processMonitoringUpdate(coord, speedKmh, steps, distToEnd, stepCompleted);

    if (monitorResult.speedWarning) {
      const { text, severity, speedKmh: spd, limitKmh, duration } = monitorResult.speedWarning;
      speak(text);
      recordSpeedViolation(coord, spd, limitKmh, severity, duration);
    }

    if (monitorResult.stopViolation) {
      const { complied, lowestSpeedKmh, type } = monitorResult.stopViolation;
      if (type) {
        recordStopEvent(coord, type as 'stop_sign' | 'railway_crossing' | 'pedestrian_crossing', complied, lowestSpeedKmh);
        if (!complied) {
          const msg =
            type === 'stop_sign' ? 'At the stop sign, you must come to a complete stop before proceeding.'
            : type === 'railway_crossing' ? 'At a railway crossing, you must slow right down and check both directions.'
            : 'You must give way to pedestrians at a pedestrian crossing.';
          speak(msg);
        }
      }
    }

    // Coaching nudges (braking, unexpected stop) are low priority: always
    // recorded, but never interrupt the examiner mid-sentence — speak() here is
    // speakNavigation, which cuts off any conversation TTS in progress.
    if (monitorResult.brakingEvent) {
      const { text, deltaKmh, prevSpeedKmh } = monitorResult.brakingEvent;
      recordBrakingEvent(coord, prevSpeedKmh, speedKmh, deltaKmh);
      if (!isTTSPlaying()) speak(text);
    }

    if (monitorResult.unexpectedStopWarning && !isTTSPlaying()) {
      speak(monitorResult.unexpectedStopWarning.text);
    }

    if (stepCompleted && canRerouteNow) {
      triggerReroute(coord, 'step_complete');
      // Reset nav dedup for next step
      navImmediateFiredRef.current = false;
      navUpcomingFiredRef.current = false;
      navStepKeyRef.current = '';
      return;
    }
    if (offRoute && canRerouteNow) { triggerReroute(coord, 'off_route'); return; }

    // ─── Scripted navigation instructions ────────────────────────────────────
    const distToTurn = distToEnd;
    const stepKey = `${nextStep.endLocation.latitude.toFixed(5)},${nextStep.endLocation.longitude.toFixed(5)}`;

    if (stepKey !== navStepKeyRef.current) {
      navStepKeyRef.current = stepKey;
      navImmediateFiredRef.current = false;
      navUpcomingFiredRef.current = false;
      lastInstructionRef.current = '';
    }

    if (!navUpcomingFiredRef.current) {
      const upcoming = buildUpcomingInstruction(nextStep, distToTurn);
      if (upcoming && upcoming !== lastNavInstrRef.current) {
        navUpcomingFiredRef.current = true;
        lastNavInstrRef.current = upcoming;
        lastInstructionRef.current = upcoming;
        speak(upcoming);
      }
    }

    if (!navImmediateFiredRef.current) {
      const immediate = buildImmediateInstruction(nextStep, distToTurn);
      if (immediate && immediate !== lastNavInstrRef.current) {
        navImmediateFiredRef.current = true;
        lastNavInstrRef.current = immediate;
        lastInstructionRef.current = immediate;
        speak(immediate);
      }
    }
  }, [triggerReroute]);

  const updatePositionFromMap = useCallback((coord: Coordinate, speedKmh = 0) => {
    processPosition(coord, speedKmh);
  }, [processPosition]);

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  const cleanup = useCallback(async () => {
    locationSubscription.current?.remove();
    if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
    if (checkpointTimerRef.current) clearInterval(checkpointTimerRef.current);
    resetMonitor();
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
      setRemainingStepsWithRef([...routeData.steps]);

      // Resolve auth at creation time — the userId prop may still hold its
      // placeholder while auth loads (the v1 'anon'-in-uuid save bug).
      const resolvedUserId = (await getCurrentUserId().catch(() => null)) ?? userId;
      setSession(createSession(resolvedUserId));
      setPhaseWithRef('ready');
    } catch (err: any) {
      setError(err?.message ?? 'Failed to start session. Check your internet connection.');
      setPhaseWithRef('idle');
    }
  }, [userId, setPhaseWithRef, setRemainingStepsWithRef]);

  const finishSession = useCallback(async () => {
    setPhaseWithRef('completing');
    await cleanup();
    const completed = completeSession();
    setSession(completed);
    setPhaseWithRef('completed');
  }, [cleanup, setPhaseWithRef]);

  const beginDriving = useCallback(async () => {
    setPhaseWithRef('active');
    sessionStartTimeRef.current = Date.now();
    lastRerouteTimeRef.current = Date.now();
    resetMonitor();

    locationSubscription.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: LOCATION_UPDATE_INTERVAL, distanceInterval: 0 },
      (loc) => {
        const coord: Coordinate = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        const speedKmh = Math.max(0, (loc.coords.speed ?? 0) * 3.6);
        processPosition(coord, speedKmh);
        recordGPSPoint({ coordinate: coord, timestamp: loc.timestamp, speed: Math.max(0, loc.coords.speed ?? 0), heading: loc.coords.heading ?? 0 });
      }
    );

    sessionTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - sessionStartTimeRef.current;
      const remaining = Math.max(0, NZ_DRIVING.SESSION_DURATION_MS - elapsed);
      timeRemainingMsRef.current = remaining;
      setTimeRemainingMs(remaining);
      if (remaining <= 0) finishSession();
    }, 1000);

    // Incremental persistence: checkpoint every minute so a crash mid-session
    // loses at most ~1 min of data (ROADMAP MVP-0). Fire-and-forget.
    checkpointTimerRef.current = setInterval(() => {
      const active = getActiveSession();
      if (active) checkpointSession(active).catch(() => {});
    }, 60_000);
  }, [setPhaseWithRef, processPosition, finishSession]);

  const cancelSession = useCallback(async () => {
    await cleanup();
    abandonSession();
    setSession(null);
    setPhaseWithRef('idle');
    setRoute(null);
    setRemainingStepsWithRef([]);
    timeRemainingMsRef.current = NZ_DRIVING.SESSION_DURATION_MS;
    setTimeRemainingMs(NZ_DRIVING.SESSION_DURATION_MS);
    sessionDestinationRef.current = null;
  }, [cleanup, setPhaseWithRef, setRemainingStepsWithRef]);

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
