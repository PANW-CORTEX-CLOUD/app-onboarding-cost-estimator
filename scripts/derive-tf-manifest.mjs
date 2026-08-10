#!/usr/bin/env node
/**
 * derive-tf-manifest.mjs — read the connector Terraform and write down what it
 * actually deploys.
 *
 * The onboarding template is assembled from modules, and `template_version` in
 * template_params.tfvars is the list of modules a given customer got — the
 * checkboxes. A module that is not listed there, or whose .tf file is empty,
 * is not deployed, and nothing it would have created may be billed.
 *
 * Output: sources/tf-feature-manifest.json. A test re-derives it and fails on
 * drift, so toggling a module in the TF forces the estimate to follow.
 *
 *   node scripts/derive-tf-manifest.mjs           print + diff against the checked-in file
 *   node scripts/derive-tf-manifest.mjs --write   regenerate it
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TF_DIR = path.join(ROOT, "azure/data");
const TFVARS = path.join(TF_DIR, "template_params.tfvars");
const OUT = path.join(ROOT, "sources/tf-feature-manifest.json");
const WRITE = process.argv.includes("--write");

/**
 * Terraform resource type → the meters it makes the customer pay for.
 * Anything absent from this table deploys no billable meter: identities, role
 * assignments, auth rules, consumer groups, resource groups and diagnostic
 * settings are configuration, not consumption.
 */
const RESOURCE_BILLABLE_METERS = {
  azurerm_eventhub_namespace: ["eh-standard-tu", "eh-standard-ingress-events"],
  azurerm_storage_account: ["blob-hot-lrs-capacity"],
};

/** Which capability each template module implements. */
const MODULE_CAPABILITY = {
  "DISCOVERY-assets_discovery": "discovery",
  "AUDIT_LOGS-audit_organization": "audit_logs",
  "AUDIT_LOGS-audit_common_resources": "audit_logs",
  "BASE-base_organization": "base",
};

/** Capabilities the estimator can price, for the coverage report. */
const PRICEABLE_CAPABILITIES = [
  "discovery",
  "audit_logs",
  "ads_cloud",
  "ads_outpost",
  "dspm",
  "registry",
  "serverless",
  "egress",
];

/** `resource "type" "name"` declarations, comments stripped. */
function parseResources(hcl) {
  const withoutComments = hcl
    .replace(/^\s*#.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const out = [];
  const re = /resource\s+"([^"]+)"\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(withoutComments)) !== null) {
    out.push({ type: m[1], name: m[2] });
  }
  return out;
}

/** Keys of the `template_version = { ... }` map — the deployed module list. */
function parseTemplateVersionKeys(tfvars) {
  const block = /template_version\s*=\s*\{([\s\S]*?)\}/.exec(tfvars);
  if (!block) return [];
  const keys = [];
  const re = /"([^"]+)"\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(block[1])) !== null) keys.push({ module: m[1], version: m[2] });
  return keys;
}

