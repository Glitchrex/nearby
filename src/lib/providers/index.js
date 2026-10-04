import { createGooglePlacesProvider } from './google-places.js';
import { createOverpassProvider } from './overpass.js';

export const PROVIDERS = [
  { id: 'overpass', label: 'OpenStreetMap (free, no key)', needsKey: false },
  { id: 'google', label: 'Google Places (your API key)', needsKey: true },
];

/** Provider by id; Google without a key falls back to Overpass. */
export function createProvider(id, { googleKey, storage, fetch } = {}) {
  if (id === 'google' && googleKey) return createGooglePlacesProvider({ apiKey: googleKey, fetch });
  return createOverpassProvider({ storage, fetch });
}
