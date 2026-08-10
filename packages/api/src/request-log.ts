/**
 * Diagnostic request logging for the API.
 *
 * This sits alongside `hono/logger`, and the split is deliberate rather than
 * accidental duplication:
 *
 * - **Access log** (`hono/logger`) is always on and answers "what traffic did
 *   this process serve" — method, path, status, latency. Operations.
 * - **Diagnostic log** (here) is silent unless switched on and answers "why did
 *   *that* request produce *that* number" — a correlation id plus the decisions
 *   the estimate actually made: which rate source won, which TF mode applied,
 *   what confidence came out, how many warnings. Debugging.
 *
 * It reuses the cost-engine's logger rather than adding a dependency, so one
 * switch lights up both layers and the engine's own lines interleave with the
 * request that caused them:
 *
 * ```
 * DEBUG=cost:* pnpm --filter @cloud-connector/api start
 * DEBUG=cost:api node --experimental-strip-types packages/api/src/index.ts
 * ```
 *
 * No logging package was added on purpose. Beyond the fact that the engine
 * already had a working logger, the small high-fanout terminal utilities that
 * would otherwise be candidates — `debug` and `chalk` among them — were the
 * exact cluster compromised in the npm supply-chain attack of 8 September 2025,
 * when a maintainer was phished and malicious versions carrying a
 * crypto-wallet-hijacking payload shipped for roughly two hours. The packages
 * are fine today; the point is that every added dependency is a standing
 * exposure, and this one buys nothing we do not already have.
 *
 * @see https://www.wiz.io/blog/widespread-npm-supply-chain-attack-breaking-down-impact-scope-across-debug-chalk
 */
import type { Context, Next } from "hono";
import { createLogger } from "@cloud-connector/cost-engine";

const log = createLogger("cost:api");

/** Header a caller can set to thread their own id through the logs. */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Short, collision-tolerant id.
 *
 * Correlating one process's log lines does not need cryptographic uniqueness,
 * and `crypto.randomUUID` is not available in every runtime this may land in,
 * so this stays dependency-free and degrades rather than throwing.
 */
function newRequestId(): string {
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
  return `${Date.now().toString(36)}-${rand}`;
}

/** Per-request context key holding the id, for handlers that want to log. */
export const REQUEST_ID_KEY = "requestId";

/**
 * Middleware: tag each request with an id, echo it back, and log start/end
 * with duration. Silent unless `cost:api` is enabled.
 */
export function requestLogger() {
  return async (c: Context, next: Next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const id = incoming && incoming.trim() ? incoming.trim() : newRequestId();
    c.set(REQUEST_ID_KEY, id);
    c.header(REQUEST_ID_HEADER, id);

    const startedAt = Date.now();
    log.debug(() => `${id} → ${c.req.method} ${c.req.path}`);

    await next();

    const ms = Date.now() - startedAt;
    const status = c.res.status;
    const line = `${id} ← ${status} ${c.req.method} ${c.req.path} ${ms}ms`;
    // A 5xx is worth seeing at a lower verbosity than a successful request.
    if (status >= 500) log.error(() => line);
    else if (status >= 400) log.warn(() => line);
    else log.debug(() => line);
  };
}

/** Request id for the current context, or "-" when logging is not wired. */
export function requestIdOf(c: Context): string {
  return (c.get(REQUEST_ID_KEY) as string | undefined) ?? "-";
}

/**
 * Log the decisions behind one estimate.
 *
 * These are exactly the fields that turn "the number looks wrong" into a
 * diagnosis: where the rates came from, whether TF gating dropped anything, and
 * whether any meter was untrusted enough to cap the confidence.
 */
export function logEstimateOutcome(
  c: Context,
  estimate: {
    provider: string;
    tfMode?: string;
    ratesSource?: string;
    ratesAsOf?: string;
    confidence?: string;
    totals?: { expected?: number };
    lineItems?: Array<{ meterId: string }>;
    warnings?: string[];
    excludedCapabilities?: Array<{ capability: string }>;
    appliedDefaults?: Array<{ field: string }>;
  },
): void {
  log.debug(() => {
    const excluded = estimate.excludedCapabilities?.map((e) => e.capability) ?? [];
    return [
      `${requestIdOf(c)} estimate`,
      `provider=${estimate.provider}`,
      `tfMode=${estimate.tfMode ?? "-"}`,
      `rates=${estimate.ratesSource ?? "-"}@${estimate.ratesAsOf ?? "-"}`,
      `confidence=${estimate.confidence ?? "-"}`,
      `total=${estimate.totals?.expected ?? "-"}`,
      `meters=${estimate.lineItems?.length ?? 0}`,
      `warnings=${estimate.warnings?.length ?? 0}`,
      `defaultsApplied=${estimate.appliedDefaults?.length ?? 0}`,
      excluded.length ? `excluded=${excluded.join(",")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  });
}

/** Log a rejected request with the reason, so 400s are diagnosable. */
export function logRejection(c: Context, reason: string): void {
  log.warn(() => `${requestIdOf(c)} rejected: ${reason}`);
}
