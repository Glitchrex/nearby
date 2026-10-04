import { describe, expect, it } from 'vitest';
import { PROVIDERS, createProvider } from '../../src/lib/providers/index.js';

describe('createProvider', () => {
  it('lists the available providers', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['overpass', 'google']);
    expect(PROVIDERS.find((p) => p.id === 'google').needsKey).toBe(true);
  });

  it('creates the Overpass provider by default', () => {
    expect(createProvider('overpass').id).toBe('overpass');
    expect(createProvider(undefined).id).toBe('overpass');
  });

  it('creates Google only with a key, else falls back to Overpass', () => {
    expect(createProvider('google', { googleKey: 'K' }).id).toBe('google');
    expect(createProvider('google', { googleKey: '' }).id).toBe('overpass');
  });
});
