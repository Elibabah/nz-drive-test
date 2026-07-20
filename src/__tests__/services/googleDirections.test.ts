import { distanceBetween, distanceToPolyline, formatDistance, getDestinationAhead } from '../../services/googleDirections';
import type { Coordinate } from '../../types';

// Auckland reference coordinates (WGS84)
const CBD: Coordinate = { latitude: -36.8485, longitude: 174.7633 };
const ONE_TREE_HILL: Coordinate = { latitude: -36.8789, longitude: 174.7785 };
const BRITOMART: Coordinate = { latitude: -36.8445, longitude: 174.7677 };

// ─── distanceToPolyline ───────────────────────────────────────────────────────

describe('distanceToPolyline', () => {
  // ~1 km straight step heading south along a meridian (0.009° lat ≈ 1000 m)
  const KM_STEP_START: Coordinate = { latitude: -36.8400, longitude: 174.7600 };
  const KM_STEP_END: Coordinate = { latitude: -36.8490, longitude: 174.7600 };
  const KM_STEP = [KM_STEP_START, KM_STEP_END];

  it('midpoint of a 1 km straight step is ON the line (~0 m) — the old endpoint check called this off-route', () => {
    const midpoint: Coordinate = { latitude: -36.8445, longitude: 174.7600 };
    // Sanity: midpoint really is ~500 m from BOTH endpoints (> 300 m threshold)
    expect(distanceBetween(midpoint, KM_STEP_START)).toBeGreaterThan(300);
    expect(distanceBetween(midpoint, KM_STEP_END)).toBeGreaterThan(300);
    // But its distance to the step geometry is ~0
    expect(distanceToPolyline(midpoint, KM_STEP)).toBeLessThan(5);
  });

  it('point ~200 m beside the line returns ~200 m (within 5%)', () => {
    // 0.00225° of longitude at -36.84° ≈ 200 m
    const beside: Coordinate = { latitude: -36.8445, longitude: 174.76225 };
    const d = distanceToPolyline(beside, KM_STEP);
    expect(d).toBeGreaterThan(190);
    expect(d).toBeLessThan(210);
  });

  it('point past the segment end measures to the endpoint, not the infinite line', () => {
    const past: Coordinate = { latitude: -36.8535, longitude: 174.7600 }; // ~500 m beyond end
    const d = distanceToPolyline(past, KM_STEP);
    expect(d).toBeGreaterThan(450);
    expect(d).toBeLessThan(550);
  });

  it('multi-segment polyline uses the nearest segment', () => {
    // L-shaped path: south 1 km, then east 1 km
    const corner = KM_STEP_END;
    const eastEnd: Coordinate = { latitude: -36.8490, longitude: 174.7712 };
    const path = [KM_STEP_START, corner, eastEnd];
    const nearEastLeg: Coordinate = { latitude: -36.8492, longitude: 174.7650 };
    expect(distanceToPolyline(nearEastLeg, path)).toBeLessThan(30);
  });

  it('empty polyline returns Infinity; single point measures point distance', () => {
    expect(distanceToPolyline(CBD, [])).toBe(Infinity);
    const d = distanceToPolyline(CBD, [BRITOMART]);
    expect(d).toBeGreaterThan(530);
    expect(d).toBeLessThan(650);
  });
});

// ─── distanceBetween ──────────────────────────────────────────────────────────

describe('distanceBetween', () => {
  it('returns 0 for identical coordinates', () => {
    expect(distanceBetween(CBD, CBD)).toBe(0);
  });

  it('Auckland CBD to One Tree Hill ~3600 m (±150 m)', () => {
    const d = distanceBetween(CBD, ONE_TREE_HILL);
    expect(d).toBeGreaterThan(3450);
    expect(d).toBeLessThan(3750);
  });

  it('Auckland CBD to Britomart ~590 m (±60 m)', () => {
    const d = distanceBetween(CBD, BRITOMART);
    expect(d).toBeGreaterThan(530);
    expect(d).toBeLessThan(650);
  });

  it('is symmetric (a→b equals b→a)', () => {
    const ab = distanceBetween(CBD, ONE_TREE_HILL);
    const ba = distanceBetween(ONE_TREE_HILL, CBD);
    expect(Math.abs(ab - ba)).toBeLessThan(0.001);
  });

  it('one degree of latitude apart returns ~111 km (±2 km)', () => {
    const a = { latitude: -36.0, longitude: 174.0 };
    const b = { latitude: -37.0, longitude: 174.0 };
    const d = distanceBetween(a, b);
    expect(d).toBeGreaterThan(109_000);
    expect(d).toBeLessThan(113_000);
  });

  it('always returns a positive value', () => {
    expect(distanceBetween({ latitude: -37, longitude: 175 }, { latitude: -36, longitude: 174 })).toBeGreaterThan(0);
  });
});

