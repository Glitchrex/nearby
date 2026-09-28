import { describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_TYPES,
  classifyGoogleTypes,
  createGooglePlacesProvider,
} from '../../src/lib/providers/google-places.js';
import { CATEGORY_IDS } from '../../src/lib/categories.js';

const json = (body, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const gPlace = (over = {}) => ({
  id: 'abc',
  displayName: { text: 'Fresh Mart', languageCode: 'en' },
  location: { latitude: 12.9717, longitude: 77.5946 },
  types: ['supermarket', 'grocery_store', 'store'],
  formattedAddress: '1 MG Road, Bengaluru',
  internationalPhoneNumber: '+91 80 0000 0000',
  websiteUri: 'https://fresh.example',
  regularOpeningHours: { weekdayDescriptions: ['Monday: 9 AM – 9 PM', 'Tuesday: Closed'] },
  googleMapsUri: 'https://maps.google.com/?cid=1',
  ...over,
});

const params = { lat: 12.9716, lon: 77.5946, radiusM: 1000, categories: ['grocery'] };

describe('GOOGLE_TYPES', () => {
  it('maps every category to at least one Places type', () => {
    for (const id of CATEGORY_IDS) expect(GOOGLE_TYPES[id].length).toBeGreaterThan(0);
  });
});

describe('classifyGoogleTypes', () => {
  it('picks the first selected category that matches', () => {
    expect(classifyGoogleTypes(['atm', 'supermarket'], CATEGORY_IDS)).toBe('grocery');
    expect(classifyGoogleTypes(['atm', 'supermarket'], ['banks'])).toBe('banks');
    expect(classifyGoogleTypes(['hospital'], CATEGORY_IDS)).toBe('health');
  });

  it('only uses "other" for leftovers', () => {
    expect(classifyGoogleTypes(['book_store'], ['other'])).toBe('other');
    expect(classifyGoogleTypes(['supermarket', 'book_store'], ['other'])).toBeNull();
    expect(classifyGoogleTypes([], CATEGORY_IDS)).toBeNull();
    expect(classifyGoogleTypes(undefined, CATEGORY_IDS)).toBeNull();
  });
});

describe('google places provider', () => {
  it('requires an API key', () => {
    expect(() => createGooglePlacesProvider({ apiKey: '' })).toThrow(/key/i);
  });

  it('sends a searchNearby request per selected category with key and field mask', async () => {
    const fetch = vi.fn(() => json({ places: [] }));
    const provider = createGooglePlacesProvider({ apiKey: 'KEY', fetch });
    expect(provider.id).toBe('google');
    await provider.search({ ...params, categories: ['grocery', 'banks'] });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchNearby');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Goog-Api-Key']).toBe('KEY');
    expect(init.headers['X-Goog-FieldMask']).toContain('places.displayName');
    expect(JSON.parse(init.body)).toEqual({
      includedTypes: GOOGLE_TYPES.grocery,
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: { center: { latitude: 12.9716, longitude: 77.5946 }, radius: 1000 },
      },
    });
    expect(JSON.parse(fetch.mock.calls[1][1].body).includedTypes).toEqual(GOOGLE_TYPES.banks);
  });

  it('maps results to Place[]', async () => {
    const fetch = vi.fn(() => json({ places: [gPlace()] }));
    const [p] = await createGooglePlacesProvider({ apiKey: 'K', fetch }).search(params);
    expect(p).toMatchObject({
      id: 'google:abc',
      name: 'Fresh Mart',
      category: 'grocery',
      lat: 12.9717,
      lon: 77.5946,
      walkingM: null,
      sourceUrl: 'https://maps.google.com/?cid=1',
      details: {
        address: '1 MG Road, Bengaluru',
        phone: '+91 80 0000 0000',
        website: 'https://fresh.example',
        hours: 'Monday: 9 AM – 9 PM; Tuesday: Closed',
      },
    });
    expect(p.distanceM).toBeGreaterThan(0);
  });

  it('dedupes across categories, filters by radius and sorts by distance', async () => {
    const near = gPlace({ id: 'n', location: { latitude: 12.9716, longitude: 77.5947 } });
    const far = gPlace({ id: 'f', location: { latitude: 13.5, longitude: 77.5946 } });
    const mid = gPlace({
      id: 'm',
      types: ['atm'],
      location: { latitude: 12.975, longitude: 77.5946 },
    });
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => json({ places: [gPlace(), far, near] }))
      .mockImplementationOnce(() => json({ places: [mid, gPlace()] }));
    const places = await createGooglePlacesProvider({ apiKey: 'K', fetch }).search({
      ...params,
      categories: ['grocery', 'banks'],
    });
    expect(places.map((p) => p.id)).toEqual(['google:n', 'google:abc', 'google:m']);
  });

  it('handles an empty response and minimal places', async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => json({}))
      .mockImplementationOnce(() =>
        json({
          places: [
            { id: 'z', types: ['atm'], location: { latitude: 12.9716, longitude: 77.5946 } },
          ],
        }),
      );
    const provider = createGooglePlacesProvider({ apiKey: 'K', fetch });
    expect(await provider.search(params)).toEqual([]);
    const [p] = await provider.search({ ...params, categories: ['banks'] });
    expect(p).toMatchObject({ name: '', details: {}, sourceUrl: null });
  });

  it.each([
    [400, 'bad-response'],
    [403, 'auth'],
    [429, 'rate-limit'],
    [500, 'server'],
  ])('maps HTTP %d to a %s SearchError', async (status, kind) => {
    const fetch = vi.fn(() => json({ error: { message: 'nope' } }, status));
    await expect(
      createGooglePlacesProvider({ apiKey: 'K', fetch }).search(params),
    ).rejects.toMatchObject({ kind });
  });

  it('treats an invalid key (400 API_KEY_INVALID) as an auth error', async () => {
    const fetch = vi.fn(() =>
      json({ error: { status: 'INVALID_ARGUMENT', message: 'API key not valid.' } }, 400),
    );
    await expect(
      createGooglePlacesProvider({ apiKey: 'K', fetch }).search(params),
    ).rejects.toMatchObject({ kind: 'auth' });
  });

  it('maps network failures and aborts', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(
      createGooglePlacesProvider({ apiKey: 'K', fetch, isOffline: () => false }).search(params),
    ).rejects.toMatchObject({ kind: 'network' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      createGooglePlacesProvider({ apiKey: 'K', fetch }).search({
        ...params,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});
