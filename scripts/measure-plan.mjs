#!/usr/bin/env node
/**
 * measure-plan.mjs — SSOT progress meter for Cursor plan packages ([NN/M][REQ|AC|TEST|EDGE]).
 *
 * Purpose: parse a plan file's YAML todos, report the first pending package/step,
 * MVP remaining, and emit hook-ready follow-up / context text. Fail closed on
 * missing/unreadable plans (non-zero exit) — never invent packages.
 *
 * Usage:
 *   node scripts/measure-plan.mjs [--plan PATH] [--mvp N] [--json]
 *   node scripts/measure-plan.mjs --check          # format compatibility vs plan-execute skill
 *   node scripts/measure-plan.mjs --summary
 *   node scripts/measure-plan.mjs --followup [--loop-count N] [--loop-limit N]
 *   node scripts/measure-plan.mjs --context
 *   node scripts/measure-plan.mjs --write-status [PATH]
 *
 * Exit codes:
 *   0  work remains / --check compatible
 *   2  done through MVP (or no follow-up should fire)
 *   1  hard failure (missing plan, incompatible format, corrupt, bad args)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_PLAN = path.join(
  DEFAULT_ROOT,
  ".cursor/plans/azure_cortex_cost_estimator_4075e709.plan.md",
);
const DEFAULT_MVP = 19;
export { DEFAULT_MVP };
const STEP_ORDER = { REQ: 0, AC: 1, TEST: 2, EDGE: 3 };

/**
 * @typedef {{ id: string, content: string, status: string, nn: number, total: number, kind: 'REQ'|'AC'|'TEST'|'EDGE', title: string }} PlanTodo
 * @typedef {{
 *   ok: boolean,
 *   planPath: string,
 *   mvpStop: number,
 *   todos: PlanTodo[],
 *   byPackage: Record<string, PlanTodo[]>,
 *   firstPendingNn: number|null,
 *   resumeKind: 'REQ'|'AC'|'TEST'|'EDGE'|null,
 *   resumeTodo: PlanTodo|null,
 *   pendingThroughMvp: number,
 *   completedThroughMvp: number,
 *   totalThroughMvp: number,
 *   outcome: 'continue'|'mvp-complete'|'all-complete'|'error',
 *   error?: string,
 *   nextSteps: string[],
 *   compatibility?: CompatibilityReport,
 * }} MeasureResult
 * @typedef {{
 *   compatible: boolean,
 *   planPath: string,
 *   errors: string[],
 *   warnings: string[],
 *   howToFix: string,
 *   taggedTodoCount: number,
 *   packageCount: number,
 * }} CompatibilityReport
 */

/** Canonical shape required by the plan-execute skill (fail closed if missing). */
export const PLAN_FORMAT_HOWTO = `HOW TO MAKE THE PLAN COMPATIBLE WITH plan-execute
=================================================
1. Use a Cursor plan markdown file with YAML frontmatter containing \`todos:\`.
2. Every work item MUST be a YAML list entry with ALL three fields, in this order:
     - id: unique-kebab-id
       content: "[NN/M][KIND] Short title — acceptance detail…"
       status: pending|in_progress|completed|cancelled
3. \`content\` MUST be a DOUBLE-QUOTED string starting with the tag:
     [NN/M][REQ|AC|TEST|EDGE]
   where NN = package number (1-based), M = total packages, KIND = delivery step.
4. Each package NN MUST have exactly four todos, one of each KIND, in order:
     REQ → AC → TEST → EDGE
5. Do NOT use untagged todos, markdown checkboxes alone, or single-field entries —
   measure-plan / hooks will ignore or reject them.
6. Keep \`status\` as one of: pending, in_progress, completed, cancelled.
7. Prefer stable ids: req-<slug>, ac-<slug>, test-<slug>, edge-<slug>.

Minimal valid package example (package 01 of 03):

---
name: example-plan
overview: "…"
todos:
  - id: req-example
    content: "[01/03][REQ] Example — deliverable description"
    status: pending
  - id: ac-example
    content: "[01/03][AC] Example — verifiable acceptance criteria"
    status: pending
  - id: test-example
    content: "[01/03][TEST] Example — test command or checklist"
    status: pending
  - id: edge-example
    content: "[01/03][EDGE] Example — edge cases + hunt/tests"
    status: pending
---

# Plan body (optional narrative)

Run: node scripts/measure-plan.mjs --check --plan <path>
`;

