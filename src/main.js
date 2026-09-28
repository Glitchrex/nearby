import { CATEGORIES, getCategory } from './lib/categories.js';
import { debounce } from './lib/debounce.js';
import { download, toCSV, toJSON } from './lib/export.js';
import {
  filterPlaces,
  parseLatLonInput,
  placeTitle,
  radiusLabel,
  safeUrl,
  telHref,
} from './lib/format.js';
import { formatDistance } from './lib/geo.js';
import { geolocationMessage, searchErrorMessage } from './lib/messages.js';
import { createProvider } from './lib/providers/index.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import { RADII_M, readState, writeState } from './lib/urlState.js';
import { addWalkingDistances, sortPlaces } from './lib/walking.js';

const SEARCH_DEBOUNCE_MS = 700;
const FILTER_DEBOUNCE_MS = 150;
const PLACE_ZOOM = 17;
const CIRCLE_COLOR = '#4c8bf5';

const TILES = {
  light: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: {
      maxZoom: 20,
      subdomains: 'abcd',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
};

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
// Matches the single-column breakpoint in style.css, where the map sits above the list.
const narrowLayout = window.matchMedia('(max-width: 760px)');

const $ = (id) => document.getElementById(id);
const ui = {
  status: $('status'),
  results: $('results'),
  radius: $('radius'),
  categories: $('categories'),
  coordsForm: $('coords-form'),
  lat: $('lat'),
  lon: $('lon'),
  locate: $('locate'),
  useCenter: $('use-center'),
  filter: $('filter'),
  hideUnnamed: $('hide-unnamed'),
  sort: $('sort'),
  exportCsv: $('export-csv'),
  exportJson: $('export-json'),
  copyLink: $('copy-link'),
  settings: $('settings'),
  settingsForm: $('settings-form'),
  settingsOpen: $('settings-open'),
  settingsClear: $('settings-clear'),
  googleKey: $('google-key'),
  orsKey: $('ors-key'),
};

let settings = loadSettings(storage);
const state = {
  ...readState(window.location.search),
  filterText: '',
  hideUnnamed: false,
  places: [],
  visible: [],
  providerId: 'overpass',
  notice: '',
  selectedId: null,
  lastErrorKind: null,
};

/** Create an element. Text is always assigned via textContent, never parsed as HTML. */
function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key === 'style')
      for (const [p, v] of Object.entries(value)) node.style.setProperty(p, v);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

const actionButton = (text, onclick) =>
  h('button', { type: 'button', class: 'button', text, onclick });

function setStatus(text, kind = 'info', actions = []) {
  ui.status.dataset.kind = kind;
  ui.status.replaceChildren(
    h('span', { text }),
    ...(actions.length ? [h('div', {}, actions)] : []),
  );
}

const animate = () => !reducedMotion.matches;

// ---------------------------------------------------------------- map

let map;
let markers;
let circle;
let pin;
const markerById = new Map();

function createMap() {
  map = L.map('map', { preferCanvas: true, worldCopyJump: true }).setView([20, 0], 2);
  markers = L.layerGroup().addTo(map);
  circle = L.circle([0, 0], {
    radius: state.radiusM,
    color: CIRCLE_COLOR,
    weight: 2,
    fillOpacity: 0.08,
    interactive: false,
  });
  pin = L.marker([0, 0], {
    draggable: true,
    autoPan: true,
    title: 'Search centre: drag to move',
    alt: 'Search centre',
  });
}

let tileLayer = null;

function applyTiles() {
  const theme =
    settings.tileTheme === 'auto' ? (darkScheme.matches ? 'dark' : 'light') : settings.tileTheme;
  if (tileLayer?.options.theme === theme) return;
  tileLayer?.remove();
  const { url, options } = TILES[theme];
  tileLayer = L.tileLayer(url, { ...options, theme }).addTo(map);
}

function fitCircle() {
  map.fitBounds(circle.getBounds(), { padding: [16, 16], animate: animate() });
}

// ---------------------------------------------------------------- state changes

function syncUrl() {
  window.history.replaceState(null, '', `${window.location.pathname}${writeState(state)}`);
}

