# nearby

[![CI](https://github.com/glitchrex/nearby/actions/workflows/ci.yml/badge.svg)](https://github.com/glitchrex/nearby/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/glitchrex/nearby/actions/workflows/pages.yml/badge.svg)](https://github.com/glitchrex/nearby/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Pick a point and a radius and see every shop, grocery, mall, hospital, pharmacy, restaurant and bank or ATM inside it. Uses OpenStreetMap data, with no backend and no API key.**

> **Demo GIF:** _placeholder, to be recorded and saved as `docs/demo.gif`._
>
> **Live demo:** _placeholder, will be <https://glitchrex.github.io/nearby/> once GitHub Pages is enabled (Settings → Pages → Source: GitHub Actions)._

## Quickstart

```sh
git clone https://github.com/glitchrex/nearby.git && cd nearby
python3 -m http.server 8000 --directory src      # or: npm start
# open http://localhost:8000
```

That's all. There is no build step and nothing to install to _run_ it. Node is only needed for tests and linting.

## Features

- **Location:** "Use my location" (with clear messages when access is denied, unavailable, or times out), click the map, drag the pin, "Use map centre", or type coordinates. The latitude field also accepts a pasted `lat, lon` pair.
- **Radius:** 500 m, 1 km, 2 km or 5 km. The circle is redrawn at once, and the search re-runs after 700 ms so quick changes are combined into one request.
- **Categories:** Grocery, Malls, Health, Food, Banks & ATMs, and Other shops. Each chip toggles on or off and only selected categories are queried. "Other shops" only collects shops that no other category claims.
- **Results:** a list sorted by distance. Clicking a row pans the map and opens a popup with opening hours, phone, address, website and an OpenStreetMap link, when those are known.
- A new search **cancels the one in flight**. Loading, empty and error states tell you what to do next (Retry, try a larger radius, check your connection, and so on).
- **Filter** results by name, and optionally hide unnamed places.
- **Export** the current results (after filtering) as **CSV** or **JSON**. The CSV is UTF-8 with a BOM, so Kannada and Hindi names open correctly in Excel.
- **Shareable URL:** `?lat=12.97160&lon=77.59460&r=1000&cats=grocery,food` restores the location, radius and categories. "Copy link" copies it.
- **Dark mode** follows `prefers-color-scheme` and switches the map to dark tiles. You can also force light or dark in Settings.
- **Optional Google Places** data source, using your own key ([see billing](#google-places-billing)).
- **Optional walking-distance sort** through the OpenRouteService matrix API, using your own key.
- **Accessibility:** native, keyboard-operable controls, visible focus, an `aria-live` status line, a layout that works down to 360 px wide, and support for `prefers-reduced-motion`.

## How it works

1. You choose a point, a radius and some categories.
2. `src/lib/overpass.js` builds an [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL) query containing **only** the filters for the selected categories. For example, Food plus Banks within 1 km:

   ```
   [out:json][timeout:25];
   (
     nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream|bank|atm)$"](around:1000,12.971600,77.594600);
   );
   out center tags;
   ```

   - `nwr` searches **n**odes, **w**ays and **r**elations, so a mall mapped as a building outline is still found.
   - `around:R,lat,lon` is Overpass's radius filter.
   - `out center tags` returns a single centre point for each way or relation instead of its full geometry, which keeps responses small.
   - Filters that share a tag key are merged into one regex. If "Other shops" (`["shop"]`) is selected, it makes the more specific `shop` filters redundant, so they are dropped.

3. The query is POSTed to `overpass-api.de`. On **429 or 504** the same server is retried with exponential backoff (1 s, then 2 s, or the server's `Retry-After` value, capped at 15 s). After that, or straight away on other errors, the next mirror is tried (`overpass.kumi.systems`, then `overpass.private.coffee`). Each attempt has a 30 s timeout. All of this is cancelled through an `AbortController` as soon as you change the search.
4. The response is parsed into `Place` objects:
   - Ways and relations use their `center` as their position.
   - Duplicates are removed by `type/id`.
   - Each place is classified by `src/lib/categories.js`, the same definitions that built the query.
   - Places outside the circle are dropped, since `around` matches any part of a way, not just its centre.
   - The rest are sorted by haversine distance.
5. Raw responses are cached in `localStorage` for 10 minutes, up to 20 queries, so repeating a search or toggling back to an earlier radius is instant and doesn't touch Overpass.

Every data source implements the same interface (`src/lib/providers/`):

```js
search({ lat, lon, radiusM, categories, signal }) → Promise<Place[]>
```

**Security:** OSM names and tags are written by users, so all of them are rendered with `textContent` or `createElement`, never `innerHTML`. Map popups are DOM nodes, not HTML strings. Links are only created for `http(s)` URLs (so `javascript:` URLs in `website` tags are ignored) and for `tel:` numbers. CSV cells that start with `= + - @` get a leading `'` so spreadsheets don't run them as formulas.

## Data sources compared

| Source                         | Cost / key                                       | Coverage (India in particular)                                                                                       | Live query from a static page?                                               | Licence & caveats                                                                                   | In this app         |
| ------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------- |
| **OpenStreetMap via Overpass** | Free, no key                                     | Good for hospitals, banks, ATMs, chains and malls; **patchy for small shops** (kiranas, chemists) outside big cities | Yes (CORS enabled)                                                           | ODbL; you must credit contributors. Public servers are shared and rate-limited.                     | Default             |
| **Google Places API (New)**    | Paid per request, needs your billing-enabled key | Usually the most complete, including small shops                                                                     | Yes (CORS enabled)                                                           | Proprietary. Terms limit caching and require Google attribution. At most **20 results per request** | Optional (Settings) |
| **Foursquare Places API**      | Key needed; free tier, then paid                 | Strong for food and venues, weaker for utilities                                                                     | Yes, but the key would be visible in the browser                             | Proprietary                                                                                         | Not implemented     |
| **Overture Maps (Places)**     | Free open data                                   | Large and growing POI set, from Meta and Microsoft sources                                                           | **No:** bulk GeoParquet downloads only, so it needs your own tiles or an API | CDLA-Permissive-2.0 / ODbL                                                                          | Not implemented     |

### Google Places billing

- With Google selected, each search sends **one Nearby Search (New) request per selected category**, because Google returns at most 20 places per request. All 6 categories means **6 billable requests per search**, and changing the radius or categories re-runs the search.
- The app asks for phone, website and opening hours. That puts every request in Google's **higher-priced (Enterprise) Nearby Search tier**.
- Google's prices and free monthly allowances change, so check the current [Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing) before you use this.
- Protect yourself:
  - Restrict the key to the **Places API (New)** and to your site's HTTP referrer.
  - Set a daily quota.
  - Add a budget alert in Google Cloud.
- Google results are **not** cached by the app.
- The key is stored only in this browser's `localStorage` and sent only to `places.googleapis.com`. It never appears in the URL, in exports, or in the repository.

### Walking distance (OpenRouteService)

- Paste a free [OpenRouteService](https://openrouteservice.org/dev/#/signup) key in Settings, then choose **Sort → Walking distance**.
- One `foot-walking` matrix request is made per search, for the **50 nearest places** (by straight line) only, to stay within free-tier limits. The rest keep their straight-line distance and are listed after them.
- If the key is missing or rejected, or the service can't be reached, the list stays in straight-line order and the status line says why.
- The key is stored only in `localStorage` and sent only to `api.openrouteservice.org`.

## Limitations

- **OSM coverage gaps.** Many small kirana stores, chemists and street-food stalls in India aren't mapped yet, and opening hours or phone numbers are often missing. An empty result means "not in OSM", not "nothing there". You can fix that by [adding the places to OpenStreetMap](https://www.openstreetmap.org/fixthemap).
- **Public Overpass rate limits.** The public servers are shared and limit how many queries each IP address can run. Heavy use (many 5 km searches in a row) will get 429 responses. The app backs off, tries other mirrors, and then asks you to wait a minute. Large radii in dense cities can also time out; a smaller radius helps.
- **Distances are straight-line** (haversine) unless you enable walking distance, and walking distance only covers the 50 nearest places.
- **Google Places** returns at most 20 places per category per search, so results in dense areas are incomplete.
- **Map tiles:** the light map uses the OpenStreetMap Foundation's tile servers, and the dark map uses CARTO's free basemap. Both are meant for light use. A high-traffic deployment should switch to its own or a commercial tile provider.
- There is no marker clustering yet, so dense areas at 5 km get crowded on the map.

## Privacy

- There is no backend, account, analytics or cookies.
- **Your location stays in your browser, apart from the map data query.** The chosen coordinates are sent:
  - to the Overpass server(s) as part of the query;
  - to Google or OpenRouteService, only if you enabled them with your own key.
- Map tile requests reveal which area of the map you are **viewing** (not your GPS position) to the tile server (OpenStreetMap or CARTO). Every web map works this way.
- Stored locally in `localStorage`: your settings (and keys, if you added them), plus a 10-minute cache of Overpass responses, which includes the query coordinates.
- The page URL contains the search location, so only share links you're happy to share.
- Leaflet is loaded from unpkg with a Subresource Integrity hash. No location data is sent to unpkg.

## Development

```sh
npm ci              # dev tooling only: Vitest, ESLint, Prettier
npm test            # unit tests (tests/ mirrors src/lib)
npm run coverage    # tests with coverage report; CI fails if src/lib line coverage drops below 90%
npm run lint        # ESLint and Prettier --check
npm run format      # Prettier --write
```

```
src/
  index.html, style.css, main.js   UI (main.js is the only file that touches the DOM or Leaflet)
  lib/geo.js                        haversine, boundingBox, formatDistance, isValidLatLon
  lib/categories.js                 category definitions, classifier, Overpass filters
  lib/overpass.js                   query builder, fetch with mirrors/retry/timeout, parser, cache
  lib/providers/                    overpass.js (default), google-places.js (optional), index.js
  lib/walking.js                    OpenRouteService matrix and sorting
  lib/export.js                     CSV/JSON export and download helper
  lib/urlState.js                   ?lat=&lon=&r=&cats= read/write
  lib/format.js, messages.js, settings.js, errors.js, debounce.js
tests/                              Vitest, mirrors src/lib
.github/workflows/                  ci.yml (Node 20 and 22), pages.yml (deploys src/)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [good first issues](docs/good-first-issues.md).

## Roadmap

- [ ] Petrol pumps / fuel category
- [ ] Marker clustering for dense results
- [ ] Interface translations (Kannada, Hindi, …)
- [ ] "Open now" filter that parses `opening_hours`
- [ ] Print / PDF view of results
- [ ] Place search by name or address (Nominatim)
- [ ] Offline-capable PWA with cached tiles for the last searched area

## License

[MIT](LICENSE). Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL.
