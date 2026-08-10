/**
 * Estimator honesty: TF-grounded audit vs modeled non-TF capabilities (pkg 32).
 * Fail closed on messaging — never imply comprehensive = deployed TF.
 */
import type { CloudProvider } from "../core/models/estimate.types.ts";
import {
  AZURE_MODELED_NO_TF_CAPABILITIES,
  AZURE_MODELED_NO_TF_WARNING_PREFIX,
  NO_TF_INVENTORY_WARNING,
  type AzureModeledNoTfCapability,
} from "./azure/tf-audit-reconciliation.ts";

export type HonestyCapabilityFlags = {
  discovery?: boolean;
  auditLogs?: boolean;
  adsCloud?: boolean;
  adsOutpost?: boolean;
  dspm?: boolean;
  registry?: boolean;
  serverless?: boolean;
  egress?: boolean;
};

const CAP_FLAG_TO_MODELED: Array<{
  flag: keyof HonestyCapabilityFlags;
  id: AzureModeledNoTfCapability;
}> = [
  { flag: "adsCloud", id: "ads_cloud" },
  { flag: "adsOutpost", id: "ads_outpost" },
  { flag: "dspm", id: "dspm" },
  { flag: "registry", id: "registry" },
  { flag: "serverless", id: "serverless" },
  { flag: "egress", id: "egress" },
];

/**
 * Append at most one Azure modeled warning and one AWS/GCP no-TF note.
 * AWS/GCP: no connector TF inventory exists yet, so every enabled capability
 * is flagged as modeled-not-TF-verified (one combined note, deduped).
 * Azure: only capabilities outside `AZURE_MODELED_NO_TF_CAPABILITIES` (the
 * audit stream + storage) are TF-grounded; audit-only (no modeled caps on)
 * → no warning. Discovery alone does not trigger modeled spam (it has no
 * meter at all — @see create-estimate.ts).
 * Mutates `warnings` in place (push-only; does not dedupe pre-existing entries
 * from other sources beyond the exact-match/prefix checks it performs itself).
 * @throws when an enabled Azure capability id isn't in the known modeled set
 * (fail closed if the two maps drift apart).
 */
export function appendTfHonestyWarnings(
  provider: CloudProvider,
  caps: HonestyCapabilityFlags,
  warnings: string[],
): void {
  if (provider === "aws" || provider === "gcp") {
    if (!warnings.some((w) => w.includes(NO_TF_INVENTORY_WARNING))) {
      warnings.push(
        `${provider.toUpperCase()}: ${NO_TF_INVENTORY_WARNING}`,
      );
    }
    return;
  }

  // Azure: list enabled modeled caps once (comprehensive honesty).
  const enabledModeled = CAP_FLAG_TO_MODELED.filter(
    (row) => caps[row.flag] === true,
  ).map((row) => row.id);

  if (enabledModeled.length === 0) {
    return;
  }

  // Guard: only known modeled set (fail closed if map drifts).
  for (const id of enabledModeled) {
    if (
      !(AZURE_MODELED_NO_TF_CAPABILITIES as readonly string[]).includes(id)
    ) {
      throw new Error(`unexpected modeled capability id: ${id}`);
    }
  }

  if (
    warnings.some((w) => w.startsWith(AZURE_MODELED_NO_TF_WARNING_PREFIX))
  ) {
    return;
  }

  warnings.push(
    `${AZURE_MODELED_NO_TF_WARNING_PREFIX} ${enabledModeled.join(", ")}`,
  );
}
