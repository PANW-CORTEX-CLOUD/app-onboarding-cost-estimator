/**
 * TF-grounding labels for cost-driver literacy (package 01/07).
 *
 * The connector Terraform decides what a customer can actually be billed for:
 * a capability whose module is switched off in `template_version`, or whose
 * .tf file is empty, will never create a resource and so can never appear on
 * an invoice. The table below mirrors sources/tf-feature-manifest.json, which
 * is derived from azure/data by scripts/derive-tf-manifest.mjs — a test binds
 * the two together so the UI cannot drift from the real Terraform.
 */
import type { CloudProvider } from "./cloud-provider.ts";

export type TfGroundingKind = "tf-grounded" | "modeled";

/**
 * deployed        the Terraform creates billable resources for this
 * not-deployed    a module exists but is switched off or empty → cannot be billed
 * no-connector-tf nothing in the Terraform implements this → modelled only
 */
export type TfDeployability = "deployed" | "not-deployed" | "no-connector-tf";

/** How the estimate is grounded. */
export type TfMode = "as-deployed" | "what-if";

/**
 * Azure capability → deployability, mirroring sources/tf-feature-manifest.json.
 * Keyed by UI capability key (camelCase), not the engine's snake_case id.
 */
export const AZURE_CAPABILITY_DEPLOYABILITY: Record<string, TfDeployability> = {
  discovery: "not-deployed",
  auditLogs: "deployed",
  adsCloud: "no-connector-tf",
  adsOutpost: "no-connector-tf",
  dspm: "no-connector-tf",
  registry: "no-connector-tf",
  serverless: "no-connector-tf",
  egress: "no-connector-tf",
};

/** UI capability key → engine capability id, for manifest comparisons. */
export const CAPABILITY_KEY_TO_ENGINE_ID: Record<string, string> = {
  discovery: "discovery",
  auditLogs: "audit_logs",
  adsCloud: "ads_cloud",
  adsOutpost: "ads_outpost",
  dspm: "dspm",
  registry: "registry",
  serverless: "serverless",
  egress: "egress",
};

/**
 * Only Azure ships connector IaC in this repo. AWS and GCP figures are
 * modelled defaults and must never borrow the Azure manifest.
 */
export function capabilityDeployability(
  provider: CloudProvider,
  capabilityKey: string,
): TfDeployability {
  if (provider !== "azure") return "no-connector-tf";
  return AZURE_CAPABILITY_DEPLOYABILITY[capabilityKey] ?? "no-connector-tf";
}

export function deployabilityLabel(kind: TfDeployability): string {
  if (kind === "deployed") return "Deployed by your Terraform";
  if (kind === "not-deployed") return "In the Terraform but switched off";
  return "No Terraform — modelled";
}

export function deployabilityHint(
  provider: CloudProvider,
  kind: TfDeployability,
): string {
  if (kind === "deployed") {
    return "This appears on your bill once you run terraform apply.";
  }
  if (kind === "not-deployed") {
    return "The module deploys nothing, so it cannot be billed. Priced at $0.";
  }
  return provider === "azure"
    ? "The connector Terraform does not create this. Priced as a plan, not as deployed infrastructure."
    : `No connector Terraform exists for ${provider.toUpperCase()}. Every figure is a modelled default.`;
}

/** True when this capability can contribute to an as-deployed total. */
export function isBillableAsDeployed(
  provider: CloudProvider,
  capabilityKey: string,
): boolean {
  return capabilityDeployability(provider, capabilityKey) === "deployed";
}

/**
 * The questions each capability makes worth asking. Used by the overview step
 * to say up front what it will need, and to keep the driver step down to the
 * fields the selected capabilities actually consume.
 */
export const CAPABILITY_COST_DRIVERS: Record<string, string[]> = {
  discovery: [],
  auditLogs: [
    "Accounts / subscriptions in scope",
    "Log intensity",
    "Monthly active users",
    "Average stored audit GB",
  ],
  adsCloud: ["VM count", "Average used disk GB", "Scans per month"],
  adsOutpost: ["VM count", "Average used disk GB", "Scans per month"],
  dspm: ["Data estate GB", "Percent scanned", "Scans per month"],
  registry: ["Container image count", "Average image GB", "Scans per month"],
  serverless: ["Function package count", "Scans per month"],
  egress: ["Egress GB per month"],
};

export function costDriversForCapability(capabilityKey: string): string[] {
  return CAPABILITY_COST_DRIVERS[capabilityKey] ?? [];
}

/**
 * Distinct questions the driver step will ask for a selection, in a stable
 * order — capabilities share drivers (scans per month), so this de-duplicates.
 */
export function costDriversForSelection(
  selected: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of selected) {
    for (const driver of costDriversForCapability(key)) {
      if (seen.has(driver)) continue;
      seen.add(driver);
      out.push(driver);
    }
  }
  return out;
}

export function tfGroundingForCapability(
  provider: CloudProvider,
  capability: string,
): TfGroundingKind {
  if (provider === "azure" && capability === "audit_logs") {
    return "tf-grounded";
  }
  return "modeled";
}

export function tfGroundingLabel(kind: TfGroundingKind): string {
  return kind === "tf-grounded" ? "TF-grounded" : "Modeled · no TF";
}

export function modeledCapsList(): string[] {
  return ["ADS", "DSPM", "Registry", "Serverless", "Egress"];
}