function usage() {
  return `Usage: node scripts/measure-plan.mjs [--plan PATH] [--mvp N] [--json|--summary|--followup|--context|--check|--write-status [PATH]]
  --check          validate plan format vs plan-execute skill (exit 0/1)
  --loop-count N   stop-hook loop_count (default 0)
  --loop-limit N   max auto follow-ups (default 25)
Exit: 0=work remains or check OK, 2=mvp/done (no follow-up), 1=error/incompatible`;
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean|number>} */
  const out = {
    plan: process.env.PLAN_EXECUTE_PLAN || DEFAULT_PLAN,
    mvp: Number(process.env.PLAN_EXECUTE_MVP || DEFAULT_MVP),
    json: false,
    summary: false,
    followup: false,
    context: false,
    check: false,
    writeStatus: false,
    statusPath: "",
    loopCount: 0,
    loopLimit: 25,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plan") out.plan = argv[++i];
    else if (a === "--mvp") out.mvp = Number(argv[++i]);
    else if (a === "--json") out.json = true;
    else if (a === "--summary") out.summary = true;
    else if (a === "--followup") out.followup = true;
    else if (a === "--context") out.context = true;
    else if (a === "--check") out.check = true;
    else if (a === "--write-status") {
      out.writeStatus = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        out.statusPath = next;
        i++;
      }
    } else if (a === "--loop-count") out.loopCount = Number(argv[++i]);
    else if (a === "--loop-limit") out.loopLimit = Number(argv[++i]);
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Unknown arg: ${a}\n${usage()}`);
  }
  if (!Number.isFinite(out.mvp) || out.mvp < 1) throw new Error("--mvp must be a positive number");
  if (!Number.isFinite(out.loopCount) || out.loopCount < 0) throw new Error("--loop-count must be >= 0");
  if (!Number.isFinite(out.loopLimit) || out.loopLimit < 0) throw new Error("--loop-limit must be >= 0");
  return out;
}

/**
 * Parse plan todos from Cursor plan markdown (YAML frontmatter).
 * Fail closed if zero [NN/M][KIND] todos found.
 * @param {string} text
 * @param {string} planPath
 * @returns {PlanTodo[]}
 */
export function parsePlanTodos(text, planPath = "<plan>") {
  /** @type {PlanTodo[]} */
  const todos = [];
  // Match each todo block: id, content with [NN/M][KIND], status
  const blockRe =
    /-\s*id:\s*([^\n]+)\n\s*content:\s*"((?:\\.|[^"\\])*)"\s*\n\s*status:\s*(\w+)/g;
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    const id = m[1].trim();
    const content = m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n");
    const status = m[3].trim();
    const tag = content.match(/^\[(\d+)\/(\d+)\]\[(REQ|AC|TEST|EDGE)\]\s*(.*)$/);
    if (!tag) continue;
    const nn = Number(tag[1]);
    const total = Number(tag[2]);
    /** @type {'REQ'|'AC'|'TEST'|'EDGE'} */
    const kind = /** @type {*} */ (tag[3]);
    const title = tag[4].trim();
    todos.push({ id, content, status, nn, total, kind, title });
  }
  if (todos.length === 0) {
    throw new Error(`No [NN/M][REQ|AC|TEST|EDGE] todos parsed from ${planPath}`);
  }
  return todos;
}

const ALLOWED_STATUS = new Set(["pending", "in_progress", "completed", "cancelled"]);
const REQUIRED_KINDS = ["REQ", "AC", "TEST", "EDGE"];

/**
 * Validate plan file shape against plan-execute skill contract.
 * Fail closed: incompatible → compatible=false with actionable howToFix.
 * @param {string} text
 * @param {string} planPath
 * @returns {CompatibilityReport}
 */
export function checkPlanCompatibility(text, planPath = "<plan>") {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  if (!text || !String(text).trim()) {
    errors.push("Plan file is empty");
    return {
      compatible: false,
      planPath,
      errors,
      warnings,
      howToFix: PLAN_FORMAT_HOWTO,
      taggedTodoCount: 0,
      packageCount: 0,
    };
  }

  if (!/^---\s*\n/.test(text)) {
    errors.push("Missing YAML frontmatter opener (`---` at file start)");
  }
  const fmClose = text.indexOf("\n---", 3);
  if (fmClose < 0) {
    errors.push("Missing YAML frontmatter closer (`---` after todos)");
  }
  const front = fmClose > 0 ? text.slice(0, fmClose + 1) : text;
  if (!/\btodos\s*:/.test(front)) {
    errors.push("Frontmatter has no `todos:` key — plan-execute reads only YAML todos");
  }

  // Detect id: blocks that are not the strict shape (wrong field order / unquoted content)
  const looseIdBlocks = [...text.matchAll(/^\s*-\s*id:\s*.+$/gm)].length;
  const blockRe =
    /-\s*id:\s*([^\n]+)\n\s*content:\s*"((?:\\.|[^"\\])*)"\s*\n\s*status:\s*(\w+)/g;
  /** @type {{ id: string, content: string, status: string, tagged: boolean, nn?: number, total?: number, kind?: string }[]} */
  const blocks = [];
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    const id = m[1].trim();
    const content = m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n");
    const status = m[3].trim();
    const tag = content.match(/^\[(\d+)\/(\d+)\]\[(REQ|AC|TEST|EDGE)\]\s*(.*)$/);
    if (tag) {
      blocks.push({
        id,
        content,
        status,
        tagged: true,
        nn: Number(tag[1]),
        total: Number(tag[2]),
        kind: tag[3],
      });
    } else {
      blocks.push({ id, content, status, tagged: false });
      errors.push(
        `Todo id=${id} content missing required tag [NN/M][REQ|AC|TEST|EDGE] (got: ${content.slice(0, 80)})`,
      );
    }
  }

  if (looseIdBlocks > blocks.length) {
    errors.push(
      `Found ${looseIdBlocks} \`- id:\` entries but only ${blocks.length} match required shape (id + double-quoted content + status). Fix field order and quote content.`,
    );
  }

  const tagged = blocks.filter((b) => b.tagged);
  if (tagged.length === 0) {
    errors.push(
      "No tagged todos found. Every package step needs content like \"[01/23][REQ] …\"",
    );
  }

  // Status + duplicate ids
  const seenIds = new Set();
  for (const b of blocks) {
    if (!ALLOWED_STATUS.has(b.status)) {
      errors.push(
        `Todo id=${b.id} has invalid status "${b.status}" (allowed: pending|in_progress|completed|cancelled)`,
      );
    }
    if (seenIds.has(b.id)) errors.push(`Duplicate todo id: ${b.id}`);
    seenIds.add(b.id);
  }

  // Package quadruple integrity
  /** @type {Record<string, typeof tagged>} */
  const byNn = {};
  const totals = new Set();
  for (const t of tagged) {
    const key = String(t.nn);
    (byNn[key] ??= []).push(t);
    totals.add(t.total);
  }
  if (totals.size > 1) {
    warnings.push(
      `Inconsistent M in [NN/M] tags: saw ${[...totals].join(", ")} — prefer one total package count`,
    );
  }
  for (const [nn, list] of Object.entries(byNn)) {
    const kinds = list.map((t) => t.kind);
    for (const need of REQUIRED_KINDS) {
      const count = kinds.filter((k) => k === need).length;
      if (count === 0) {
        errors.push(`Package ${nn.padStart(2, "0")}: missing [${need}] todo`);
      } else if (count > 1) {
        errors.push(`Package ${nn.padStart(2, "0")}: duplicate [${need}] todos (${count})`);
      }
    }
    if (list.length !== 4) {
      errors.push(
        `Package ${nn.padStart(2, "0")}: expected exactly 4 todos (REQ/AC/TEST/EDGE), found ${list.length}`,
      );
    }
    // Order warning (not hard error if all four exist)
    const ordered = [...list].sort(
      (a, b) => STEP_ORDER[/** @type {*} */ (a.kind)] - STEP_ORDER[/** @type {*} */ (b.kind)],
    );
    const fileOrder = list.map((t) => t.kind).join(",");
    const ideal = REQUIRED_KINDS.join(",");
    if (fileOrder !== ideal && ordered.length === 4) {
      warnings.push(
        `Package ${nn.padStart(2, "0")}: todo KIND order in file is ${fileOrder} (prefer ${ideal})`,
      );
    }
  }

  const packageCount = Object.keys(byNn).length;
  if (packageCount === 0 && errors.length === 0) {
    errors.push("No packages detected");
  }

  return {
    compatible: errors.length === 0,
    planPath,
    errors,
    warnings,
    howToFix: PLAN_FORMAT_HOWTO,
    taggedTodoCount: tagged.length,
    packageCount,
  };
}

