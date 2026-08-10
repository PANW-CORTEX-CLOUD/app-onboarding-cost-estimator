/**
 * AWS DSPM estimator — S3 data retrieval band + optional ephemeral EC2.
 * @see https://aws.amazon.com/s3/pricing/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateDspmForProvider } from "../dspm/estimate-dspm-core.ts";
import type { DspmInputs, DspmResult } from "../dspm/dspm.types.ts";

export const AWS_DSPM_READ_METER = "s3-get-10k";
/** Enumerating the estate: a dearer operation class than a read. */
export const AWS_DSPM_LIST_METER = "s3-put-10k";
export const AWS_DSPM_EPHEMERAL_METER = "ec2-outpost-scanner";

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
