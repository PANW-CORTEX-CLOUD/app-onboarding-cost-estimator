#!/usr/bin/env node
/**
 * test-measure-plan.mjs — automated AC/EDGE checks for measure-plan + hook scripts.
 * Run: node scripts/test-measure-plan.mjs
 * Exit 0 only when all assertions pass.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  parsePlanTodos,
  measureFromTodos,
  measurePlan,
  formatFollowup,
  formatSummary,
  toPublicJson,
  checkPlanCompatibility,
  checkPlanFile,
  formatCompatibilityReport,
  PLAN_FORMAT_HOWTO,
} from "./measure-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PLAN = path.join(ROOT, ".cursor/plans/azure_cortex_cost_estimator_4075e709.plan.md");
const MEASURE = path.join(ROOT, "scripts/measure-plan.mjs");
const HOOKS = {
  session: path.join(ROOT, ".cursor/hooks/plan-measure-session.sh"),
  stop: path.join(ROOT, ".cursor/hooks/plan-execute-stop.sh"),
  inject: path.join(ROOT, ".cursor/hooks/plan-measure-inject.sh"),
};

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`OK: ${msg}`);
  }
}

function runNode(args, env = {}) {
  return spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: ROOT,
  });
}

function runHook(script, stdin, env = {}) {
  return spawnSync("bash", [script], {
    encoding: "utf8",
    input: stdin,
    env: { ...process.env, CURSOR_PROJECT_DIR: ROOT, ...env },
    cwd: ROOT,
  });
}

// --- Unit: real plan (may be mid-flight or all-complete) ---
{
  const text = fs.readFileSync(PLAN, "utf8");
  const todos = parsePlanTodos(text, PLAN);
  assert(todos.length >= 76, `parsed todos >= 76 (got ${todos.length})`);
  const m = measureFromTodos(todos, 19, PLAN);
  assert(m.ok, "measure ok");
  assert(m.totalThroughMvp === 76, `76 todos through MVP (got ${m.totalThroughMvp})`);
  assert(
    ["continue", "mvp-complete", "all-complete"].includes(m.outcome),
    `outcome known (got ${m.outcome})`,
  );
  if (m.outcome === "all-complete") {
    assert(m.firstPendingNn == null, "all-complete: no pending nn");
    assert(m.pendingThroughMvp === 0, "all-complete: no MVP pending");
    assert(m.completedThroughMvp === 76, `all-complete: 76 done (got ${m.completedThroughMvp})`);
  } else if (m.outcome === "continue") {
    assert(m.firstPendingNn != null && m.resumeKind != null, "continue has resume");
    assert(m.pendingThroughMvp > 0, "continue: pendingThroughMvp > 0");
  } else {
    assert(m.firstPendingNn != null && m.firstPendingNn > 19, "mvp-complete: post-MVP pending");
  }
}

/** Minimal pending plan for continue-path CLI/hook tests (independent of live plan). */
function writePendingPlan() {
  const tmp = path.join(os.tmpdir(), `pending-plan-${Date.now()}.md`);
  const lines = ["---", "name: pending-fixture", "todos:"];
  for (const kind of ["REQ", "AC", "TEST", "EDGE"]) {
    const id = `${kind.toLowerCase()}-fix-a`;
    lines.push(`  - id: ${id}`);
    lines.push(`    content: "[02/23][${kind}] Fixture A"`);
    lines.push(`    status: pending`);
  }
  lines.push("---", "");
  fs.writeFileSync(tmp, lines.join("\n") + "\n");
  return tmp;
}