/**
 * Format compatibility report for humans / hooks (always includes howToFix on failure).
 * @param {CompatibilityReport} report
 */
export function formatCompatibilityReport(report) {
  const lines = [
    report.compatible
      ? "PLAN-EXECUTE COMPAT CHECK: OK"
      : "PLAN-EXECUTE COMPAT CHECK: INCOMPATIBLE",
    `plan: ${report.planPath}`,
    `taggedTodos: ${report.taggedTodoCount}  packages: ${report.packageCount}`,
  ];
  if (report.errors.length) {
    lines.push("errors:");
    for (const e of report.errors) lines.push(`  - ${e}`);
  }
  if (report.warnings.length) {
    lines.push("warnings:");
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  if (!report.compatible) {
    lines.push("");
    lines.push(report.howToFix);
  }
  return lines.join("\n");
}

/**
 * @param {PlanTodo[]} todos
 * @param {number} mvpStop
 * @param {string} planPath
 * @returns {MeasureResult}
 */
export function measureFromTodos(todos, mvpStop, planPath) {
  /** @type {Record<string, PlanTodo[]>} */
  const byPackage = {};
  for (const t of todos) {
    const key = String(t.nn);
    (byPackage[key] ??= []).push(t);
  }
  for (const key of Object.keys(byPackage)) {
    byPackage[key].sort((a, b) => STEP_ORDER[a.kind] - STEP_ORDER[b.kind]);
  }

  const open = todos.filter((t) => t.status === "pending" || t.status === "in_progress");
  const openThroughMvp = open.filter((t) => t.nn <= mvpStop);
  const totalThroughMvp = todos.filter((t) => t.nn <= mvpStop).length;
  const completedThroughMvp = todos.filter(
    (t) => t.nn <= mvpStop && t.status === "completed",
  ).length;

  let firstPendingNn = null;
  let resumeKind = null;
  let resumeTodo = null;
  if (openThroughMvp.length > 0) {
    firstPendingNn = Math.min(...openThroughMvp.map((t) => t.nn));
    const pkg = byPackage[String(firstPendingNn)] || [];
    const openInPkg = pkg.filter((t) => t.status === "pending" || t.status === "in_progress");
    openInPkg.sort((a, b) => STEP_ORDER[a.kind] - STEP_ORDER[b.kind]);
    resumeTodo = openInPkg[0] || null;
    resumeKind = resumeTodo ? resumeTodo.kind : null;
  } else if (open.length > 0) {
    // Only post-MVP work remains
    firstPendingNn = Math.min(...open.map((t) => t.nn));
    const pkg = byPackage[String(firstPendingNn)] || [];
    const openInPkg = pkg.filter((t) => t.status === "pending" || t.status === "in_progress");
    openInPkg.sort((a, b) => STEP_ORDER[a.kind] - STEP_ORDER[b.kind]);
    resumeTodo = openInPkg[0] || null;
    resumeKind = resumeTodo ? resumeTodo.kind : null;
  }

  /** @type {MeasureResult['outcome']} */
  let outcome = "continue";
  if (open.length === 0) outcome = "all-complete";
  else if (openThroughMvp.length === 0) outcome = "mvp-complete";

  /** @type {string[]} */
  const nextSteps = [];
  if (outcome === "continue" && resumeTodo && firstPendingNn != null) {
    const pkgTodos = byPackage[String(firstPendingNn)] || [];
    nextSteps.push(
      `Active package ${String(firstPendingNn).padStart(2, "0")}/${pkgTodos[0]?.total ?? "?"}`,
    );
    nextSteps.push(`Resume at [${resumeTodo.kind}] ${resumeTodo.id}`);
    for (const t of pkgTodos) {
      nextSteps.push(`  - [${t.kind}] ${t.status}: ${t.id}`);
    }
    nextSteps.push("Run plan-execute skill: REQ → AC → TEST → EDGE for this package only");
    nextSteps.push("Validate with pnpm test (+ spectral/boundary when present); fail closed");
    nextSteps.push("Mark the four package todos completed in the plan file only after checks pass");
  } else if (outcome === "mvp-complete") {
    nextSteps.push(`MVP packages 01–${String(mvpStop).padStart(2, "0")} are complete`);
    nextSteps.push(
      `Post-MVP next: package ${String(firstPendingNn).padStart(2, "0")} — auto-run only with through-all opt-in (bash scripts/plan-execute-enable.sh --through-all)`,
    );
  } else {
    nextSteps.push("All plan todos completed");
  }

  return {
    ok: true,
    planPath,
    mvpStop,
    todos,
    byPackage,
    firstPendingNn,
    resumeKind,
    resumeTodo,
    pendingThroughMvp: openThroughMvp.length,
    completedThroughMvp,
    totalThroughMvp,
    outcome,
    nextSteps,
  };
}

/**
 * @param {string} planPath
 * @param {number} mvpStop
 * @returns {MeasureResult}
 */
export function measurePlan(planPath, mvpStop = DEFAULT_MVP) {
  const resolved = path.resolve(planPath);
  /** @returns {MeasureResult} */
  const fail = (error, nextSteps, compatibility) => ({
    ok: false,
    planPath: resolved,
    mvpStop,
    todos: [],
    byPackage: {},
    firstPendingNn: null,
    resumeKind: null,
    resumeTodo: null,
    pendingThroughMvp: 0,
    completedThroughMvp: 0,
    totalThroughMvp: 0,
    outcome: "error",
    error,
    nextSteps,
    compatibility,
  });

  if (!fs.existsSync(resolved)) {
    return fail(`Plan file not found: ${resolved}`, [
      "Fail closed: provide --plan PATH or create the plan file",
      "Then shape todos per plan-execute (see --check how-to)",
    ]);
  }
  let text;
  try {
    text = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    return fail(`Cannot read plan: ${err instanceof Error ? err.message : String(err)}`, [
      "Fail closed: fix plan file permissions/path",
    ]);
  }

  const compatibility = checkPlanCompatibility(text, resolved);
  if (!compatibility.compatible) {
    return fail(
      `Plan format incompatible with plan-execute (${compatibility.errors.length} error(s)): ${compatibility.errors[0]}`,
      [
        "Fail closed: fix plan todos until `node scripts/measure-plan.mjs --check` exits 0",
        ...compatibility.errors.map((e) => `error: ${e}`),
        ...compatibility.warnings.map((w) => `warning: ${w}`),
        "",
        compatibility.howToFix,
      ],
      compatibility,
    );
  }

  try {
    const todos = parsePlanTodos(text, resolved);
    const measured = measureFromTodos(todos, mvpStop, resolved);
    measured.compatibility = compatibility;
    return measured;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), [
      "Fail closed: fix plan todo YAML shape",
      compatibility.howToFix,
    ], compatibility);
  }
}

