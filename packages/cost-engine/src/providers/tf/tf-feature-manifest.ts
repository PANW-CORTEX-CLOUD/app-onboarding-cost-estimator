/**
 * What the connector Terraform actually deploys, and what that permits pricing.
 *
 * sources/tf-feature-manifest.json is derived from azure/data by
 * scripts/derive-tf-manifest.mjs — the module list in `template_version` is the
 * customer's checkbox state. Turning a module off there means the estimate must
 * stop billing whatever that module would have created, otherwise the quote
 * describes an infrastructure that will never exist.
 *
 * Two ways to ask for an estimate:
 *   as-deployed  price only what `terraform apply` will create — this is the
 *                number that has to match the customer's first invoice.
 *   what-if      price capabilities that have no connector TF as well, clearly
 *                labelled, for planning conversations.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CloudProvider } from "../../core/models/estimate.types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TF_FEATURE_MANIFEST_PATH = path.resolve(
  __dirname,
  "../../../../../sources/tf-feature-manifest.json",
);

/**
 * deployed          module is selected and creates billable resources
 * deployed-no-meter module is selected but creates nothing billable (→ $0, not "unknown")
 * not-deployed      module exists but is switched off or empty
 * no-connector-tf   no module implements this capability at all
 */
export type TfAvailability =
  | "deployed"
  | "deployed-no-meter"
  | "not-deployed"
  | "no-connector-tf";

export type TfMode = "as-deployed" | "what-if";

export const DEFAULT_TF_MODE: TfMode = "what-if";

export interface TfModuleRow {
  moduleId: string;
  file: string | null;
  capability: string;
  deployed: boolean;
  selectedInTemplateVersion: boolean;
  emptyFile: boolean;
  templateVersion: string | null;
  resourceCount: number;
  resourceTypes: string[];
  billableMeters: string[];
}

export interface TfCapabilityRow {
  availability: TfAvailability;
  billableMeters: string[];
  reason: string;
}

export interface TfFeatureManifest {
  schemaVersion: number;
  provider: CloudProvider;
  inventoryRoot: string;
  modules: TfModuleRow[];
  deployedBillableMeters: string[];
  capabilities: Record<string, TfCapabilityRow>;
}

const VALID_AVAILABILITY = new Set<string>([
  "deployed",
  "deployed-no-meter",
  "not-deployed",
  "no-connector-tf",
]);

export function parseTfFeatureManifest(raw: unknown): TfFeatureManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("tf-feature-manifest: document must be an object");
  }
  const doc = raw as Record<string, unknown>;
  if (doc.provider !== "azure") {
    throw new Error(
      `tf-feature-manifest: only azure has connector IaC, got ${String(doc.provider)}`,
    );
  }
  if (!Array.isArray(doc.modules)) {
    throw new Error("tf-feature-manifest: modules[] required");
  }
  if (!Array.isArray(doc.deployedBillableMeters)) {
    throw new Error("tf-feature-manifest: deployedBillableMeters[] required");
  }
  const caps = doc.capabilities as Record<string, TfCapabilityRow> | undefined;
  if (!caps || typeof caps !== "object") {
    throw new Error("tf-feature-manifest: capabilities required");
  }
  for (const [id, row] of Object.entries(caps)) {
    if (!VALID_AVAILABILITY.has(row?.availability)) {
      throw new Error(`tf-feature-manifest: bad availability for ${id}`);
    }
  }
  return doc as unknown as TfFeatureManifest;
}

let cached: TfFeatureManifest | undefined;

export function loadTfFeatureManifest(
  filePath: string = TF_FEATURE_MANIFEST_PATH,
): TfFeatureManifest {
  if (filePath === TF_FEATURE_MANIFEST_PATH && cached) return cached;
  const manifest = parseTfFeatureManifest(
    JSON.parse(fs.readFileSync(filePath, "utf8")),
  );
  if (filePath === TF_FEATURE_MANIFEST_PATH) cached = manifest;
  return manifest;
}

/**
 * Availability of one capability for one provider.
 * AWS and GCP ship no connector IaC in this repo, so every capability there is
 * `no-connector-tf` — never silently borrowed from the Azure manifest.
 */
export function capabilityAvailability(
  provider: CloudProvider,
  capability: string,
  manifest: TfFeatureManifest = loadTfFeatureManifest(),
): TfCapabilityRow {
  if (provider !== "azure") {
    return {
      availability: "no-connector-tf",
      billableMeters: [],
      reason: `${provider.toUpperCase()} has no connector Terraform in this repo — figures are modelled defaults.`,
    };
  }
  return (
    manifest.capabilities[capability] ?? {
      availability: "no-connector-tf",
      billableMeters: [],
      reason: `No module in ${manifest.inventoryRoot} implements '${capability}'.`,
    }
  );
}

