import { buildQuery, createCache, fetchOverpass, parseResponse } from '../overpass.js';

/**
 * Default provider: OpenStreetMap data via the public Overpass API.
 * `deps` are forwarded to fetchOverpass (fetch, mirrors, sleep, …).
 */
export function createOverpassProvider({ storage = null, cacheOptions, ...deps } = {}) {
  const cache = createCache(storage, cacheOptions);
  return {
    id: 'overpass',
    label: 'OpenStreetMap (Overpass)',
    async search({ lat, lon, radiusM, categories, signal }) {
      const query = buildQuery({ lat, lon, radiusM, categories });
      let json = cache.get(query);
      if (!json) {
        json = await fetchOverpass(query, { ...deps, signal });
        cache.set(query, json);
      }
      return parseResponse(json, { lat, lon, radiusM, categories });
    },
  };
}
