/**
 * Typed engine errors — so a caller can tell *whose fault* a failure is.
 *
 * The estimate pipeline throws for two very different reasons, and collapsing
 * them loses the one fact an HTTP layer needs to pick an honest status:
 *
 * - **The caller's request was invalid** — an unsized capability, a Gov region,
 *   `avgObjectSizeMB <= 0`. These are client-actionable (fix the input), so they
 *   map to a 4xx. They stay plain `Error`s; the API's default is to treat an
 *   estimate throw as a 400 with the domain reason echoed.
 * - **A rate source failed** — an adapter threw, or it returned a corrupt price
 *   (non-finite / negative), so pricing cannot proceed. This is *not* the
 *   client's fault and nothing in their request can fix it, so echoing the
 *   reason as a 400 is a lie about who is responsible. `UpstreamRateError`
 *   marks this class, and the API maps it to a 502 (bad upstream dependency)
 *   with a generic, non-leaking detail plus a correlation id.
 *
 * This is deliberately a *two-way* split, not a taxonomy of every failure: the
 * only distinction the status code turns on is "your input vs. our/upstream
 * data". Anything genuinely unexpected (a real bug) is neither and surfaces as
 * the global 500 net.
 */

/**
 * A rate source (live pricing API or the bundled fallback) failed or produced
 * data the engine refuses to price with (fail-closed — never invents $0). Not
 * caused by the request, so the API renders it as a 5xx, not a 4xx.
 */
export class UpstreamRateError extends Error {
  /** The lower-level failure this wraps (an adapter throw, if any). */
  override readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "UpstreamRateError";
    // Keep the underlying cause for server-side logging without leaking it to
    // the client (the API logs it against the request id, never echoes it).
    this.cause = options?.cause;
    // Preserve the prototype chain across the TS `extends Error` down-compile so
    // `instanceof UpstreamRateError` holds at the API boundary.
    Object.setPrototypeOf(this, UpstreamRateError.prototype);
  }
}
