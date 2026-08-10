/**
 * First-run Azure audit bootstrap gate (literacy polish package 03/07).
 * Session sentinel prevents re-forcing after the user edits.
 */
export const ESTIMATOR_BOOTSTRAP_SESSION_KEY = "cc-estimator-bootstrapped";

/**
 * Whether cold load should apply Azure · audit-only once.
 * Skips when session already bootstrapped, share URL present, or
 * explicit non-Azure `?provider=` (EDGE: provider=aws / share).
 */
export function shouldBootstrapAzureAudit(
  search: string,
  sessionGet: (key: string) => string | null = (k) =>
    typeof sessionStorage !== "undefined" ? sessionStorage.getItem(k) : null,
): boolean {
  if (sessionGet(ESTIMATOR_BOOTSTRAP_SESSION_KEY) === "1") return false;
  const params = new URLSearchParams(search);
  if (params.get("s")) return false;
  const raw = params.get("provider");
  if (raw && raw !== "azure") return false;
  return true;
}

export function markEstimatorBootstrapped(
  sessionSet: (key: string, value: string) => void = (k, v) => {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(k, v);
  },
): void {
  sessionSet(ESTIMATOR_BOOTSTRAP_SESSION_KEY, "1");
}
