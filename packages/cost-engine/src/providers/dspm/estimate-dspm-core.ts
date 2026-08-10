/**
 * Shared DSPM estimate body — provider meters injected (package 09).
 */
import type {
  CloudProvider,
  LineItem,
  RateCard,
} from "../../core/models/estimate.types.ts";
import { isGovCloudRegion } from "../ads/ads.types.ts";
import { DEFAULT_AVG_OBJECT_SIZE_MB } from "../../core/estimator-defaults.ts";
import { createLogger } from "../../core/debug-log.ts";
import { opsCost, scanOperationCounts } from "./scan-operations.ts";
import {
  bandFromExpected,
  DEFAULT_EPHEMERAL_HOURS_PER_SCAN,
  requireRate,
  scannedGbFromInputs,
  type DspmInputs,
  type DspmResult,
} from "./dspm.types.ts";

const log = createLogger("cost:dspm");

export type DspmMeterIds = {
  /** Per-object read operation meter (Get Blob / GetObject / Class B). */
  dataReadMeterId: string;
  /** Estate enumeration meter (List Blobs / LIST / Class A). */
  listMeterId: string;
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
  const avgObjectSizeMB = inputs.avgObjectSizeMB ?? DEFAULT_AVG_OBJECT_SIZE_MB;

  // Object stores bill scanning per API call, not per gigabyte: hot/standard
  // tiers have no retrieval fee at all. Bytes therefore have to become an
  // object count before they can become dollars, and the assumption that does
  // it is stated in the notes rather than hidden.
  const ops = scanOperationCounts(provider, scannedGB, avgObjectSizeMB);
  const readRate = requireRate(rates.unitPrices, meters.dataReadMeterId);
  const listRate = requireRate(rates.unitPrices, meters.listMeterId);

  const readCost = opsCost(ops.readOps, readRate);
  const listCost = opsCost(ops.listOps, listRate);
  let expected = readCost + listCost;

  log.debug(
    () =>
      `${provider} scannedGB=${scannedGB} avgObjectSizeMB=${avgObjectSizeMB} objects=${ops.objects} readOps=${ops.readOps}@${readRate}/10k listOps=${ops.listOps}@${listRate}/10k read=$${readCost} list=$${listCost}`,
  );

  notes.push(
    `${ops.objects.toLocaleString("en-US", { maximumFractionDigits: 0 })} objects derived from ${scannedGB} GB at ${avgObjectSizeMB} MB average object size (object stores bill per operation, not per GB).`,
    `${ops.readOps.toLocaleString("en-US", { maximumFractionDigits: 0 })} read operations (${meters.dataReadMeterId}) + ${ops.listOps.toLocaleString("en-US")} list operations (${meters.listMeterId}, ${ops.listPageSize} objects per page).`,
  );

  const lineItems: LineItem[] = [
    {
      provider,
      capability: "dspm",
      meterId: meters.dataReadMeterId,
      amount: readCost,
      confidence: "Low",
    },
    {
      provider,
      capability: "dspm",
      meterId: meters.listMeterId,
      amount: listCost,
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
