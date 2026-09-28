/**
 * Error thrown by providers. `kind` is one of:
 * 'aborted' | 'offline' | 'network' | 'timeout' | 'rate-limit' | 'server' |
 * 'bad-response' | 'auth'
 */
export class SearchError extends Error {
  constructor(kind, message, { cause, status } = {}) {
    super(message, { cause });
    this.name = 'SearchError';
    this.kind = kind;
    this.status = status;
  }
}

export const isAbortError = (err) => err?.name === 'AbortError';

/** SearchError for a non-OK HTTP status from `service`. */
export function errorFromStatus(status, service) {
  let kind = 'server';
  if (status === 401 || status === 403) kind = 'auth';
  else if (status === 429) kind = 'rate-limit';
  else if (status === 504) kind = 'timeout';
  else if (status >= 400 && status < 500) kind = 'bad-response';
  return new SearchError(kind, `${service}: HTTP ${status}`, { status });
}

/** SearchError for a rejected fetch(): cancelled, offline or unreachable. */
export function errorFromFailure(
  cause,
  { signal, isOffline = () => globalThis.navigator?.onLine === false } = {},
) {
  if (signal?.aborted) return new SearchError('aborted', 'Search cancelled', { cause });
  if (isOffline()) return new SearchError('offline', 'Browser is offline', { cause });
  return new SearchError('network', cause?.message ?? 'Network error', { cause });
}