function setLocation(lat, lon, { fit = true, immediate = false } = {}) {
  state.lat = lat;
  state.lon = lon;
  pin.setLatLng([lat, lon]).addTo(map);
  circle.setLatLng([lat, lon]).addTo(map);
  ui.lat.value = lat.toFixed(5);
  ui.lon.value = lon.toFixed(5);
  clearFieldErrors();
  syncUrl();
  if (fit) fitCircle();
  scheduleSearch();
  if (immediate) scheduleSearch.flush();
}

function setRadius(radiusM) {
  state.radiusM = radiusM;
  circle.setRadius(radiusM);
  syncUrl();
  if (state.lat !== null) fitCircle();
  scheduleSearch();
}

function toggleCategory(id) {
  const selected = new Set(state.categories);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  state.categories = CATEGORIES.map((c) => c.id).filter((c) => selected.has(c));
  renderChips();
  syncUrl();
  scheduleSearch();
}

// ---------------------------------------------------------------- searching

let searchController = null;
let walkingController = null;
let searchSeq = 0;

function cancelInFlight() {
  searchController?.abort();
  walkingController?.abort();
}

function setBusy(busy) {
  ui.results.setAttribute('aria-busy', String(busy));
}

async function runSearch() {
  cancelInFlight();
  const seq = ++searchSeq;
  if (state.lat === null) {
    setStatus('Pick a location: use your location, click the map, or enter coordinates.');
    return;
  }
  if (state.categories.length === 0) {
    state.places = [];
    render();
    setStatus('Select at least one category to search.');
    return;
  }

  searchController = new AbortController();
  const { signal } = searchController;
  const provider = createProvider(settings.provider, { googleKey: settings.googleKey, storage });
  state.providerId = provider.id;
  setBusy(true);
  setStatus(`Searching within ${radiusLabel(state.radiusM)}…`, 'loading');
  try {
    const places = await provider.search({
      lat: state.lat,
      lon: state.lon,
      radiusM: state.radiusM,
      categories: state.categories,
      signal,
    });
    if (seq !== searchSeq) return;
    state.places = places;
    state.notice = '';
    state.lastErrorKind = null;
    render();
    if (settings.sort === 'walking') await enrichWalking(seq);
  } catch (err) {
    if (err.kind === 'aborted' || seq !== searchSeq) return;
    state.places = [];
    state.lastErrorKind = err.kind;
    render();
    setStatus(searchErrorMessage(err), 'error', [actionButton('Retry', runSearch)]);
  } finally {
    if (seq === searchSeq) setBusy(false);
  }
}

const scheduleSearch = debounce(runSearch, SEARCH_DEBOUNCE_MS);

function walkingFailure(err) {
  const reason =
    err.kind === 'auth'
      ? 'the OpenRouteService key was rejected (check Settings)'
      : 'OpenRouteService could not be reached';
  return `Walking distances unavailable: ${reason}. Sorted by straight-line distance.`;
}

async function enrichWalking(seq = searchSeq) {
  if (!state.places.length) return;
  if (!settings.orsKey) {
    state.notice =
      'Add an OpenRouteService key in Settings to sort by walking distance. Sorted by straight-line distance.';
    render();
    return;
  }
  walkingController?.abort();
  walkingController = new AbortController();
  setStatus('Calculating walking distances…', 'loading');
  try {
    const places = await addWalkingDistances(state.places, {
      lat: state.lat,
      lon: state.lon,
      apiKey: settings.orsKey,
      signal: walkingController.signal,
    });
    if (seq !== searchSeq) return;
    state.places = places;
    state.notice = '';
  } catch (err) {
    if (err.kind === 'aborted' || seq !== searchSeq) return;
    state.notice = walkingFailure(err);
  }
  render();
}

// ---------------------------------------------------------------- rendering

function distanceText(place) {
  const straight = formatDistance(place.distanceM);
  return place.walkingM === null ? straight : `${formatDistance(place.walkingM)} walk`;
}

function detailRow(label, value) {
  return value ? [h('dt', { text: label }), h('dd', {}, [value])] : [];
}

function externalLink(href, text) {
  return h('a', { href, text, target: '_blank', rel: 'noopener noreferrer' });
}

