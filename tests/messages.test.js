import { describe, expect, it } from 'vitest';
import { SearchError } from '../src/lib/errors.js';
import { geolocationMessage, searchErrorMessage } from '../src/lib/messages.js';

describe('searchErrorMessage', () => {
  it.each([
    ['offline', /offline/i],
    ['rate-limit', /busy/i],
    ['timeout', /smaller radius/i],
    ['network', /connection/i],
    ['server', /retry/i],
    ['bad-response', /unexpected/i],
    ['auth', /settings/i],
  ])('explains %s with a next step', (kind, pattern) => {
    const msg = searchErrorMessage(new SearchError(kind, 'x'));
    expect(msg).toMatch(pattern);
  });

  it('has a generic fallback for unknown errors', () => {
    expect(searchErrorMessage(new Error('boom'))).toMatch(/retry/i);
  });
});

describe('geolocationMessage', () => {
  it.each([
    [1, /denied/i],
    [2, /couldn.t be determined/i],
    [3, /too long/i],
    ['unsupported', /doesn.t support/i],
    ['insecure', /https/i],
  ])('explains %s and offers an alternative', (code, pattern) => {
    const msg = geolocationMessage(code);
    expect(msg).toMatch(pattern);
    expect(msg).toMatch(/click the map|coordinates/i);
  });
});
