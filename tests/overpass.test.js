import { describe, expect, it, vi } from 'vitest';
import { CATEGORY_IDS, overpassFilters } from '../src/lib/categories.js';
import { SearchError } from '../src/lib/errors.js';
import {
  DEFAULT_MIRRORS,
  buildQuery,
  createCache,
  fetchOverpass,
  parseResponse,
} from '../src/lib/overpass.js';

const CENTER = { lat: 12.9716, lon: 77.5946 };
const RADII = [500, 1000, 2000, 5000];

/** Every non-empty subset of the category ids. */
function subsets(ids) {
  const out = [];
  for (let mask = 1; mask < 1 << ids.length; mask++) {
    out.push(ids.filter((_, i) => mask & (1 << i)));
  }
  return out;
}

describe('buildQuery', () => {
  const combos = subsets(CATEGORY_IDS);

  it('covers all 63 category combinations', () => {
    expect(combos).toHaveLength(63);
  });

  it.each(RADII)('produces one nwr line per filter for every combination at %d m', (radiusM) => {
    for (const categories of combos) {
      const query = buildQuery({ ...CENTER, radiusM, categories });
      const expected = overpassFilters(categories);
      const lines = query.split('\n').filter((l) => l.trim().startsWith('nwr'));
      expect(lines).toHaveLength(expected.length);
      for (const filter of expected) {
        expect(lines).toContain(`  nwr${filter}(around:${radiusM},12.971600,77.594600);`);
      }
    }
  });

  it('has JSON output, a server timeout and asks for way/relation centres', () => {
    const query = buildQuery({ ...CENTER, radiusM: 1000, categories: ['food'] });
    expect(query).toBe(
      [
        '[out:json][timeout:25];',
        '(',
        '  nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream)$"](around:1000,12.971600,77.594600);',
        ');',
        'out center tags;',
      ].join('\n'),
    );
  });

  it('does not request unselected categories', () => {
    const query = buildQuery({ ...CENTER, radiusM: 500, categories: ['banks'] });
    expect(query).toContain('bank|atm');
    expect(query).not.toContain('restaurant');
    expect(query).not.toContain('"shop"');
  });

  it('rounds the radius and fixes coordinate precision', () => {
    const query = buildQuery({
      lat: -33.8688,
      lon: 151.2093,
      radiusM: 999.6,
      categories: ['malls'],
    });
    expect(query).toContain('(around:1000,-33.868800,151.209300)');
  });

  it('rejects invalid input', () => {
    expect(() => buildQuery({ lat: 100, lon: 0, radiusM: 500, categories: ['food'] })).toThrow();
    expect(() => buildQuery({ ...CENTER, radiusM: 0, categories: ['food'] })).toThrow();
    expect(() => buildQuery({ ...CENTER, radiusM: 500, categories: [] })).toThrow();
  });
});

