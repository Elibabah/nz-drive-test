import { downsamplePolyline, buildOverpassQuery, parseOverpassResponse, fetchRoadData } from '../../services/osmRoadData';
import type { Coordinate } from '../../types';

beforeEach(() => jest.restoreAllMocks());

// ─── downsamplePolyline ───────────────────────────────────────────────────────

describe('downsamplePolyline', () => {
  it('keeps endpoints and drops points closer than the minimum gap', () => {
    // 100 points, ~11 m apart along a meridian (0.0001° lat)
    const points: Coordinate[] = Array.from({ length: 100 }, (_, i) => ({
      latitude: -36.84 - i * 0.0001, longitude: 174.76,
    }));
    const out = downsamplePolyline(points, 50, 80);
    expect(out.length).toBeLessThan(30); // ~11 m spacing → keep ~1 in 5
    expect(out[0]).toEqual(points[0]);
    expect(out[out.length - 1]).toEqual(points[99]);
  });

  it('caps at maxPoints', () => {
    const points: Coordinate[] = Array.from({ length: 500 }, (_, i) => ({
      latitude: -36.84 - i * 0.001, longitude: 174.76, // ~111 m apart, all kept by gap
    }));
    expect(downsamplePolyline(points, 50, 80).length).toBeLessThanOrEqual(81);
  });

  it('returns short polylines untouched', () => {
    const two: Coordinate[] = [
      { latitude: -36.84, longitude: 174.76 },
      { latitude: -36.85, longitude: 174.76 },
    ];
    expect(downsamplePolyline(two)).toEqual(two);
  });
});

// ─── buildOverpassQuery ───────────────────────────────────────────────────────

describe('buildOverpassQuery', () => {
  const corridor: Coordinate[] = [
    { latitude: -36.84, longitude: 174.76 },
    { latitude: -36.85, longitude: 174.77 },
  ];

  it('queries every control-point tag family and maxspeed ways around the corridor', () => {
    const q = buildOverpassQuery(corridor);
    expect(q).toContain('stop|traffic_signals|give_way');
    expect(q).toContain('"railway"="level_crossing"');
    expect(q).toContain('"highway"="crossing"');
    expect(q).toContain('["maxspeed"]');
    expect(q).toContain('around:30,-36.84000,174.76000,-36.85000,174.77000');
    expect(q).toContain('out tags geom');
  });
});

// ─── parseOverpassResponse ────────────────────────────────────────────────────

describe('parseOverpassResponse', () => {
  const fixture = {
    elements: [
      { type: 'node', lat: -36.841, lon: 174.761, tags: { highway: 'stop' } },
      { type: 'node', lat: -36.842, lon: 174.762, tags: { highway: 'traffic_signals' } },
      { type: 'node', lat: -36.843, lon: 174.763, tags: { highway: 'give_way' } },
      { type: 'node', lat: -36.844, lon: 174.764, tags: { railway: 'level_crossing' } },
      { type: 'node', lat: -36.845, lon: 174.765, tags: { highway: 'crossing', crossing: 'zebra' } },
      { type: 'node', lat: -36.846, lon: 174.766, tags: { highway: 'crossing', crossing: 'traffic_signals' } },
      {
        type: 'way', tags: { maxspeed: '60' },
        geometry: [{ lat: -36.84, lon: 174.76 }, { lat: -36.85, lon: 174.76 }],
      },
      {
        type: 'way', tags: { maxspeed: 'NZ:urban' },
        geometry: [{ lat: -36.85, lon: 174.76 }, { lat: -36.86, lon: 174.76 }],
      },
      { type: 'way', tags: { maxspeed: 'walk' }, geometry: [{ lat: -36.8, lon: 174.7 }, { lat: -36.81, lon: 174.7 }] },
    ],
  };

  it('maps every node tag family to its control-point kind', () => {
    const kinds = parseOverpassResponse(fixture).controlPoints.map((c) => c.kind);
    expect(kinds).toEqual([
      'stop_sign', 'traffic_signals', 'give_way', 'railway_crossing',
      'pedestrian_crossing', 'traffic_signals',
    ]);
  });

  it('parses numeric and NZ:urban maxspeeds, skips unparseable ones', () => {
    const zones = parseOverpassResponse(fixture).speedZones;
    expect(zones.map((z) => z.maxspeedKmh)).toEqual([60, 50]);
    expect(zones[0].polyline).toHaveLength(2);
  });

  it('returns empty road data for an empty/malformed response', () => {
    expect(parseOverpassResponse({})).toEqual({ controlPoints: [], speedZones: [] });
    expect(parseOverpassResponse(null)).toEqual({ controlPoints: [], speedZones: [] });
  });
});

// ─── fetchRoadData ────────────────────────────────────────────────────────────

describe('fetchRoadData', () => {
  const route: Coordinate[] = [
    { latitude: -36.84, longitude: 174.76 },
    { latitude: -36.85, longitude: 174.76 },
  ];

  it('POSTs to Overpass and parses the response', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ elements: [{ type: 'node', lat: -36.84, lon: 174.76, tags: { highway: 'stop' } }] }),
    } as Response);
    const rd = await fetchRoadData(route);
    expect(spy).toHaveBeenCalledWith('https://overpass-api.de/api/interpreter', expect.objectContaining({ method: 'POST' }));
    expect(rd.controlPoints).toHaveLength(1);
  });

  it('degrades to empty road data on network failure', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('offline'));
    expect(await fetchRoadData(route)).toEqual({ controlPoints: [], speedZones: [] });
  });

  it('degrades to empty road data on HTTP error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 429 } as Response);
    expect(await fetchRoadData(route)).toEqual({ controlPoints: [], speedZones: [] });
  });
});
