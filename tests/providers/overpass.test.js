import { describe, expect, it, vi } from 'vitest';
import { createOverpassProvider } from '../../src/lib/providers/overpass.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const BODY = {
  elements: [
    { type: 'node', id: 1, lat: 12.9717, lon: 77.5946, tags: { amenity: 'atm', name: 'ATM' } },
    { type: 'node', id: 2, lat: 12.9718, lon: 77.5946, tags: { amenity: 'cafe', name: 'Cafe' } },
  ],
};
const respond = () => Promise.resolve(new Response(JSON.stringify(BODY), { status: 200 }));
const params = { lat: 12.9716, lon: 77.5946, radiusM: 500, categories: ['banks'] };

describe('overpass provider', () => {
  it('implements the provider interface and returns Place[] for selected categories', async () => {
    const fetch = vi.fn(respond);
    const provider = createOverpassProvider({ fetch });
    expect(provider.id).toBe('overpass');
    expect(typeof provider.label).toBe('string');
    const places = await provider.search(params);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ id: 'osm:node/1', category: 'banks', name: 'ATM' });
  });

  it('serves repeated searches from the cache', async () => {
    const fetch = vi.fn(respond);
    const provider = createOverpassProvider({ fetch, storage: memoryStorage() });
    await provider.search(params);
    const again = await provider.search(params);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(again).toHaveLength(1);
    await provider.search({ ...params, radiusM: 1000 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('passes the abort signal through', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(respond);
    await createOverpassProvider({ fetch }).search({ ...params, signal: controller.signal });
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    controller.abort();
    await expect(
      createOverpassProvider({ fetch }).search({ ...params, signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});
