import { Coordinate, RouteStep } from '../types';

const DIRECTIONS_API = 'https://maps.googleapis.com/maps/api/directions/json';

export interface DirectionsResult {
  steps: RouteStep[];
  polylineCoordinates: Coordinate[];
  totalDistance: number;
  totalDuration: number;
  startAddress: string;
  endAddress: string;
}

function decodePolyline(encoded: string): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function parseDirectionsResponse(data: any): DirectionsResult {
  const route = data.routes[0];
  const leg = route.legs[0];

  const steps: RouteStep[] = leg.steps.map((step: any) => ({
    instruction: stripHtml(step.html_instructions),
    distance: step.distance.value,
    duration: step.duration.value,
    startLocation: { latitude: step.start_location.lat, longitude: step.start_location.lng },
    endLocation: { latitude: step.end_location.lat, longitude: step.end_location.lng },
    maneuver: step.maneuver ?? 'straight',
  }));

  return {
    steps,
    polylineCoordinates: decodePolyline(route.overview_polyline.points),
    totalDistance: leg.distance.value,
    totalDuration: leg.duration.value,
    startAddress: leg.start_address,
    endAddress: leg.end_address,
  };
}

// Pick a point N km ahead in a given compass bearing — no API call
export function getDestinationAhead(origin: Coordinate, bearingDeg: number, distanceKm: number): Coordinate {
  const R = 6371;
  const d = distanceKm / R;
  const lat1 = (origin.latitude * Math.PI) / 180;
  const lng1 = (origin.longitude * Math.PI) / 180;
  const brng = (bearingDeg * Math.PI) / 180;

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return { latitude: (lat2 * 180) / Math.PI, longitude: (lng2 * 180) / Math.PI };
}

// Fetch initial route at session start
export async function getRoute(origin: Coordinate, destination: Coordinate, apiKey: string): Promise<DirectionsResult> {
  const params = new URLSearchParams({
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    mode: 'driving',
    avoid: 'highways',
    key: apiKey,
    region: 'nz',
    language: 'en',
  });

  const response = await fetch(`${DIRECTIONS_API}?${params}`);
  const data = await response.json();

  if (data.status !== 'OK' || !data.routes?.length) {
    throw new Error(`Directions API error: ${data.status}`);
  }

  return parseDirectionsResponse(data);
}

// Re-fetch route mid-session from current position (same destination, fresh steps)
export async function rerouteFromPosition(
  origin: Coordinate,
  destination: Coordinate,
  apiKey: string
): Promise<DirectionsResult> {
  return getRoute(origin, destination, apiKey);
}

export function formatDistance(meters: number): string {
  if (meters < 100) return 'immediately';
  if (meters < 1000) return `${Math.round(meters / 50) * 50} metres`;
  return `${(meters / 1000).toFixed(1)} kilometres`;
}

export function distanceBetween(a: Coordinate, b: Coordinate): number {
  const R = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
