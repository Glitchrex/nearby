import { getCategory } from './categories.js';

export const CSV_COLUMNS = [
  'name',
  'category',
  'distance_m',
  'walking_m',
  'lat',
  'lon',
  'address',
  'phone',
  'opening_hours',
  'website',
  'source_url',
];

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;
// Cells starting with these are evaluated as formulas by spreadsheet apps.
const FORMULA_START = /^[=+\-@\t\r]/;

/** RFC 4180 field escaping plus a guard against CSV formula injection in text. */
export function escapeCSVField(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const round = (n) => (typeof n === 'number' ? Math.round(n) : null);

function csvRow(p) {
  return [
    p.name,
    getCategory(p.category)?.label ?? p.category,
    round(p.distanceM),
    round(p.walkingM),
    p.lat,
    p.lon,
    p.details.address,
    p.details.phone,
    p.details.hours,
    p.details.website,
    p.sourceUrl,
  ]
    .map(escapeCSVField)
    .join(',');
}

/** Places → CSV text (CRLF line endings, header row first). */
export function toCSV(places) {
  return [CSV_COLUMNS.join(','), ...places.map(csvRow)].map((line) => `${line}\r\n`).join('');
}

/** Places → pretty JSON with the search parameters that produced them. */
export function toJSON(places, { lat, lon, radiusM, provider, now = () => new Date() }) {
  const doc = {
    generatedAt: now().toISOString(),
    center: { lat, lon },
    radiusM,
    provider,
    count: places.length,
    places: places.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      lat: p.lat,
      lon: p.lon,
      distanceM: round(p.distanceM),
      walkingM: round(p.walkingM),
      details: p.details,
      sourceUrl: p.sourceUrl,
      tags: p.raw,
    })),
  };
  return JSON.stringify(doc, null, 2);
}

/** Save `text` as a file via a temporary object URL. */
export function download(
  filename,
  text,
  mime,
  { bom = false, doc = globalThis.document, url = globalThis.URL } = {},
) {
  const parts = bom ? ['﻿', text] : [text];
  const href = url.createObjectURL(new Blob(parts, { type: mime }));
  const a = doc.createElement('a');
  a.href = href;
  a.download = filename;
  doc.body.append(a);
  a.click();
  a.remove();
  url.revokeObjectURL(href);
}