/** Load plan text and run compatibility check only. */
export function checkPlanFile(planPath) {
  const resolved = path.resolve(planPath);
  if (!fs.existsSync(resolved)) {
    return {
      compatible: false,
      planPath: resolved,
      errors: [`Plan file not found: ${resolved}`],
      warnings: [],
      howToFix: PLAN_FORMAT_HOWTO,
      taggedTodoCount: 0,
      packageCount: 0,
    };
  }
  const text = fs.readFileSync(resolved, "utf8");
  return checkPlanCompatibility(text, resolved);
}

/** @param {MeasureResult} r */
export function formatSummary(r) {
  if (!r.ok) {
    const lines = [
      "PLAN-EXECUTE MEASURE: ERROR",
      `plan: ${r.planPath}`,
      `error: ${r.error}`,
      "",
      ...r.nextSteps,
    ];
    if (r.compatibility && !r.compatibility.compatible) {
      // howToFix already appended via nextSteps; ensure header present once
      if (!r.nextSteps.some((s) => s.includes("HOW TO MAKE THE PLAN COMPATIBLE"))) {
        lines.push("", r.compatibility.howToFix);
      }
    }
    return lines.join("\n");
  }
  const nn =
    r.firstPendingNn == null ? "—" : String(r.firstPendingNn).padStart(2, "0");
  const lines = [
    "PLAN-EXECUTE MEASURE",
    `plan: ${r.planPath}`,
    `outcome: ${r.outcome}`,
    `mvpStop: ${r.mvpStop}`,
    `compat: OK (${r.compatibility?.packageCount ?? "?"} packages, ${r.compatibility?.taggedTodoCount ?? "?"} tagged todos)`,
    `progress MVP: ${r.completedThroughMvp}/${r.totalThroughMvp} completed; ${r.pendingThroughMvp} pending`,
    `activePackage: ${nn}`,
    `resume: ${r.resumeKind ?? "—"} (${r.resumeTodo?.id ?? "—"})`,
    "nextSteps:",
    ...r.nextSteps.map((s) => `- ${s}`),
  ];
  return lines.join("\n");
}

