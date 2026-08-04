import { Coordinate } from '../types';
import { distanceBetween } from '../engine/geo';
import { getDestinationAhead } from './googleDirections';

// Destination validation (ROADMAP MVP-1): a random bearing can drop the
// destination in the sea, on a motorway ramp, or on an unformed paper road —
// Google then routes somewhere silly or fails. One Overpass query checks all
// candidate bearings at once for genuinely drivable urban streets and snaps
// the destination onto the nearest one. Overpass down → caller falls back to
// the unvalidated candidate (pre-MVP-1 behaviour).

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CANDIDATE_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const SNAP_RADIUS_M = 500;

// Urban streets a session can end on. Deliberately excludes motorway/trunk
// (and their links), track (unformed/paper roads), and service ways
// (driveways, parking aisles).
const URBAN_HIGHWAY_REGEX = '^(residential|unclassified|tertiary|secondary|living_street)$';

export function buildDestinationQuery(candidates: Coordinate[]): string {
  const clauses = candidates
    .map((c) => `  way(around:${SNAP_RADIUS_M},${c.latitude.toFixed(5)},${c.longitude.toFixed(5)})["highway"~"${URBAN_HIGHWAY_REGEX}"]["access"!~"private|no"]["surface"!~"unpaved|gravel|dirt|sand|grass"];`)
    .join('\n');
  return `[out:json][timeout:8];\n(\n${clauses}\n);\nout geom 60;`;
}

interface OverpassWay {
  type: string;
  geometry?: { lat: number; lon: number }[];
}

/**
 * Pick a destination among the candidates that actually have an urban street
 * within SNAP_RADIUS_M, snapped onto the nearest street point. `random`
 * injected for deterministic tests.
 */
export function snapToUrbanStreet(
  candidates: Coordinate[],
  ways: OverpassWay[],
  random: () => number = Math.random
): Coordinate | null {
  const streetPoints: Coordinate[] = ways
    .filter((w) => w.type === 'way' && w.geometry)
    .flatMap((w) => w.geometry!.map((g) => ({ latitude: g.lat, longitude: g.lon })));
  if (streetPoints.length === 0) return null;

  const viable = candidates
    .map((candidate) => {
      let nearest: Coordinate | null = null;
      let nearestDist = Infinity;
      for (const p of streetPoints) {
        const d = distanceBetween(candidate, p);
        if (d < nearestDist) { nearestDist = d; nearest = p; }
      }
      return { nearest, nearestDist };
    })
    .filter((v): v is { nearest: Coordinate; nearestDist: number } => v.nearest !== null && v.nearestDist <= SNAP_RADIUS_M);

  if (viable.length === 0) return null;
  return viable[Math.floor(random() * viable.length)].nearest;
}

/**
 * A validated random destination ~`distanceKm` from the origin, or null when
 * no candidate bearing has urban streets nearby / Overpass is unreachable.
 */
export async function pickValidDestination(origin: Coordinate, distanceKm: number): Promise<Coordinate | null> {
  const candidates = CANDIDATE_BEARINGS.map((b) => getDestinationAhead(origin, b, distanceKm));
  try {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(buildDestinationQuery(candidates))}`,
    });
    if (!response.ok) return null;
    const data = await response.json();
    return snapToUrbanStreet(candidates, data.elements ?? []);
  } catch {
    return null;
  }
}
