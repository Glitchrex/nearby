# Contributing to nearby

Thanks for helping! Bug reports, OSM tag suggestions, docs fixes and code are all welcome. Check [docs/good-first-issues.md](docs/good-first-issues.md) if you are looking for a place to start.

## Setup

```sh
git clone https://github.com/glitchrex/nearby.git && cd nearby
npm ci                                            # dev tooling only
python3 -m http.server 8000 --directory src      # run the app at http://localhost:8000
```

The app is plain ES modules with no bundler: edit a file and reload the page.

## Before you open a pull request

```sh
npm test          # all tests pass
npm run lint      # ESLint + Prettier --check (use `npm run format` to fix formatting)
npm run coverage  # keep src/lib coverage above the thresholds in vitest.config.js
```

CI runs the same checks on Node 20 and 22.

## Guidelines

- **Tests first for `src/lib`.** Every module in `src/lib` has a matching file in `tests/`. Add or update tests with each change; `fetch`, storage, timers and `sleep` are injected so nothing needs a browser.
- **Keep the core pure.** Only `src/main.js` may touch the DOM, `window`, `navigator` or Leaflet.
- **Never use `innerHTML` with data.** OSM names and tags are user-generated. Use `textContent` / `createElement` (see the `h()` helper in `main.js`) and `safeUrl()` for any link.
- **No new runtime dependencies** and no build step. Dev dependencies need a justification in the commit message.
- **Never commit API keys.** Keys belong in the Settings dialog (localStorage) only.
- Keep functions small, avoid dead code, and don't leave TODOs behind: open an issue instead.
- Adding or changing a category? Edit `src/lib/categories.js` (the query and the classifier share it), add classifier tests, and map it to Google types in `src/lib/providers/google-places.js`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`, `refactor:`. One logical change per commit.

## Reporting bugs

Use the bug report template. Include the shared URL (the `?lat=…` link) if you are comfortable sharing the location, plus the browser and what the status line said.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