/** @param {MeasureResult} r */
export function formatContext(r) {
  if (!r.ok) {
    return [
      "[plan-execute measure — INCOMPATIBLE / ERROR — injected by hook]",
      formatSummary(r),
      "",
      "Do not invent packages. Fix the plan format, then re-run:",
      "  node scripts/measure-plan.mjs --check",
    ].join("\n");
  }
  return [
    "[plan-execute measure — injected by hook]",
    formatSummary(r),
    "",
    "If the user asked to execute/walk the plan, follow ~/.cursor/skills/plan-execute/SKILL.md (or .cursor/skills/plan-execute/SKILL.md).",
    "Opt-in auto-continue sentinel: .cursor/plan-execute.active",
    "Post-MVP through-all sentinel: .cursor/plan-execute.through-all (enable --through-all)",
  ].join("\n");
}

/**
 * Post-MVP opt-in: `.cursor/plan-execute.through-all` or PLAN_EXECUTE_THROUGH_ALL=1.
 * Default auto-continue stops at mvpStop; through-all continues until all-complete.
 * @param {string} [repoRoot]
 */
export function isThroughAll(repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const p = path.join(repoRoot, ".cursor", "plan-execute.through-all");
  if (fs.existsSync(p)) return true;
  const v = process.env.PLAN_EXECUTE_THROUGH_ALL;
  return v === "1" || v === "true";
}

