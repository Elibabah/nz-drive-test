import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
} from 'react-native';

interface Props {
  prompt: string | null;
  isListening: boolean;
  questionType?: 'hazard' | 'knowledge' | 'decision';
  onManualDismiss?: () => void;
}

const BADGE_LABELS: Record<string, string> = {
  hazard: 'HAZARD CHECK',
  knowledge: 'KNOWLEDGE CHECK',
  decision: 'EXAMINER QUESTION',
};

export function HazardPromptOverlay({ prompt, isListening, questionType = 'hazard', onManualDismiss }: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (prompt) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [prompt]);

  useEffect(() => {
    if (!isListening) {
      pulseAnim.setValue(1);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [isListening]);

  if (!prompt) return null;

  return (
    <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.label}>{BADGE_LABELS[questionType] ?? 'HAZARD CHECK'}</Text>
        </View>

        <Text style={styles.prompt}>{prompt}</Text>

        {isListening && (
          <View style={styles.listeningRow}>
            <Animated.View
              style={[styles.micDot, { transform: [{ scale: pulseAnim }] }]}
            />
            <Text style={styles.listeningText}>Listening... speak now</Text>
          </View>
        )}

        {!isListening && onManualDismiss && (
          <TouchableOpacity style={styles.dismissBtn} onPress={onManualDismiss}>
            <Text style={styles.dismissText}>Skip (voice not available)</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 100,
  },
  card: {
    backgroundColor: '#1a2035',
    borderRadius: 20,
    padding: 28,
    marginHorizontal: 24,
    borderWidth: 2,
    borderColor: '#f59e0b',
    gap: 20,
    alignItems: 'center',
  },
  header: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  label: {
    color: '#000',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 1.5,
  },
  prompt: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 28,
  },
  listeningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  micDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#f87171',
  },
  listeningText: {
    color: '#f87171',
    fontSize: 14,
    fontWeight: '600',
  },
  dismissBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  dismissText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
  },
});
