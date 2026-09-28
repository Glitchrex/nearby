/** Trailing-edge debounce with `cancel()` and `flush()`. */
export function debounce(fn, waitMs) {
  let timer = null;
  let pendingArgs = null;

  const run = () => {
    const args = pendingArgs;
    timer = null;
    pendingArgs = null;
    fn(...args);
  };

  const debounced = (...args) => {
    pendingArgs = args;
    clearTimeout(timer);
    timer = setTimeout(run, waitMs);
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };
  debounced.flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    run();
  };
  return debounced;
}
