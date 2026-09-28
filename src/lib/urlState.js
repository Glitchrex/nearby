import { CATEGORY_IDS } from './categories.js';
import { isValidLatLon } from './geo.js';

export const RADII_M = [500, 1000, 2000, 5000];

export const DEFAULT_STATE = Object.freeze({
  lat: null,
  lon: null,
  radiusM: 1000,
  categories: CATEGORY_IDS,
});

const NUMBER = /^-?\d+(\.\d+)?$/;

const parseNumber = (text) => (text && NUMBER.test(text) ? Number(text) : NaN);

function readLocation(params) {
  const lat = parseNumber(params.get('lat'));
  const lon = parseNumber(params.get('lon'));
  return isValidLatLon(lat, lon) ? { lat, lon } : { lat: null, lon: null };
}

function readRadius(params) {
  const r = parseNumber(params.get('r'));
  return RADII_M.includes(r) ? r : DEFAULT_STATE.radiusM;
}

function readCategories(params) {
  const requested = (params.get('cats') ?? '').split(',');
  const valid = CATEGORY_IDS.filter((id) => requested.includes(id));
  return valid.length ? valid : DEFAULT_STATE.categories;
}

/** Parse `location.search`; each invalid parameter falls back to its default. */
export function readState(search) {
  const params = new URLSearchParams(search);
  return {
    ...readLocation(params),
    radiusM: readRadius(params),
    categories: readCategories(params),
  };
}

/** Serialise a search as a query string (commas left readable in `cats`). */
export function writeState({ lat, lon, radiusM, categories }) {
  const parts = [];
  if (isValidLatLon(lat, lon)) parts.push(`lat=${lat.toFixed(5)}`, `lon=${lon.toFixed(5)}`);
  parts.push(`r=${radiusM}`, `cats=${categories.join(',')}`);
  return `?${parts.join('&')}`;
}