/**
 * Whether stop-hook should emit a follow-up for this measure outcome.
 * mvp-complete only auto-continues when through-all is opted in.
 * @param {MeasureResult['outcome']} outcome
 * @param {boolean} throughAll
 */
export function shouldFollowupForOutcome(outcome, throughAll) {
  if (outcome === "continue") return true;
  if (outcome === "mvp-complete" && throughAll) return true;
  return false;
}

/**
 * Build stop-hook follow-up message, or null when no auto-continue.
 * @param {MeasureResult} r
 * @param {{ loopCount: number, loopLimit: number, active: boolean, status?: string, throughAll?: boolean }} opts
 */
export function formatFollowup(r, opts) {
  if (!opts.active) return null;
  if (opts.status && opts.status !== "completed") return null;
  if (opts.loopCount >= opts.loopLimit) {
    return null;
  }
  if (!r.ok) {
    return [
      "plan-execute STOP: measure failed — fail closed.",
      r.error,
      "Fix the plan so it is compatible with plan-execute, then continue.",
      "Run: node scripts/measure-plan.mjs --check",
      "",
      ...(r.compatibility ? [formatCompatibilityReport(r.compatibility)] : r.nextSteps),
    ].join("\n");
  }
  const throughAll = opts.throughAll ?? isThroughAll();
  if (!shouldFollowupForOutcome(r.outcome, throughAll)) {
    return null; // all-complete, or mvp-complete without through-all
  }
  const nn = String(r.firstPendingNn).padStart(2, "0");
  const postMvp =
    r.outcome === "mvp-complete"
      ? "Post-MVP (through-all opt-in): continue until all packages complete."
      : null;
  return [
    "plan-execute auto-continue (stop hook).",
    `Read and follow the plan-execute skill. One tick only.`,
    `Plan: ${r.planPath}`,
    postMvp,
    `Package ${nn}: resume at [${r.resumeKind}] → finish REQ → AC → TEST → EDGE.`,
    `Then run pnpm test (and spectral/boundary when present). Fail closed if tests fail.`,
    `Mark package ${nn} todos completed only after validation. Stop after this package (hook will continue if sentinel still active).`,
    `loop_count=${opts.loopCount} loop_limit=${opts.loopLimit} pendingThroughMvp=${r.pendingThroughMvp} throughAll=${throughAll}`,
    "",
    formatSummary(r),
  ]
    .filter((line) => line != null && line !== "")
    .join("\n");
}

