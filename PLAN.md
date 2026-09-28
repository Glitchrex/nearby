# nearby — Implementation Plan

> Status: **awaiting approval**. No application code is written until this plan is approved.

`nearby/index.html` does not exist in this repo, so the app is built from scratch.
The repository root *is* `nearby/`, so `src/`, `tests/`, etc. live at the root.

## 1. Architecture

A static, backend-free single page app. Everything runs in the browser.

```
            ┌────────────── main.js (UI glue, the only file touching the DOM/Leaflet) ──────────────┐
 user ───►  │ location controls · radius · chips · filter · results list · export · settings panel │
            └───────┬───────────────┬────────────────┬───────────────┬───────────────┬────────────┘
                    │               │                │               │               │
               lib/urlState    lib/geo      lib/providers/index   lib/export     lib/walking
               (URL <-> state) (math)       (pick provider)       (CSV/JSON)     (ORS matrix, optional)
                                                 │
                              ┌──────────────────┴──────────────────┐
                    providers/overpass.js (default)       providers/google-places.js (optional, user key)
                              │
                       lib/overpass.js  ── query builder · fetch w/ mirrors · timeout · retry/backoff
                              │             · AbortController · localStorage TTL cache · parser
                       lib/categories.js ── category defs (Overpass filters, classifier, colour)
```

Design principles

- **Pure core, thin shell.** Every `src/lib` module is pure or takes its side-effecting
  dependencies as parameters (`fetch`, `storage`, `now`, `sleep`) so it is unit-testable
  in Node without a DOM. `main.js` is the only place that touches `document`, `navigator`,
  `window.location` or Leaflet.
- **One search pipeline.** `state change → debounce(700 ms) → abort previous → provider.search()
  → optional walking-distance enrich → render`. A monotonically increasing request id guards
  against late responses.
- **Safe rendering.** All OSM/Google strings are rendered via `textContent` /
  `document.createElement`. Leaflet popups receive a DOM node, never an HTML string.
  Links are only emitted for `http(s):` URLs (blocks `javascript:` in `website` tags).
- **No build step.** Native ES modules, Leaflet 1.9.4 from unpkg with SRI hash,
  OSM raster tiles (light) and CARTO "dark_all" tiles (dark), attribution shown.

### State model (single object in `main.js`)

```js
{ lat, lon, radiusM, categories: Set<id>, filterText, hideUnnamed,
  sort: 'straight' | 'walking', provider: 'overpass' | 'google', tileTheme: 'auto'|'light'|'dark' }
```

Only `lat, lon, r, cats` are mirrored to the URL (shareable); keys and preferences live in
`localStorage`.

## 2. File tree

```
.
├── src/
│   ├── index.html
│   ├── style.css
│   ├── main.js
│   └── lib/
│       ├── geo.js               haversine, boundingBox, formatDistance, isValidLatLon
│       ├── categories.js        CATEGORIES[], classify(tags), overpassFilters(ids)
│       ├── overpass.js          buildQuery, parseResponse, fetchWithFallback, cache helpers
│       ├── export.js            toCSV, toJSON, download
│       ├── urlState.js          readState(search), writeState(state) -> query string
│       ├── walking.js           ORS matrix request + merge walking distances (optional)
│       ├── debounce.js          tiny debounce used by main.js
│       └── providers/
│           ├── index.js         getProvider(name, opts)
│           ├── overpass.js      default provider (wraps lib/overpass.js)
│           └── google-places.js optional, Places API (New) searchNearby, user key
├── tests/                       mirrors src/lib (geo, categories, overpass, export,
│   └── providers/                urlState, walking, debounce, providers/*)
├── .github/
│   ├── workflows/ci.yml         npm ci · eslint · prettier --check · vitest (Node 20, 22)
│   ├── workflows/pages.yml      deploy src/ to GitHub Pages on push to main
│   ├── ISSUE_TEMPLATE/bug_report.md, feature_request.md
│   └── pull_request_template.md
├── docs/good-first-issues.md    5 drafts
├── package.json, package-lock.json, eslint.config.js, .prettierrc, .prettierignore,
│   vitest.config.js, .gitignore, .editorconfig
├── README.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, LICENSE (existing MIT, kept)
└── PLAN.md
```

## 3. Provider interface

```js
/**
 * @typedef {Object} Place
 * @property {string} id          stable, provider-prefixed ("osm:node/123", "google:ChIJ...")
 * @property {string} name        "" when unnamed
 * @property {string} category    one of CATEGORIES ids
 * @property {number} lat
 * @property {number} lon
 * @property {number} distanceM   straight-line from search centre
 * @property {number|null} walkingM  filled by walking.js when enabled
 * @property {{hours?, phone?, address?, website?}} details
 * @property {string|null} sourceUrl  OSM / Google Maps link
 * @property {Object} raw          original tags (for JSON export)
 */

/** Provider: { id, label, search({lat, lon, radiusM, categories, signal}) => Promise<Place[]> } */
```

Every provider returns places already **filtered to `distanceM <= radiusM`, deduped, and
sorted by distance**. Errors are thrown as a typed `SearchError` with a `kind`
(`'rate-limit' | 'timeout' | 'network' | 'offline' | 'bad-response' | 'auth' | 'aborted'`)
so the UI can show actionable wording.

### Overpass details

- Query: `[out:json][timeout:25];( nwr[<filter>](around:R,lat,lon); … );out center tags;`
  one `nwr` line per Overpass filter of each *selected* category only.
- "Other shops" = `nwr[shop]` minus shops claimed by other categories; the classifier decides
  (so "Other" only catches leftovers even though the query is broad).