function derive() {
  if (!fs.existsSync(TF_DIR)) {
    throw new Error(`TF inventory missing: ${TF_DIR}`);
  }
  const tfvars = fs.readFileSync(TFVARS, "utf8");
  const declared = parseTemplateVersionKeys(tfvars);
  const declaredIds = new Set(declared.map((d) => d.module));

  const tfFiles = fs
    .readdirSync(TF_DIR)
    .filter((f) => f.endsWith(".tf"))
    .sort();

  const modules = [];
  for (const file of tfFiles) {
    const full = path.join(TF_DIR, file);
    const raw = fs.readFileSync(full, "utf8");
    const id = file.replace(/\.tf$/, "");
    // main.tf carries the base module rather than a template_version key of its own.
    const moduleId = id === "main" ? "BASE-base_organization" : id;
    const resources = parseResources(raw);
    const meters = [
      ...new Set(
        resources.flatMap((r) => RESOURCE_BILLABLE_METERS[r.type] ?? []),
      ),
    ].sort();

    const emptyFile = raw.trim().length === 0;
    const selected = declaredIds.has(moduleId);

    modules.push({
      moduleId,
      file: `azure/data/${file}`,
      capability: MODULE_CAPABILITY[moduleId] ?? "unmapped",
      // Selected in template_version AND actually containing resources.
      deployed: selected && !emptyFile && resources.length > 0,
      selectedInTemplateVersion: selected,
      emptyFile,
      templateVersion: declared.find((d) => d.module === moduleId)?.version ?? null,
      resourceCount: resources.length,
      resourceTypes: [...new Set(resources.map((r) => r.type))].sort(),
      billableMeters: meters,
    });
  }

  // Modules the template selected but that ship no .tf in this repo.
  for (const d of declared) {
    if (!modules.some((m) => m.moduleId === d.module)) {
      modules.push({
        moduleId: d.module,
        file: null,
        capability: MODULE_CAPABILITY[d.module] ?? "unmapped",
        deployed: false,
        selectedInTemplateVersion: true,
        emptyFile: false,
        templateVersion: d.version,
        resourceCount: 0,
        resourceTypes: [],
        billableMeters: [],
      });
    }
  }
  modules.sort((a, b) => a.moduleId.localeCompare(b.moduleId));

  const deployedMeters = [
    ...new Set(modules.filter((m) => m.deployed).flatMap((m) => m.billableMeters)),
  ].sort();

  const capabilities = {};
  for (const cap of PRICEABLE_CAPABILITIES) {
    const owning = modules.filter((m) => m.capability === cap);
    if (owning.length === 0) {
      capabilities[cap] = {
        availability: "no-connector-tf",
        billableMeters: [],
        reason: "No module in the connector Terraform implements this capability.",
      };
      continue;
    }
    const live = owning.filter((m) => m.deployed);
    if (live.length === 0) {
      capabilities[cap] = {
        availability: "not-deployed",
        billableMeters: [],
        reason: owning.every((m) => m.emptyFile)
          ? `Module file is empty (${owning.map((m) => m.file).join(", ")}) — deploys nothing.`
          : `Module not selected in template_version (${owning.map((m) => m.moduleId).join(", ")}).`,
      };
      continue;
    }
    const meters = [...new Set(live.flatMap((m) => m.billableMeters))].sort();
    capabilities[cap] = {
      availability: meters.length ? "deployed" : "deployed-no-meter",
      billableMeters: meters,
      reason: meters.length
        ? `Deployed by ${live.map((m) => m.moduleId).join(", ")}.`
        : `Deployed by ${live.map((m) => m.moduleId).join(", ")} but creates no billable resource.`,
    };
  }

  return {
    schemaVersion: 1,
    provider: "azure",
    inventoryRoot: "azure/data",
    description:
      "Derived from the connector Terraform by scripts/derive-tf-manifest.mjs. `deployed` means the module is listed in template_version AND its .tf declares resources. Only capabilities marked deployed can be priced as as-deployed cost.",
    modules,
    deployedBillableMeters: deployedMeters,
    capabilities,
  };
}

function main() {
  const derived = derive();
  const json = `${JSON.stringify(derived, null, 2)}\n`;

  if (WRITE) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, json);
    console.log(`wrote ${path.relative(ROOT, OUT)}`);
  } else if (!fs.existsSync(OUT)) {
    console.error(`missing ${path.relative(ROOT, OUT)} — run with --write`);
    process.exit(1);
  } else if (fs.readFileSync(OUT, "utf8") !== json) {
    console.error(
      `TF MANIFEST DRIFT: ${path.relative(ROOT, OUT)} no longer matches azure/data — run \`node scripts/derive-tf-manifest.mjs --write\``,
    );
    process.exit(1);
  } else {
    console.log("TF MANIFEST: OK (matches azure/data)");
  }

  for (const [cap, info] of Object.entries(derived.capabilities)) {
    console.log(
      `  ${cap.padEnd(12)} ${info.availability.padEnd(18)} ${info.billableMeters.join(", ") || "-"}`,
    );
  }
}

main();
