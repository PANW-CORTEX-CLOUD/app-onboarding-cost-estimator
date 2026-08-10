/**
 * Shared ADS estimate body — provider meters injected (package 08).
 */
import type {
  CloudProvider,
  Confidence,
  LineItem,
  RateCard,
} from "../../core/models/estimate.types.ts";
import {
  DEFAULT_MONTH_HOURS,
  prorateSnapshotCost,
  resolveMonthHours,
} from "../../core/hours.ts";
import {
  collectAdsEdgeWarnings,
  isGovCloudRegion,
  requireRate,
  snapshotGbMonthsUsedSize,
  sumAmounts,
  DEFAULT_OUTPOST_HOURS_PER_SCAN,
  type AdsInputs,
  type AdsResult,
} from "./ads.types.ts";

export type AdsMeterIds = {
  snapshotMeterId: string;
  outpostMeterId: string;
  providerLabel: string;
};

export function estimateAdsForProvider(
  provider: CloudProvider,
  meters: AdsMeterIds,
  inputs: AdsInputs,
  rates: RateCard,
): AdsResult {
  if (rates.provider !== provider) {
    throw new Error(`estimateAds requires ${provider} RateCard`);
  }
  const notes: string[] = [
    "ADS Cloud bills snapshot used-size prorated by lifetimeHours/monthHours.",
    "v1 snapshot model is conservative full used size (not incremental delta).",
  ];
  if (!inputs.enabled) {
    return {
      lineItems: [],
      totals: { expected: 0 },
      snapshotGbMonths: 0,
      snapshotCost: 0,
      computeCost: 0,
      warnings: [],
      notes,
      confidence: "Med",
    };
  }

  const warnings = collectAdsEdgeWarnings(inputs);
  const monthHours =
    inputs.monthHours ??
    resolveMonthHours({ convention: "730" }).monthHours ??
    DEFAULT_MONTH_HOURS;

  if (isGovCloudRegion(inputs.region)) {
    warnings.push(
      `${meters.providerLabel} region '${inputs.region}' looks like Government/restricted — verify ADS / snapshot SKU availability before quoting`,
    );
    if (inputs.mode === "Outpost") {
      warnings.push(
        `ADS Outpost scanner availability in ${meters.providerLabel} Government/restricted regions is limited — Med-Low confidence`,
      );
    }
  }

  const snapshotRate = requireRate(rates.unitPrices, meters.snapshotMeterId);
  const gbMonths = snapshotGbMonthsUsedSize({
    vmCount: inputs.vmCount,
    avgUsedDiskGB: inputs.avgUsedDiskGB,
    scansPerMonth: inputs.scansPerMonth,
    snapshotLifetimeHours: inputs.snapshotLifetimeHours,
    monthHours,
  });
  const snapshotCost =
    inputs.vmCount *
    inputs.scansPerMonth *
    prorateSnapshotCost(
      inputs.avgUsedDiskGB,
      snapshotRate,
      inputs.snapshotLifetimeHours,
      monthHours,
    );

  const lineItems: LineItem[] = [
    {
      provider,
      capability: "ads_cloud",
      meterId: meters.snapshotMeterId,
      amount: snapshotCost,
      confidence: "Med",
    },
  ];

  let computeCost = 0;
  let confidence: Confidence = "Med";

  if (inputs.mode === "Outpost") {
    const computeRate = requireRate(rates.unitPrices, meters.outpostMeterId);
    const hoursPerScan =
      inputs.outpostHoursPerScan ?? DEFAULT_OUTPOST_HOURS_PER_SCAN;
    const scannerUnits = 1;
    const computeHours = scannerUnits * inputs.scansPerMonth * hoursPerScan;
    computeCost = scannerUnits * computeRate * computeHours;
    if (inputs.outpostVmSku) {
      notes.push(`outpostVmSku=${inputs.outpostVmSku}`);
    }
    lineItems.push({
      provider,
      capability: "ads_outpost",
      meterId: meters.outpostMeterId,
      amount: computeCost,
      confidence: "Low",
    });
    notes.push(
      `Outpost computeHours=${computeHours} (scans × hoursPerScan); confidence Med-Low`,
    );
    confidence = "Low";
  } else {
    notes.push("Cloud mode: no outpost compute line.");
  }

  return {
    lineItems,
    totals: { expected: sumAmounts(lineItems) },
    snapshotGbMonths: gbMonths,
    snapshotCost,
    computeCost,
    warnings,
    notes,
    confidence,
  };
}