/** Capability flags as createEstimate takes them. */
export type CapabilityFlags = {
  discovery?: boolean;
  auditLogs?: boolean;
  adsCloud?: boolean;
  adsOutpost?: boolean;
  dspm?: boolean;
  registry?: boolean;
  serverless?: boolean;
  egress?: boolean;
};

/** Request flag → manifest capability id. */
export const CAPABILITY_FLAG_IDS: ReadonlyArray<{
  flag: keyof CapabilityFlags;
  id: string;
}> = [
  { flag: "discovery", id: "discovery" },
  { flag: "auditLogs", id: "audit_logs" },
  { flag: "adsCloud", id: "ads_cloud" },
  { flag: "adsOutpost", id: "ads_outpost" },
  { flag: "dspm", id: "dspm" },
  { flag: "registry", id: "registry" },
  { flag: "serverless", id: "serverless" },
  { flag: "egress", id: "egress" },
];

export type CapabilityGateResult = {
  /** Flags the estimator may actually price. */
  effective: CapabilityFlags;
  /** Capabilities dropped because the TF will not deploy them. */
  excluded: Array<{ capability: string; reason: string }>;
  warnings: string[];
  mode: TfMode;
};

/**
 * Reduce requested capabilities to the ones the chosen mode allows.
 *
 * In `as-deployed`, anything the Terraform will not create is removed from the
 * estimate — with a warning naming it, so nothing disappears silently. In
 * `what-if` nothing is removed; the caller keeps the existing honesty warnings
 * that label those capabilities as modelled.
 */
export function gateCapabilitiesByTf(
  provider: CloudProvider,
  caps: CapabilityFlags,
  mode: TfMode = DEFAULT_TF_MODE,
  manifest: TfFeatureManifest = loadTfFeatureManifest(),
): CapabilityGateResult {
  const effective: CapabilityFlags = { ...caps };
  const excluded: Array<{ capability: string; reason: string }> = [];
  const warnings: string[] = [];

  if (mode !== "as-deployed") {
    return { effective, excluded, warnings, mode };
  }

  for (const { flag, id } of CAPABILITY_FLAG_IDS) {
    if (caps[flag] !== true) continue;
    const row = capabilityAvailability(provider, id, manifest);
    if (row.availability === "deployed" || row.availability === "deployed-no-meter") {
      continue;
    }
    effective[flag] = false;
    excluded.push({ capability: id, reason: row.reason });
  }

  if (excluded.length > 0) {
    warnings.push(
      `as-deployed mode: excluded ${excluded
        .map((e) => e.capability)
        .join(", ")} — the connector Terraform does not deploy ${excluded.length === 1 ? "it" : "them"}, so ${excluded.length === 1 ? "it cannot" : "they cannot"} appear on the bill. Switch to what-if mode to price ${excluded.length === 1 ? "it" : "them"} as a plan.`,
    );
  }

  return { effective, excluded, warnings, mode };
}

/**
 * Meters an as-deployed Azure estimate is allowed to bill.
 * Empty for providers without connector IaC — callers must not fall back to
 * the Azure set.
 */
export function deployedMetersFor(
  provider: CloudProvider,
  manifest: TfFeatureManifest = loadTfFeatureManifest(),
): string[] {
  return provider === "azure" ? [...manifest.deployedBillableMeters] : [];
}

/**
 * Cross-check: the meters derived by walking the Terraform must equal the
 * hand-maintained audit allowlist. Two independent derivations of the same
 * fact — if they ever disagree, one of them is describing infrastructure that
 * does not exist.
 *
 * @throws listing both sides when they differ.
 */
export function assertManifestMatchesAllowlist(
  allowlist: readonly string[],
  manifest: TfFeatureManifest = loadTfFeatureManifest(),
): void {
  const derived = new Set(manifest.deployedBillableMeters);
  const declared = new Set(allowlist);
  const missing = [...declared].filter((m) => !derived.has(m));
  const extra = [...derived].filter((m) => !declared.has(m));
  if (missing.length || extra.length) {
    throw new Error(
      `TF manifest vs audit allowlist drift — derived from ${manifest.inventoryRoot}: [${[...derived].sort().join(", ")}], declared: [${[...declared].sort().join(", ")}]` +
        (missing.length ? `; declared-but-not-in-TF: ${missing.join(", ")}` : "") +
        (extra.length ? `; in-TF-but-not-declared: ${extra.join(", ")}` : ""),
    );
  }
}
