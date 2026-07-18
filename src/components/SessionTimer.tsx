import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  remainingMs: number;
}

export function SessionTimer({ remainingMs }: Props) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const progress = remainingMs / (20 * 60 * 1000);
  const isUrgent = remainingMs < 3 * 60 * 1000;

  return (
    <View style={styles.container}>
      <Text style={[styles.timer, isUrgent && styles.timerUrgent]}>
        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </Text>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressBar,
            { width: `${Math.round(progress * 100)}%` },
            isUrgent && styles.progressBarUrgent,
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 6,
  },
  timer: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
  timerUrgent: {
    color: '#ff6b6b',
  },
  progressTrack: {
    width: 160,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#4ade80',
    borderRadius: 2,
  },
  progressBarUrgent: {
    backgroundColor: '#ff6b6b',
  },
});
