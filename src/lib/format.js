import { getCategory } from './categories.js';
import { isValidLatLon } from './geo.js';

const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const BARE_HOST = /^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/;

/**
 * An http(s) URL safe to put in an href, or null. OSM `website` tags are
 * user-supplied, so `javascript:`, `data:` etc. are rejected; a bare host such
 * as "www.example.com" is upgraded to https.
 */
export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  let text = value.trim();
  if (!HAS_SCHEME.test(text)) {
    if (!BARE_HOST.test(text)) return null;
    text = `https://${text}`;
  }
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** `tel:` link for the first number in an OSM phone tag, or null. */
export function telHref(phone) {
  const first = String(phone ?? '').split(';')[0];
  const digits = first.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return digits.replace('+', '').length >= 3 ? `tel:${digits}` : null;
}

export function placeTitle(place) {
  return place.name || `Unnamed (${getCategory(place.category)?.label ?? place.category})`;
}

export function radiusLabel(radiusM) {
  return radiusM < 1000 ? `${radiusM} m` : `${radiusM / 1000} km`;
}

const normalise = (s) => s.normalize('NFC').toLocaleLowerCase().trim();

/** Places whose name contains `text` (case-insensitive), optionally without unnamed ones. */
export function filterPlaces(places, { text, hideUnnamed }) {
  const needle = normalise(text);
  return places.filter(
    (p) => (!hideUnnamed || p.name) && (!needle || normalise(p.name).includes(needle)),
  );
}

const NUMBER = /^-?\d+(\.\d+)?$/;
const LAT_ERROR = 'Enter a latitude between -90 and 90.';
const LON_ERROR = 'Enter a longitude between -180 and 180.';

/** Validate the coordinate inputs. A "lat, lon" pair in the first field is accepted. */
export function parseLatLonInput(latText, lonText) {
  let [a, b] = [latText.trim(), lonText.trim()];
  if (!b && a.includes(',')) [a, b] = a.split(',').map((s) => s.trim());
  const lat = NUMBER.test(a) ? Number(a) : NaN;
  const lon = NUMBER.test(b ?? '') ? Number(b) : NaN;
  const errors = {};
  if (!isValidLatLon(lat, 0)) errors.lat = LAT_ERROR;
  if (!isValidLatLon(0, lon)) errors.lon = LON_ERROR;
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, lat, lon };
}
