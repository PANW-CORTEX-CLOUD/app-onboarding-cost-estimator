/**
 * Namespaced, level-based debug logging for the cost engine.
 *
 * Diagnosing a wrong total previously meant adding `console.log` and deleting
 * it again, which is why none of the arithmetic left any trace. This gives the
 * engine a permanent, zero-cost-when-off way to explain itself.
 *
 * Design constraints that ruled out reaching for a library:
 * - The engine is a pure TypeScript package with no runtime dependencies, and
 *   the same code runs in Node (API) and in the browser (offline mode). `debug`
 *   and `pino` both assume Node built-ins or a bundler shim.
 * - It must be genuinely free when disabled — message arguments are passed as
 *   a thunk so nothing is formatted, serialised or concatenated unless someone
 *   is listening.
 *
 * Enabling:
 * - Node:    `DEBUG=cost:*` or `DEBUG=cost:dspm,cost:rates`
 * - Browser: `?debug=cost:*` in the URL, or `localStorage.debug = "cost:*"`
 * - Tests:   `setDebugFilter("cost:*")` / `captureLogs()`
 *
 * Namespaces are dot-scoped under `cost:` — `cost:estimate`, `cost:dspm`,
 * `cost:rates` — and a trailing `*` matches a prefix.
 *
 * @example
 * const log = createLogger("cost:dspm");
 * log.debug(() => `objects=${objects} readOps=${readOps}`);
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

/** Ordered so a threshold comparison is a number comparison. */
const LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export type LogRecord = {
  namespace: string;
  level: LogLevel;
  message: string;
  timestamp: string;
};

export type LogSink = (record: LogRecord) => void;

/**
 * A message is a thunk so that building it costs nothing while logging is off.
 * Strings are accepted too, for call sites where the message is already built.
 */
export type LogMessage = string | (() => string);

export interface Logger {
  error(message: LogMessage): void;
  warn(message: LogMessage): void;
  info(message: LogMessage): void;
  debug(message: LogMessage): void;
  /** Child logger under a sub-namespace, e.g. `cost:dspm` → `cost:dspm:azure`. */
  child(suffix: string): Logger;
  readonly namespace: string;
}

let filter: string | null = null;
let threshold: LogLevel = "debug";
let sink: LogSink = defaultSink;
let resolvedFromEnv = false;

function defaultSink(record: LogRecord): void {
  const line = `${record.timestamp} ${record.level.toUpperCase().padEnd(5)} ${record.namespace} ${record.message}`;
  if (record.level === "error") console.error(line);
  else if (record.level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Read the filter from the ambient environment once, lazily.
 * Kept lazy so importing the engine never touches `process` or `window`.
 */
function envFilter(): string | null {
  // Node
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  const fromEnv = proc?.env?.DEBUG ?? proc?.env?.COST_DEBUG;
  if (fromEnv) return fromEnv;

  // Browser: URL wins over localStorage so a link can turn logging on.
  const win = globalThis as {
    location?: { search?: string };
    localStorage?: { getItem(k: string): string | null };
  };
  try {
    if (win.location?.search) {
      const q = new URLSearchParams(win.location.search);
      const fromUrl = q.get("debug");
      if (fromUrl) return fromUrl;
    }
    const fromStorage = win.localStorage?.getItem("debug");
    if (fromStorage) return fromStorage;
  } catch {
    // Storage access can throw in sandboxed frames — logging must never be the
    // reason an estimate fails, so treat it as "no filter configured".
    return null;
  }
  return null;
}

function currentFilter(): string | null {
  if (filter !== null) return filter;
  if (!resolvedFromEnv) {
    filter = envFilter();
    resolvedFromEnv = true;
  }
  return filter;
}

/**
 * `cost:*` matches everything under `cost:`; an exact name matches only itself.
 * Comma or space separated, as `DEBUG` conventionally is.
 */
function namespaceEnabled(namespace: string, spec: string): boolean {
  for (const raw of spec.split(/[,\s]+/)) {
    const pattern = raw.trim();
    if (!pattern) continue;
    if (pattern === "*") return true;
    if (pattern.endsWith("*")) {
      if (namespace.startsWith(pattern.slice(0, -1))) return true;
    } else if (namespace === pattern) {
      return true;
    }
  }
  return false;
}

export function isEnabled(namespace: string, level: LogLevel = "debug"): boolean {
  const spec = currentFilter();
  if (!spec) return false;
  if (LEVEL_RANK[level] > LEVEL_RANK[threshold]) return false;
  return namespaceEnabled(namespace, spec);
}

/** Override the filter programmatically. `null` restores environment lookup. */
export function setDebugFilter(spec: string | null): void {
  filter = spec;
  resolvedFromEnv = spec !== null;
}

/** Drop anything below this level. Defaults to `debug` (keep everything). */
export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

/** Redirect output. Returns the previous sink so callers can restore it. */
export function setLogSink(next: LogSink): LogSink {
  const previous = sink;
  sink = next;
  return previous;
}

function emit(namespace: string, level: LogLevel, message: LogMessage): void {
  if (!isEnabled(namespace, level)) return;
  let text: string;
  try {
    text = typeof message === "function" ? message() : message;
  } catch (e) {
    // A broken log message must never take down the calculation it describes.
    text = `<log message threw: ${e instanceof Error ? e.message : String(e)}>`;
  }
  sink({
    namespace,
    level,
    message: text,
    timestamp: new Date().toISOString(),
  });
}

export function createLogger(namespace: string): Logger {
  return {
    namespace,
    error: (m) => emit(namespace, "error", m),
    warn: (m) => emit(namespace, "warn", m),
    info: (m) => emit(namespace, "info", m),
    debug: (m) => emit(namespace, "debug", m),
    child: (suffix) => createLogger(`${namespace}:${suffix}`),
  };
}

/**
 * Collect records emitted while `fn` runs, for assertions in tests.
 * Restores the previous filter and sink even if `fn` throws.
 */
export function captureLogs<T>(
  spec: string,
  fn: () => T,
): { result: T; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const previousFilter = filter;
  const previousResolved = resolvedFromEnv;
  const previousSink = setLogSink((r) => records.push(r));
  setDebugFilter(spec);
  try {
    return { result: fn(), records };
  } finally {
    setLogSink(previousSink);
    filter = previousFilter;
    resolvedFromEnv = previousResolved;
  }
}

/** Root namespace every engine logger hangs off. */
export const ENGINE_LOG_NAMESPACE = "cost";
