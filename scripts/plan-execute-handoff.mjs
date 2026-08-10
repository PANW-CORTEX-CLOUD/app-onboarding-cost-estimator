#!/usr/bin/env node
/**
 * plan-execute-handoff.mjs — End-of-turn + stop-hook orchestrator.
 *
 * Writes next-steps artifact, validates prior work (pnpm test / check),
 * applies discovered gaps into the plan, and builds stop-hook followups
 * so hooks auto-continue with validate-then-next.
 *
 * Usage:
 *   node scripts/plan-execute-handoff.mjs --write-next
 *   node scripts/plan-execute-handoff.mjs --validate-prior
 *   node scripts/plan-execute-handoff.mjs --apply-gaps [--dry-run]
 *   node scripts/plan-execute-handoff.mjs --scan-gaps   # auto-detect missing paths from completed AC
 *   node scripts/plan-execute-handoff.mjs --followup [--loop-count N] [--loop-limit N]
 *
 * Exit: 0 ok/continue, 2 mvp-done/no-followup, 1 hard failure
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  measurePlan,
  checkPlanFile,
  formatSummary,
  formatCompatibilityReport,
  parsePlanTodos,
  DEFAULT_MVP,
  isThroughAll,
  shouldFollowupForOutcome,
} from "./measure-plan.mjs";

// Re-export parse - need to check if parsePlanTodos is exported
// measure-plan exports parsePlanTodos - good

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PLAN = path.join(
  ROOT,
  ".cursor/plans/azure_cortex_cost_estimator_4075e709.plan.md",
);
const NEXT_PATH = path.join(ROOT, ".cursor/plan-execute.next.json");
const GAPS_PATH = path.join(ROOT, ".cursor/plan-execute.gaps.json");
const ACTIVE_PATH = path.join(ROOT, ".cursor/plan-execute.active");
const THROUGH_ALL_PATH = path.join(ROOT, ".cursor/plan-execute.through-all");
const STATUS_PATH = path.join(ROOT, ".cursor/plan-execute.status.json");

function usage() {
  return `Usage: node scripts/plan-execute-handoff.mjs [--write-next|--validate-prior|--apply-gaps|--scan-gaps|--followup]
  --plan PATH  --mvp N  --loop-count N  --loop-limit N  --dry-run  --json`;
}

function parseArgs(argv) {
  const out = {
    plan: process.env.PLAN_EXECUTE_PLAN || DEFAULT_PLAN,
    mvp: Number(process.env.PLAN_EXECUTE_MVP || DEFAULT_MVP || 19),
    writeNext: false,
    validatePrior: false,
    applyGaps: false,
    scanGaps: false,
    followup: false,
    dryRun: false,
    json: false,
    loopCount: 0,
    loopLimit: 25,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plan") out.plan = argv[++i];
    else if (a === "--mvp") out.mvp = Number(argv[++i]);
    else if (a === "--write-next") out.writeNext = true;
    else if (a === "--validate-prior") out.validatePrior = true;
    else if (a === "--apply-gaps") out.applyGaps = true;
    else if (a === "--scan-gaps") out.scanGaps = true;
    else if (a === "--followup") out.followup = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--loop-count") out.loopCount = Number(argv[++i]);
    else if (a === "--loop-limit") out.loopLimit = Number(argv[++i]);
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Unknown arg: ${a}\n${usage()}`);
  }
  return out;
}

function isActive() {
  if (fs.existsSync(ACTIVE_PATH)) return true;
  const v = process.env.PLAN_EXECUTE_ACTIVE;
  return v === "1" || v === "true";
}

function throughAllEnabled() {
  return isThroughAll(ROOT);
}

/**
 * Run workspace validation for prior package work.
 * Fail closed: non-zero test exit → ok=false.
 */
export function validatePrior(repoRoot = ROOT) {
  const checks = [];
  const pkgJson = path.join(repoRoot, "package.json");
  if (fs.existsSync(pkgJson)) {
    const pj = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
    if (pj.scripts?.test) {
      const r = spawnSync("pnpm", ["test"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
        timeout: 180_000,
      });
      checks.push({
        name: "pnpm test",
        exitCode: r.status ?? 1,
        ok: r.status === 0,
        stderrTail: (r.stderr || r.stdout || "").slice(-2000),
      });
    } else {
      checks.push({
        name: "pnpm test",
        exitCode: 0,
        ok: true,
        skipped: true,
        reason: "no test script",
      });
    }
  } else {
    checks.push({
      name: "pnpm test",
      exitCode: 0,
      ok: true,
      skipped: true,
      reason: "no package.json",
    });
  }

  const measureBin = path.join(repoRoot, "scripts/measure-plan.mjs");
  if (fs.existsSync(measureBin)) {
    const r = spawnSync(process.execPath, [measureBin, "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 30_000,
    });
    checks.push({
      name: "measure-plan --check",
      exitCode: r.status ?? 1,
      ok: r.status === 0,
      stderrTail: (r.stdout || r.stderr || "").slice(-1500),
    });
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks, at: new Date().toISOString() };
}

