# Good first issues (drafts)

Ready-to-file issue drafts. Each one lists where to look and what "done" means. Copy one into a new GitHub issue and add the `good first issue` label.

---

## 1. Add a "Petrol pumps" category

**Why:** fuel stations are a common "what's nearby" need, and OSM maps them well (`amenity=fuel`).

**Where:**

- `src/lib/categories.js`: add `{ id: 'fuel', label: 'Petrol pumps', color: '#…', filters: [{ key: 'amenity', values: ['fuel'] }] }`. Put it before `other` so that "Other shops" stays the last category.
- `src/lib/providers/google-places.js`: map `fuel` to `['gas_station']` in `GOOGLE_TYPES`.
- `tests/categories.test.js`: update the expected id and label lists, and add classifier cases (`amenity=fuel` → `fuel`; a fuel station with `shop=convenience` is classified in display order).
- `tests/overpass.test.js`: the combinations test uses `CATEGORY_IDS`, so it will cover 127 combinations automatically. Update the `63` assertion.
- README: the features list.

**Done when:** the chip appears, the query includes `["amenity"="fuel"]` only when the chip is selected, the URL `cats=fuel` works, and all tests pass.

---

## 2. Marker clustering for dense results

**Why:** a 5 km search in central Bengaluru can return thousands of markers, which is hard to read.

**Approach:** load [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) from a CDN with an SRI hash, like Leaflet itself. There must be no bundler and no npm runtime dependency. In `src/main.js`, replace the `markers` layer group with a cluster group, and style cluster icons by the dominant category or keep the defaults.

**Watch out for:**

- `focusPlace()` must still open the popup when the marker is inside a cluster (`zoomToShowLayer`).
- Keep `preferCanvas` behaviour or check that performance holds.
- Respect `prefers-reduced-motion` (turn off cluster animations).

**Done when:** clusters appear at low zoom, clicking a list row still opens the right popup, there are no console errors, and the README limitations section is updated.

---

## 3. Internationalisation (i18n): Kannada and Hindi UI

**Why:** most places near our main users have names in Kannada or Hindi, but the interface is English-only.

**Approach:**

- Add `src/lib/i18n.js` with a `t(key, params)` function and message catalogues (`en`, `kn`, `hi`). Pick the language from `navigator.languages` with an optional `?lang=` override, and set `<html lang>` to match.
- Move the strings from `src/lib/messages.js`, `categories.js` labels and `main.js` into the catalogues. Static text in `index.html` needs `data-i18n` attributes.
- Use `Intl.NumberFormat` in `formatDistance` for locale digits and decimal separators, and add tests.

**Done when:** switching `?lang=kn` shows a fully Kannada UI, tests cover the fallback to English for missing keys, and screen readers announce the status in the right language.

---

## 4. "Open now" filter

**Why:** people often want to know what they can visit right now.

**Approach:**

- Add a pure `isOpenNow(openingHours, date)` in `src/lib/hours.js` that supports the common subset of the [`opening_hours`](https://wiki.openstreetmap.org/wiki/Key:opening_hours) syntax: `24/7`, `Mo-Fr 09:00-18:00`, several rules separated by `;`, `off`, and ranges that run past midnight. Anything it can't parse returns `null` (unknown).
- Add a checkbox "Open now" next to "Hide unnamed". Unknown hours should be neither shown as open nor hidden silently; show a count ("12 hidden: hours unknown").
- Write the tests first, with fixed dates and times (don't rely on today's date).

**Done when:** the filter works on real OSM strings from the tests, unknown hours are handled as described, and the README explains how far the parser goes.

---

## 5. Print / PDF view

**Why:** some users want a paper list (for example, the pharmacies near an elderly relative's home).

**Approach:** add a `@media print` block to `src/style.css`:

- Hide the controls and the map, or print the map at a fixed height.
- Print the results as a table with name, category, distance, address, phone and hours.
- Add a header with the search centre, the radius and the date.

Add a "Print" button that calls `window.print()`. Browsers already offer "Save as PDF" in the print dialog, so no library is needed.

**Done when:** printing from Chrome and Firefox produces a readable list on A4 without cut-off text, and the Kannada and Hindi names render correctly.
