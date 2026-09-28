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
