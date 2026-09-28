import { SearchError, errorFromFailure, errorFromStatus } from './errors.js';

const ENDPOINT = 'https://api.openrouteservice.org/v2/matrix/foot-walking';

/** Only the nearest N places are enriched, to stay within the ORS free-tier matrix limit. */
export const WALKING_LIMIT = 50;

/**
 * Returns a copy of `places` with `walkingM` filled in (via the OpenRouteService
 * matrix API) for the nearest WALKING_LIMIT places. Throws SearchError on failure.
 */
export async function addWalkingDistances(
  places,
  { lat, lon, apiKey, fetch: fetchFn = globalThis.fetch, signal, isOffline },
) {
  const targets = [...places].sort((a, b) => a.distanceM - b.distanceM).slice(0, WALKING_LIMIT);
  if (targets.length === 0) return [];

  let res;
  try {
    res = await fetchFn(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
      body: JSON.stringify({
        locations: [[lon, lat], ...targets.map((p) => [p.lon, p.lat])],
        sources: [0],
        destinations: targets.map((_, i) => i + 1),
        metrics: ['distance'],
        units: 'm',
      }),
      signal,
    });
  } catch (cause) {
    throw errorFromFailure(cause, { signal, isOffline });
  }
  if (!res.ok) throw errorFromStatus(res.status, 'OpenRouteService');

  const row = (await res.json().catch(() => null))?.distances?.[0];
  if (!Array.isArray(row)) throw new SearchError('bad-response', 'OpenRouteService: no distances');
  const walking = new Map(targets.map((p, i) => [p.id, row[i] ?? null]));
  return places.map((p) => ({ ...p, walkingM: walking.get(p.id) ?? null }));
}

const byStraight = (a, b) => a.distanceM - b.distanceM;
const byWalking = (a, b) => (a.walkingM ?? Infinity) - (b.walkingM ?? Infinity) || byStraight(a, b);

/** Sorted copy: 'walking' puts places without a walking distance last. */
export function sortPlaces(places, mode) {
  return [...places].sort(mode === 'walking' ? byWalking : byStraight);
}
