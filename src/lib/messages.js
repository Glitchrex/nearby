const SEARCH_ERRORS = {
  offline: "You're offline. Reconnect to the internet, then press Retry.",
  'rate-limit':
    'The data server is busy (too many requests). Wait a minute, then press Retry, or try a smaller radius.',
  timeout: 'The search took too long. Try a smaller radius or fewer categories, then press Retry.',
  network:
    "Couldn't reach the data server. Check your connection or any content blocker, then press Retry.",
  server: 'The data server had a problem. Press Retry to try again.',
  'bad-response':
    'The data server sent an unexpected response. Press Retry; if it keeps happening, please report a bug.',
  auth: 'Your API key was rejected. Check it in Settings, or switch the data source back to OpenStreetMap.',
};

/** User-facing, actionable wording for a SearchError (or any error). */
export function searchErrorMessage(err) {
  return SEARCH_ERRORS[err?.kind] ?? 'Something went wrong while searching. Press Retry.';
}

const ALTERNATIVE = 'You can also click the map or enter coordinates.';

const GEO_ERRORS = {
  1: 'Location access was denied. Allow location for this site in your browser settings.',
  2: "Your location couldn't be determined (no GPS or network fix). Try again in a moment.",
  3: 'Finding your location took too long. Try again.',
  unsupported: "This browser doesn't support location sharing.",
  insecure: 'Location only works when the page is served over HTTPS or from localhost.',
};

/** Message for a GeolocationPositionError code, 'unsupported' or 'insecure'. */
export function geolocationMessage(code) {
  return `${GEO_ERRORS[code] ?? GEO_ERRORS[2]} ${ALTERNATIVE}`;
}
