import { DrivingSession, NZTAError, NZTAVerdict } from '../types';

// PASS/FAIL per the official NZTA Full Licence assessment (ADR-0005).
// Fail = any immediate-fail error, or more than one critical error.
// Event → category mapping and sources: docs/nzta-error-mapping.md.
// The verdict only claims what the app can observe — everything else is
// listed in notAssessed so the user never mistakes this for a full test.

const ASSESSED = [
  'Speed limit compliance (OSM speed zones, GPS speed)',
  'Complete stops at stop signs and railway crossings',
  'Giving way at pedestrian crossings',
  'Following directions, with justified deviations excused',
];

const NOT_ASSESSED = [
  'Mirror, blind-spot and head checks',
  'Indicator use and signal timing',
  'Lane position and following distance',
  'Vehicle control (stalling, kerb contact)',
  'Give-way compliance at uncontrolled intersections',
];

export function computeVerdict(session: DrivingSession): NZTAVerdict {
  const immediateFailErrors: NZTAError[] = [];
  const criticalErrors: NZTAError[] = [];

  for (const v of session.speedViolations) {
    if (v.severity === 'immediate_fail') {
      immediateFailErrors.push({
        category: 'excessive_speed',
        kind: 'immediate_fail',
        description: `${v.speedKmh} km/h in a ${v.limitKmh} km/h zone${v.durationSeconds >= 5 ? ` for ${v.durationSeconds} s` : ''}`,
        timestamp: v.timestamp,
      });
    } else {
      criticalErrors.push({
        category: 'too_fast',
        kind: 'critical',
        description: `Briefly ${v.speedKmh} km/h in a ${v.limitKmh} km/h zone`,
        timestamp: v.timestamp,
      });
    }
  }

  for (const e of session.stopEvents) {
    if (e.complied) continue;
    if (e.type === 'pedestrian_crossing') {
      immediateFailErrors.push({
        category: 'failure_to_give_way',
        kind: 'immediate_fail',
        description: `Did not give way at a pedestrian crossing (lowest speed ${e.lowestSpeedKmh} km/h)`,
        timestamp: e.timestamp,
      });
    } else {
      immediateFailErrors.push({
        category: 'failure_to_stop',
        kind: 'immediate_fail',
        description: `No complete stop at a ${e.type === 'stop_sign' ? 'stop sign' : 'railway crossing'} (lowest speed ${e.lowestSpeedKmh} km/h)`,
        timestamp: e.timestamp,
      });
    }
  }

  // Navigation events are deliberately absent: getting lost is not an error
  // on the real test, and justified deviations are already excused upstream.

  return {
    result: immediateFailErrors.length > 0 || criticalErrors.length > 1 ? 'fail' : 'pass',
    immediateFailErrors,
    criticalErrors,
    assessed: ASSESSED,
    notAssessed: NOT_ASSESSED,
  };
}