describe('parseResponse', () => {
  const opts = { ...CENTER, radiusM: 1000, categories: CATEGORY_IDS };

  const node = {
    type: 'node',
    id: 1,
    lat: 12.972,
    lon: 77.595,
    tags: {
      name: 'Corner Mart',
      shop: 'supermarket',
      opening_hours: 'Mo-Su 08:00-22:00',
      phone: '+91 80 1234 5678',
      website: 'https://example.com',
      'addr:housenumber': '12',
      'addr:street': 'MG Road',
      'addr:city': 'Bengaluru',
      'addr:postcode': '560001',
    },
  };
  const way = {
    type: 'way',
    id: 2,
    center: { lat: 12.975, lon: 77.596 },
    tags: { name: 'City Hospital', amenity: 'hospital', 'contact:phone': '108' },
  };
  const relation = {
    type: 'relation',
    id: 3,
    center: { lat: 12.9716, lon: 77.5996 },
    tags: { name: 'Big Mall', shop: 'mall', 'contact:website': 'https://mall.example' },
  };

  it('parses nodes, ways and relations (using centre for the latter)', () => {
    const places = parseResponse({ elements: [way, node, relation] }, opts);
    expect(places.map((p) => p.id)).toEqual(['osm:node/1', 'osm:way/2', 'osm:relation/3']);
    const [mart, hospital, mall] = places;
    expect(mart).toMatchObject({
      name: 'Corner Mart',
      category: 'grocery',
      lat: 12.972,
      lon: 77.595,
    });
    expect(mall).toMatchObject({ category: 'malls', lat: 12.9716, lon: 77.5996 });
    expect(hospital).toMatchObject({ category: 'health', lat: 12.975, lon: 77.596 });
  });

  it('extracts details and a source link', () => {
    const [mart] = parseResponse({ elements: [node] }, opts);
    expect(mart.details).toEqual({
      hours: 'Mo-Su 08:00-22:00',
      phone: '+91 80 1234 5678',
      address: '12 MG Road, Bengaluru 560001',
      website: 'https://example.com',
    });
    expect(mart.sourceUrl).toBe('https://www.openstreetmap.org/node/1');
    expect(mart.walkingM).toBeNull();
    expect(mart.raw).toBe(node.tags);
  });

  it('falls back to contact:* tags and addr:full', () => {
    const [hospital] = parseResponse({ elements: [way] }, opts);
    expect(hospital.details.phone).toBe('108');
    const [mall] = parseResponse({ elements: [relation] }, opts);
    expect(mall.details.website).toBe('https://mall.example');
    const [full] = parseResponse(
      { elements: [{ ...node, tags: { shop: 'bakery', 'addr:full': '1, Main St' } }] },
      opts,
    );
    expect(full.details.address).toBe('1, Main St');
    expect(full.name).toBe('');
  });

  it('omits empty details', () => {
    const [p] = parseResponse(
      { elements: [{ type: 'node', id: 9, lat: 12.9716, lon: 77.5946, tags: { amenity: 'atm' } }] },
      opts,
    );
    expect(p.details).toEqual({});
  });

  it('dedupes repeated elements', () => {
    const places = parseResponse({ elements: [node, node, { ...node }] }, opts);
    expect(places).toHaveLength(1);
  });

  it('keeps same id with different types', () => {
    const places = parseResponse(
      { elements: [node, { ...way, id: 1 }] },
      { ...opts, radiusM: 5000 },
    );
    expect(places).toHaveLength(2);
  });

  it('drops elements without coordinates or a matching category', () => {
    const places = parseResponse(
      {
        elements: [
          { type: 'way', id: 5, tags: { shop: 'mall' } },
          { type: 'node', id: 6, lat: 12.9716, lon: 77.5946, tags: { amenity: 'bench' } },
          { type: 'node', id: 7, lat: 12.9716, lon: 77.5946 },
        ],
      },
      opts,
    );
    expect(places).toEqual([]);
  });

  it('filters out places beyond the radius (the "around" filter is not exact for ways)', () => {
    const far = { type: 'node', id: 8, lat: 12.99, lon: 77.5946, tags: { amenity: 'cafe' } };
    const places = parseResponse({ elements: [far, node] }, opts);
    expect(places.map((p) => p.id)).toEqual(['osm:node/1']);
    expect(places[0].distanceM).toBeGreaterThan(0);
    expect(places[0].distanceM).toBeLessThanOrEqual(1000);
  });

  it('only classifies into selected categories', () => {
    const places = parseResponse(
      { elements: [node, way, relation] },
      { ...opts, categories: ['health'] },
    );
    expect(places.map((p) => p.category)).toEqual(['health']);
  });

  it('sorts by distance, then name', () => {
    const a = {
      type: 'node',
      id: 10,
      lat: 12.9726,
      lon: 77.5946,
      tags: { amenity: 'atm', name: 'B' },
    };
    const b = {
      type: 'node',
      id: 11,
      lat: 12.9726,
      lon: 77.5946,
      tags: { amenity: 'atm', name: 'A' },
    };
    const c = {
      type: 'node',
      id: 12,
      lat: 12.9717,
      lon: 77.5946,
      tags: { amenity: 'atm', name: 'Z' },
    };
    expect(parseResponse({ elements: [a, b, c] }, opts).map((p) => p.name)).toEqual([
      'Z',
      'A',
      'B',
    ]);
  });

  it('tolerates a missing elements array', () => {
    expect(parseResponse({}, opts)).toEqual([]);
    expect(parseResponse(null, opts)).toEqual([]);
  });
});

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const OK = { elements: [{ type: 'node', id: 1 }] };
const noSleep = () => Promise.resolve();

