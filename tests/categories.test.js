import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CATEGORY_IDS,
  classify,
  getCategory,
  overpassFilters,
} from '../src/lib/categories.js';

describe('CATEGORIES', () => {
  it('defines the six categories in display order', () => {
    expect(CATEGORY_IDS).toEqual(['grocery', 'malls', 'health', 'food', 'banks', 'other']);
    expect(CATEGORIES.map((c) => c.label)).toEqual([
      'Grocery',
      'Malls',
      'Health',
      'Food',
      'Banks & ATMs',
      'Other shops',
    ]);
  });

  it('gives every category a hex colour and at least one filter', () => {
    for (const c of CATEGORIES) {
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.filters.length).toBeGreaterThan(0);
    }
  });

  it('uses only safe characters in tag keys and values (they are inlined into queries)', () => {
    for (const c of CATEGORIES) {
      for (const f of c.filters) {
        expect(f.key).toMatch(/^[a-z_:]+$/);
        for (const v of f.values ?? []) expect(v).toMatch(/^[a-z_]+$/);
      }
    }
  });

  it('looks categories up by id', () => {
    expect(getCategory('food').label).toBe('Food');
    expect(getCategory('nope')).toBeUndefined();
  });
});

describe('classify', () => {
  it.each([
    [{ shop: 'supermarket' }, 'grocery'],
    [{ shop: 'convenience' }, 'grocery'],
    [{ shop: 'greengrocer' }, 'grocery'],
    [{ shop: 'bakery' }, 'grocery'],
    [{ shop: 'mall' }, 'malls'],
    [{ shop: 'department_store' }, 'malls'],
    [{ amenity: 'hospital' }, 'health'],
    [{ amenity: 'clinic' }, 'health'],
    [{ amenity: 'pharmacy' }, 'health'],
    [{ healthcare: 'pharmacy' }, 'health'],
    [{ shop: 'chemist' }, 'health'],
    [{ amenity: 'restaurant' }, 'food'],
    [{ amenity: 'cafe' }, 'food'],
    [{ amenity: 'fast_food' }, 'food'],
    [{ amenity: 'bank' }, 'banks'],
    [{ amenity: 'atm' }, 'banks'],
    [{ shop: 'clothes' }, 'other'],
    [{ shop: 'hardware' }, 'other'],
    [{ shop: 'yes' }, 'other'],
  ])('%o → %s', (tags, expected) => {
    expect(classify(tags)).toBe(expected);
  });

  it('returns null for untagged or irrelevant features', () => {
    expect(classify({})).toBeNull();
    expect(classify(undefined)).toBeNull();
    expect(classify({ amenity: 'bench' })).toBeNull();
    expect(classify({ highway: 'bus_stop', name: 'Shop Stop' })).toBeNull();
  });

  it('"Other shops" never takes a shop that a specific category claims', () => {
    expect(classify({ shop: 'supermarket' }, ['other'])).toBeNull();
    expect(classify({ shop: 'mall' }, ['other'])).toBeNull();
    expect(classify({ shop: 'chemist' }, ['other'])).toBeNull();
  });

  it('"Other shops" does not take a shop that is also a specific amenity', () => {
    // A bookshop with a café is Food, never a leftover.
    expect(classify({ shop: 'books', amenity: 'cafe' }, ['other'])).toBeNull();
    expect(classify({ shop: 'books', amenity: 'cafe' }, ['food', 'other'])).toBe('food');
  });

  it('only returns selected categories', () => {
    const tags = { shop: 'supermarket', amenity: 'atm' };
    expect(classify(tags)).toBe('grocery');
    expect(classify(tags, ['banks'])).toBe('banks');
    expect(classify(tags, ['food'])).toBeNull();
    expect(classify(tags, [])).toBeNull();
  });

  it('respects display order when several selected categories match', () => {
    expect(classify({ amenity: 'pharmacy', shop: 'supermarket' })).toBe('grocery');
    expect(classify({ amenity: 'pharmacy', shop: 'supermarket' }, ['health', 'banks'])).toBe(
      'health',
    );
  });
});

describe('overpassFilters', () => {
  it('renders value lists as anchored regexes and single values as equality', () => {
    const filters = overpassFilters(['malls']);
    expect(filters).toContain('["shop"~"^(mall|department_store)$"]');
    expect(overpassFilters(['banks'])).toEqual(['["amenity"~"^(bank|atm)$"]']);
    expect(overpassFilters(['health'])).toContain('["shop"="chemist"]');
  });

  it('renders a key-only filter as an existence check', () => {
    expect(overpassFilters(['other'])).toEqual(['["shop"]']);
  });

  it('returns nothing for no or unknown categories', () => {
    expect(overpassFilters([])).toEqual([]);
    expect(overpassFilters(['bogus'])).toEqual([]);
  });

  it('drops value filters that an existence filter on the same key already covers', () => {
    const filters = overpassFilters(['grocery', 'malls', 'other']);
    expect(filters).toEqual(['["shop"]']);
    const withHealth = overpassFilters(['health', 'other']);
    expect(withHealth).toContain('["shop"]');
    expect(withHealth.some((f) => f.startsWith('["shop"~'))).toBe(false);
    expect(withHealth.some((f) => f.startsWith('["amenity"~'))).toBe(true);
  });

  it('merges values that share a key across categories', () => {
    const filters = overpassFilters(['health', 'food']);
    const amenity = filters.filter((f) => f.startsWith('["amenity"'));
    expect(amenity).toHaveLength(1);
    expect(amenity[0]).toContain('hospital');
    expect(amenity[0]).toContain('restaurant');
  });

  it('is independent of the order categories are passed in', () => {
    expect(overpassFilters(['food', 'health'])).toEqual(overpassFilters(['health', 'food']));
  });
});