- Parse: nodes use `lat/lon`, ways/relations use `center`. Dedupe by `type/id`, drop
  elements without coordinates, compute distance, filter by radius, sort.
- Mirrors: `overpass-api.de` → `overpass.kumi.systems` → `overpass.private.coffee`.
- Per-attempt timeout 30 s via `AbortController` (linked to the caller's signal).
- 429/504: exponential backoff (1 s, 2 s, 4 s; honours `Retry-After`), then next mirror.
  Other 5xx / network errors: next mirror immediately. Caller abort stops everything.
- Cache: `localStorage` key = hash of the query string, TTL 10 min, size-capped (LRU of
  ~20 entries), silently skipped when storage is unavailable/full.

### Google Places (optional)

- `POST https://places.googleapis.com/v1/places:searchNearby` with `X-Goog-Api-Key` and a
  minimal `X-Goog-FieldMask`. Our categories map to Google `includedTypes`.
- Limits: max 20 results per request and radius ≤ 50 km; one request per selected category
  (≤ 6), merged and deduped. The UI states "Google returns at most 20 per category".
- Key stored only in `localStorage` (`nearby.googleKey`), sent only to googleapis.com.

### Walking distance (optional)

- `POST https://api.openrouteservice.org/v2/matrix/foot-walking`, 1 source × N destinations,
  key in `Authorization` header, stored in `localStorage` (`nearby.orsKey`).
- Only the nearest 50 places (straight-line) are enriched, to stay inside the free-tier
  matrix limit; others keep `walkingM = null` and sort after them. Documented in README.

## 4. Test plan (Vitest, tests written before each lib module)

| Module | Cases |
| --- | --- |
| geo | haversine vs known pairs (London–Paris ≈ 343.5 km, Bengaluru–Mysuru ≈ 128 km, NYC–LA ≈ 3936 km, same point = 0, antimeridian); boundingBox contains circle, poles clamp; formatDistance edges (0, 999 → "999 m", 1000 → "1.0 km", 9 999, rounding, negative/NaN rejected); isValidLatLon |
| categories | classifier per category (supermarket, mall, hospital/clinic/pharmacy, restaurant/cafe/fast_food, bank/atm), shop=convenience → grocery, shop=clothes → other, amenity=bank + atm → banks, no match → null; "Other" never wins when a specific category matches; overpassFilters only for selected ids |
| overpass | buildQuery for every one of the 63 non-empty category combinations × 4 radii (snapshot of structure + contains exactly the selected filters); coordinate formatting; parse node/way/relation (center); dedupe; drop missing coords; distance filtering; mirror fallback, 429 & 504 retry with backoff and `Retry-After` (mocked fetch + fake sleep); timeout; abort; cache hit/miss/expiry/quota-error |
| providers | overpass provider contract; google-places request shape, response mapping, auth error, dedupe across categories |
| walking | request shape, merge, cap at 50, error → graceful fallback |
| export | CSV quotes (`"` → `""`), commas, CR/LF newlines, leading `=+-@` formula-injection guard, Kannada (ಬೆಂಗಳೂರು) & Hindi (दिल्ली) names, UTF-8 BOM for Excel; JSON shape |
| urlState | round-trip; invalid lat/lon/r/cats rejected individually (NaN, out of range, radius not in allowed set, unknown category); missing params → defaults |
| debounce | fires once after delay, trailing call wins, cancel |

Coverage: `@vitest/coverage-v8`, thresholds ≥ 90 % lines on `src/lib` (enforced in CI).

**Manual / browser verification** (headless Chromium via Playwright script, not committed as a
dependency — run ad-hoc): locate (mocked geolocation), 1 km radius, circle + results,
CSV export, URL share/restore, geolocation **denied**, **offline**, **empty area**,
**Overpass 429** (mocked via request interception). Results reported in the final summary.

## 5. Milestones (one conventional commit each, tests + lint green before commit)

1. `docs: add implementation plan` — this file.
2. `chore: add tooling` — package.json, ESLint (flat config), Prettier, Vitest, .gitignore,
   .editorconfig. Dev deps: `vitest`, `@vitest/coverage-v8`, `eslint`, `@eslint/js`,
   `globals`, `prettier` (each justified in the commit message).
3. `feat(geo): …` — tests then implementation of geo.js + debounce.js.
4. `feat(categories): …` — tests then categories.js.
5. `feat(overpass): …` — tests then overpass.js + providers/overpass.js + providers/index.js.
6. `feat(export): …` and `feat(url-state): …` — tests then modules.
7. `feat(ui): …` — index.html, style.css, main.js: map, location (GPS/click/drag/inputs),
   radius, chips, results, popups, states, filter, hide-unnamed, export, URL state, dark mode.
8. `feat(providers): …` — Google Places provider + settings panel; ORS walking sort.
9. `ci: …` — ci.yml, pages.yml.
10. `docs: …` — README (badges, how it works, comparison table, limitations, privacy,
    roadmap), CONTRIBUTING, CODE_OF_CONDUCT, templates, good-first-issues.
11. Browser verification pass + any `fix:` commits, then final summary.

## 6. Known environment constraint

The sandbox this is built in **cannot reach** `overpass-api.de`, `unpkg.com` or
`tile.openstreetmap.org` (egress blocked). Browser verification will therefore use
recorded/mocked Overpass responses and a locally served Leaflet copy via request
interception. Real-network behaviour will be verified by unit tests with mocked `fetch`
only; I will state that clearly in the final report.
