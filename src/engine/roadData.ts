import { Coordinate } from '../types';
import { distanceToPolyline } from './geo';

// Real road data (ADR-0004): typed control points + speed zones fetched from
// OSM along the route corridor. The engine consumes these by GPS proximity —
// replacing the v1 instruction-text sniffing that never matched anything.

export type ControlPointKind =
  | 'stop_sign'
  | 'traffic_signals'
  | 'give_way'
  | 'railway_crossing'
  | 'pedestrian_crossing';

export interface ControlPoint {
  kind: ControlPointKind;
  location: Coordinate;
}

export interface SpeedZone {
  maxspeedKmh: number;
  /** Geometry of the OSM way this limit applies to */
  polyline: Coordinate[];
}

export interface RoadData {
  controlPoints: ControlPoint[];
  speedZones: SpeedZone[];
}

export const EMPTY_ROAD_DATA: RoadData = { controlPoints: [], speedZones: [] };

/** Max distance (m) from a way's geometry for its speed limit to apply. */
const SPEED_ZONE_MATCH_M = 25;

/**
 * The speed limit at a position: the limit of the nearest speed-zone way
 * within 25 m, or the fallback when no zone matches (no data / off corridor).
 */
export function speedLimitAt(roadData: RoadData, coord: Coordinate, fallbackKmh: number): number {
  let best: number | null = null;
  let bestDist = SPEED_ZONE_MATCH_M;
  for (const zone of roadData.speedZones) {
    const d = distanceToPolyline(coord, zone.polyline);
    if (d < bestDist) {
      bestDist = d;
      best = zone.maxspeedKmh;
    }
  }
  return best ?? fallbackKmh;
}
