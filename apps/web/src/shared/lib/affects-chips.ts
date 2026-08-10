/**
 * Post-estimate “Affects” chips — bind volume fields to live meter $ (package 35).
 * Never invent meters; only map fields to line items present on the estimate.
 */
import type { CloudProvider } from "../model/cloud-provider.ts";
import { formatUsd } from "./format-currency.ts";

export type AffectsChip = {
  meterId: string;
  friendlyName: string;
  amount: number;
};

export type AffectsFieldId =
  | "peakMBps"
  | "peakEventsPerSec"
  | "ingressGBPerDay"
  | "avgStoredGB"
  | "accountCount";

type LineLike = {
  meterId: string;
  amount: number;
  capability?: string;
};

const FRIENDLY: Record<string, string> = {
  "eh-standard-tu": "Event Hubs capacity (TU)",
  "eh-standard-ingress-events": "Event Hubs ingress events",
  "blob-hot-lrs-capacity": "Blob Hot LRS storage",
  "kinesis-shard-hour": "Kinesis shard-hours",
  "kinesis-put-payload-units": "Kinesis PUT payload units",
  "s3-standard-storage": "S3 Standard storage",
  "pubsub-message-delivery": "Pub/Sub message delivery",
  "pubsub-storage": "Pub/Sub storage",
  "gcs-standard-storage": "GCS Standard storage",
};

/** Field → meterIds that this input primarily sizes (provider-specific). */
const FIELD_METERS: Record<
  CloudProvider,
  Partial<Record<AffectsFieldId, string[]>>
> = {
  azure: {
    peakMBps: ["eh-standard-tu"],
    peakEventsPerSec: ["eh-standard-tu"],
    ingressGBPerDay: ["eh-standard-ingress-events"],
    avgStoredGB: ["blob-hot-lrs-capacity"],
    accountCount: ["eh-standard-tu", "eh-standard-ingress-events"],
  },
  aws: {
    peakMBps: ["kinesis-shard-hour"],
    peakEventsPerSec: ["kinesis-shard-hour"],
    ingressGBPerDay: ["kinesis-put-payload-units"],
    avgStoredGB: ["s3-standard-storage"],
    accountCount: ["kinesis-shard-hour", "kinesis-put-payload-units"],
  },
  gcp: {
    peakMBps: ["pubsub-message-delivery", "pubsub-storage"],
    peakEventsPerSec: ["pubsub-message-delivery"],
    ingressGBPerDay: ["pubsub-message-delivery", "pubsub-storage"],
    avgStoredGB: ["gcs-standard-storage"],
    accountCount: ["pubsub-message-delivery", "pubsub-storage"],
  },
};

/**
 * Build chips for one field from estimate line items.
 * EDGE: omit meters not present; omit zero-amount lines; never invent $0 meters.
 * No aggregation/percent math — each chip shows a meter's raw line-item `amount`
 * as-is; `wanted` meter order (not a sort) determines chip order.
 * @param provider Selected cloud provider — selects the field→meterId table.
 * @param lineItems Current estimate's line items (or `null`/`undefined` before a run).
 * @param fieldId Volume input field to look up affected meters for.
 * @returns Chips for meters present on the estimate with `amount > 0`, in table order.
 */
export function buildAffectsChips(
  provider: CloudProvider,
  lineItems: LineLike[] | null | undefined,
  fieldId: AffectsFieldId,
): AffectsChip[] {
  if (!lineItems || lineItems.length === 0) return [];
  const wanted = FIELD_METERS[provider]?.[fieldId] ?? [];
  if (wanted.length === 0) return [];

  const byMeter = new Map(lineItems.map((li) => [li.meterId, li]));
  const chips: AffectsChip[] = [];
  for (const meterId of wanted) {
    const li = byMeter.get(meterId);
    if (!li) continue;
    if (!(li.amount > 0)) continue;
    chips.push({
      meterId,
      friendlyName: FRIENDLY[meterId] ?? meterId,
      amount: li.amount,
    });
  }
  return chips;
}

/** All audit-related fields → chips map for forms; fields with no chips are omitted (not `[]`). */
export function buildAffectsByField(
  provider: CloudProvider,
  lineItems: LineLike[] | null | undefined,
): Partial<Record<AffectsFieldId, AffectsChip[]>> {
  const fields: AffectsFieldId[] = [
    "peakMBps",
    "peakEventsPerSec",
    "ingressGBPerDay",
    "avgStoredGB",
    "accountCount",
  ];
  const out: Partial<Record<AffectsFieldId, AffectsChip[]>> = {};
  for (const f of fields) {
    const chips = buildAffectsChips(provider, lineItems, f);
    if (chips.length > 0) out[f] = chips;
  }
  return out;
}

export function formatAffectsChip(chip: AffectsChip): string {
  return `Affects: ${chip.friendlyName} · ${formatUsd(chip.amount)}/mo`;
}