// ─── formatDistance ───────────────────────────────────────────────────────────

describe('formatDistance', () => {
  it('0 m → "immediately"', () => {
    expect(formatDistance(0)).toBe('immediately');
  });

  it('50 m → "immediately" (below 100 threshold)', () => {
    expect(formatDistance(50)).toBe('immediately');
  });

  it('99 m → "immediately"', () => {
    expect(formatDistance(99)).toBe('immediately');
  });

  it('100 m → "100 metres"', () => {
    expect(formatDistance(100)).toBe('100 metres');
  });

  it('125 m rounds to 150 → "150 metres"', () => {
    expect(formatDistance(125)).toBe('150 metres');
  });

  it('174 m rounds to 150 → "150 metres"', () => {
    expect(formatDistance(174)).toBe('150 metres');
  });

  it('175 m rounds to 200 → "200 metres"', () => {
    expect(formatDistance(175)).toBe('200 metres');
  });

  // Edge case: Math.round(999/50)*50 = 1000, but 999 < 1000 so stays in metres branch
  it('999 m → "1000 metres" (rounds up, stays in metres branch)', () => {
    expect(formatDistance(999)).toBe('1000 metres');
  });

  it('1000 m switches to kilometres → "1.0 kilometres"', () => {
    expect(formatDistance(1000)).toBe('1.0 kilometres');
  });

  it('1500 m → "1.5 kilometres"', () => {
    expect(formatDistance(1500)).toBe('1.5 kilometres');
  });

  it('10000 m → "10.0 kilometres"', () => {
    expect(formatDistance(10000)).toBe('10.0 kilometres');
  });
});

// ─── getDestinationAhead ──────────────────────────────────────────────────────

describe('getDestinationAhead', () => {
  it('heading north 1 km — latitude increases ~0.009 degrees', () => {
    const result = getDestinationAhead(CBD, 0, 1);
    expect(result.latitude).toBeGreaterThan(CBD.latitude);
    expect(result.latitude).toBeCloseTo(CBD.latitude + 0.009, 2);
    expect(result.longitude).toBeCloseTo(CBD.longitude, 3);
  });

  it('heading east 1 km — longitude increases, latitude stays roughly same', () => {
    const result = getDestinationAhead(CBD, 90, 1);
    expect(result.longitude).toBeGreaterThan(CBD.longitude);
    expect(result.latitude).toBeCloseTo(CBD.latitude, 2);
  });

  it('heading south 5 km — latitude decreases ~0.045 degrees', () => {
    const result = getDestinationAhead(CBD, 180, 5);
    expect(result.latitude).toBeLessThan(CBD.latitude);
    expect(result.latitude).toBeCloseTo(CBD.latitude - 0.045, 2);
  });

  it('0 km distance returns origin unchanged', () => {
    const result = getDestinationAhead(CBD, 45, 0);
    expect(result.latitude).toBeCloseTo(CBD.latitude, 5);
    expect(result.longitude).toBeCloseTo(CBD.longitude, 5);
  });

  it('round-trip north 10 km then south 10 km returns close to origin', () => {
    const north = getDestinationAhead(CBD, 0, 10);
    const back = getDestinationAhead(north, 180, 10);
    expect(back.latitude).toBeCloseTo(CBD.latitude, 3);
    expect(back.longitude).toBeCloseTo(CBD.longitude, 3);
  });
});