// --- CLI: json default (live plan) ---
{
  const r = runNode([MEASURE]);
  assert(r.status === 0 || r.status === 2, `CLI default exit 0/2 (got ${r.status}) stderr=${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert(j.ok === true, "CLI JSON ok");
  assert(["continue", "mvp-complete", "all-complete"].includes(j.outcome), "CLI outcome known");
}

// --- CLI: pending fixture selects package 02 ---
{
  const tmp = writePendingPlan();
  const r = runNode([MEASURE, "--plan", tmp, "--json"]);
  assert(r.status === 0, `CLI pending fixture exit 0 (got ${r.status})`);
  const j = JSON.parse(r.stdout);
  assert(j.firstPendingNn === 2 && j.resumeKind === "REQ", "CLI fixture selects 02/REQ");
  fs.unlinkSync(tmp);
}

// --- CLI: summary ---
{
  const r = runNode([MEASURE, "--summary"]);
  assert(r.status === 0 || r.status === 2, "CLI summary exit 0/2");
  assert(r.stdout.includes("PLAN-EXECUTE MEASURE"), "summary header");
}

// --- CLI: context ---
{
  const r = runNode([MEASURE, "--context"]);
  assert(r.status === 0 || r.status === 2, "CLI context exit 0/2");
  assert(r.stdout.includes("plan-execute measure"), "context marker");
}

// --- EDGE: missing plan ---
{
  const r = runNode([MEASURE, "--plan", "/tmp/does-not-exist-plan-xyz.md", "--json"]);
  assert(r.status === 1, `missing plan exit 1 (got ${r.status})`);
  const j = JSON.parse(r.stdout);
  assert(j.ok === false && j.outcome === "error", "missing plan fail closed");
}

// --- EDGE: corrupt / no tags ---
{
  const tmp = path.join(os.tmpdir(), `bad-plan-${Date.now()}.md`);
  fs.writeFileSync(tmp, "---\nname: x\ntodos: []\n---\n# hi\n");
  const r = runNode([MEASURE, "--plan", tmp, "--json"]);
  assert(r.status === 1, "corrupt plan exit 1");
  fs.unlinkSync(tmp);
}

// --- EDGE: mid-quadruple resume ---
{
  const todos = [
    { id: "req-a", content: "[01/2][REQ] A", status: "completed", nn: 1, total: 2, kind: "REQ", title: "A" },
    { id: "ac-a", content: "[01/2][AC] A", status: "pending", nn: 1, total: 2, kind: "AC", title: "A" },
    { id: "test-a", content: "[01/2][TEST] A", status: "pending", nn: 1, total: 2, kind: "TEST", title: "A" },
    { id: "edge-a", content: "[01/2][EDGE] A", status: "pending", nn: 1, total: 2, kind: "EDGE", title: "A" },
    { id: "req-b", content: "[02/2][REQ] B", status: "pending", nn: 2, total: 2, kind: "REQ", title: "B" },
    { id: "ac-b", content: "[02/2][AC] B", status: "pending", nn: 2, total: 2, kind: "AC", title: "B" },
    { id: "test-b", content: "[02/2][TEST] B", status: "pending", nn: 2, total: 2, kind: "TEST", title: "B" },
    { id: "edge-b", content: "[02/2][EDGE] B", status: "pending", nn: 2, total: 2, kind: "EDGE", title: "B" },
  ];
  const m = measureFromTodos(todos, 19, "synthetic");
  assert(m.resumeKind === "AC" && m.resumeTodo.id === "ac-a", "mid-quadruple resumes at AC");
}

// --- EDGE: mvp-complete does not auto-follow without through-all ---
{
  const todos = [];
  for (let nn = 1; nn <= 20; nn++) {
    for (const kind of ["REQ", "AC", "TEST", "EDGE"]) {
      todos.push({
        id: `${kind.toLowerCase()}-${nn}`,
        content: `[${String(nn).padStart(2, "0")}/20][${kind}] X`,
        status: nn <= 19 ? "completed" : "pending",
        nn,
        total: 20,
        kind: /** @type {*} */ (kind),
        title: "X",
      });
    }
  }
  const m = measureFromTodos(todos, 19, "synthetic");
  assert(m.outcome === "mvp-complete", `mvp-complete (got ${m.outcome})`);
  assert(m.firstPendingNn === 20, "post-MVP package 20 visible but not auto");
  const fu = formatFollowup(m, {
    loopCount: 0,
    loopLimit: 25,
    active: true,
    throughAll: false,
    status: "completed",
  });
  assert(fu === null, "no followup when mvp-complete without through-all");

  const fuAll = formatFollowup(m, {
    loopCount: 0,
    loopLimit: 25,
    active: true,
    throughAll: true,
    status: "completed",
  });
  assert(
    typeof fuAll === "string" && fuAll.includes("Package 20") && fuAll.includes("through-all"),
    "followup when mvp-complete WITH through-all",
  );
}

// --- Followup only when active (synthetic continue measure) ---
{
  const todos = [];
  for (const kind of ["REQ", "AC", "TEST", "EDGE"]) {
    todos.push({
      id: `${kind.toLowerCase()}-a`,
      content: `[02/2][${kind}] A`,
      status: "pending",
      nn: 2,
      total: 2,
      kind: /** @type {*} */ (kind),
      title: "A",
    });
  }
  const m = measureFromTodos(todos, 19, "synthetic-continue");
  assert(formatFollowup(m, { loopCount: 0, loopLimit: 25, active: false, status: "completed" }) === null, "no followup when inactive");
  const msg = formatFollowup(m, { loopCount: 0, loopLimit: 25, active: true, status: "completed" });
  assert(typeof msg === "string" && msg.includes("plan-execute auto-continue"), "followup when active");
  assert(
    formatFollowup(m, { loopCount: 0, loopLimit: 25, active: true, status: "aborted" }) === null,
    "no followup on aborted",
  );
  assert(
    formatFollowup(m, { loopCount: 25, loopLimit: 25, active: true, status: "completed" }) === null,
    "no followup at loop_limit",
  );
}

// --- CLI followup ---
{
  const live = measurePlan(PLAN, 19);
  const off = runNode([MEASURE, "--followup"], { PLAN_EXECUTE_ACTIVE: "0" });
  assert(off.status === 2, `followup inactive exit 2 (got ${off.status})`);
  assert(off.stdout.trim() === "{}", "followup inactive emits {}");

  const tmp = writePendingPlan();
  const on = runNode([MEASURE, "--plan", tmp, "--followup", "--loop-count", "0"], {
    PLAN_EXECUTE_ACTIVE: "1",
  });
  assert(on.status === 0, "followup active exit 0 on pending fixture");
  const j = JSON.parse(on.stdout);
  assert(typeof j.followup_message === "string" && j.followup_message.includes("Package 02"), "followup Package 02");
  fs.unlinkSync(tmp);

  if (live.outcome === "all-complete") {
    const done = runNode([MEASURE, "--followup", "--loop-count", "0"], { PLAN_EXECUTE_ACTIVE: "1" });
    assert(done.status === 2, "live all-complete followup exit 2");
    assert(done.stdout.trim() === "{}", "live all-complete emits {}");
  }
}

// --- Hooks.json present ---
{
  const hj = JSON.parse(fs.readFileSync(path.join(ROOT, ".cursor/hooks.json"), "utf8"));
  assert(hj.version === 1, "hooks.json version 1");
  assert(hj.hooks.sessionStart?.length >= 1, "sessionStart configured");
  assert(hj.hooks.postToolUse?.length >= 1, "postToolUse configured");
  assert(hj.hooks.stop?.[0]?.loop_limit === 40, "stop loop_limit 40");
  assert(hj.hooks.afterAgentResponse?.length >= 1, "afterAgentResponse configured");
}

// --- Hook scripts executable + sessionStart JSON ---
{
  for (const [name, p] of Object.entries(HOOKS)) {
    assert(fs.existsSync(p), `hook exists ${name}`);
    const mode = fs.statSync(p).mode;
    assert(Boolean(mode & 0o100), `hook executable ${name}`);
  }
  const r = runHook(HOOKS.session, JSON.stringify({ session_id: "test", is_background_agent: false, composer_mode: "agent" }));
  assert(r.status === 0, `sessionStart exit 0 (got ${r.status}) stderr=${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert(typeof j.additional_context === "string" && j.additional_context.includes("PLAN-EXECUTE MEASURE"), "sessionStart additional_context");
  assert(j.env?.PLAN_EXECUTE_MVP === "19", "sessionStart env MVP");
  assert(fs.existsSync(path.join(ROOT, ".cursor/plan-execute.status.json")), "status file written");
}

// --- stop hook inactive → {} ---
{
  const activePath = path.join(ROOT, ".cursor/plan-execute.active");
  const had = fs.existsSync(activePath);
  if (had) fs.unlinkSync(activePath);
  const r = runHook(HOOKS.stop, JSON.stringify({ status: "completed", loop_count: 0 }), { PLAN_EXECUTE_ACTIVE: "0" });
  assert(r.status === 0, "stop inactive exit 0");
  assert(r.stdout.trim() === "{}", `stop inactive {} (got ${r.stdout})`);
  if (had) fs.writeFileSync(activePath, "");
}

// --- stop hook active → followup when work remains; {} when all-complete ---
{
  const activePath = path.join(ROOT, ".cursor/plan-execute.active");
  const throughPath = path.join(ROOT, ".cursor/plan-execute.through-all");
  const hadThrough = fs.existsSync(throughPath);
  fs.writeFileSync(activePath, "test\n");
  const live = measurePlan(PLAN, 19);
  const r = runHook(HOOKS.stop, JSON.stringify({ status: "completed", loop_count: 0 }));
  assert(r.status === 0, "stop active exit 0");
  if (live.outcome === "all-complete") {
    assert(r.stdout.trim() === "{}", "stop active all-complete emits {}");
  } else if (live.outcome === "mvp-complete" && !hadThrough) {
    assert(r.stdout.trim() === "{}", "stop mvp-complete without through-all emits {}");
  } else {
    const j = JSON.parse(r.stdout);
    assert(typeof j.followup_message === "string", "stop followup message present");
  }
  fs.unlinkSync(activePath);
}

// --- stop aborted → {} ---
{
  fs.writeFileSync(path.join(ROOT, ".cursor/plan-execute.active"), "t\n");
  const r = runHook(HOOKS.stop, JSON.stringify({ status: "aborted", loop_count: 0 }));
  assert(r.status === 0 && r.stdout.trim() === "{}", "stop aborted emits {}");
  fs.unlinkSync(path.join(ROOT, ".cursor/plan-execute.active"));
}

// --- inject hook relevant vs irrelevant ---
{
  const miss = runHook(HOOKS.inject, JSON.stringify({ tool_name: "Shell", tool_input: { command: "ls" } }));
  assert(miss.status === 0 && miss.stdout.trim() === "{}", "inject irrelevant {}");
  const hit = runHook(
    HOOKS.inject,
    JSON.stringify({
      tool_name: "Read",
      tool_input: { path: PLAN },
    }),
  );
  assert(hit.status === 0, "inject relevant exit 0");
  const j = JSON.parse(hit.stdout);
  assert(
    typeof j.additional_context === "string" && j.additional_context.includes("PLAN-EXECUTE MEASURE"),
    "inject context",
  );
}

// --- formatSummary smoke ---
{
  const live = measurePlan(PLAN, 19);
  const s = formatSummary(live);
  assert(s.includes("PLAN-EXECUTE MEASURE"), "summary header present");
  if (live.outcome === "all-complete") {
    assert(s.includes("activePackage: —") || s.includes("All plan todos completed"), "summary all-complete");
    assert(toPublicJson(live).packageSteps.length === 0, "no package steps when complete");
  } else {
    assert(s.includes(`activePackage: ${String(live.firstPendingNn).padStart(2, "0")}`), "summary activePackage");
    assert(toPublicJson(live).packageSteps.length === 4, "4 package steps");
  }
}

// --- Compat: real plan OK ---
{
  const report = checkPlanFile(PLAN);
  assert(report.compatible === true, "real plan compatible");
  assert(report.packageCount === 23, `23 packages (got ${report.packageCount})`);
  assert(report.taggedTodoCount === 92, `92 tagged (got ${report.taggedTodoCount})`);
  const cli = runNode([MEASURE, "--check"]);
  assert(cli.status === 0, `--check exit 0 (got ${cli.status})`);
  assert(cli.stdout.includes("COMPAT CHECK: OK"), "check OK banner");
}

// --- Compat: missing tags → howto ---
{
  const tmp = path.join(os.tmpdir(), `bad-compat-${Date.now()}.md`);
  fs.writeFileSync(
    tmp,
    `---
name: bad
todos:
  - id: do-thing
    content: "Implement the feature"
    status: pending
---
# body
`,
  );
  const report = checkPlanCompatibility(fs.readFileSync(tmp, "utf8"), tmp);
  assert(report.compatible === false, "untagged content incompatible");
  assert(report.errors.some((e) => e.includes("[NN/M]")), "error mentions tag format");
  assert(report.howToFix.includes("[01/03][REQ]"), "howto includes example tag");
  const cli = runNode([MEASURE, "--check", "--plan", tmp]);
  assert(cli.status === 1, "incompatible --check exit 1");
  assert(cli.stdout.includes("INCOMPATIBLE"), "INCOMPATIBLE banner");
  assert(cli.stdout.includes("HOW TO MAKE THE PLAN COMPATIBLE"), "howto in stdout");
  const measured = measurePlan(tmp, 19);
  assert(measured.ok === false, "measurePlan fail closed on incompatible");
  assert(measured.nextSteps.some((s) => s.includes("HOW TO MAKE THE PLAN COMPATIBLE")), "measure includes howto");
  const ctx = runNode([MEASURE, "--context", "--plan", tmp]);
  assert(ctx.status === 1, "context exit 1 on incompatible");
  assert(ctx.stdout.includes("HOW TO MAKE THE PLAN COMPATIBLE"), "context stdout has howto for hooks");
  fs.unlinkSync(tmp);
}

// --- Compat: incomplete quadruple ---
{
  const tmp = path.join(os.tmpdir(), `partial-quad-${Date.now()}.md`);
  fs.writeFileSync(
    tmp,
    `---
name: partial
todos:
  - id: req-a
    content: "[01/01][REQ] Only req"
    status: pending
  - id: ac-a
    content: "[01/01][AC] Only ac"
    status: pending
---
`,
  );
  const report = checkPlanFile(tmp);
  assert(report.compatible === false, "partial quadruple incompatible");
  assert(report.errors.some((e) => e.includes("[TEST]")), "reports missing TEST");
  assert(report.errors.some((e) => e.includes("[EDGE]")), "reports missing EDGE");
  assert(formatCompatibilityReport(report).includes(PLAN_FORMAT_HOWTO.split("\n")[0]), "report embeds howto header");
  fs.unlinkSync(tmp);
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nALL TESTS PASSED");
process.exit(0);
