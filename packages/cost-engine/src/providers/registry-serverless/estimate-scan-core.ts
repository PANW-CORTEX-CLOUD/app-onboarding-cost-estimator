/**
 * Registry + serverless scan estimators core (package 10).
 */
import type {
  CloudProvider,
  LineItem,
  RateCard,
} from "../../core/models/estimate.types.ts";
import {
  registryPullGb,
  requireRate,
  serverlessScanOps,
  sumAmounts,
  type RegistryScanInputs,
  type ScanEstimateResult,
  type ServerlessScanInputs,
} from "./scan.types.ts";

export type RegistryMeters = {
  pullMeterId: string;
  providerLabel: string;
};

export type ServerlessMeters = {
  opsMeterId: string;
  providerLabel: string;
};

/**
 * Registry scan: bill incremental pull bandwidth only.
 * Same-region → $0 bandwidth (TEST); cross-region → pullGB × rate.
 */
/**
 * `amount = crossRegionPull ? registryPullGb(inputs) × rate : 0`
 * (@see registryPullGb in scan.types.ts). Same-region pulls are modeled as
 * $0 bandwidth; only cross-region pull is billed. Never charges existing
 * registry storage — incremental pull bandwidth only.
 * @returns Empty $0 result when `inputs.enabled` is false.
 * @throws when `rates.provider` doesn't match `provider`, or the pull-bandwidth
 * meter price is missing.
 */
export function estimateRegistryScanForProvider(
  provider: CloudProvider,
  meters: RegistryMeters,
  inputs: RegistryScanInputs,
  rates: RateCard,
): ScanEstimateResult {
  if (rates.provider !== provider) {
    throw new Error(`estimateRegistryScan requires ${provider} RateCard`);
  }
  const notes: string[] = [
    "Do not charge existing registry storage — incremental scan pull bandwidth only.",
    "Confidence Medium-Low (Low) for registry scan estimates.",
  ];
  if (!inputs.enabled) {
    return empty(notes);
  }

  const warnings: string[] = [];
  if (inputs.imageCount === 0) {
    warnings.push(
      "registry scan enabled with imageCount=0 — no pull volume; verify intentional",
    );
  }

  const pullGb = registryPullGb(inputs);
  const rate = requireRate(rates.unitPrices, meters.pullMeterId);
  // Same-region: zero/minimal bandwidth; cross-region uplift uses full pull × rate
  const amount = inputs.crossRegionPull ? pullGb * rate : 0;
  if (!inputs.crossRegionPull) {
    notes.push(
      "same-region pull: bandwidth defaulted to $0 (crossRegionPull=false); set crossRegionPull for egress uplift",
    );
  } else {
    notes.push(
      `cross-region pull uplift: ${pullGb} GB × ${meters.pullMeterId}`,
    );
  }

  const lineItems: LineItem[] = [
    {
      provider,
      capability: "registry",
      meterId: meters.pullMeterId,
      amount,
      confidence: "Low",
    },
  ];

  return {
    lineItems,
    totals: { expected: sumAmounts(lineItems) },
    warnings,
    notes,
    confidence: "Low",
  };
}

/**
 * Serverless scan: bill incremental package scan ops only (not function storage).
 * Cost scales with packageCount × scansPerMonth (million-ops style rate).
 */
/**
 * `amount = (serverlessScanOps(inputs) / 1_000_000) × rate`
 * (@see serverlessScanOps in scan.types.ts — ops meter, GB not billed).
 * Never charges existing function/package storage — incremental scan ops only.
 * @returns Empty $0 result when `inputs.enabled` is false.
 * @throws when `rates.provider` doesn't match `provider`, or the ops meter price is missing.
 */
export function estimateServerlessScanForProvider(
  provider: CloudProvider,
  meters: ServerlessMeters,
  inputs: ServerlessScanInputs,
  rates: RateCard,
): ScanEstimateResult {
  if (rates.provider !== provider) {
    throw new Error(`estimateServerlessScan requires ${provider} RateCard`);
  }
  const notes: string[] = [
    "Do not charge existing function/package storage — incremental scan ops only.",
    "Confidence Medium-Low (Low) for serverless scan estimates.",
  ];
  if (!inputs.enabled) {
    return empty(notes);
  }

  const warnings: string[] = [];
  if (inputs.packageCount === 0) {
    warnings.push(
      "serverless scan enabled with packageCount=0 — no ops volume; verify intentional",
    );
  }

  const ops = serverlessScanOps(inputs);
  const rate = requireRate(rates.unitPrices, meters.opsMeterId);
  // Rate is per million requests/exec — convert ops to millions
  const millions = ops / 1_000_000;
  // Also include light bandwidth proxy from avgPackageGB when present (incremental copy)
  const gb = inputs.packageCount * inputs.avgPackageGB * inputs.scansPerMonth;
  // Primary bill: million-ops; if avgPackageGB>0, add a note that GB is tracking only
  // unless the meter is GB-denominated — our meters are ops-style. Keep ops as amount.
  const amount = millions * rate;
  if (gb > 0) {
    notes.push(
      `tracked incremental package volume ${gb} GB (ops meter ${meters.opsMeterId}; storage not billed)`,
    );
  }

  const lineItems: LineItem[] = [
    {
      provider,
      capability: "serverless",
      meterId: meters.opsMeterId,
      amount,
      confidence: "Low",
    },
  ];

  return {
    lineItems,
    totals: { expected: sumAmounts(lineItems) },
    warnings,
    notes,
    confidence: "Low",
  };
}

function empty(notes: string[]): ScanEstimateResult {
  return {
    lineItems: [],
    totals: { expected: 0 },
    warnings: [],
    notes,
    confidence: "Low",
  };
}
