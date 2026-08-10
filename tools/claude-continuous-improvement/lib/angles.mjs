/**
 * angles.mjs — Investigation angle catalogue for the continuous-improvement loop.
 *
 * When an iteration reports `NEXT-STEP: INVESTIGATE` (nothing known left to build), the
 * Stop hook hands the next **unused** angle from this ordered list to the following
 * iteration. Each angle is handed out at most once per loop run, which is what makes the
 * sweep terminate: once the list is exhausted the loop must close out with `COMPLETE`
 * or `BLOCKED` instead of investigating forever.
 *
 * Order matters — it is a priority order, cheapest-and-most-damaging first. Angles that
 * catch fail-open behaviour and data corruption come before cosmetic concerns.
 *
 * This module is the single source of truth for the catalogue. `REFERENCE.md` documents
 * the same list for humans and is checked against this file by the unit tests, so adding
 * an angle here means adding it there too.
 *
 * @module continuous-improvement/angles
 */

/**
 * A single investigation angle.
 *
 * @typedef {object} Angle
 * @property {string} id       Stable kebab-case identifier. Usable in a control line as
 *                             `NEXT-STEP: INVESTIGATE [angle:<id>]` to request it explicitly.
 * @property {string} title    Short human-facing label.
 * @property {string} focus    One sentence describing the failure shape being hunted.
 * @property {string[]} checks Concrete things to look for. Injected verbatim into the
 *                             follow-up prompt so the iteration has a checklist, not a mood.
 */

/**
 * Ordered investigation angles.
 *
 * @type {readonly Angle[]}
 */
export const ANGLES = Object.freeze([
  {
    id: "fail-open-and-silent-fallbacks",
    title: "Fail-open behaviour and silent fallbacks",
    focus:
      "Code that swallows a failure and continues with a substitute value, so a broken " +
      "dependency looks like a healthy one.",
    checks: [
      "catch blocks that return a default, empty array/object, or zero instead of rethrowing",
      "`||`, `??` and optional chaining that mask a missing required value",
      "fallback data paths (cached/stale/hardcoded) that are not surfaced to the caller as degraded",
      "timeouts, retries and circuit breakers whose exhausted state resolves successfully",
      "warnings logged where the correct behaviour is to fail the request or the build",
    ],
  },
  {
    id: "persistence-and-state-drift",
    title: "Persistence and state drift",
    focus:
      "Stored state that can diverge from the code's current expectations: schemas, caches, " +
      "generated artefacts, migrations.",
    checks: [
      "generated/derived files that can go stale without a drift gate failing",
      "persisted records read back without validating their shape or version",
      "cache keys that do not include everything the value depends on",
      "writes that are not atomic or not idempotent on retry",
      "TTL/age policies that are enforced nowhere, or enforced in more than one place inconsistently",
    ],
  },
  {
    id: "input-validation-and-trust-boundaries",
    title: "Input validation and trust boundaries",
    focus:
      "Loose validation at the edges where untrusted input enters: HTTP, CLI, files, env, " +
      "third-party responses.",
    checks: [
      "request/response bodies parsed without schema validation, or validated only on one side",
      "numeric input accepted without range/NaN/Infinity checks",
      "validation that coerces instead of rejecting (loose equality, silent clamping, parseInt on junk)",
      "third-party API responses trusted structurally without a parse step",
      "env vars read with a default that hides a misconfigured deployment",
    ],
  },
  {
    id: "error-handling-and-observability",
    title: "Error handling and observability",
    focus:
      "Whether a failure in production can actually be diagnosed: structured logging, debug " +
      "mode, correlation, actionable messages.",
    checks: [
      "errors that lose their cause (no `cause`, stack stripped, rethrown as a bare string)",
      "log lines without enough context to identify the request, input, or provider",
      "no debug/verbose mode for the subsystem, or one that must be added by editing code",
      "user-facing error messages that do not say what to do next",
      "console.* used where the project has a logging abstraction (or the absence of one)",
    ],
  },
  {
    id: "dead-code-and-unfinished-features",
    title: "Dead code and unfinished features",
    focus:
      "Code that no live path reaches, and half-built features that were abandoned mid-way.",
    checks: [
      "exports with no importer; files no entry point transitively reaches",
      "feature flags that are permanently on or off, and the branch that can never run",
      "backward-compatibility shims for versions the project no longer supports",
      "commented-out blocks and `@deprecated` members with no removal date",
      "for each finding: classify as (a) abandoned feature — summarise and ask for approval, or (b) plain dead code — treat as a bug",
    ],
  },
  {
    id: "hardcoded-parameters-and-configuration",
    title: "Hardcoded parameters and configuration",
    focus:
      "Values that should be centrally managed but are literals scattered across the code.",
    checks: [
      "magic numbers: limits, timeouts, retry counts, page sizes, thresholds, prices",
      "the same literal repeated in more than one module (a constant waiting to happen)",
      "URLs, region names, account ids, bucket/queue names inline in logic",
      "config read ad hoc at call sites instead of through one typed, validated config module",
      "values that differ per environment but are not overridable",
    ],
  },
  {
    id: "architecture-and-coupling",
    title: "Architecture, coupling and DRY",
    focus:
      "Spaghetti code and long interdependency trails that make change expensive: layering " +
      "violations, cycles, duplication.",
    checks: [
      "imports that cross a documented boundary (check the architecture guide and any boundary linter)",
      "circular dependencies, and modules imported by nearly everything",
      "duplicated logic that should be one function/package",
      "functions doing several jobs at once; files far larger than their neighbours",
      "business rules leaking into adapters/UI, or I/O leaking into pure logic",
    ],
  },
  {
    id: "test-coverage-and-edge-cases",
    title: "Test coverage, edge cases and contract drift",
    focus:
      "Behaviour that is asserted nowhere — especially edges, error paths and the contract " +
      "between components.",
    checks: [
      "public behaviour with only happy-path tests; no test for the failure path",
      "edges: empty, zero, one, max, negative, unicode, duplicate, out-of-order, concurrent",
      "contract/schema tests missing between producer and consumer (API ↔ client, engine ↔ adapter)",
      "end-to-end coverage of the actual user journey, not just units",
      "tests that assert implementation details and would pass while the behaviour is broken",
    ],
  },
  {
    id: "concurrency-and-ordering",
    title: "Concurrency, ordering and time",
    focus:
      "Assumptions about sequence, simultaneity and clocks that hold on a fast laptop and " +
      "break under load.",
    checks: [
      "read-modify-write sequences without a lock, transaction or compare-and-set",
      "unawaited promises, floating async work, and fire-and-forget error paths",
      "shared mutable module-level state across requests",
      "operations that assume ordered delivery or exactly-once execution",
      "wall-clock arithmetic without timezone/DST/monotonic considerations",
    ],
  },
  {
    id: "performance-and-resource-usage",
    title: "Performance and resource usage",
    focus: "Work that grows without bound as data, users or time increase.",
    checks: [
      "N+1 calls in a loop where one batched call exists",
      "collections that only ever grow (caches, maps, arrays) with no eviction",
      "whole-file/whole-dataset reads where streaming or pagination is available",
      "repeated recomputation of a value that is stable within the request",
      "payload sizes and bundle weight on the hot path",
    ],
  },
  {
    id: "security-and-secrets",
    title: "Security, secrets and data exposure",
    focus: "Ways the system leaks or over-trusts: credentials, PII, authorization, injection.",
    checks: [
      "secrets in source, in logs, in error messages, or in committed fixtures",
      "PII or customer identifiers written to logs/telemetry",
      "authorization checked at one layer but not the layer that actually serves data",
      "injection surfaces: shell, SQL, path traversal, template, prototype pollution",
      "outbound requests that ignore TLS verification, redirects, or response size limits",
    ],
  },
  {
    id: "dependencies-and-supply-chain",
    title: "Dependencies and supply chain",
    focus: "Third-party risk: known CVEs, deprecations, unpinned versions, install-time trust.",
    checks: [
      "known advisories against the current lockfile (research authoritative sources)",
      "deprecated APIs of pinned dependencies, and breaking changes in the next major",
      "floating version ranges on anything security-relevant; lockfile not committed or not enforced",
      "postinstall scripts and transitive packages nobody chose deliberately",
      "runtime version assumptions (engines) that CI does not actually enforce",
    ],
  },
  {
    id: "docs-and-code-comments",
    title: "Documentation and code comments",
    focus:
      "Documentation that is wrong, missing, or not machine-readable — including JSDoc/TSDoc " +
      "coverage on exported surfaces.",
    checks: [
      "exported functions/types without a `/** ... */` block explaining contract and failure modes",
      "docs describing behaviour the code no longer has (commands, paths, flags, outputs)",
      "the why missing at non-obvious code — invariants, ordering requirements, past bugs",
      "README/architecture guide out of step with the actual module layout",
      "hard-won lessons from earlier iterations not written down where the next reader will look",
    ],
  },
  {
    id: "user-journey-and-accessibility",
    title: "End-to-end user journey and accessibility",
    focus:
      "The product as a user meets it: the whole flow, the error states, and whether it is " +
      "usable by everyone.",
    checks: [
      "run the app in debug mode and walk the primary journey start to finish",
      "loading, empty, partial and error states — do they exist and do they explain themselves",
      "keyboard navigation, focus order, labels/roles, contrast",
      "the flow after a failed request: is recovery possible without a reload",
      "what a first-time user sees with no data at all",
    ],
  },
]);

