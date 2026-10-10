import { describe, expect, it } from 'vitest';
import { SearchError, errorFromFailure, errorFromStatus, isAbortError } from '../src/lib/errors.js';

describe('errors', () => {
  it('SearchError carries kind, status and cause', () => {
    const cause = new Error('x');
    const err = new SearchError('server', 'boom', { status: 500, cause });
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ name: 'SearchError', kind: 'server', status: 500, cause });
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limit'],
    [504, 'timeout'],
    [400, 'bad-response'],
    [500, 'server'],
    [503, 'server'],
  ])('maps HTTP %d to %s', (status, kind) => {
    expect(errorFromStatus(status, 'Svc')).toMatchObject({ kind, status });
  });

  it('maps fetch failures to aborted, offline or network', () => {
    const controller = new AbortController();
    controller.abort();
    expect(errorFromFailure(new Error('x'), { signal: controller.signal }).kind).toBe('aborted');
    expect(errorFromFailure(new Error('x'), { isOffline: () => true }).kind).toBe('offline');
    expect(errorFromFailure(new TypeError('Failed to fetch'), {}).kind).toBe('network');
  });

  it('recognises AbortError', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});
