## What & why

<!-- What does this change and why? Link the issue: Closes #… -->

## How it was tested

- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] Tried it in the browser (`python3 -m http.server 8000 --directory src`)

## Checklist

- [ ] Tests added/updated for any `src/lib` change
- [ ] No `innerHTML` with OSM/Google data; links go through `safeUrl()`
- [ ] No new runtime dependencies; any new dev dependency is justified
- [ ] No API keys or secrets committed
- [ ] README updated if behaviour changed