/** @type {ReadonlyMap<string, Angle>} */
const BY_ID = new Map(ANGLES.map((a) => [a.id, a]));

/**
 * Look up an angle by its stable id.
 *
 * @param {string} id Angle id, e.g. `"security-and-secrets"`.
 * @returns {Angle | undefined} The angle, or `undefined` when the id is unknown.
 */
export function getAngle(id) {
  return BY_ID.get(id);
}

/**
 * Pick the next angle to investigate.
 *
 * Honours an explicit request (`[angle:<id>]` in the control line) when that angle exists
 * and has not been used yet; otherwise returns the first unused angle in catalogue order.
 * Returns `null` only when every angle has been used — the signal that the sweep is over.
 *
 * @param {Iterable<string>} usedIds Angle ids already handed out during this loop run.
 * @param {string | null} [requestedId] Optional angle id requested by the agent.
 * @returns {Angle | null} The next angle, or `null` when the catalogue is exhausted.
 */
export function nextAngle(usedIds, requestedId = null) {
  const used = new Set(usedIds ?? []);
  if (requestedId) {
    const requested = BY_ID.get(requestedId);
    if (requested && !used.has(requested.id)) return requested;
  }
  return ANGLES.find((a) => !used.has(a.id)) ?? null;
}

/**
 * Render an angle as the checklist injected into the follow-up prompt.
 *
 * @param {Angle} angle The angle to render.
 * @returns {string} Markdown block: title, focus and checks.
 */
export function formatAngle(angle) {
  const checks = angle.checks.map((c) => `- ${c}`).join("\n");
  return `**Angle \`${angle.id}\` — ${angle.title}**\n\n${angle.focus}\n\nLook specifically for:\n\n${checks}`;
}
