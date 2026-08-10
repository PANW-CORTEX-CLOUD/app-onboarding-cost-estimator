/**
 * Mirror of cost-engine honesty warning prefixes for UI filtering.
 * Keep in sync with packages/cost-engine/.../tf-audit-reconciliation.ts.
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
