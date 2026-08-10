/**
 * Azure DSPM estimator — Blob Storage read (Get Blob) + list (List and
 * create container) operations, priced per-10k-requests, plus optional
 * ephemeral connector compute. Hot-tier retrieval is free on Azure, so
 * operations — not gigabytes — are the billable unit.
 * Azure Government: fail closed (N/A per Cortex).
 * @see https://azure.microsoft.com/en-us/pricing/details/storage/blobs/
 * @see https://learn.microsoft.com/en-us/azure/storage/blobs/map-rest-apis-transaction-categories
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { AZURE_TF_DEFAULTS } from "./capability-meter-map.ts";
import { estimateDspmForProvider } from "../dspm/estimate-dspm-core.ts";
import type { DspmInputs, DspmResult } from "../dspm/dspm.types.ts";

/** Get Blob — Read-class operation, one per object regardless of size. */
export const AZURE_DSPM_READ_METER = "blob-hot-lrs-read-10k";
/** Enumerating the estate: a dearer operation class than a read. */
export const AZURE_DSPM_LIST_METER = "blob-hot-lrs-list-10k";
export const AZURE_DSPM_EPHEMERAL_METER = "vm-outpost-scanner";

/**
 * Azure DSPM monthly cost band — Low confidence (never a single point
 * quote). Delegates to {@link estimateDspmForProvider}: scanned bytes are
 * converted to an object count via `avgObjectSizeMB`, then priced as Get
 * Blob reads (`AZURE_DSPM_READ_METER`) plus List Blobs enumeration
 * (`AZURE_DSPM_LIST_METER`).
 *
 * @param inputs DSPM toggle + data-estate volume signals.
 * @param rates Azure RateCard — must carry provider "azure",
 *   `blob-hot-lrs-read-10k` and `blob-hot-lrs-list-10k` (and
 *   `vm-outpost-scanner` when `includeEphemeralInfra`).
 * @returns `{low, expected, high}` band totals (never a bare point) — always Low confidence.
 * @throws when the region looks like Azure Government (DSPM is N/A per Cortex; fail
 *   closed instead of pricing at commercial rates).
 */
export function estimateAzureDspm(
  inputs: DspmInputs,
  rates: RateCard,
): DspmResult {
  const withDiscovery: DspmInputs = {
    ...inputs,
    discoveryTelemetryEmpty:
      inputs.discoveryTelemetryEmpty ?? AZURE_TF_DEFAULTS.discoveryTfEmpty,
  };
  return estimateDspmForProvider(
    "azure",
    {
      listMeterId: AZURE_DSPM_LIST_METER,
      dataReadMeterId: AZURE_DSPM_READ_METER,
      ephemeralMeterId: AZURE_DSPM_EPHEMERAL_METER,
      providerLabel: "Azure",
      govCloudFailClosed: true,
    },
    withDiscovery,
    rates,
  );
}
