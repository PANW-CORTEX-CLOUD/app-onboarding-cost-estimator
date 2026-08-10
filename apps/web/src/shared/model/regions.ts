/**
 * Provider → default regions for estimator (display / request only; no pricing).
 */
import type { CloudProvider } from "../model/cloud-provider.ts";

export const REGIONS_BY_PROVIDER: Record<CloudProvider, readonly string[]> = {
  azure: ["eastus", "westeurope", "westus2"],
  aws: ["us-east-1", "eu-west-1", "us-west-2"],
  gcp: ["us-central1", "europe-west1", "us-east1"],
};

export function defaultRegionFor(provider: CloudProvider): string {
  return REGIONS_BY_PROVIDER[provider][0]!;
}
