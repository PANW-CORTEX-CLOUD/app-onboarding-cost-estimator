/**
 * Debounce helper for capability-toggle → estimate API (package 18 AC ≤300ms).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => void;

export function debounce<T extends AnyFn>(
  fn: T,
  waitMs: number,
): T & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const wrapped = ((...args: Parameters<T>) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = lastArgs;
      lastArgs = null;
      if (a) fn(...a);
    }, waitMs);
  }) as T & { cancel: () => void; flush: () => void };

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  wrapped.flush = () => {
    if (!timer || !lastArgs) return;
    clearTimeout(timer);
    timer = null;
    const a = lastArgs;
    lastArgs = null;
    fn(...a);
  };

  return wrapped;
}

/** Default debounce for capability toggles — must stay ≤300ms (AC). */
export const CAPABILITY_DEBOUNCE_MS = 300;
