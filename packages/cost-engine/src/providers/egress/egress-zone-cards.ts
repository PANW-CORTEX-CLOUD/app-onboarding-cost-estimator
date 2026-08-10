/**
 * Zone/region egress rate cards (package 11).
 * Multipliers applied to the provider's base egress meter unit price.
 * Unknown zones are not silently mapped to free — caller excludes + warns.
 *
 * Official bandwidth pages (citations in OFFICIAL_FORMULA_CHECKS.md):
 * - Azure: https://azure.microsoft.com/en-us/pricing/details/bandwidth/
 * - AWS: https://aws.amazon.com/ec2/pricing/on-demand/ (Data Transfer)
 * - GCP: https://cloud.google.com/vpc/network-pricing
 */

export type EgressZoneCard = {
  /** Canonical zone key (lowercase). */
  zone: string;
  /** Multiplier on base $/GB meter (1 = full internet egress tier). */
  rateMultiplier: number;
  label: string;
};

/** Azure bandwidth zones (commercial). Gov uses separate card set. */
export const AZURE_EGRESS_ZONES: readonly EgressZoneCard[] = [
  { zone: "internet", rateMultiplier: 1, label: "Internet egress" },
  { zone: "cross-cloud", rateMultiplier: 1, label: "Cross-cloud egress (never free)" },
  { zone: "europe", rateMultiplier: 0.9, label: "Inter-continent Europe-ish" },
  { zone: "asia", rateMultiplier: 1.1, label: "Inter-continent Asia-ish" },
  { zone: "same-region", rateMultiplier: 0, label: "Same-region (typically $0)" },
] as const;

export const AZURE_GOV_EGRESS_ZONES: readonly EgressZoneCard[] = [
  { zone: "internet", rateMultiplier: 1.15, label: "Azure Gov internet egress (separate SKU)" },
  { zone: "cross-cloud", rateMultiplier: 1.15, label: "Azure Gov cross-cloud" },
  { zone: "same-region", rateMultiplier: 0, label: "Azure Gov same-region" },
] as const;

export const AWS_EGRESS_ZONES: readonly EgressZoneCard[] = [
  { zone: "internet", rateMultiplier: 1, label: "Internet data transfer out" },
  { zone: "cross-cloud", rateMultiplier: 1, label: "Cross-cloud (never free)" },
  { zone: "us-west-2", rateMultiplier: 0.02 / 0.09, label: "Inter-region to us-west-2 (approx)" },
  { zone: "same-region", rateMultiplier: 0, label: "Same-AZ/region typical $0" },
] as const;

export const AWS_GOV_EGRESS_ZONES: readonly EgressZoneCard[] = [
  { zone: "internet", rateMultiplier: 1.2, label: "GovCloud internet egress (separate price list)" },
  { zone: "cross-cloud", rateMultiplier: 1.2, label: "GovCloud cross-cloud" },
  { zone: "same-region", rateMultiplier: 0, label: "GovCloud same-region" },
] as const;

export const GCP_EGRESS_ZONES: readonly EgressZoneCard[] = [
  { zone: "internet", rateMultiplier: 1, label: "Internet egress" },
  { zone: "cross-cloud", rateMultiplier: 1, label: "Cross-cloud (never free)" },
  { zone: "europe", rateMultiplier: 0.08 / 0.12, label: "Intercontinental Europe-ish" },
  { zone: "same-region", rateMultiplier: 0, label: "Same-region typical $0" },
] as const;

export const GCP_GOV_EGRESS_ZONES: readonly EgressZoneCard[] = [
  { zone: "internet", rateMultiplier: 1.1, label: "Assured/restricted internet egress" },
  { zone: "cross-cloud", rateMultiplier: 1.1, label: "Restricted cross-cloud" },
  { zone: "same-region", rateMultiplier: 0, label: "Same-region" },
] as const;

/**
 * Case/whitespace-insensitive lookup of a zone card by key.
 * @returns `undefined` when unrecognized — caller must exclude + warn, never
 * default to a fabricated rate (fail closed; @see estimate-egress-core.ts).
 */
export function lookupEgressZone(
  cards: readonly EgressZoneCard[],
  destinationZone: string,
): EgressZoneCard | undefined {
  const key = destinationZone.trim().toLowerCase();
  return cards.find((c) => c.zone === key);
}
