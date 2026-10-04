import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/lib/settings.js';

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

describe('settings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({
      provider: 'overpass',
      tileTheme: 'auto',
      sort: 'straight',
      googleKey: '',
      orsKey: '',
    });
  });

  it('round-trips valid settings', () => {
    const storage = memoryStorage();
    const s = {
      provider: 'google',
      tileTheme: 'dark',
      sort: 'walking',
      googleKey: 'g',
      orsKey: 'o',
    };
    saveSettings(storage, s);
    expect(loadSettings(storage)).toEqual(s);
  });

  it('drops invalid or unknown values', () => {
    const storage = memoryStorage();
    storage.setItem(
      'nearby.settings',
      JSON.stringify({ provider: 'evil', tileTheme: 3, sort: 'walking', googleKey: 5, extra: 1 }),
    );
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, sort: 'walking' });
  });

  it('trims keys', () => {
    const storage = memoryStorage();
    saveSettings(storage, { ...DEFAULT_SETTINGS, googleKey: '  abc  ' });
    expect(loadSettings(storage).googleKey).toBe('abc');
  });

  it('survives corrupt or unavailable storage', () => {
    const storage = memoryStorage();
    storage.setItem('nearby.settings', '{oops');
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    const denied = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadSettings(denied)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(denied, DEFAULT_SETTINGS)).toBe(false);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});
