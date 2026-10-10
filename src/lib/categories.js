/**
 * Category definitions. Each filter is `{ key, values? }`: a tag key plus the
 * accepted values, or just a key meaning "any value". The same data drives both
 * the Overpass query and the client-side classifier, so they cannot drift apart.
 */
export const CATEGORIES = [
  {
    id: 'grocery',
    label: 'Grocery',
    color: '#2e7d32',
    filters: [
      {
        key: 'shop',
        values: [
          'supermarket',
          'convenience',
          'grocery',
          'greengrocer',
          'general',
          'bakery',
          'butcher',
          'dairy',
          'deli',
          'health_food',
          'farm',
        ],
      },
    ],
  },
  {
    id: 'malls',
    label: 'Malls',
    color: '#7b1fa2',
    filters: [{ key: 'shop', values: ['mall', 'department_store'] }],
  },
  {
    id: 'health',
    label: 'Health',
    color: '#c62828',
    filters: [
      { key: 'amenity', values: ['hospital', 'clinic', 'doctors', 'dentist', 'pharmacy'] },
      { key: 'healthcare', values: ['hospital', 'clinic', 'pharmacy'] },
      { key: 'shop', values: ['chemist'] },
    ],
  },
  {
    id: 'food',
    label: 'Food',
    color: '#e65100',
    filters: [
      { key: 'amenity', values: ['restaurant', 'cafe', 'fast_food', 'food_court', 'ice_cream'] },
    ],
  },
  {
    id: 'banks',
    label: 'Banks & ATMs',
    color: '#1565c0',
    filters: [{ key: 'amenity', values: ['bank', 'atm'] }],
  },
  {
    id: 'other',
    label: 'Other shops',
    color: '#546e7a',
    filters: [{ key: 'shop' }],
  },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

const LEFTOVER_ID = 'other';
const SPECIFIC = CATEGORIES.filter((c) => c.id !== LEFTOVER_ID);

export function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id);
}

const filterMatches = (filter, tags) =>
  filter.key in tags && (!filter.values || filter.values.includes(tags[filter.key]));

const categoryMatches = (category, tags) => category.filters.some((f) => filterMatches(f, tags));

/**
 * Category id for a feature's tags, restricted to `selected` ids (in display
 * order), or null. "Other shops" only matches when no specific category would.
 */
export function classify(tags, selected = CATEGORY_IDS) {
  if (!tags) return null;
  for (const category of CATEGORIES) {
    if (!selected.includes(category.id)) continue;
    if (category.id === LEFTOVER_ID) {
      if (SPECIFIC.some((c) => categoryMatches(c, tags))) continue;
    }
    if (categoryMatches(category, tags)) return category.id;
  }
  return null;
}

/**
 * Overpass tag-filter strings (e.g. `["amenity"~"^(bank|atm)$"]`) for the
 * selected categories. Values sharing a key are merged into one regex, and a
 * key-only filter makes value filters on that key redundant.
 */
export function overpassFilters(selected) {
  const byKey = new Map();
  for (const category of CATEGORIES) {
    if (!selected.includes(category.id)) continue;
    for (const { key, values } of category.filters) {
      const current = byKey.get(key);
      if (current === 'any') continue;
      if (!values) byKey.set(key, 'any');
      else byKey.set(key, new Set([...(current ?? []), ...values]));
    }
  }
  return [...byKey].map(([key, values]) => {
    if (values === 'any') return `["${key}"]`;
    const list = [...values];
    return list.length === 1 ? `["${key}"="${list[0]}"]` : `["${key}"~"^(${list.join('|')})$"]`;
  });
}