function buildPopup(place) {
  const { details } = place;
  const category = getCategory(place.category);
  const tel = telHref(details.phone);
  const website = safeUrl(details.website);
  const source = safeUrl(place.sourceUrl);
  const meta = [category.label, `${formatDistance(place.distanceM)} away`];
  if (place.walkingM !== null) meta.push(`${formatDistance(place.walkingM)} walk`);

  const dl = h('dl', {}, [
    ...detailRow('Hours', details.hours),
    ...detailRow(
      'Phone',
      details.phone && (tel ? h('a', { href: tel, text: details.phone }) : details.phone),
    ),
    ...detailRow('Address', details.address),
    ...detailRow('Website', website && externalLink(website, new URL(website).host)),
  ]);
  const sourceLabel = place.id.startsWith('google:')
    ? 'View on Google Maps'
    : 'View on OpenStreetMap';
  return h('div', { class: 'popup' }, [
    h('h3', { text: placeTitle(place) }),
    h('p', { text: meta.join(' · ') }),
    ...(dl.childElementCount ? [dl] : []),
    ...(source ? [externalLink(source, sourceLabel)] : []),
  ]);
}

function renderMarkers(places) {
  markers.clearLayers();
  markerById.clear();
  for (const place of places) {
    const marker = L.circleMarker([place.lat, place.lon], {
      radius: 7,
      color: '#ffffff',
      weight: 1.5,
      fillColor: getCategory(place.category).color,
      fillOpacity: 0.95,
      bubblingMouseEvents: false,
    })
      .bindPopup(() => buildPopup(place), { maxWidth: 280 })
      .on('click', () => markSelected(place.id, { scroll: true }));
    marker.addTo(markers);
    markerById.set(place.id, marker);
  }
}

function resultItem(place) {
  const category = getCategory(place.category);
  return h('li', {}, [
    h(
      'button',
      {
        type: 'button',
        class: 'result',
        'data-id': place.id,
        'aria-current': String(place.id === state.selectedId),
      },
      [
        h('span', {
          class: 'dot',
          style: { '--dot-color': category.color },
          'aria-hidden': 'true',
        }),
        h('span', { class: 'result-name', text: placeTitle(place) }),
        h('span', { class: 'result-distance', text: distanceText(place) }),
        h('span', { class: 'result-meta', text: category.label }),
      ],
    ),
  ]);
}

function renderList(places) {
  const fragment = document.createDocumentFragment();
  for (const place of places) fragment.append(resultItem(place));
  ui.results.replaceChildren(fragment);
}

function renderChips() {
  const counts = new Map();
  for (const p of state.places) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  for (const chip of ui.categories.querySelectorAll('.chip')) {
    const { id } = chip.dataset;
    const selected = state.categories.includes(id);
    chip.setAttribute('aria-pressed', String(selected));
    chip.querySelector('.count').textContent =
      selected && state.places.length ? String(counts.get(id) ?? 0) : '';
  }
}

function summaryStatus() {
  const total = state.places.length;
  const shown = state.visible.length;
  const within = `within ${radiusLabel(state.radiusM)}`;
  const actions = [];
  let text;
  if (total === 0) {
    text = `No places found ${within} for the selected categories. Try a larger radius or more categories; small shops are sometimes missing from OpenStreetMap.`;
    const larger = RADII_M.find((r) => r > state.radiusM);
    if (larger)
      actions.push(actionButton(`Search ${radiusLabel(larger)}`, () => selectRadius(larger)));
  } else if (shown === 0) {
    text = `None of the ${total} places ${within} match your filter.`;
    actions.push(actionButton('Clear filter', clearFilter));
  } else {
    const count = shown === total ? `${total}` : `${shown} of ${total}`;
    text = `${count} ${total === 1 ? 'place' : 'places'} ${within}.`;
  }
  if (state.notice) text = `${text} ${state.notice}`;
  setStatus(text, 'info', actions);
}

function sortMode() {
  return settings.sort === 'walking' && state.places.some((p) => p.walkingM !== null)
    ? 'walking'
    : 'straight';
}

function render() {
  const filtered = filterPlaces(state.places, {
    text: state.filterText,
    hideUnnamed: state.hideUnnamed,
  });
  state.visible = sortPlaces(filtered, sortMode());
  if (!state.visible.some((p) => p.id === state.selectedId)) state.selectedId = null;
  renderMarkers(state.visible);
  renderList(state.visible);
  renderChips();
  ui.exportCsv.disabled = ui.exportJson.disabled = state.visible.length === 0;
  if (state.lat !== null && state.categories.length) summaryStatus();
}

