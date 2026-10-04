import { classify, overpassFilters } from './categories.js';
import { SearchError, isAbortError } from './errors.js';
import { haversine, isValidLatLon } from './geo.js';

export const DEFAULT_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const SERVER_TIMEOUT_S = 25;

/** Overpass QL for every selected category within `radiusM` of the point. */
export function buildQuery({ lat, lon, radiusM, categories }) {
  if (!isValidLatLon(lat, lon)) throw new RangeError('Invalid coordinates');
  if (!(radiusM > 0)) throw new RangeError('Radius must be positive');
  const filters = overpassFilters(categories);
  if (filters.length === 0) throw new RangeError('Select at least one category');
  const around = `(around:${Math.round(radiusM)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  return [
    `[out:json][timeout:${SERVER_TIMEOUT_S}];`,
    '(',
    ...filters.map((f) => `  nwr${f}${around};`),
    ');',
    'out center tags;',
  ].join('\n');
}

function formatAddress(tags) {
  if (tags['addr:full']) return tags['addr:full'];
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const locality = [tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(' ');
  return [street, locality].filter(Boolean).join(', ');
}

function extractDetails(tags) {
  const details = {
    hours: tags.opening_hours,
    phone: tags.phone || tags['contact:phone'],
    address: formatAddress(tags),
    website: tags.website || tags['contact:website'] || tags.url,
  };
  return Object.fromEntries(Object.entries(details).filter(([, v]) => v));
}

const coordsOf = (el) =>
  typeof el.lat === 'number' ? { lat: el.lat, lon: el.lon } : (el.center ?? null);

const byDistanceThenName = (a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name);

/** Overpass JSON → Place[] inside the radius, deduped and sorted by distance. */
export function parseResponse(json, { lat, lon, radiusM, categories }) {
  const seen = new Set();
  const places = [];
  for (const el of json?.elements ?? []) {
    const key = `${el.type}/${el.id}`;
    const coords = coordsOf(el);
    if (seen.has(key) || !coords) continue;
    const category = classify(el.tags, categories);
    if (!category) continue;
    const distanceM = haversine(lat, lon, coords.lat, coords.lon);
    if (distanceM > radiusM) continue;
    seen.add(key);
    places.push({
      id: `osm:${key}`,
      name: el.tags.name ?? '',
      category,
      lat: coords.lat,
      lon: coords.lon,
      distanceM,
      walkingM: null,
      details: extractDetails(el.tags),
      sourceUrl: `https://www.openstreetmap.org/${key}`,
      raw: el.tags,
    });
  }
  return places.sort(byDistanceThenName);
}

/** setTimeout as a promise that rejects with an AbortError when `signal` aborts. */
export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const RETRYABLE = { 429: 'rate-limit', 504: 'timeout' };

function retryDelay(res, attempt, backoffMs, maxBackoffMs) {
  const header = Number(res.headers.get('retry-after'));
  const ms = header > 0 ? header * 1000 : backoffMs * 2 ** attempt;
  return Math.min(ms, maxBackoffMs);
}

/** One HTTP attempt with its own timeout, linked to the caller's signal. */
async function attempt(fetchFn, url, query, signal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    return await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function readJson(res) {
  let json;
  try {
    json = await res.json();
  } catch (cause) {
    throw new SearchError('bad-response', 'Overpass returned invalid JSON', { cause });
  }
  if (/runtime error/i.test(json.remark ?? '')) {
    throw new SearchError('timeout', `Overpass: ${json.remark}`);
  }
  return json;
}

/**
 * POST a query to Overpass, retrying 429/504 with exponential backoff (or
 * Retry-After) and falling back through mirrors. Throws SearchError.
 */
export async function fetchOverpass(
  query,
  {
    fetch: fetchFn = globalThis.fetch,
    mirrors = DEFAULT_MIRRORS,
    signal,
    timeoutMs = 30_000,
    retries = 2,
    backoffMs = 1000,
    maxBackoffMs = 15_000,
    sleep = abortableSleep,
    isOffline = () => globalThis.navigator?.onLine === false,
  } = {},
) {
  const aborted = () => new SearchError('aborted', 'Search cancelled');
  if (signal?.aborted) throw aborted();
  if (isOffline()) throw new SearchError('offline', 'Browser is offline');

  let lastError;
  for (const url of mirrors) {
    for (let n = 0; n <= retries; n++) {
      let res;
      try {
        res = await attempt(fetchFn, url, query, signal, timeoutMs);
      } catch (cause) {
        if (signal?.aborted) throw aborted();
        if (isOffline()) throw new SearchError('offline', 'Browser is offline', { cause });
        const kind = isAbortError(cause) ? 'timeout' : 'network';
        lastError = new SearchError(kind, `${url}: ${cause.message}`, { cause });
        break;
      }

      const retryKind = RETRYABLE[res.status];
      if (retryKind) {
        lastError = new SearchError(retryKind, `${url}: HTTP ${res.status}`, {
          status: res.status,
        });
        if (n === retries) break;
        try {
          await sleep(retryDelay(res, n, backoffMs, maxBackoffMs), signal);
        } catch {
          throw aborted();
        }
        continue;
      }
      if (res.status === 400) {
        throw new SearchError('bad-response', `${url}: HTTP 400 (invalid query)`, { status: 400 });
      }
      if (!res.ok) {
        lastError = new SearchError('server', `${url}: HTTP ${res.status}`, { status: res.status });
        break;
      }
      try {
        return await readJson(res);
      } catch (err) {
        if (signal?.aborted) throw aborted();
        lastError = err;
        break;
      }
    }
  }
  throw lastError;
}

/** 32-bit FNV-1a hash as hex; keeps storage keys short. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Small TTL + LRU cache of Overpass responses in Web Storage. Every storage
 * failure (disabled, full, corrupt) degrades to a cache miss, never an error.
 */
export function createCache(
  storage,
  { ttlMs = 10 * 60_000, maxEntries = 20, prefix = 'nearby.cache.', now = Date.now } = {},
) {
  const indexKey = `${prefix}index`;
  const entryKey = (query) => `${prefix}entry.${hash(query)}`;

  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  const readIndex = () => {
    const list = safe(() => JSON.parse(storage.getItem(indexKey)), null);
    return Array.isArray(list) ? list : [];
  };
  const writeIndex = (list) => safe(() => storage.setItem(indexKey, JSON.stringify(list)));
  const remove = (key) => {
    safe(() => storage.removeItem(key));
    writeIndex(readIndex().filter((e) => e.key !== key));
  };

  function get(query) {
    if (!storage) return null;
    const key = entryKey(query);
    const entry = safe(() => JSON.parse(storage.getItem(key)), null);
    if (!entry || entry.query !== query) return null;
    if (now() - entry.time > ttlMs) {
      remove(key);
      return null;
    }
    return entry.data;
  }

  function set(query, data) {
    if (!storage) return;
    const key = entryKey(query);
    const time = now();
    const value = JSON.stringify({ query, time, data });
    const write = () => {
      storage.setItem(key, value);
      return true;
    };
    let ok = safe(write, false);
    if (!ok) {
      // Probably over quota: drop every other cached response and retry once.
      for (const e of readIndex()) if (e.key !== key) remove(e.key);
      ok = safe(write, false);
    }
    if (!ok) return;
    const index = readIndex().filter((e) => e.key !== key);
    index.push({ key, time });
    while (index.length > maxEntries) safe(() => storage.removeItem(index.shift().key));
    writeIndex(index);
  }

  return { get, set };
}
