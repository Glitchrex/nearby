import { CATEGORIES } from '../categories.js';
import { SearchError, errorFromFailure, errorFromStatus } from '../errors.js';
import { haversine } from '../geo.js';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
const MAX_RESULTS = 20; // Places API (New) hard limit per request

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.types',
  'places.formattedAddress',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.googleMapsUri',
].join(',');

/** Our categories → Google Places (New) "Table A" place types. */
export const GOOGLE_TYPES = {
  grocery: ['grocery_store', 'supermarket', 'convenience_store', 'bakery'],
  malls: ['shopping_mall', 'department_store'],
  health: ['hospital', 'pharmacy', 'drugstore', 'doctor', 'dentist'],
  food: ['restaurant', 'cafe', 'fast_food_restaurant', 'meal_takeaway'],
  banks: ['bank', 'atm'],
  other: [
    'book_store',
    'clothing_store',
    'electronics_store',
    'furniture_store',
    'hardware_store',
    'home_goods_store',
    'jewelry_store',
    'liquor_store',
    'pet_store',
    'shoe_store',
    'sporting_goods_store',
    'gift_shop',
  ],
};

const matches = (id, types) => GOOGLE_TYPES[id].some((t) => types.includes(t));

/** Same rules as the OSM classifier: display order, "other" only for leftovers. */
export function classifyGoogleTypes(types, selected) {
  if (!types?.length) return null;
  const specific = CATEGORIES.map((c) => c.id).filter((id) => id !== 'other');
  for (const id of specific) if (selected.includes(id) && matches(id, types)) return id;
  if (selected.includes('other') && matches('other', types)) {
    return specific.some((id) => matches(id, types)) ? null : 'other';
  }
  return null;
}

function toPlace(g, { lat, lon, categories }) {
  const category = classifyGoogleTypes(g.types, categories);
  if (!category || !g.location) return null;
  const details = Object.fromEntries(
    Object.entries({
      hours: g.regularOpeningHours?.weekdayDescriptions?.join('; '),
      phone: g.internationalPhoneNumber,
      address: g.formattedAddress,
      website: g.websiteUri,
    }).filter(([, v]) => v),
  );
  return {
    id: `google:${g.id}`,
    name: g.displayName?.text ?? '',
    category,
    lat: g.location.latitude,
    lon: g.location.longitude,
    distanceM: haversine(lat, lon, g.location.latitude, g.location.longitude),
    walkingM: null,
    details,
    sourceUrl: g.googleMapsUri ?? null,
    raw: g,
  };
}

async function httpError(res) {
  const body = await res.json().catch(() => ({}));
  if (res.status === 400 && /api key/i.test(body?.error?.message ?? '')) {
    return new SearchError('auth', 'Google Places: invalid API key', { status: 400 });
  }
  return errorFromStatus(res.status, 'Google Places');
}

/**
 * Optional provider backed by Google Places API (New). Uses the user's own key,
 * which is sent only to places.googleapis.com. One request per category, as each
 * request returns at most 20 places.
 */
export function createGooglePlacesProvider({
  apiKey,
  fetch: fetchFn = globalThis.fetch,
  isOffline,
}) {
  if (!apiKey) throw new Error('Google Places needs an API key');

  async function searchType(category, { lat, lon, radiusM, signal }) {
    let res;
    try {
      res = await fetchFn(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify({
          includedTypes: GOOGLE_TYPES[category],
          maxResultCount: MAX_RESULTS,
          rankPreference: 'DISTANCE',
          locationRestriction: {
            circle: { center: { latitude: lat, longitude: lon }, radius: radiusM },
          },
        }),
        signal,
      });
    } catch (cause) {
      throw errorFromFailure(cause, { signal, isOffline });
    }
    if (!res.ok) throw await httpError(res);
    return (await res.json()).places ?? [];
  }

  return {
    id: 'google',
    label: 'Google Places (your key)',
    async search(params) {
      if (params.signal?.aborted) throw new SearchError('aborted', 'Search cancelled');
      const batches = await Promise.all(params.categories.map((c) => searchType(c, params)));
      const byId = new Map();
      for (const g of batches.flat()) {
        const place = byId.has(g.id) ? null : toPlace(g, params);
        if (place && place.distanceM <= params.radiusM) byId.set(g.id, place);
      }
      return [...byId.values()].sort((a, b) => a.distanceM - b.distanceM);
    },
  };
}
