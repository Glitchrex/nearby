import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_M,
  boundingBox,
  formatDistance,
  haversine,
  isValidLatLon,
} from '../src/lib/geo.js';

// Point reached by travelling `distanceM` from (lat, lon) on the initial bearing.
function destination(lat, lon, distanceM, bearingDeg) {
  const r = Math.PI / 180;
  const d = distanceM / EARTH_RADIUS_M;
  const b = bearingDeg * r;
  const lat1 = lat * r;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 =
    lon * r +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: lat2 / r, lon: lon2 / r };
}

const EPS = 1e-9; // floating-point slack for points exactly on the box edge
const LONDON = { lat: 51.5074, lon: -0.1278 };
const PARIS = { lat: 48.8566, lon: 2.3522 };
const BENGALURU = { lat: 12.9716, lon: 77.5946 };
const MYSURU = { lat: 12.2958, lon: 76.6394 };
const NYC = { lat: 40.7128, lon: -74.006 };
const LA = { lat: 34.0522, lon: -118.2437 };

describe('haversine', () => {
  it.each([
    ['London–Paris', LONDON, PARIS, 343_500],
    ['Bengaluru–Mysuru', BENGALURU, MYSURU, 127_000],
    ['New York–Los Angeles', NYC, LA, 3_936_000],
  ])('%s is within 1%% of the known great-circle distance', (_name, a, b, expected) => {
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    expect(Math.abs(d - expected) / expected).toBeLessThan(0.01);
  });

  it('is zero for the same point', () => {
    expect(haversine(12.97, 77.59, 12.97, 77.59)).toBe(0);
  });

  it('is symmetric', () => {
    const ab = haversine(LONDON.lat, LONDON.lon, PARIS.lat, PARIS.lon);
    const ba = haversine(PARIS.lat, PARIS.lon, LONDON.lat, LONDON.lon);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it('takes the short way across the antimeridian', () => {
    // 1 degree of longitude on the equator ≈ 111.2 km
    const d = haversine(0, 179.5, 0, -179.5);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_500);
  });

  it('matches one degree of latitude ≈ 111.2 km', () => {
    expect(haversine(0, 0, 1, 0)).toBeCloseTo(111_195, -1);
  });
});

describe('boundingBox', () => {
  it('contains every point on the circle', () => {
    const box = boundingBox(BENGALURU.lat, BENGALURU.lon, 5000);
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const { lat, lon } = destination(BENGALURU.lat, BENGALURU.lon, 5000, bearing);
      expect(lat).toBeGreaterThanOrEqual(box.south - EPS);
      expect(lat).toBeLessThanOrEqual(box.north + EPS);
      expect(lon).toBeGreaterThanOrEqual(box.west - EPS);
      expect(lon).toBeLessThanOrEqual(box.east + EPS);
    }
  });

  it('is symmetric around the centre and roughly 2r tall', () => {
    const box = boundingBox(0, 0, 1000);
    expect(box.north).toBeCloseTo(-box.south, 10);
    expect(box.east).toBeCloseTo(-box.west, 10);
    expect(haversine(box.south, 0, box.north, 0)).toBeCloseTo(2000, -1);
  });

  it('clamps latitude at the poles and spans all longitudes', () => {
    const box = boundingBox(89.99, 10, 5000);
    expect(box.north).toBe(90);
    expect(box.west).toBe(-180);
    expect(box.east).toBe(180);
  });
});

describe('formatDistance', () => {
  it.each([
    [0, '0 m'],
    [0.4, '0 m'],
    [12.6, '13 m'],
    [999, '999 m'],
    [999.6, '1.0 km'],
    [1000, '1.0 km'],
    [1049, '1.0 km'],
    [1050, '1.1 km'],
    [9_949, '9.9 km'],
    [9_999, '10 km'],
    [12_345, '12 km'],
  ])('formats %d m as "%s"', (meters, expected) => {
    expect(formatDistance(meters)).toBe(expected);
  });

  it.each([[-1], [NaN], [Infinity], [null], [undefined], ['100']])(
    'returns an empty string for invalid input %s',
    (value) => {
      expect(formatDistance(value)).toBe('');
    },
  );
});

describe('isValidLatLon', () => {
  it.each([
    [0, 0],
    [90, 180],
    [-90, -180],
    [12.97, 77.59],
  ])('accepts %d, %d', (lat, lon) => {
    expect(isValidLatLon(lat, lon)).toBe(true);
  });

  it.each([
    [91, 0],
    [0, 181],
    [-90.1, 0],
    [NaN, 0],
    [0, Infinity],
    ['12', 77],
    [null, 0],
  ])('rejects %s, %s', (lat, lon) => {
    expect(isValidLatLon(lat, lon)).toBe(false);
  });
});
