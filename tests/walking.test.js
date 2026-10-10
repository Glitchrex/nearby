import { describe, expect, it, vi } from 'vitest';
import { WALKING_LIMIT, addWalkingDistances, sortPlaces } from '../src/lib/walking.js';

const json = (body, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const place = (id, distanceM, extra = {}) => ({
  id,
  name: id,
  lat: 12.97 + distanceM / 1e6,
  lon: 77.59,
  distanceM,
  walkingM: null,
  ...extra,
});
const origin = { lat: 12.97, lon: 77.59 };

describe('addWalkingDistances', () => {
  it('sends one source and N destinations as [lon, lat] to the ORS foot-walking matrix', async () => {
    const fetch = vi.fn(() => json({ distances: [[120, 340]] }));
    const places = [place('a', 100), place('b', 300)];
    const out = await addWalkingDistances(places, { ...origin, apiKey: 'ORS', fetch });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.openrouteservice.org/v2/matrix/foot-walking');
    expect(init.headers.Authorization).toBe('ORS');
    expect(JSON.parse(init.body)).toEqual({
      locations: [
        [77.59, 12.97],
        [77.59, places[0].lat],
        [77.59, places[1].lat],
      ],
      sources: [0],
      destinations: [1, 2],
      metrics: ['distance'],
      units: 'm',
    });
    expect(out.map((p) => p.walkingM)).toEqual([120, 340]);
    expect(places[0].walkingM).toBeNull(); // input not mutated
  });

  it(`only enriches the nearest ${WALKING_LIMIT} places`, async () => {
    const places = Array.from({ length: WALKING_LIMIT + 5 }, (_, i) => place(`p${i}`, 1000 - i));
    const fetch = vi.fn((_u, init) => {
      const n = JSON.parse(init.body).destinations.length;
      return json({ distances: [Array.from({ length: n }, () => 1)] });
    });
    const out = await addWalkingDistances(places, { ...origin, apiKey: 'K', fetch });
    expect(out.filter((p) => p.walkingM === 1)).toHaveLength(WALKING_LIMIT);
    const farthest = out.reduce((a, b) => (a.distanceM > b.distanceM ? a : b));
    expect(farthest.walkingM).toBeNull();
  });

  it('keeps null for unroutable destinations', async () => {
    const fetch = vi.fn(() => json({ distances: [[null, 50]] }));
    const out = await addWalkingDistances([place('a', 1), place('b', 2)], {
      ...origin,
      apiKey: 'K',
      fetch,
    });
    expect(out.map((p) => p.walkingM)).toEqual([null, 50]);
  });

  it('skips the request when there is nothing to enrich', async () => {
    const fetch = vi.fn();
    expect(await addWalkingDistances([], { ...origin, apiKey: 'K', fetch })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limit'],
    [500, 'server'],
  ])('throws a %d as %s so the UI can fall back to straight-line', async (status, kind) => {
    const fetch = vi.fn(() => json({ error: 'x' }, status));
    await expect(
      addWalkingDistances([place('a', 1)], { ...origin, apiKey: 'K', fetch }),
    ).rejects.toMatchObject({ kind });
  });

  it('rejects a malformed response', async () => {
    const fetch = vi.fn(() => json({ nope: true }));
    await expect(
      addWalkingDistances([place('a', 1)], { ...origin, apiKey: 'K', fetch }),
    ).rejects.toMatchObject({ kind: 'bad-response' });
  });

  it('maps network failures', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(
      addWalkingDistances([place('a', 1)], {
        ...origin,
        apiKey: 'K',
        fetch,
        isOffline: () => false,
      }),
    ).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('sortPlaces', () => {
  const places = [
    place('far-walk', 100, { walkingM: 900 }),
    place('no-walk-near', 50),
    place('near-walk', 300, { walkingM: 350 }),
    place('no-walk-far', 400),
  ];

  it('sorts by straight-line distance', () => {
    expect(sortPlaces(places, 'straight').map((p) => p.id)).toEqual([
      'no-walk-near',
      'far-walk',
      'near-walk',
      'no-walk-far',
    ]);
  });

  it('sorts by walking distance with unknown ones last (by straight-line)', () => {
    expect(sortPlaces(places, 'walking').map((p) => p.id)).toEqual([
      'near-walk',
      'far-walk',
      'no-walk-near',
      'no-walk-far',
    ]);
  });

  it('does not mutate its input', () => {
    const copy = [...places];
    sortPlaces(places, 'walking');
    expect(places).toEqual(copy);
  });
});
