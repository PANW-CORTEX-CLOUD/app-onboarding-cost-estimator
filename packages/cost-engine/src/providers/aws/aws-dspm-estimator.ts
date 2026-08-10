/**
 * AWS DSPM estimator — S3 data retrieval band + optional ephemeral EC2.
 * @see https://aws.amazon.com/s3/pricing/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateDspmForProvider } from "../dspm/estimate-dspm-core.ts";
import type { DspmInputs, DspmResult } from "../dspm/dspm.types.ts";

/**
 * Blended $/GB proxy for S3 data-plane reads (GetObject scan traffic). Not a
 * single official S3 SKU — S3 itself bills GET as $/1,000 requests plus (for
 * cross-region/internet) $/GB data transfer; this meter approximates both as
 * one $/GB band, consistent with the Low-confidence "GB + 1k-requests" unit
 * documented in `capability-meter-map.ts`.
 */
export const AWS_DSPM_READ_METER = "s3-data-retrieval-band";
/** Reused EC2 outpost-scanner hourly rate for DSPM's optional ephemeral connector compute. */
export const AWS_DSPM_EPHEMERAL_METER = "ec2-outpost-scanner";

/**
 * DSPM data-plane read estimate: `scannedGB × s3-data-retrieval-band` ($/GB),
 * plus an optional ephemeral-compute uplift when `includeEphemeralInfra` is set
 * (`scansPerMonth × ephemeralHoursPerScan × ec2-outpost-scanner`).
 * Always returned as a low/expected/high band — DSPM is Low confidence by
 * policy (never a false-precise point quote); see `estimateDspmForProvider`.
 *
 * @param inputs DSPM inputs; `enabled=false` → $0 band.
 * @param rates AWS RateCard — must carry provider "aws".
 * @returns Line items, low/expected/high totals, and `scannedGB`.
 * @see https://aws.amazon.com/s3/pricing/
 */
export function estimateAwsDspm(
  inputs: DspmInputs,
  rates: RateCard,
): DspmResult {
  return estimateDspmForProvider(
    "aws",
    {
      dataReadMeterId: AWS_DSPM_READ_METER,
      ephemeralMeterId: AWS_DSPM_EPHEMERAL_METER,
      providerLabel: "AWS",
      govCloudFailClosed: false,
    },
    inputs,
    rates,
  );
}
