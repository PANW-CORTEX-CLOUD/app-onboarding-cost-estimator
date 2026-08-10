/**
 * AWS DSPM estimator — S3 read (GET) + list (PUT-class) operations, priced
 * per-10k-requests, plus optional ephemeral EC2 scanner compute.
 * @see https://aws.amazon.com/s3/pricing/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateDspmForProvider } from "../dspm/estimate-dspm-core.ts";
import type { DspmInputs, DspmResult } from "../dspm/dspm.types.ts";

/** S3 Tier2 (GET and other) requests — one per object scanned. */
export const AWS_DSPM_READ_METER = "s3-get-10k";
/** Enumerating the estate: a dearer operation class than a read. */
export const AWS_DSPM_LIST_METER = "s3-put-10k";
export const AWS_DSPM_EPHEMERAL_METER = "ec2-outpost-scanner";

/**
 * AWS DSPM monthly cost band — Low confidence (never a single point quote).
 * Delegates to {@link estimateDspmForProvider}: scanned bytes are converted
 * to an object count via `avgObjectSizeMB`, then priced as S3 GET requests
 * (`AWS_DSPM_READ_METER`) plus LIST requests (`AWS_DSPM_LIST_METER`) — S3
 * has no per-GB retrieval fee for Standard storage, so operations, not
 * gigabytes, are the billable unit. Optional ephemeral connector compute
 * reuses `AWS_DSPM_EPHEMERAL_METER`.
 *
 * @param inputs DSPM estate/scan config. `enabled=false` → $0.
 * @param rates AWS RateCard; must carry `s3-get-10k` and `s3-put-10k` (and
 *   `ec2-outpost-scanner` when `includeEphemeralInfra` is set).
 * @returns low/expected/high band (0.5×/1×/2× expected) — UI must show the
 *   Low confidence warning, never a bare point estimate.
 * @see https://aws.amazon.com/s3/pricing/
 */
export function estimateAwsDspm(
  inputs: DspmInputs,
  rates: RateCard,
): DspmResult {
  return estimateDspmForProvider(
    "aws",
    {
      listMeterId: AWS_DSPM_LIST_METER,
      dataReadMeterId: AWS_DSPM_READ_METER,
      ephemeralMeterId: AWS_DSPM_EPHEMERAL_METER,
      providerLabel: "AWS",
      govCloudFailClosed: false,
    },
    inputs,
    rates,
  );
}
