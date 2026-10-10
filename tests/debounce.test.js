import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from '../src/lib/debounce.js';

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after the delay with the last arguments', () => {
    const fn = vi.fn();
    const d = debounce(fn, 700);
    d(1);
    d(2);
    vi.advanceTimersByTime(699);
    expect(fn).not.toHaveBeenCalled();
    d(3);
    vi.advanceTimersByTime(700);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('can be cancelled', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it('can be flushed immediately', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('x');
    d.flush();
    expect(fn).toHaveBeenCalledWith('x');
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush is a no-op when nothing is pending', () => {
    const fn = vi.fn();
    debounce(fn, 100).flush();
    expect(fn).not.toHaveBeenCalled();
  });
});
