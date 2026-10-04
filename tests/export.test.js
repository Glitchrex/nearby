import { describe, expect, it, vi } from 'vitest';
import { CSV_COLUMNS, download, escapeCSVField, toCSV, toJSON } from '../src/lib/export.js';

const place = (over = {}) => ({
  id: 'osm:node/1',
  name: 'Corner Mart',
  category: 'grocery',
  lat: 12.972,
  lon: 77.595,
  distanceM: 57.4,
  walkingM: null,
  details: { hours: 'Mo-Su 08:00-22:00', phone: '+91 80 1234', address: '12 MG Road' },
  sourceUrl: 'https://www.openstreetmap.org/node/1',
  raw: { shop: 'supermarket' },
  ...over,
});

describe('escapeCSVField', () => {
  it.each([
    ['plain', 'plain'],
    ['', ''],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['"', '""""'],
    ['line1\nline2', '"line1\nline2"'],
    ['line1\r\nline2', '"line1\r\nline2"'],
    [' padded ', '" padded "'],
  ])('%j → %j', (input, expected) => {
    expect(escapeCSVField(input)).toBe(expected);
  });

  it.each([
    ['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
    ['+91 80 1234', "'+91 80 1234"],
    ['-5', "'-5"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tTab', "'\tTab"],
  ])('neutralises spreadsheet formulas: %j', (input, expected) => {
    expect(escapeCSVField(input)).toBe(expected);
  });

  it('leaves numbers alone, including negatives', () => {
    expect(escapeCSVField(-0.1278)).toBe('-0.1278');
    expect(escapeCSVField(42)).toBe('42');
  });

  it('writes null and undefined as empty', () => {
    expect(escapeCSVField(null)).toBe('');
    expect(escapeCSVField(undefined)).toBe('');
  });

  it('keeps Kannada and Hindi text intact', () => {
    expect(escapeCSVField('ನಂದಿನಿ ಹಾಲು')).toBe('ನಂದಿನಿ ಹಾಲು');
    expect(escapeCSVField('अपना बाज़ार, दिल्ली')).toBe('"अपना बाज़ार, दिल्ली"');
  });
});

describe('toCSV', () => {
  it('writes a header row and one CRLF-terminated row per place', () => {
    const csv = toCSV([place()]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines[1]).toBe(
      "Corner Mart,Grocery,57,,12.972,77.595,12 MG Road,'+91 80 1234,Mo-Su 08:00-22:00,,https://www.openstreetmap.org/node/1",
    );
    expect(lines[2]).toBe('');
    expect(lines).toHaveLength(3);
  });

  it('escapes quotes, commas and newlines inside names', () => {
    const csv = toCSV([place({ name: 'Joe\'s "Best", Ltd\nBranch 2' })]);
    expect(csv).toContain('"Joe\'s ""Best"", Ltd\nBranch 2",Grocery');
  });

  it('round-trips unicode names (Kannada, Hindi)', () => {
    const csv = toCSV([place({ name: 'ಮೋರ್ ಸೂಪರ್‌ಮಾರ್ಕೆಟ್' }), place({ name: 'रिलायंस फ्रेश' })]);
    expect(csv).toContain('\r\nಮೋರ್ ಸೂಪರ್‌ಮಾರ್ಕೆಟ್,Grocery,');
    expect(csv).toContain('\r\nरिलायंस फ्रेश,Grocery,');
  });

  it('includes walking distance when known and rounds distances', () => {
    const csv = toCSV([place({ distanceM: 999.5, walkingM: 1234.4 })]);
    expect(csv.split('\r\n')[1]).toMatch(/^Corner Mart,Grocery,1000,1234,/);
  });

  it('only outputs the header for no places', () => {
    expect(toCSV([])).toBe(`${CSV_COLUMNS.join(',')}\r\n`);
  });
});

describe('toJSON', () => {
  it('wraps places with search metadata', () => {
    const json = JSON.parse(
      toJSON([place()], {
        lat: 12.97,
        lon: 77.59,
        radiusM: 1000,
        provider: 'overpass',
        now: () => new Date('2026-01-02T03:04:05Z'),
      }),
    );
    expect(json).toEqual({
      generatedAt: '2026-01-02T03:04:05.000Z',
      center: { lat: 12.97, lon: 77.59 },
      radiusM: 1000,
      provider: 'overpass',
      count: 1,
      places: [
        {
          id: 'osm:node/1',
          name: 'Corner Mart',
          category: 'grocery',
          lat: 12.972,
          lon: 77.595,
          distanceM: 57,
          walkingM: null,
          details: place().details,
          sourceUrl: 'https://www.openstreetmap.org/node/1',
          tags: { shop: 'supermarket' },
        },
      ],
    });
  });

  it('preserves unicode rather than escaping it', () => {
    expect(toJSON([place({ name: 'ಹಾಲು' })], {})).toContain('ಹಾಲು');
  });
});

describe('download', () => {
  function fakeEnv() {
    const anchor = { click: vi.fn(), remove: vi.fn() };
    const doc = {
      createElement: vi.fn(() => anchor),
      body: { append: vi.fn() },
    };
    const url = { createObjectURL: vi.fn(() => 'blob:1'), revokeObjectURL: vi.fn() };
    return { anchor, doc, url };
  }

  it('triggers a download of a blob with the given name and type', async () => {
    const { anchor, doc, url } = fakeEnv();
    download('nearby.csv', 'a,b', 'text/csv', { doc, url });
    expect(doc.createElement).toHaveBeenCalledWith('a');
    expect(anchor.download).toBe('nearby.csv');
    expect(anchor.href).toBe('blob:1');
    expect(anchor.click).toHaveBeenCalled();
    expect(anchor.remove).toHaveBeenCalled();
    const blob = url.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('text/csv');
    expect(await blob.text()).toBe('a,b');
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });

  it('prepends a UTF-8 BOM when asked (so Excel reads Indic scripts correctly)', async () => {
    const { doc, url } = fakeEnv();
    download('x.csv', 'ಹಾಲು', 'text/csv', { doc, url, bom: true });
    const blob = url.createObjectURL.mock.calls[0][0];
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
