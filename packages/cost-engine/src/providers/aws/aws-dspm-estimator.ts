/**
 * AWS DSPM estimator — S3 data retrieval band + optional ephemeral EC2.
 * @see https://aws.amazon.com/s3/pricing/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateDspmForProvider } from "../dspm/estimate-dspm-core.ts";
import type { DspmInputs, DspmResult } from "../dspm/dspm.types.ts";

export const AWS_DSPM_READ_METER = "s3-data-retrieval-band";
export const AWS_DSPM_EPHEMERAL_METER = "ec2-outpost-scanner";

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