describe('fetchOverpass', () => {
  const mirrors = ['https://a.test/api', 'https://b.test/api', 'https://c.test/api'];

  it('POSTs the query form-encoded to the first mirror', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(OK));
    const data = await fetchOverpass('[out:json];', { fetch, mirrors, sleep: noSleep });
    expect(data).toEqual(OK);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://a.test/api');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init.body).toBe('data=%5Bout%3Ajson%5D%3B');
  });

  it('defaults to the public mirrors', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(OK));
    await fetchOverpass('q', { fetch, sleep: noSleep });
    expect(fetch.mock.calls[0][0]).toBe(DEFAULT_MIRRORS[0]);
    expect(DEFAULT_MIRRORS.length).toBeGreaterThanOrEqual(2);
  });

  it('retries 429 on the same mirror with exponential backoff', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse(OK));
    const sleep = vi.fn(noSleep);
    const data = await fetchOverpass('q', { fetch, mirrors, sleep, retries: 2, backoffMs: 1000 });
    expect(data).toEqual(OK);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([mirrors[0], mirrors[0], mirrors[0]]);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it('retries 504 the same way', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 504))
      .mockResolvedValueOnce(jsonResponse(OK));
    const sleep = vi.fn(noSleep);
    await fetchOverpass('q', { fetch, mirrors, sleep, backoffMs: 500 });
    expect(sleep).toHaveBeenCalledWith(500, undefined);
  });

  it('honours Retry-After (seconds), capped', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '3' }))
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '3600' }))
      .mockResolvedValueOnce(jsonResponse(OK));
    const sleep = vi.fn(noSleep);
    await fetchOverpass('q', { fetch, mirrors, sleep, maxBackoffMs: 10_000 });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([3000, 10_000]);
  });

  it('falls back to the next mirror after exhausting retries', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse(OK));
    const data = await fetchOverpass('q', { fetch, mirrors, sleep: noSleep, retries: 1 });
    expect(data).toEqual(OK);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([mirrors[0], mirrors[0], mirrors[1]]);
  });

  it('moves to the next mirror immediately on other server errors and network failures', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('oops', { status: 502 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(OK));
    const sleep = vi.fn(noSleep);
    const data = await fetchOverpass('q', { fetch, mirrors, sleep });
    expect(data).toEqual(OK);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(mirrors);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('moves on when a mirror returns something that is not JSON', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html>busy</html>', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(OK));
    expect(await fetchOverpass('q', { fetch, mirrors, sleep: noSleep })).toEqual(OK);
  });

  it('treats an Overpass runtime-error remark as a timeout and tries the next mirror', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ elements: [], remark: 'runtime error: Query timed out' })),
      );
    await expect(fetchOverpass('q', { fetch, mirrors, sleep: noSleep })).rejects.toMatchObject({
      kind: 'timeout',
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reports rate-limit when every mirror keeps returning 429', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({}, 429)));
    const err = await fetchOverpass('q', { fetch, mirrors, sleep: noSleep, retries: 1 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(SearchError);
    expect(err.kind).toBe('rate-limit');
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('reports network when every mirror is unreachable', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchOverpass('q', { fetch, mirrors, sleep: noSleep })).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('reports offline without hitting the network when the browser is offline', async () => {
    const fetch = vi.fn();
    await expect(
      fetchOverpass('q', { fetch, mirrors, sleep: noSleep, isOffline: () => true }),
    ).rejects.toMatchObject({ kind: 'offline' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails fast on a 400 (bad query) without trying other mirrors', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('parse error', { status: 400 }));
    await expect(fetchOverpass('q', { fetch, mirrors, sleep: noSleep })).rejects.toMatchObject({
      kind: 'bad-response',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('times out a hung request and tries the next mirror', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn((url, { signal }) =>
        url === mirrors[0]
          ? new Promise((_, reject) =>
              signal.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              ),
            )
          : Promise.resolve(jsonResponse(OK)),
      );
      const promise = fetchOverpass('q', { fetch, mirrors, sleep: noSleep, timeoutMs: 5000 });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await promise).toEqual(OK);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops immediately when the caller aborts', async () => {
    const controller = new AbortController();
    const fetch = vi.fn((_url, { signal }) => {
      controller.abort();
      return Promise.reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
    });
    await expect(
      fetchOverpass('q', { fetch, mirrors, sleep: noSleep, signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn();
    await expect(
      fetchOverpass('q', { fetch, mirrors, signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops retrying when aborted during backoff (real sleep)', async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue(jsonResponse({}, 429));
    const promise = fetchOverpass('q', {
      fetch,
      mirrors,
      signal: controller.signal,
      backoffMs: 60_000,
    });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe('createCache', () => {
  it('returns what was stored until the TTL expires', () => {
    let t = 1000;
    const cache = createCache(memoryStorage(), { ttlMs: 500, now: () => t });
    expect(cache.get('q')).toBeNull();
    cache.set('q', OK);
    expect(cache.get('q')).toEqual(OK);
    t = 1499;
    expect(cache.get('q')).toEqual(OK);
    t = 1501;
    expect(cache.get('q')).toBeNull();
  });

  it('removes expired entries from storage', () => {
    let t = 0;
    const storage = memoryStorage();
    const cache = createCache(storage, { ttlMs: 10, now: () => t });
    cache.set('q', OK);
    const before = storage.map.size;
    t = 100;
    cache.get('q');
    expect(storage.map.size).toBeLessThan(before);
  });

  it('keys entries by query, so different queries do not collide', () => {
    const cache = createCache(memoryStorage());
    cache.set('a', { elements: [1] });
    cache.set('b', { elements: [2] });
    expect(cache.get('a')).toEqual({ elements: [1] });
    expect(cache.get('b')).toEqual({ elements: [2] });
  });

  it('evicts the oldest entries beyond maxEntries', () => {
    let t = 0;
    const cache = createCache(memoryStorage(), { maxEntries: 2, now: () => t++ });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('evicts old entries and retries once when storage is full', () => {
    const storage = memoryStorage();
    const cache = createCache(storage);
    cache.set('old', 1);
    const realSet = storage.setItem;
    let failures = 1;
    storage.setItem = (k, v) => {
      if (failures-- > 0 && k.includes('entry'))
        throw new DOMException('full', 'QuotaExceededError');
      realSet(k, v);
    };
    cache.set('new', 2);
    expect(cache.get('new')).toBe(2);
    expect(cache.get('old')).toBeNull();
  });

  it('never throws when storage is unavailable or corrupt', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const cache = createCache(broken);
    expect(() => cache.set('q', OK)).not.toThrow();
    expect(cache.get('q')).toBeNull();

    const corrupt = memoryStorage();
    const c2 = createCache(corrupt);
    c2.set('q', OK);
    for (const k of corrupt.map.keys()) corrupt.map.set(k, '{not json');
    expect(c2.get('q')).toBeNull();
    expect(() => c2.set('r', OK)).not.toThrow();
  });

  it('works without any storage', () => {
    const cache = createCache(null);
    cache.set('q', OK);
    expect(cache.get('q')).toBeNull();
  });
});
