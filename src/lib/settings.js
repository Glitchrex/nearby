const KEY = 'nearby.settings';

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'overpass',
  tileTheme: 'auto',
  sort: 'straight',
  googleKey: '',
  orsKey: '',
});

const ALLOWED = {
  provider: ['overpass', 'google'],
  tileTheme: ['auto', 'light', 'dark'],
  sort: ['straight', 'walking'],
};

function sanitise(raw) {
  const out = { ...DEFAULT_SETTINGS };
  for (const [field, values] of Object.entries(ALLOWED)) {
    if (values.includes(raw?.[field])) out[field] = raw[field];
  }
  for (const field of ['googleKey', 'orsKey']) {
    if (typeof raw?.[field] === 'string') out[field] = raw[field].trim();
  }
  return out;
}

/**
 * User preferences, including optional API keys. Kept only in this browser's
 * localStorage; nothing here is ever sent anywhere except the matching API.
 */
export function loadSettings(storage) {
  try {
    return sanitise(JSON.parse(storage.getItem(KEY)));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Returns false when storage is unavailable (e.g. private mode). */
export function saveSettings(storage, settings) {
  try {
    storage.setItem(KEY, JSON.stringify(sanitise(settings)));
    return true;
  } catch {
    return false;
  }
}
