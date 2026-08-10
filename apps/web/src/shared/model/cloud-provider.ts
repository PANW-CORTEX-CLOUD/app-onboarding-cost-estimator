/**
 * Shared cloud-provider primitives (OpenAPI CloudProvider mirror).
 * Kept in shared so URL/cache helpers can use them without upward FSD imports.
 */
export type CloudProvider = "azure" | "aws" | "gcp";

export const CLOUD_PROVIDERS: readonly CloudProvider[] = [
  "azure",
  "aws",
  "gcp",
] as const;

export const DEFAULT_PROVIDER: CloudProvider = "azure";

export const PROVIDER_LABELS: Record<CloudProvider, string> = {
  azure: "Azure",
  aws: "AWS",
  gcp: "GCP",
};

export function isCloudProvider(value: string): value is CloudProvider {
  return (CLOUD_PROVIDERS as readonly string[]).includes(value);
}