/**
 * Extract repo-relative path-like tokens from plan AC/REQ text.
 * @param {string} text
 */
export function extractCitedPaths(text) {
  const found = new Set();
  const patterns = [
    /`((?:docs|packages|apps|openapi|sources|azure|aws|gcp|scripts)\/[^`\s]+)`/g,
    /\b((?:docs|packages|apps|openapi|sources)\/[a-zA-Z0-9_./-]+\.(?:md|ts|tsx|yaml|yml|json|mjs|js))\b/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1].replace(/^\.\//, ""));
  }
  return [...found];
}

/**
 * Scan completed REQ/AC todos for cited paths that do not exist → gaps.
 * @param {string} planPath
 * @param {string} repoRoot
 */
export function scanGapsFromPlan(planPath, repoRoot = ROOT) {
  const text = fs.readFileSync(planPath, "utf8");
  const todos = parsePlanTodos(text, planPath);
  const maxNn = todos.reduce((m, t) => Math.max(m, t.nn), 0);
  const total = Math.max(todos[0]?.total || maxNn, maxNn + 1);
  /** @type {Array<Record<string, unknown>>} */
  const gaps = [];
  const completed = todos.filter(
    (t) => (t.kind === "REQ" || t.kind === "AC") && t.status === "completed",
  );
  const missingPaths = [];
  const seen = new Set();
  for (const t of completed) {
    for (const p of extractCitedPaths(t.content)) {
      if (seen.has(p)) continue;
      seen.add(p);
      const abs = path.join(repoRoot, p);
      if (!fs.existsSync(abs)) {
        missingPaths.push({ path: p, citedBy: t.id, nn: t.nn });
      }
    }
  }
  if (missingPaths.length) {
    const nn = maxNn + 1;
    const M = Math.max(total, nn);
    const list = missingPaths.map((x) => `\`${x.path}\` (from ${x.citedBy})`).join("; ");
    gaps.push({
      createPackage: true,
      packageNn: nn,
      total: M,
      slug: `gap-missing-paths-${nn}`,
      title: "Auto-gap — missing paths cited by completed packages",
      reason: `Create or fix: ${list}`,
    });
  }
  return gaps;
}

/**
 * Append new todos into plan YAML frontmatter before closing ---.
 * Fail closed if plan shape wrong or id collision.
 * @param {string} planPath
 * @param {Array<{ id: string, content: string, status?: string }>} newTodos
 * @param {{ dryRun?: boolean }} opts
 */
export function appendTodosToPlan(planPath, newTodos, opts = {}) {
  if (!newTodos.length) {
    return { applied: [], skipped: [], planPath };
  }
  let text = fs.readFileSync(planPath, "utf8");
  if (!text.startsWith("---")) {
    throw new Error("Plan missing YAML frontmatter");
  }
  const close = text.indexOf("\n---", 3);
  if (close < 0) throw new Error("Plan missing frontmatter closer");

  const existing = parsePlanTodos(text, planPath);
  const ids = new Set(existing.map((t) => t.id));
  const applied = [];
  const skipped = [];
  let block = "";
  for (const t of newTodos) {
    if (ids.has(t.id)) {
      skipped.push({ id: t.id, reason: "id already exists" });
      continue;
    }
    if (!/^\[\d+\/\d+\]\[(REQ|AC|TEST|EDGE)\]/.test(t.content)) {
      skipped.push({ id: t.id, reason: "content missing [NN/M][KIND] tag" });
      continue;
    }
    const status = t.status || "pending";
    const escaped = t.content.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    block += `  - id: ${t.id}\n    content: "${escaped}"\n    status: ${status}\n`;
    ids.add(t.id);
    applied.push(t.id);
  }

  if (!applied.length || opts.dryRun) {
    return { applied, skipped, planPath, dryRun: !!opts.dryRun, preview: block };
  }

  const before = text.slice(0, close + 1);
  // Insert before the newline that precedes closing ---
  // close points at \n--- ; we want to append todos at end of todos list (just before \n---)
  const inserted = before + block + text.slice(close + 1);
  // Verify still compatible
  fs.writeFileSync(planPath, inserted);
  const report = checkPlanFile(planPath);
  if (!report.compatible) {
    // rollback
    fs.writeFileSync(planPath, text);
    throw new Error(
      `Gap append made plan incompatible: ${report.errors.join("; ")}`,
    );
  }
  return { applied, skipped, planPath };
}

