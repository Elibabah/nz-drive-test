import { Coordinate } from '../types';
import { RoadData, ControlPoint, SpeedZone, EMPTY_ROAD_DATA } from '../engine/roadData';
import { distanceBetween } from '../engine/geo';

// OSM road data along the route corridor (ADR-0004): speed limits, stop
// signs, traffic signals, give-way signs, level crossings, pedestrian
// crossings. Fetched once per route from Overpass; failures degrade to
// EMPTY_ROAD_DATA (the engine falls back to v1 behaviour).

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CORRIDOR_RADIUS_M = 30;

// ─── Corridor construction ────────────────────────────────────────────────────

/**
 * Thin a polyline for the Overpass `around` linestring: keep points at least
 * `minGapM` apart, capped at `maxPoints` (query size limit), always keeping
 * the endpoints.
 */
export function downsamplePolyline(points: Coordinate[], minGapM = 50, maxPoints = 80): Coordinate[] {
  if (points.length <= 2) return points;
  const out: Coordinate[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (distanceBetween(out[out.length - 1], points[i]) >= minGapM) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  if (out.length <= maxPoints) return out;
  // Still too many: uniform stride, endpoints preserved
  const stride = Math.ceil(out.length / maxPoints);
  const thinned = out.filter((_, i) => i % stride === 0);
  if (thinned[thinned.length - 1] !== out[out.length - 1]) thinned.push(out[out.length - 1]);
  return thinned;
}

export function buildOverpassQuery(corridor: Coordinate[]): string {
  const line = corridor.map((c) => `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`).join(',');
  const around = `(around:${CORRIDOR_RADIUS_M},${line})`;
  return `
[out:json][timeout:10];
(
  node${around}["highway"~"^(stop|traffic_signals|give_way)$"];
  node${around}["railway"="level_crossing"];
  node${around}["highway"="crossing"];
  way${around}["maxspeed"];
);
out tags geom;`.trim();
}

// ─── Response parsing ─────────────────────────────────────────────────────────

function parseMaxspeed(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'nz:urban') return 50;
  if (trimmed === 'nz:rural') return 100;
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 && n <= 110 ? n : null;
}

export function parseOverpassResponse(data: any): RoadData {
  const controlPoints: ControlPoint[] = [];
  const speedZones: SpeedZone[] = [];

  for (const el of data?.elements ?? []) {
    const tags = el.tags ?? {};

    if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
      const location = { latitude: el.lat, longitude: el.lon };
      if (tags.highway === 'stop') controlPoints.push({ kind: 'stop_sign', location });
      else if (tags.highway === 'traffic_signals') controlPoints.push({ kind: 'traffic_signals', location });
      else if (tags.highway === 'give_way') controlPoints.push({ kind: 'give_way', location });
      else if (tags.railway === 'level_crossing') controlPoints.push({ kind: 'railway_crossing', location });
      else if (tags.highway === 'crossing') {
        // Signal-controlled crossings behave like traffic lights; zebra/marked
        // crossings demand the give-way slow-down
        const kind = tags.crossing === 'traffic_signals' ? 'traffic_signals' : 'pedestrian_crossing';
        controlPoints.push({ kind, location });
      }
    }

    if (el.type === 'way' && tags.maxspeed && Array.isArray(el.geometry)) {
      const maxspeedKmh = parseMaxspeed(String(tags.maxspeed));
      if (maxspeedKmh !== null && el.geometry.length >= 2) {
        speedZones.push({
          maxspeedKmh,
          polyline: el.geometry.map((g: any) => ({ latitude: g.lat, longitude: g.lon })),
        });
      }
    }
  }

  return { controlPoints, speedZones };
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchRoadData(routePolyline: Coordinate[], timeoutMs = 12_000): Promise<RoadData> {
  if (routePolyline.length < 2) return EMPTY_ROAD_DATA;

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(buildOverpassQuery(downsamplePolyline(routePolyline)))}`,
      signal: controller.signal,
    });
    if (!response.ok) return EMPTY_ROAD_DATA;
    return parseOverpassResponse(await response.json());
  } catch {
    return EMPTY_ROAD_DATA;
  } finally {
    clearTimeout(fetchTimeout);
  }
}
