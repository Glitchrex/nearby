import { describe, expect, it } from 'vitest';
import {
  filterPlaces,
  parseLatLonInput,
  placeTitle,
  radiusLabel,
  safeUrl,
  telHref,
} from '../src/lib/format.js';

describe('safeUrl', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['http://example.com', 'http://example.com/'],
    ['  https://example.com  ', 'https://example.com/'],
    ['www.example.com', 'https://www.example.com/'],
    ['example.co.in/shop', 'https://example.co.in/shop'],
  ])('allows %j', (input, expected) => {
    expect(safeUrl(input)).toBe(expected);
  });

  it.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:x'],
    ['ftp://example.com'],
    ['not a url'],
    [''],
    [null],
    [undefined],
    [42],
  ])('rejects %j', (input) => {
    expect(safeUrl(input)).toBeNull();
  });
});

describe('telHref', () => {
  it.each([
    ['+91 80 1234 5678', 'tel:+918012345678'],
    ['(080) 2222-3333', 'tel:08022223333'],
    ['+91 80 1111 2222; +91 80 3333 4444', 'tel:+918011112222'],
    ['108', 'tel:108'],
  ])('%j → %j', (input, expected) => {
    expect(telHref(input)).toBe(expected);
  });

  it.each([['12'], ['call us'], [''], [undefined]])('rejects %j', (input) => {
    expect(telHref(input)).toBeNull();
  });
});

describe('placeTitle', () => {
  it('uses the name, or labels unnamed places by category', () => {
    expect(placeTitle({ name: 'Cafe', category: 'food' })).toBe('Cafe');
    expect(placeTitle({ name: '', category: 'banks' })).toBe('Unnamed (Banks & ATMs)');
  });
});

describe('radiusLabel', () => {
  it.each([
    [500, '500 m'],
    [1000, '1 km'],
    [2000, '2 km'],
    [5000, '5 km'],
  ])('%d → %s', (r, label) => {
    expect(radiusLabel(r)).toBe(label);
  });
});

describe('filterPlaces', () => {
  const places = [
    { name: 'Nandini Milk Parlour', category: 'grocery' },
    { name: 'ನಂದಿನಿ ಹಾಲು', category: 'grocery' },
    { name: '', category: 'banks' },
    { name: 'CAFÉ Coffee Day', category: 'food' },
  ];

  it('returns everything with no filter', () => {
    expect(filterPlaces(places, { text: '', hideUnnamed: false })).toHaveLength(4);
  });

  it('matches names case-insensitively, including accents and Indic scripts', () => {
    expect(filterPlaces(places, { text: 'nandini', hideUnnamed: false })).toHaveLength(1);
    expect(filterPlaces(places, { text: 'café', hideUnnamed: false })).toHaveLength(1);
    expect(filterPlaces(places, { text: 'ನಂದಿನಿ', hideUnnamed: false })).toHaveLength(1);
    expect(filterPlaces(places, { text: '  coffee ', hideUnnamed: false })).toHaveLength(1);
  });

  it('hides unnamed places when asked', () => {
    expect(filterPlaces(places, { text: '', hideUnnamed: true })).toHaveLength(3);
  });
});

describe('parseLatLonInput', () => {
  it('parses two valid fields', () => {
    expect(parseLatLonInput('12.9716', '77.5946')).toEqual({
      ok: true,
      lat: 12.9716,
      lon: 77.5946,
    });
    expect(parseLatLonInput(' -33.8 ', '151.2')).toEqual({ ok: true, lat: -33.8, lon: 151.2 });
  });

  it('accepts a "lat, lon" pair pasted into the latitude field', () => {
    expect(parseLatLonInput('12.9716, 77.5946', '')).toEqual({
      ok: true,
      lat: 12.9716,
      lon: 77.5946,
    });
  });

  it('reports per-field errors', () => {
    expect(parseLatLonInput('', '')).toEqual({
      ok: false,
      errors: {
        lat: 'Enter a latitude between -90 and 90.',
        lon: 'Enter a longitude between -180 and 180.',
      },
    });
    expect(parseLatLonInput('95', '77')).toEqual({
      ok: false,
      errors: { lat: 'Enter a latitude between -90 and 90.' },
    });
    expect(parseLatLonInput('12', '12abc')).toEqual({
      ok: false,
      errors: { lon: 'Enter a longitude between -180 and 180.' },
    });
  });
});
