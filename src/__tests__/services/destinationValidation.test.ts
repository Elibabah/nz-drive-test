import { buildDestinationQuery, snapToUrbanStreet } from '../../services/destinationValidation';

const AKL = { latitude: -36.8485, longitude: 174.7633 };
const SEA = { latitude: -36.8, longitude: 174.9 };   // out in the Hauraki Gulf
const INLAND = { latitude: -36.9, longitude: 174.75 };

const way = (points: [number, number][]) => ({
  type: 'way',
  geometry: points.map(([lat, lon]) => ({ lat, lon })),
});

describe('buildDestinationQuery', () => {
  it('emits one around-clause per candidate, restricted to urban drivable streets', () => {
    const q = buildDestinationQuery([AKL, SEA]);
    expect(q.match(/way\(around:/g)).toHaveLength(2);
    expect(q).toContain('residential');
    expect(q).not.toContain('motorway');
    expect(q).toContain('"access"!~"private|no"');
    expect(q).toContain('out geom');
  });
});

describe('snapToUrbanStreet', () => {
  it('returns null when no streets came back (all candidates in the sea)', () => {
    expect(snapToUrbanStreet([SEA], [])).toBeNull();
  });

  it('snaps onto the nearest street point of a viable candidate', () => {
    const street = way([
      [INLAND.latitude + 0.001, INLAND.longitude],       // ~111 m from INLAND
      [INLAND.latitude + 0.003, INLAND.longitude],       // ~333 m
    ]);
    const snapped = snapToUrbanStreet([INLAND], [street], () => 0);
    expect(snapped).toEqual({ latitude: INLAND.latitude + 0.001, longitude: INLAND.longitude });
  });

  it('ignores candidates whose nearest street is beyond the snap radius', () => {
    const farStreet = way([[INLAND.latitude + 0.01, INLAND.longitude]]); // ~1.1 km
    expect(snapToUrbanStreet([INLAND], [farStreet])).toBeNull();
  });

  it('picks only among viable candidates: the sea bearing never wins', () => {
    const inlandStreet = way([[INLAND.latitude + 0.001, INLAND.longitude]]);
    // random () => 0.99 — still lands on the single viable (inland) candidate
    const snapped = snapToUrbanStreet([SEA, INLAND], [inlandStreet], () => 0.99);
    expect(snapped).toEqual({ latitude: INLAND.latitude + 0.001, longitude: INLAND.longitude });
  });

  it('skips elements without geometry', () => {
    expect(snapToUrbanStreet([INLAND], [{ type: 'way' }])).toBeNull();
  });
});