function loadAgentGaps() {
  if (!fs.existsSync(GAPS_PATH)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(GAPS_PATH, "utf8"));
    const gaps = Array.isArray(j) ? j : j.gaps;
    if (!Array.isArray(gaps)) throw new Error("gaps must be an array");
    return gaps;
  } catch (err) {
    throw new Error(
      `Corrupt gaps file ${GAPS_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Normalize agent gap objects into plan todos.
 * Full package gaps (missingPackage: true) expand to REQ/AC/TEST/EDGE.
 */
export function normalizeGapsToTodos(gaps, planPath) {
  const text = fs.readFileSync(planPath, "utf8");
  const existing = parsePlanTodos(text, planPath);
  const maxNn = existing.reduce((m, t) => Math.max(m, t.nn), 0);
  const total = existing[0]?.total || maxNn;
  /** @type {Array<{ id: string, content: string, status: string }>} */
  const todos = [];

  for (const g of gaps) {
    if (g.missingPackage === true || g.createPackage === true) {
      const nn = Number(g.packageNn || maxNn + 1);
      const M = Number(g.total || Math.max(total, nn));
      const slug = String(g.slug || g.id || `auto-${nn}`).replace(/[^a-z0-9-]/gi, "-");
      const title = g.title || g.reason || "Auto-added package";
      for (const kind of ["REQ", "AC", "TEST", "EDGE"]) {
        todos.push({
          id: `${kind.toLowerCase()}-${slug}`,
          content: `[${String(nn).padStart(2, "0")}/${String(M).padStart(2, "0")}][${kind}] ${title} — ${g.reason || "auto-gap"}`,
          status: "pending",
        });
      }
      continue;
    }
    if (g.content && g.id) {
      todos.push({
        id: g.id,
        content: g.content,
        status: g.status || "pending",
      });
      continue;
    }
    // EDGE under package
    const nn = Number(g.packageNn || maxNn);
    const M = Number(g.total || total);
    const slug = String(g.id || g.reason || "gap")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 48);
    todos.push({
      id: slug.startsWith("edge-") ? slug : `edge-${slug}`,
      content:
        g.content ||
        `[${String(nn).padStart(2, "0")}/${String(M).padStart(2, "0")}][EDGE] Auto-gap — ${g.reason || "unspecified"}`,
      status: "pending",
    });
  }
  return todos;
}

export function writeNextArtifact(opts = {}) {
  const planPath = opts.plan || DEFAULT_PLAN;
  const mvp = opts.mvp ?? 19;
  const measure = measurePlan(planPath, mvp);
  const validation =
    opts.validation ||
    (opts.skipValidate ? { ok: true, checks: [], skipped: true } : validatePrior(ROOT));
  const gapsApplied = opts.gapsApplied || [];

  const artifact = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    planPath: measure.planPath,
    active: isActive(),
    followThrough: isActive(),
    outcome: measure.outcome,
    ok: measure.ok && validation.ok,
    priorValidation: validation,
    gapsApplied,
    activePackage: measure.firstPendingNn,
    resumeKind: measure.resumeKind,
    resumeTodoId: measure.resumeTodo?.id ?? null,
    nextSteps: measure.nextSteps,
    summary: formatSummary(measure),
    agentInstructions: buildAgentInstructions(measure, validation, gapsApplied),
  };

  fs.mkdirSync(path.dirname(NEXT_PATH), { recursive: true });
  fs.writeFileSync(NEXT_PATH, JSON.stringify(artifact, null, 2) + "\n");
  fs.writeFileSync(
    STATUS_PATH,
    JSON.stringify(
      {
        ...artifact,
        nextPath: NEXT_PATH,
      },
      null,
      2,
    ) + "\n",
  );
  return artifact;
}

function buildAgentInstructions(measure, validation, gapsApplied) {
  const lines = [];
  lines.push("plan-execute handoff — follow plan-execute skill.");
  if (!validation.ok) {
    lines.push("PRIOR VALIDATION FAILED — fail closed. Do NOT start a new package.");
    lines.push("Re-run failing checks, fix root cause, re-validate, update plan statuses only when green.");
    for (const c of validation.checks.filter((x) => !x.ok)) {
      lines.push(`Failed: ${c.name} exit=${c.exitCode}`);
      if (c.stderrTail) lines.push(c.stderrTail.slice(0, 800));
    }
    return lines.join("\n");
  }
  if (!measure.ok) {
    lines.push("PLAN INCOMPATIBLE — run measure-plan --check and fix HOW TO.");
    return lines.join("\n");
  }
  if (measure.outcome !== "continue") {
    if (
      measure.outcome === "mvp-complete" &&
      throughAllEnabled() &&
      measure.firstPendingNn != null
    ) {
      lines.push(
        "Outcome mvp-complete — through-all opt-in active; continue post-MVP packages.",
      );
      // Fall through to one-tick instructions for the post-MVP package.
    } else if (measure.outcome === "all-complete") {
      lines.push("Outcome all-complete — stop auto-continue (plan finished).");
      return lines.join("\n");
    } else {
      lines.push(
        `Outcome ${measure.outcome} — stop auto-continue (MVP gate without through-all).`,
      );
      return lines.join("\n");
    }
  }
  if (gapsApplied.length) {
    lines.push(`Gaps applied to plan: ${gapsApplied.join(", ")}`);
  }
  const nn = String(measure.firstPendingNn).padStart(2, "0");
  lines.push(`One tick: package ${nn} resume [${measure.resumeKind}] → REQ→AC→TEST→EDGE.`);
  lines.push("Validate with pnpm test; mark package complete only if green.");
  lines.push(
    "Before ending the turn: run `node scripts/plan-execute-handoff.mjs --write-next` (and --scan-gaps/--apply-gaps if you discovered missing work). Write gaps to .cursor/plan-execute.gaps.json.",
  );
  lines.push(...measure.nextSteps.map((s) => `- ${s}`));
  return lines.join("\n");
}

export function buildFollowupMessage(artifact, loopCount, loopLimit) {
  if (!artifact.followThrough && !isActive()) return null;
  if (loopCount >= loopLimit) return null;
  const throughAll = throughAllEnabled();
  if (!shouldFollowupForOutcome(artifact.outcome, throughAll)) {
    return null;
  }
  if (!artifact.ok && artifact.priorValidation && !artifact.priorValidation.ok) {
    return [
      "plan-execute auto-continue: PRIOR VALIDATION FAILED.",
      "Read .cursor/plan-execute.next.json and plan-execute skill.",
      "Fix failing checks from the previous package. Fail closed — do not advance.",
      "",
      artifact.agentInstructions,
      "",
      artifact.summary,
    ].join("\n");
  }
  if (!artifact.ok) {
    return [
      "plan-execute auto-continue: handoff not ok — fail closed.",
      artifact.agentInstructions,
      artifact.summary,
    ].join("\n");
  }
  const postMvpNote =
    artifact.outcome === "mvp-complete"
      ? "Post-MVP (through-all opt-in): continue until all packages complete."
      : null;
  return [
    "plan-execute auto-continue (stop hook handoff).",
    "Read and follow the plan-execute skill + .cursor/plan-execute.next.json.",
    postMvpNote,
    "1) Confirm prior validation is green (already checked by hook).",
    "2) Implement exactly one next package (REQ→AC→TEST→EDGE).",
    "3) If you discover missing plan work, append to .cursor/plan-execute.gaps.json then run handoff --apply-gaps.",
    "4) End turn with: node scripts/plan-execute-handoff.mjs --write-next",
    `loop_count=${loopCount} loop_limit=${loopLimit} throughAll=${throughAll}`,
    "",
    artifact.agentInstructions,
    "",
    artifact.summary,
  ]
    .filter((line) => line != null && line !== "")
    .join("\n");
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

  const planPath = path.resolve(String(args.plan));

  // Default: if no mode flags, do write-next
  if (
    !args.writeNext &&
    !args.validatePrior &&
    !args.applyGaps &&
    !args.scanGaps &&
    !args.followup
  ) {
    args.writeNext = true;
  }

  try {
    if (args.scanGaps) {
      const scanned = scanGapsFromPlan(planPath, ROOT);
      const existing = loadAgentGaps();
      const merged = [...existing];
      const ids = new Set(existing.map((g) => g.id));
      for (const g of scanned) {
        if (!ids.has(g.id)) merged.push(g);
      }
      if (!args.dryRun) {
        fs.writeFileSync(
          GAPS_PATH,
          JSON.stringify({ updatedAt: new Date().toISOString(), gaps: merged }, null, 2) +
            "\n",
        );
      }
      const out = { scanned: scanned.length, totalGaps: merged.length, gaps: merged };
      if (args.json) console.log(JSON.stringify(out, null, 2));
      else {
        console.log(`Scanned ${scanned.length} path-gaps; gaps file has ${merged.length} entries`);
        for (const g of scanned) console.log(`  - ${g.id}: ${g.reason}`);
      }
      if (!args.followup && !args.writeNext && !args.applyGaps) process.exit(0);
    }

    let gapsApplied = [];
    if (args.applyGaps || args.followup) {
      let gaps = [];
      try {
        gaps = loadAgentGaps();
      } catch (err) {
        if (args.applyGaps && !args.followup) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
        // followup: ignore missing gaps file
        gaps = [];
      }
      if (gaps.length || args.followup) {
        // On followup always auto-scan completed AC for missing cited paths
        if (args.followup) {
          try {
            const scanned = scanGapsFromPlan(planPath, ROOT);
            const ids = new Set(gaps.map((g) => g.id).filter(Boolean));
            for (const g of scanned) {
              if (!ids.has(g.id)) gaps.push(g);
            }
          } catch {
            /* ignore scan errors on followup */
          }
        }
      }
      if (gaps.length) {
        const todos = normalizeGapsToTodos(gaps, planPath);
        const result = appendTodosToPlan(planPath, todos, { dryRun: args.dryRun });
        gapsApplied = result.applied;
        if (!args.dryRun && result.applied.length) {
          const remain = gaps.filter((g) => {
            if (g.createPackage || g.missingPackage) {
              const slug = String(g.slug || g.id || "");
              return slug
                ? !result.applied.some((id) => id.includes(slug))
                : true;
            }
            return g.id ? !result.applied.includes(g.id) : true;
          });
          fs.writeFileSync(
            GAPS_PATH,
            JSON.stringify({ updatedAt: new Date().toISOString(), gaps: remain }, null, 2) +
              "\n",
          );
        }
        if (args.applyGaps && !args.followup) {
          console.log(
            JSON.stringify(
              { applied: result.applied, skipped: result.skipped, dryRun: !!args.dryRun },
              null,
              2,
            ),
          );
          process.exit(0);
        }
      } else if (args.applyGaps && !args.followup) {
        console.log(JSON.stringify({ applied: [], skipped: [], message: "no gaps" }, null, 2));
        process.exit(0);
      }
    }

    if (args.validatePrior && !args.followup && !args.writeNext) {
      const v = validatePrior(ROOT);
      console.log(JSON.stringify(v, null, 2));
      process.exit(v.ok ? 0 : 1);
    }

    if (args.followup) {
      const active = isActive();
      if (!active) {
        // still write next for humans
        writeNextArtifact({ plan: planPath, mvp: args.mvp, skipValidate: true });
        process.stdout.write("{}\n");
        process.exit(2);
      }
      // validate prior before continue
      const validation = validatePrior(ROOT);
      const artifact = writeNextArtifact({
        plan: planPath,
        mvp: args.mvp,
        validation,
        gapsApplied,
      });
      const msg = buildFollowupMessage(artifact, args.loopCount, args.loopLimit);
      if (!msg) {
        process.stdout.write("{}\n");
        process.exit(artifact.outcome === "continue" && validation.ok ? 2 : validation.ok ? 2 : 1);
      }
      process.stdout.write(JSON.stringify({ followup_message: msg }) + "\n");
      process.exit(0);
    }

    if (args.writeNext) {
      const validation = args.validatePrior
        ? validatePrior(ROOT)
        : { ok: true, checks: [], skipped: true };
      const artifact = writeNextArtifact({
        plan: planPath,
        mvp: args.mvp,
        validation,
        gapsApplied,
        skipValidate: !args.validatePrior,
      });
      if (args.json) console.log(JSON.stringify(artifact, null, 2));
      else {
        console.log(`Wrote ${NEXT_PATH}`);
        console.log(artifact.agentInstructions);
      }
      process.exit(artifact.ok ? (artifact.outcome === "continue" ? 0 : 2) : 1);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
