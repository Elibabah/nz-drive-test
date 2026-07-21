import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Alert,
  ActivityIndicator, Animated,
} from 'react-native';
import MapView, { Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { useDrivingSession } from '../src/hooks/useDrivingSession';
import { useVoiceConversation } from '../src/hooks/useVoiceConversation';
import { SessionTimer } from '../src/components/SessionTimer';
import { getCurrentUserId, saveSession, updateSessionFeedback } from '../src/services/supabase';
import { generateSessionFeedback } from '../src/services/claudeFeedback';
// Light map for now (daytime testing) — DARK_MAP_STYLE in constants/mapStyle
// is ready for the automatic day/night switch (ROADMAP backlog, MVP-2).

export default function SessionScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState<string>('anon');
  const mapRef = useRef<MapView>(null);
  const sessionCompleteHandled = useRef(false);
  const [ending, setEnding] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    getCurrentUserId().then((id) => { if (id) setUserId(id); });
  }, []);

  const {
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
  } = useDrivingSession(userId);

  const { convState, instructorText, isListening, isSpeaking, tapToSpeak } = useVoiceConversation({
    getContext: getNavigationContext,
    isActive: phase === 'active',
    recordHazardExchange,
    recordKnowledgeExchange,
  });

  // Pulse animation when mic is open
  useEffect(() => {
    if (!isListening) { pulseAnim.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.5, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isListening]);

  useEffect(() => { startSession(); }, []);

  const handleUserLocationChange = useCallback(
    (event: Parameters<NonNullable<React.ComponentProps<typeof MapView>['onUserLocationChange']>>[0]) => {
      const raw = event.nativeEvent.coordinate;
      if (!raw) return;
      const coord = { latitude: raw.latitude, longitude: raw.longitude };
      const speedKmh = Math.max(0, ((raw as any).speed ?? 0) * 3.6);
      mapRef.current?.animateCamera({ center: coord, zoom: 17 }, { duration: 600 });
      if (phase === 'active') updatePositionFromMap(coord, speedKmh);
    },
    [phase, updatePositionFromMap]
  );

  useEffect(() => {
    if (phase === 'completed' && session && !sessionCompleteHandled.current) {
      sessionCompleteHandled.current = true;
      handleSessionComplete();
    }
  }, [phase, session]);

  async function handleSessionComplete() {
    if (!session) return;
    try {
      const feedback = await generateSessionFeedback(session);
      session.feedback = feedback;
      await saveSession({ ...session, feedback });
      await updateSessionFeedback(session.id, feedback);
    } catch {
      await saveSession(session).catch(() => {});
    }
    router.replace(`/feedback/${session.id}`);
  }

  function handleEndSession() {
    if (ending) return;
    Alert.alert('End Session', 'End this session early?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End Session', style: 'destructive', onPress: () => { setEnding(true); finishSession(); } },
    ]);
  }

  function handleCancel() {
    Alert.alert('Cancel Session', 'Cancel and discard?', [
      { text: 'Keep Driving', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: () => { cancelSession(); router.back(); } },
    ]);
  }

  // ─── Loading / error ──────────────────────────────────────────────────────────

  if (phase === 'requesting-location' || phase === 'building-route') {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4ade80" />
        <Text style={styles.loadingTitle}>
          {phase === 'requesting-location' ? 'Getting your location...' : 'Preparing your session...'}
        </Text>
        <Text style={styles.loadingSubtitle}>
          {phase === 'building-route' ? 'Plotting a 20-minute urban route' : 'Please allow location access'}
        </Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={startSession}>
          <Text style={styles.retryBtnText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelTextBtn} onPress={() => router.back()}>
          <Text style={styles.cancelTextBtnText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (phase === 'completing') {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4ade80" />
        <Text style={styles.loadingTitle}>Saving your session...</Text>
        <Text style={styles.loadingSubtitle}>Generating AI feedback</Text>
      </SafeAreaView>
    );
  }

  // ─── Ready ────────────────────────────────────────────────────────────────────

  if (phase === 'ready') {
    return (
      <SafeAreaView style={styles.readyContainer}>
        {currentPosition && (
          <MapView
            style={styles.map}
            provider={PROVIDER_GOOGLE}
            initialRegion={{
              latitude: currentPosition.latitude,
              longitude: currentPosition.longitude,
              latitudeDelta: 0.012,
              longitudeDelta: 0.012,
            }}
            userInterfaceStyle="light"
            showsUserLocation
            scrollEnabled={false}
            zoomEnabled={false}
          >
            {route && <Polyline coordinates={route.polylineCoordinates} strokeColor="#16a34a" strokeWidth={4} />}
          </MapView>
        )}
        <View style={styles.readyOverlay}>
          <View style={styles.readyCard}>
            <Text style={styles.readyTitle}>GPS Locked</Text>
            <Text style={styles.readyHint}>
              Sam your examiner will guide you with brief instructions and ask questions. Tap the examiner bar to respond anytime.
            </Text>
            <TouchableOpacity style={styles.goButton} onPress={beginDriving}>
              <Text style={styles.goButtonText}>I'm Ready — Drive</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelTextBtn} onPress={handleCancel}>
              <Text style={styles.cancelTextBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Active session ───────────────────────────────────────────────────────────

  const micState = isListening ? 'listening' : isSpeaking ? 'speaking' : 'idle';

  return (
    <View style={styles.container}>
      {currentPosition && (
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          initialRegion={{
            latitude: currentPosition.latitude,
            longitude: currentPosition.longitude,
            latitudeDelta: 0.008,
            longitudeDelta: 0.008,
          }}
          userInterfaceStyle="light"
          showsUserLocation
          showsMyLocationButton={false}
          onUserLocationChange={handleUserLocationChange}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
        />
      )}

      {/* Top HUD: timer + next step */}
      <SafeAreaView style={styles.hudContainer}>
        <View style={styles.hud}>
          <SessionTimer remainingMs={timeRemainingMs} />
          {isRerouting && (
            <View style={styles.reroutingBadge}>
              <ActivityIndicator size="small" color="#facc15" style={{ marginRight: 6 }} />
              <Text style={styles.reroutingText}>Recalculating...</Text>
            </View>
          )}
          {!isRerouting && remainingSteps[0] && (() => {
            const instr = remainingSteps[0].instruction;
            const hasCompass = /\b(north|south|east|west|northeast|northwest|southeast|southwest)\b/i.test(instr);
            return !hasCompass ? (
              <View style={styles.nextStepBadge}>
                <Text style={styles.nextStepText} numberOfLines={1}>{instr}</Text>
              </View>
            ) : null;
          })()}
        </View>
      </SafeAreaView>

      {/* Bottom: examiner bar (tap to speak) + end button */}
      <SafeAreaView style={styles.bottomContainer}>
        {/* Examiner speech bubble — tap to open mic */}
        <TouchableOpacity
          style={[
            styles.examinerBar,
            isListening && styles.examinerBarListening,
            isSpeaking && styles.examinerBarSpeaking,
          ]}
          onPress={tapToSpeak}
          activeOpacity={0.85}
        >
          <View style={styles.examinerLeft}>
            {micState === 'listening' ? (
              <Animated.View style={[styles.micDot, styles.micDotListening, { transform: [{ scale: pulseAnim }] }]} />
            ) : micState === 'speaking' ? (
              <View style={[styles.micDot, styles.micDotSpeaking]} />
            ) : (
              <View style={[styles.micDot, styles.micDotIdle]} />
            )}
          </View>
          <View style={styles.examinerContent}>
            {instructorText ? (
              <Text style={styles.examinerText} numberOfLines={3}>{instructorText}</Text>
            ) : (
              <Text style={styles.examinerHint}>Tap to speak to Sam</Text>
            )}
            {micState === 'listening' && (
              <Text style={styles.listeningLabel}>Listening...</Text>
            )}
          </View>
        </TouchableOpacity>

        <View style={styles.bottomBar}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, styles.statusDotActive]} />
            <Text style={styles.statusText}>Session active</Text>
          </View>
          <TouchableOpacity
            style={[styles.endButton, ending && { opacity: 0.5 }]}
            onPress={handleEndSession}
            disabled={ending}
            activeOpacity={0.8}
          >
            <Text style={styles.endButtonText}>{ending ? 'Ending...' : 'End'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0f1e' },
  map: { flex: 1 },

  loadingContainer: {
    flex: 1, backgroundColor: '#0a0f1e', justifyContent: 'center',
    alignItems: 'center', gap: 16, padding: 32,
  },
  loadingTitle: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  loadingSubtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 15, textAlign: 'center' },
  errorIcon: { fontSize: 48 },
  errorText: { color: '#f87171', fontSize: 16, textAlign: 'center', lineHeight: 24 },
  retryBtn: { backgroundColor: '#16a34a', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14 },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  cancelTextBtn: { paddingVertical: 10 },
  cancelTextBtnText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },

  readyContainer: { flex: 1, backgroundColor: '#0a0f1e' },
  readyOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20 },
  readyCard: {
    backgroundColor: '#131929', borderRadius: 24, padding: 24, gap: 14,
    alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  readyTitle: { color: '#4ade80', fontSize: 18, fontWeight: '700' },
  readyHint: { color: 'rgba(255,255,255,0.55)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  goButton: {
    backgroundColor: '#16a34a', borderRadius: 16, paddingVertical: 16,
    paddingHorizontal: 40, width: '100%', alignItems: 'center',
  },
  goButtonText: { color: '#fff', fontSize: 18, fontWeight: '800' },

  hudContainer: { position: 'absolute', top: 0, left: 0, right: 0 },
  hud: { margin: 16, gap: 10, alignItems: 'center' },
  reroutingBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(250,204,21,0.15)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(250,204,21,0.3)',
  },
  reroutingText: { color: '#facc15', fontSize: 14, fontWeight: '600' },
  nextStepBadge: {
    backgroundColor: 'rgba(10,15,30,0.92)', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', maxWidth: '90%',
  },
  nextStepText: { color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center' },

  bottomContainer: { position: 'absolute', bottom: 0, left: 0, right: 0 },

  examinerBar: {
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: 'rgba(10,15,30,0.95)', borderRadius: 18, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    minHeight: 60,
  },
  examinerBarListening: {
    borderColor: '#f87171',
    backgroundColor: 'rgba(15,5,5,0.97)',
  },
  examinerBarSpeaking: {
    borderColor: 'rgba(74,222,128,0.4)',
  },
  examinerLeft: { width: 16, alignItems: 'center' },
  micDot: { width: 12, height: 12, borderRadius: 6 },
  micDotIdle: { backgroundColor: 'rgba(255,255,255,0.2)' },
  micDotListening: { backgroundColor: '#f87171' },
  micDotSpeaking: { backgroundColor: '#4ade80' },
  examinerContent: { flex: 1 },
  examinerText: { color: '#fff', fontSize: 17, lineHeight: 23, fontWeight: '600' },
  examinerHint: { color: 'rgba(255,255,255,0.3)', fontSize: 14 },
  listeningLabel: { color: '#f87171', fontSize: 12, marginTop: 4, fontWeight: '600' },

  bottomBar: {
    margin: 16, backgroundColor: 'rgba(10,15,30,0.92)', borderRadius: 20,
    paddingHorizontal: 20, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDotActive: { backgroundColor: '#4ade80' },
  statusText: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  endButton: { backgroundColor: '#dc2626', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12 },
  endButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