/** @param {MeasureResult} r */
export function toPublicJson(r) {
  return {
    ok: r.ok,
    planPath: r.planPath,
    mvpStop: r.mvpStop,
    outcome: r.outcome,
    error: r.error ?? null,
    firstPendingNn: r.firstPendingNn,
    resumeKind: r.resumeKind,
    resumeTodoId: r.resumeTodo?.id ?? null,
    resumeTitle: r.resumeTodo?.title ?? null,
    pendingThroughMvp: r.pendingThroughMvp,
    completedThroughMvp: r.completedThroughMvp,
    totalThroughMvp: r.totalThroughMvp,
    nextSteps: r.nextSteps,
    compatibility: r.compatibility
      ? {
          compatible: r.compatibility.compatible,
          errors: r.compatibility.errors,
          warnings: r.compatibility.warnings,
          taggedTodoCount: r.compatibility.taggedTodoCount,
          packageCount: r.compatibility.packageCount,
          howToFix: r.compatibility.compatible ? null : r.compatibility.howToFix,
        }
      : null,
    packageSteps:
      r.firstPendingNn == null
        ? []
        : (r.byPackage[String(r.firstPendingNn)] || []).map((t) => ({
            id: t.id,
            kind: t.kind,
            status: t.status,
          })),
  };
}

function isMain() {
  const entry = process.argv[1] && path.resolve(process.argv[1]);
  return entry === fileURLToPath(import.meta.url);
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const planPath = String(args.plan);
  const mvpStop = Number(args.mvp);

  if (args.check) {
    const report = checkPlanFile(planPath);
    if (args.json) {
      process.stdout.write(
        JSON.stringify(
          {
            compatible: report.compatible,
            planPath: report.planPath,
            errors: report.errors,
            warnings: report.warnings,
            taggedTodoCount: report.taggedTodoCount,
            packageCount: report.packageCount,
            howToFix: report.compatible ? null : report.howToFix,
          },
          null,
          2,
        ) + "\n",
      );
    } else {
      console.log(formatCompatibilityReport(report));
    }
    process.exit(report.compatible ? 0 : 1);
  }

  const result = measurePlan(planPath, mvpStop);

  const statusPath =
    args.statusPath && String(args.statusPath)
      ? String(args.statusPath)
      : path.join(path.dirname(planPath), "..", "plan-execute.status.json");

  if (args.writeStatus) {
    const dir = path.dirname(statusPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify(toPublicJson(result), null, 2) + "\n");
  }

  if (args.followup) {
    const active =
      process.env.PLAN_EXECUTE_ACTIVE === "1" ||
      process.env.PLAN_EXECUTE_ACTIVE === "true";
    const throughAll = isThroughAll();
    const msg = formatFollowup(result, {
      loopCount: Number(args.loopCount),
      loopLimit: Number(args.loopLimit),
      active,
      throughAll,
      status: process.env.PLAN_EXECUTE_STOP_STATUS || "completed",
    });
    if (!msg) {
      process.stdout.write("{}\n");
      const wouldContinue =
        result.ok && shouldFollowupForOutcome(result.outcome, throughAll);
      process.exit(wouldContinue && !active ? 2 : result.ok ? 2 : 1);
    }
    process.stdout.write(JSON.stringify({ followup_message: msg }) + "\n");
    process.exit(0);
  }

  if (args.context) {
    // Always emit context on stdout (including incompatible how-to) so hooks can inject it.
    process.stdout.write(formatContext(result) + "\n");
    process.exit(result.ok ? 0 : 1);
  }

  if (args.json || (!args.summary && !args.writeStatus)) {
    // default: JSON on stdout for hooks; --summary for humans
    if (args.summary) {
      console.log(formatSummary(result));
    } else if (!args.writeStatus || args.json) {
      process.stdout.write(JSON.stringify(toPublicJson(result), null, 2) + "\n");
    }
    if (args.writeStatus && !args.json && !args.summary) {
      console.error(`Wrote ${statusPath}`);
    }
  } else if (args.summary) {
    console.log(formatSummary(result));
  } else if (args.writeStatus) {
    console.error(`Wrote ${statusPath}`);
  }

  if (!result.ok) process.exit(1);
  if (result.outcome === "continue") process.exit(0);
  process.exit(2);
}

if (isMain()) main();
