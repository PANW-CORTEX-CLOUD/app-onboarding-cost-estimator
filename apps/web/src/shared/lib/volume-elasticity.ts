/**
 * Client-side mirror of cost-engine volume elasticities (package 12).
 * SSOT formulas live in packages/cost-engine/src/core/volume-signals.ts —
 * keep constants in sync when bumping modelVersion.
 * Web cannot import cost-engine (boundary); this only previews UI field sync.
 */

export const REFERENCE_ACCOUNT_COUNT = 10;

export const MEDIUM_BASELINE = {
  ingressGBPerDay: 10,
  peakMBps: 1,
  peakEventsPerSec: 1000,
} as const;

export const MAU_PER_UNIT = 10_000;
export const MAU_UPLIFT_PER_UNIT = 0.1;
export const MAU_UPLIFT_CAP = 1.0;

export type ElasticVolume = {
  ingressGBPerDay: number;
  peakMBps: number;
  peakEventsPerSec: number;
};

/**
 * Derive stream volume from account count + optional MAU (medium baseline).
 * Does not apply provider log-category multipliers (UI preview only).
 */
export function deriveVolumeFromAccounts(
  accountCount: number,
  monthlyActiveUsers = 0,
): ElasticVolume {
  if (!Number.isFinite(accountCount) || accountCount <= 0) {
    throw new Error("accountCount must be a positive finite number");
  }
  const accountScale = accountCount / REFERENCE_ACCOUNT_COUNT;
  let mauUplift = 0;
  if (Number.isFinite(monthlyActiveUsers) && monthlyActiveUsers > 0) {
    mauUplift = Math.min(
      MAU_UPLIFT_CAP,
      (monthlyActiveUsers / MAU_PER_UNIT) * MAU_UPLIFT_PER_UNIT,
    );
  }
  const scale = accountScale * (1 + mauUplift);
  return {
    ingressGBPerDay: MEDIUM_BASELINE.ingressGBPerDay * scale,
    peakMBps: MEDIUM_BASELINE.peakMBps * scale,
    peakEventsPerSec: MEDIUM_BASELINE.peakEventsPerSec * scale,
  };
}
