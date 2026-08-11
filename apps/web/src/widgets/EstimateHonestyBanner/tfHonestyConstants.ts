/**
 * Mirror of cost-engine honesty warning prefixes for UI filtering.
 *
 * The duplication is architecturally forced: `check-boundaries.mjs` forbids
 * `apps/web` from importing cost-engine internals (the UI consumes generated
 * OpenAPI types only), and these strings are not part of the API contract.
 *
 * It is **not** hand-maintained on trust, though —
 * `scripts/check-tf-honesty-drift.mjs` imports both this file and the engine's
 * `tf-audit-reconciliation.ts` and fails `pnpm test` if any value here stops
 * matching the engine's. The engine is the source of truth; edit it there
 * first, then update this mirror.
 *
 * Why it matters: the UI recognises honesty warnings by matching these exact
 * strings. A silent drift would not throw — the banner would simply stop
 * appearing, hiding the very disclosure it exists to make, with every test
 * still green.
 *
 * (The engine file is named without its full path on purpose:
 * `edge-plus-hardening.test.ts` bans that path literal anywhere under
 * `apps/web/src` to stop deep imports, and it matches file text, not imports.)
 */
export const AZURE_MODELED_NO_TF_WARNING_PREFIX =
  "Azure connector TF bills audit stream+store only; modeled · no connector TF:";

export const NO_TF_INVENTORY_WARNING = "no TF inventory — modeled defaults";

/** Azure audit-only meter allowlist (TF-faithful). */
export const AZURE_AUDIT_ONLY_METER_ALLOWLIST = [
  "eh-standard-tu",
  "eh-standard-ingress-events",
  "blob-hot-lrs-capacity",
  "blob-hot-lrs-write-10k",
  "blob-hot-lrs-read-10k",
] as const;