function markSelected(id, { scroll = false } = {}) {
  state.selectedId = id;
  for (const button of ui.results.querySelectorAll('.result')) {
    const current = button.dataset.id === id;
    button.setAttribute('aria-current', String(current));
    if (current && scroll) button.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
}

function focusPlace(id) {
  const marker = markerById.get(id);
  if (!marker) return;
  markSelected(id);
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), PLACE_ZOOM), { animate: animate() });
  marker.openPopup();
  if (narrowLayout.matches) {
    map.getContainer().scrollIntoView({ block: 'start', behavior: animate() ? 'smooth' : 'auto' });
  }
}

// ---------------------------------------------------------------- controls

function buildRadiusControl() {
  for (const r of RADII_M) {
    const input = h('input', { type: 'radio', name: 'radius', value: String(r) });
    input.checked = r === state.radiusM;
    input.addEventListener('change', () => setRadius(r));
    ui.radius.append(h('label', {}, [input, h('span', { text: radiusLabel(r) })]));
  }
}

function selectRadius(r) {
  ui.radius.querySelector(`input[value="${r}"]`).checked = true;
  setRadius(r);
  scheduleSearch.flush();
}

function buildChips() {
  for (const c of CATEGORIES) {
    ui.categories.append(
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'data-id': c.id,
          style: { '--chip-color': c.color },
          onclick: () => toggleCategory(c.id),
        },
        [
          h('span', { class: 'dot', style: { '--dot-color': c.color }, 'aria-hidden': 'true' }),
          c.label,
          h('span', { class: 'count' }),
        ],
      ),
    );
  }
  renderChips();
}

function clearFieldErrors() {
  for (const field of ['lat', 'lon']) showFieldError(field, '');
}

function showFieldError(field, message) {
  const error = $(`${field}-error`);
  error.textContent = message;
  error.hidden = !message;
  ui[field].setAttribute('aria-invalid', String(Boolean(message)));
}

function submitCoordinates(event) {
  event.preventDefault();
  const result = parseLatLonInput(ui.lat.value, ui.lon.value);
  if (!result.ok) {
    clearFieldErrors();
    for (const [field, message] of Object.entries(result.errors)) showFieldError(field, message);
    ui[Object.keys(result.errors)[0]].focus();
    return;
  }
  setLocation(result.lat, result.lon, { immediate: true });
}

function locate() {
  if (!window.isSecureContext) return setStatus(geolocationMessage('insecure'), 'error');
  if (!('geolocation' in navigator)) return setStatus(geolocationMessage('unsupported'), 'error');
  ui.locate.disabled = true;
  setStatus('Finding your location…', 'loading');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      ui.locate.disabled = false;
      setLocation(pos.coords.latitude, pos.coords.longitude, { immediate: true });
    },
    (err) => {
      ui.locate.disabled = false;
      setStatus(geolocationMessage(err.code), 'error', [actionButton('Try again', locate)]);
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
  );
}

function clearFilter() {
  ui.filter.value = '';
  state.filterText = '';
  render();
  ui.filter.focus();
}

function exportName(ext) {
  return `nearby-${state.lat.toFixed(4)}_${state.lon.toFixed(4)}-${state.radiusM}m.${ext}`;
}

function exportCsv() {
  const name = exportName('csv');
  download(name, toCSV(state.visible), 'text/csv;charset=utf-8', { bom: true });
  setStatus(`Exported ${state.visible.length} places to ${name}.`);
}

function exportJson() {
  const name = exportName('json');
  const meta = {
    lat: state.lat,
    lon: state.lon,
    radiusM: state.radiusM,
    provider: state.providerId,
  };
  download(name, toJSON(state.visible, meta), 'application/json');
  setStatus(`Exported ${state.visible.length} places to ${name}.`);
}

async function copyLink() {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    setStatus('Link copied. Opening it restores this location, radius and categories.');
  } catch {
    setStatus(`Copy this link: ${url}`);
  }
}

function changeSort() {
  settings = { ...settings, sort: ui.sort.value };
  saveSettings(storage, settings);
  if (settings.sort === 'walking' && !state.places.some((p) => p.walkingM !== null)) {
    enrichWalking();
  } else {
    state.notice = '';
    render();
  }
}

