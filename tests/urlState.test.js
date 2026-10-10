import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS } from '../src/lib/categories.js';
import { DEFAULT_STATE, RADII_M, readState, writeState } from '../src/lib/urlState.js';

describe('writeState', () => {
  it('writes lat, lon (5 dp), radius and categories', () => {
    expect(
      writeState({
        lat: 12.971598,
        lon: 77.594562,
        radiusM: 1000,
        categories: ['grocery', 'food'],
      }),
    ).toBe('?lat=12.97160&lon=77.59456&r=1000&cats=grocery,food');
  });

  it('omits the location when there is none', () => {
    expect(writeState({ lat: null, lon: null, radiusM: 500, categories: ['banks'] })).toBe(
      '?r=500&cats=banks',
    );
  });
});

describe('readState', () => {
  it('round-trips through writeState', () => {
    const state = {
      lat: -33.86882,
      lon: 151.20929,
      radiusM: 2000,
      categories: ['health', 'malls'],
    };
    expect(readState(writeState(state))).toEqual({
      ...state,
      categories: ['malls', 'health'],
    });
  });

  it('returns defaults for an empty query string', () => {
    expect(readState('')).toEqual(DEFAULT_STATE);
    expect(DEFAULT_STATE).toEqual({
      lat: null,
      lon: null,
      radiusM: 1000,
      categories: CATEGORY_IDS,
    });
  });

  it('accepts a URLSearchParams-compatible string without the leading ?', () => {
    expect(readState('r=5000').radiusM).toBe(5000);
  });

  it.each([
    ['lat=abc&lon=77'],
    ['lat=91&lon=77'],
    ['lat=12&lon=-181'],
    ['lat=12'],
    ['lon=77'],
    ['lat=&lon='],
    ['lat=Infinity&lon=0'],
    ['lat=1e400&lon=0'],
    ['lat=12abc&lon=77'],
  ])('rejects invalid coordinates: %s', (qs) => {
    const s = readState(qs);
    expect(s.lat).toBeNull();
    expect(s.lon).toBeNull();
  });

  it('accepts negative and boundary coordinates', () => {
    expect(readState('lat=-90&lon=180')).toMatchObject({ lat: -90, lon: 180 });
  });

  it.each(['r=750', 'r=-500', 'r=abc', 'r=', 'r=1000.5'])('rejects radius %s', (qs) => {
    expect(readState(qs).radiusM).toBe(DEFAULT_STATE.radiusM);
  });

  it.each(RADII_M)('accepts the allowed radius %d', (r) => {
    expect(readState(`r=${r}`).radiusM).toBe(r);
  });

  it('drops unknown categories and keeps display order', () => {
    expect(readState('cats=food,bogus,grocery,food').categories).toEqual(['grocery', 'food']);
  });

  it('falls back to all categories when none are valid', () => {
    expect(readState('cats=bogus').categories).toEqual(CATEGORY_IDS);
    expect(readState('cats=').categories).toEqual(CATEGORY_IDS);
  });

  it('handles an encoded comma separator', () => {
    expect(readState('cats=banks%2Chealth').categories).toEqual(['health', 'banks']);
  });

  it('keeps invalid params independent of valid ones', () => {
    expect(readState('lat=999&lon=0&r=2000&cats=food')).toEqual({
      lat: null,
      lon: null,
      radiusM: 2000,
      categories: ['food'],
    });
  });
});
