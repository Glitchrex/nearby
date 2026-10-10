/** Mean Earth radius in metres (IUGG). */
export const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Great-circle distance in metres between two lat/lon points. */
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Smallest lat/lon box containing the circle of `radiusM` around the point.
 * Near the poles the box spans all longitudes.
 */
export function boundingBox(lat, lon, radiusM) {
  const angular = radiusM / EARTH_RADIUS_M;
  const north = Math.min(90, lat + toDeg(angular));
  const south = Math.max(-90, lat - toDeg(angular));
  if (north === 90 || south === -90) {
    return { south, west: -180, north, east: 180 };
  }
  const dLon = toDeg(Math.asin(Math.sin(angular) / Math.cos(toRad(lat))));
  return { south, west: lon - dLon, north, east: lon + dLon };
}

/** Human-readable distance: "850 m", "1.2 km", "12 km". Empty string for invalid input. */
export function formatDistance(meters) {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return '';
  if (meters < 999.5) return `${Math.round(meters)} m`;
  if (meters < 9_950) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

/** True when both values are finite numbers within WGS84 ranges. */
export function isValidLatLon(lat, lon) {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}
