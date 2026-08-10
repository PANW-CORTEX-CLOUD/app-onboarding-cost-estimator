#!/usr/bin/env node
/**
 * Tests for plan-execute-handoff (next.json, gaps, validate, followup).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  extractCitedPaths,
  scanGapsFromPlan,
  normalizeGapsToTodos,
  appendTodosToPlan,
  writeNextArtifact,
  buildFollowupMessage,
  validatePrior,
} from "./plan-execute-handoff.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HANDOFF = path.join(ROOT, "scripts/plan-execute-handoff.mjs");
const PLAN = path.join(ROOT, ".cursor/plans/azure_cortex_cost_estimator_4075e709.plan.md");
const ACTIVE = path.join(ROOT, ".cursor/plan-execute.active");
const NEXT = path.join(ROOT, ".cursor/plan-execute.next.json");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else console.log(`OK: ${msg}`);
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [HANDOFF, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

// extract paths
{
  const paths = extractCitedPaths(
    'See `docs/CLOUD_COST_MODEL.md` and packages/cost-engine/src/index.ts plus docs/ARCHITECTURE.md',
  );
  assert(paths.includes("docs/CLOUD_COST_MODEL.md"), "extract backtick path");
  assert(paths.includes("docs/ARCHITECTURE.md"), "extract bare docs path");
  assert(paths.includes("packages/cost-engine/src/index.ts"), "extract packages path");
}

// write-next
{
  const r = run(["--write-next"]);
  assert(r.status === 0 || r.status === 2, `write-next exit 0/2 (got ${r.status}) ${r.stderr}`);
  assert(fs.existsSync(NEXT), "next.json exists");
  const j = JSON.parse(fs.readFileSync(NEXT, "utf8"));
  assert(
    j.outcome === "all-complete" || j.activePackage != null,
    `activePackage or all-complete (got activePackage=${j.activePackage} outcome=${j.outcome})`,
  );
  assert(typeof j.agentInstructions === "string" && j.nextSteps.length > 0, "instructions+nextSteps");
}

// validate-prior (should pass — package 01 tests green)
{
  const v = validatePrior(ROOT);
  assert(v.ok === true, `validatePrior ok (checks=${JSON.stringify(v.checks.map(c=>({n:c.name,ok:c.ok})))})`);
}

// followup inactive → {}
{
  const had = fs.existsSync(ACTIVE);
  if (had) fs.unlinkSync(ACTIVE);
  const r = run(["--followup", "--loop-count", "0"]);
  assert(r.status === 2, `inactive followup exit 2 (got ${r.status})`);
  assert(r.stdout.trim() === "{}", "inactive emits {}");
  if (had) fs.writeFileSync(ACTIVE, "");
}

// followup active → message when work remains; {} when all-complete
{
  fs.writeFileSync(ACTIVE, "test\n");
  const live = JSON.parse(fs.readFileSync(NEXT, "utf8"));
  // refresh measure via write-next outcome
  run(["--write-next"]);
  const next = JSON.parse(fs.readFileSync(NEXT, "utf8"));
  const r = run(["--followup", "--loop-count", "0", "--loop-limit", "40"]);
  if (next.outcome === "all-complete" || next.outcome === "mvp-complete") {
    // mvp-complete without through-all also yields no followup
    assert(r.status === 2, `complete/mvp followup exit 2 (got ${r.status})`);
    assert(r.stdout.trim() === "{}", "complete/mvp emits {}");
  } else {
    assert(r.status === 0, `active followup exit 0 (got ${r.status}) stderr=${r.stderr?.slice(0,400)}`);
    const j = JSON.parse(r.stdout);
    assert(typeof j.followup_message === "string", "followup_message present");
    assert(j.followup_message.includes("plan-execute"), "mentions plan-execute");
  }
  void live;
  fs.unlinkSync(ACTIVE);
}

// gaps normalize + append dry-run on temp plan copy
{
  const tmp = path.join(os.tmpdir(), `plan-gap-${Date.now()}.md`);
  fs.copyFileSync(PLAN, tmp);
  const gaps = [
    {
      createPackage: true,
      packageNn: 99,
      total: 99,
      slug: "unit-test-gap",
      title: "Unit test gap package",
      reason: "synthetic",
    },
  ];
  const todos = normalizeGapsToTodos(gaps, tmp);
  assert(todos.length === 4, `normalize creates 4 todos (got ${todos.length})`);
  const result = appendTodosToPlan(tmp, todos, { dryRun: true });
  assert(result.applied.length === 4, "dry-run applied 4");
  const real = appendTodosToPlan(tmp, todos, { dryRun: false });
  assert(real.applied.length === 4, "real append 4");
  const text = fs.readFileSync(tmp, "utf8");
  assert(text.includes("req-unit-test-gap"), "plan contains new id");
  // rollback not needed — tmp file
  fs.unlinkSync(tmp);
}

// corrupt gaps fail closed
{
  const gapsPath = path.join(ROOT, ".cursor/plan-execute.gaps.json");
  const backup = fs.existsSync(gapsPath) ? fs.readFileSync(gapsPath, "utf8") : null;
  fs.writeFileSync(gapsPath, "{not-json");
  const r = run(["--apply-gaps"]);
  assert(r.status === 1, "corrupt gaps exit 1");
  if (backup != null) fs.writeFileSync(gapsPath, backup);
  else fs.unlinkSync(gapsPath);
}

// buildFollowupMessage MVP stop without through-all
{
  const prev = process.env.PLAN_EXECUTE_THROUGH_ALL;
  delete process.env.PLAN_EXECUTE_THROUGH_ALL;
  const throughPath = path.join(ROOT, ".cursor/plan-execute.through-all");
  const hadThrough = fs.existsSync(throughPath);
  if (hadThrough) fs.unlinkSync(throughPath);
  const msg = buildFollowupMessage(
    {
      followThrough: true,
      ok: true,
      outcome: "mvp-complete",
      agentInstructions: "x",
      summary: "y",
    },
    0,
    40,
  );
  assert(msg === null, "no followup on mvp-complete without through-all");

  process.env.PLAN_EXECUTE_THROUGH_ALL = "1";
  const msg2 = buildFollowupMessage(
    {
      followThrough: true,
      ok: true,
      outcome: "mvp-complete",
      agentInstructions: "x",
      summary: "y",
    },
    0,
    40,
  );
  assert(
    typeof msg2 === "string" && msg2.includes("through-all"),
    "followup on mvp-complete with through-all env",
  );
  if (prev == null) delete process.env.PLAN_EXECUTE_THROUGH_ALL;
  else process.env.PLAN_EXECUTE_THROUGH_ALL = prev;
  if (hadThrough) fs.writeFileSync(throughPath, "");
}

// hooks executable
{
  for (const rel of [
    ".cursor/hooks/plan-execute-stop.sh",
    ".cursor/hooks/plan-execute-after-response.sh",
  ]) {
    const p = path.join(ROOT, rel);
    assert(fs.existsSync(p) && Boolean(fs.statSync(p).mode & 0o100), `executable ${rel}`);
  }
  const hj = JSON.parse(fs.readFileSync(path.join(ROOT, ".cursor/hooks.json"), "utf8"));
  assert(hj.hooks.afterAgentResponse?.length >= 1, "afterAgentResponse hooked");
  assert(hj.hooks.stop?.[0]?.loop_limit === 40, "loop_limit 40");
}

// rule exists
assert(
  fs.existsSync(path.join(ROOT, ".cursor/rules/plan-execute-auto.mdc")),
  "plan-execute-auto rule exists",
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nALL HANDOFF TESTS PASSED");
