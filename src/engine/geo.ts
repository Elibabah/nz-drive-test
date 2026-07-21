import { Coordinate } from '../types';

// Pure geodesic math. Engine-owned so the exam core has zero service deps;
// services/googleDirections re-exports these for external callers.

export function distanceBetween(a: Coordinate, b: Coordinate): number {
  const R = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Minimum distance in metres from a point to a polyline (sequence of segments).
 * Uses an equirectangular projection around the point — accurate to well under
 * 1% at urban scales, which is plenty for a 300 m off-route threshold.
 */
export function distanceToPolyline(point: Coordinate, polyline: Coordinate[]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return distanceBetween(point, polyline[0]);

  const R = 6371000;
  const latRad = (point.latitude * Math.PI) / 180;
  const mPerDegLat = (Math.PI / 180) * R;
  const mPerDegLng = mPerDegLat * Math.cos(latRad);

  // Project everything to local metres relative to `point`
  const toXY = (c: Coordinate) => ({
    x: (c.longitude - point.longitude) * mPerDegLng,
    y: (c.latitude - point.latitude) * mPerDegLat,
  });

  let min = Infinity;
  let prev = toXY(polyline[0]);
  for (let i = 1; i < polyline.length; i++) {
    const curr = toXY(polyline[i]);
    // Distance from origin (the point) to segment prev→curr
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(prev.x * dx + prev.y * dy) / lengthSq));
    const px = prev.x + t * dx;
    const py = prev.y + t * dy;
    min = Math.min(min, Math.hypot(px, py));
    prev = curr;
  }
  return min;
}
