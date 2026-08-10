/**
 * Shared DSPM estimate body — provider meters injected (package 09).
 */
import type {
  CloudProvider,
  LineItem,
  RateCard,
} from "../../core/models/estimate.types.ts";
import { isGovCloudRegion } from "../ads/ads.types.ts";
import {
  bandFromExpected,
  DEFAULT_EPHEMERAL_HOURS_PER_SCAN,
  requireRate,
  scannedGbFromInputs,
  type DspmInputs,
  type DspmResult,
} from "./dspm.types.ts";

export type DspmMeterIds = {
  dataReadMeterId: string;
  ephemeralMeterId: string;
  providerLabel: string;
  /**
   * When true, Government regions fail closed (Azure DSPM N/A per Cortex).
   * AWS/GCP Gov warn but still estimate with Low confidence.
   */
  govCloudFailClosed: boolean;
};

/**
 * DSPM monthly band estimate for one provider — always Low confidence.
 *
 * `expected = scannedGbFromInputs(inputs) × dataReadRate` (@see scannedGbFromInputs)
 * `+ ephemeralHoursPerScan × scansPerMonth × ephemeralRate` when `includeEphemeralInfra` is set.
 * Returned as a `{low, expected, high}` band via `bandFromExpected` — never a bare point.
 *
 * @param meters.govCloudFailClosed When true, Government/restricted regions throw
 * instead of estimating (Azure: DSPM is N/A per Cortex). AWS/GCP pass false and
 * instead warn + still estimate at Low confidence.
 * @returns Empty $0 result when `inputs.enabled` is false.
 * @throws when `rates.provider` doesn't match `provider`; when Gov region and
 * `govCloudFailClosed`; when discovery telemetry is empty and dataEstateGB≤0
 * (refuse silent precision); or when a required meter price is missing.
 */
export function estimateDspmForProvider(
  provider: CloudProvider,
  meters: DspmMeterIds,
  inputs: DspmInputs,
  rates: RateCard,
): DspmResult {
  if (rates.provider !== provider) {
    throw new Error(`estimateDspm requires ${provider} RateCard`);
  }

  const notes: string[] = [
    "DSPM quotes are Low confidence bands (low/expected/high) — never present as a precise single point.",
    "Cite Cortex onboarding / permissions docs for data-plane read scope; customer-cloud meters only.",
  ];

  if (!inputs.enabled) {
    return {
      lineItems: [],
      totals: { low: 0, expected: 0, high: 0 },
      scannedGB: 0,
      warnings: [],
      notes,
      confidence: "Low",
      showLowConfidenceWarning: false,
    };
  }

  // TEST/EDGE: Azure Gov DSPM N/A — fail closed
  if (meters.govCloudFailClosed && isGovCloudRegion(inputs.region)) {
    throw new Error(
      `${meters.providerLabel} Government/restricted region '${inputs.region}': DSPM is N/A per Cortex — fail closed (do not use commercial rates)`,
    );
  }

  const warnings: string[] = [];
  if (isGovCloudRegion(inputs.region) && !meters.govCloudFailClosed) {
    warnings.push(
      `${meters.providerLabel} Gov/restricted region '${inputs.region}' — verify DSPM SKU/price list partition; do not mix commercial rates`,
    );
  }

  // EDGE: empty discovery + zero telemetry refuse silent precision
  if (
    inputs.discoveryTelemetryEmpty === true &&
    !(inputs.dataEstateGB > 0)
  ) {
    throw new Error(
      "DSPM: empty discovery TF / zero telemetry with dataEstateGB≤0 — refuse silent precision (provide explicit estate GB or disable DSPM)",
    );
  }

  if (inputs.dataEstateGB === 0) {
    warnings.push(
      "DSPM enabled with dataEstateGB=0 — expected band is $0; verify intentional (no invented estate)",
    );
  }

  const scannedGB = scannedGbFromInputs(inputs);
  const readRate = requireRate(rates.unitPrices, meters.dataReadMeterId);
  // Expected: scanned GB × data-read band unit price ($/GB)
  let expected = scannedGB * readRate;

  const lineItems: LineItem[] = [
    {
      provider,
      capability: "dspm",
      meterId: meters.dataReadMeterId,
      amount: expected,
      confidence: "Low",
    },
  ];

  if (inputs.includeEphemeralInfra) {
    const ephRate = requireRate(rates.unitPrices, meters.ephemeralMeterId);
    const hoursPerScan =
      inputs.ephemeralHoursPerScan ?? DEFAULT_EPHEMERAL_HOURS_PER_SCAN;
    const ephCost = ephRate * inputs.scansPerMonth * hoursPerScan;
    expected += ephCost;
    lineItems.push({
      provider,
      capability: "dspm",
      meterId: meters.ephemeralMeterId,
      amount: ephCost,
      confidence: "Low",
    });
    notes.push(
      `ephemeral infra uplift enabled: ${inputs.scansPerMonth}×${hoursPerScan}h × ${meters.ephemeralMeterId}`,
    );
  } else {
    notes.push("ephemeral connector infra uplift off (explicit flag required).");
  }

  const totals = bandFromExpected(expected);
  warnings.push(
    "UI: display Low confidence warning — DSPM is a band, not a point quote",
  );

  return {
    lineItems,
    totals,
    scannedGB,
    warnings,
    notes,
    confidence: "Low",
    showLowConfidenceWarning: true,
  };
}
