#!/usr/bin/env node
/**
 * check-tf-honesty-drift.mjs — the web UI's copy of the honesty warning
 * constants must equal the engine's.
 *
 * `apps/web/src/widgets/EstimateHonestyBanner/tfHonestyConstants.ts` is a
 * hand-maintained mirror of
 * `packages/cost-engine/src/providers/azure/tf-audit-reconciliation.ts`. It
 * exists because `check-boundaries.mjs` forbids `apps/web` from importing
 * cost-engine internals (the UI consumes the generated OpenAPI types only),
 * so the duplication is architecturally forced rather than an oversight.
 *
 * What is *not* forced is leaving it unchecked. The UI filters and badges
 * warnings by matching these exact strings, so if the engine reworded a
 * prefix or added a meter to the audit-only allowlist and the mirror was not
 * updated, the UI would silently stop recognising the warning: the honesty
 * banner it exists to show would quietly disappear, with every test still
 * green. That is the failure this gate makes impossible.
 *
 * Both sides are imported as real modules (Node's `--experimental-strip-types`
 * handles the TypeScript) rather than parsed as text, so the comparison is on
 * the values the programs actually use — the same approach
 * `validate-prices.mjs` takes to stop re-implementing engine invariants
 * (@see docs/IMPROVEMENT_PLAN.md REQ-9).
 *
 * Usage: node --experimental-strip-types scripts/check-tf-honesty-drift.mjs
 * Exit code 1 on any drift; runs inside `pnpm test`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENGINE_PATH = path.join(
  ROOT,
  "packages/cost-engine/src/providers/azure/tf-audit-reconciliation.ts",
);
const WEB_MIRROR_PATH = path.join(
  ROOT,
  "apps/web/src/widgets/EstimateHonestyBanner/tfHonestyConstants.ts",
);

const engine = await import(ENGINE_PATH);
const mirror = await import(WEB_MIRROR_PATH);

/** Constants that must be identical on both sides, and how to compare them. */
const MIRRORED = [
  { name: "AZURE_MODELED_NO_TF_WARNING_PREFIX", kind: "string" },
  { name: "NO_TF_INVENTORY_WARNING", kind: "string" },
  { name: "AZURE_AUDIT_ONLY_METER_ALLOWLIST", kind: "string-array" },
];

const problems = [];

for (const { name, kind } of MIRRORED) {
  const engineValue = engine[name];
  const mirrorValue = mirror[name];

  if (engineValue === undefined) {
    problems.push(
      `${name}: missing from the engine (${path.relative(ROOT, ENGINE_PATH)}) — ` +
        `if it was renamed, rename it in the mirror too and update this gate`,
    );
    continue;
  }
  if (mirrorValue === undefined) {
    problems.push(
      `${name}: missing from the web mirror (${path.relative(ROOT, WEB_MIRROR_PATH)}) — ` +
        `the UI cannot match a warning it does not know about`,
    );
    continue;
  }

  if (kind === "string") {
    if (engineValue !== mirrorValue) {
      problems.push(
        `${name}: differs.\n    engine: ${JSON.stringify(engineValue)}\n    web:    ${JSON.stringify(mirrorValue)}`,
      );
    }
    continue;
  }

  // string-array: order is irrelevant to the UI's membership checks, but
  // membership is not. Compare as sorted sets so a reordering is not a
  // false alarm while an added/removed meter still fails.
  const a = [...engineValue].map(String).sort();
  const b = [...mirrorValue].map(String).sort();
  const onlyEngine = a.filter((x) => !b.includes(x));
  const onlyWeb = b.filter((x) => !a.includes(x));
  if (onlyEngine.length || onlyWeb.length) {
    problems.push(
      `${name}: membership differs.` +
        (onlyEngine.length ? `\n    only in engine: ${onlyEngine.join(", ")}` : "") +
        (onlyWeb.length ? `\n    only in web:    ${onlyWeb.join(", ")}` : ""),
    );
  }
}

if (problems.length) {
  console.error("TF HONESTY DRIFT:");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    `\n  Fix: bring ${path.relative(ROOT, WEB_MIRROR_PATH)} back in line with ` +
      `${path.relative(ROOT, ENGINE_PATH)} (the engine is the source of truth).`,
  );
  process.exit(1);
}

console.log("TF HONESTY DRIFT: OK");