// ---------------------------------------------------------------- settings dialog

function validateSettings() {
  const needsKey = ui.settingsForm.elements.provider.value === 'google';
  ui.googleKey.setCustomValidity(
    needsKey && !ui.googleKey.value.trim()
      ? 'Enter your Google API key, or choose OpenStreetMap.'
      : '',
  );
}

function openSettings() {
  const { elements } = ui.settingsForm;
  elements.provider.value = settings.provider;
  elements.tileTheme.value = settings.tileTheme;
  ui.googleKey.value = settings.googleKey;
  ui.orsKey.value = settings.orsKey;
  validateSettings();
  ui.settings.returnValue = '';
  ui.settings.showModal();
}

function closeSettings() {
  if (ui.settings.returnValue !== 'save') return;
  const { elements } = ui.settingsForm;
  const previous = settings;
  settings = {
    ...settings,
    provider: elements.provider.value,
    tileTheme: elements.tileTheme.value,
    googleKey: ui.googleKey.value.trim(),
    orsKey: ui.orsKey.value.trim(),
  };
  const saved = saveSettings(storage, settings);
  applyTiles();
  const searchChanged =
    previous.provider !== settings.provider || previous.googleKey !== settings.googleKey;
  if (searchChanged) runSearch();
  else if (previous.orsKey !== settings.orsKey && settings.sort === 'walking') enrichWalking();
  if (!saved) {
    setStatus("Settings apply until you reload: this browser won't let the page store them.");
  }
}

/** Wipes stored keys immediately (not on Save) and re-runs the search without them. */
function forgetKeys() {
  ui.googleKey.value = '';
  ui.orsKey.value = '';
  settings = { ...settings, googleKey: '', orsKey: '', provider: 'overpass' };
  ui.settingsForm.elements.provider.value = 'overpass';
  saveSettings(storage, settings);
  validateSettings();
  runSearch();
}

// ---------------------------------------------------------------- wiring

function init() {
  createMap();
  buildRadiusControl();
  buildChips();
  ui.sort.value = settings.sort;
  applyTiles();

  map.on('click', (e) => {
    const { lat, lng } = e.latlng.wrap();
    setLocation(lat, lng, { fit: false, immediate: true });
  });
  pin.on('dragend', () => {
    const { lat, lng } = pin.getLatLng().wrap();
    setLocation(lat, lng, { fit: false, immediate: true });
  });
  darkScheme.addEventListener('change', applyTiles);

  ui.locate.addEventListener('click', locate);
  ui.useCenter.addEventListener('click', () => {
    const { lat, lng } = map.getCenter().wrap();
    setLocation(lat, lng, { fit: false, immediate: true });
  });
  ui.coordsForm.addEventListener('submit', submitCoordinates);
  ui.results.addEventListener('click', (e) => {
    const button = e.target.closest('.result');
    if (button) focusPlace(button.dataset.id);
  });
  const applyFilter = debounce(() => {
    state.filterText = ui.filter.value;
    render();
  }, FILTER_DEBOUNCE_MS);
  ui.filter.addEventListener('input', applyFilter);
  ui.hideUnnamed.addEventListener('change', () => {
    state.hideUnnamed = ui.hideUnnamed.checked;
    render();
  });
  ui.sort.addEventListener('change', changeSort);
  ui.exportCsv.addEventListener('click', exportCsv);
  ui.exportJson.addEventListener('click', exportJson);
  ui.copyLink.addEventListener('click', copyLink);

  ui.settingsOpen.addEventListener('click', openSettings);
  ui.settings.addEventListener('close', closeSettings);
  ui.settingsForm.addEventListener('change', validateSettings);
  ui.googleKey.addEventListener('input', validateSettings);
  ui.settingsClear.addEventListener('click', forgetKeys);

  window.addEventListener('online', () => {
    if (state.lastErrorKind === 'offline') runSearch();
  });

  syncUrl();
  if (state.lat !== null) setLocation(state.lat, state.lon, { immediate: true });
  else runSearch();
}

if (typeof window.L === 'undefined') {
  setStatus(
    "The map library couldn't load. Check your connection or content blocker, then reload the page.",
    'error',
  );
} else {
  init();
}
