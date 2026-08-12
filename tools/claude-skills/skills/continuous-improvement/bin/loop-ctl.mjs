#!/usr/bin/env node
/**
 * loop-ctl.mjs — Arm, disarm and inspect the continuous-improvement loop.
 *
 * The loop is opt-in per project: the Stop hook is inert until this CLI drops the
 * activation sentinel in `<project>/.claude/`. Everything the hook persists lives beside
 * it, so the whole loop can be reasoned about from the file system.
 *
 * ```text
 * <project>/.claude/
 *   continuous-improvement.active            activation sentinel (presence = armed)
 *   continuous-improvement.state.json        loop state machine
 *   continuous-improvement.config.json       optional bounds override (committed)
 *   continuous-improvement/journal.jsonl     append-only decision journal
 * ```
 *
 * Usage (from this skill's directory; the project looped is the cwd or CLAUDE_PROJECT_DIR):
 * ```bash
 * node bin/loop-ctl.mjs enable [--max N] [--keep-state]
 * node bin/loop-ctl.mjs disable
 * node bin/loop-ctl.mjs status [--json]
 * node bin/loop-ctl.mjs angles
 * node bin/loop-ctl.mjs journal [-n 20]
 * ```
 *
 * Exit 0 on success, 1 on a bad invocation.
 *
 * @module continuous-improvement/bin/loop-ctl
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ANGLES } from "../lib/angles.mjs";
import { DEFAULT_CONFIG, createState, normalizeState } from "../lib/loop-control.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Resolve the project whose loop is being controlled.
 *
 * @returns {string} Absolute project directory.
 */
function projectDir() {
  const fromEnv = process.env.CLAUDE_PROJECT_DIR;
  return fromEnv && fromEnv.trim() !== "" ? path.resolve(fromEnv) : process.cwd();
}

/**
 * Paths of every loop artefact for a project.
 *
 * @param {string} root Absolute project directory.
 * @returns {{claudeDir: string, active: string, state: string, config: string, journal: string}} Paths.
 */
function paths(root) {
  const claudeDir = path.join(root, ".claude");
  return {
    claudeDir,
    active: path.join(claudeDir, "continuous-improvement.active"),
    state: path.join(claudeDir, "continuous-improvement.state.json"),
    config: path.join(claudeDir, "continuous-improvement.config.json"),
    journal: path.join(claudeDir, "continuous-improvement", "journal.jsonl"),
  };
}

/**
 * Read and validate the persisted loop state.
 *
 * @param {string} file State file path.
 * @returns {import("../lib/loop-control.mjs").LoopState | null} State, or `null` when absent.
 */
function readState(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Read a flag's value from argv.
 *
 * @param {string[]} argv Arguments.
 * @param {string} flag Flag name including dashes.
 * @returns {string | null} The following token, or `null`.
 */
function flagValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

/**
 * Render this CLI's own path for a copy-pasteable hint.
 *
 * Relative when the skill lives inside the project (a checked-in copy), absolute otherwise —
 * a global install is typically several `..` segments away from the project, and printing
 * that chain is worse than useless.
 *
 * @param {string} root Absolute project directory.
 * @returns {string} Path to this script as the user should type it.
 */
function selfPath(root) {
  const self = path.join(SKILL_DIR, "bin", "loop-ctl.mjs");
  const relative = path.relative(root, self);
  return relative.startsWith("..") ? self : relative;
}

/**
 * `enable` — arm the loop for this project.
 *
 * By default this starts a **fresh run**: the state is reset so the iteration counter and
 * the used-angle set start clean. `--keep-state` resumes an interrupted run instead.
 *
 * @param {string[]} argv Arguments after the subcommand.
 * @returns {void}
 */
function cmdEnable(argv) {
  const root = projectDir();
  const p = paths(root);
  fs.mkdirSync(p.claudeDir, { recursive: true });

  const max = flagValue(argv, "--max");
  if (max !== null) {
    const n = Number(max);
    if (!Number.isInteger(n) || n < 1) {
      process.stderr.write(`--max must be a positive integer, got ${JSON.stringify(max)}\n`);
      process.exit(1);
    }
    const existing = fs.existsSync(p.config) ? JSON.parse(fs.readFileSync(p.config, "utf8")) : {};
    fs.writeFileSync(p.config, `${JSON.stringify({ ...existing, maxIterations: n }, null, 2)}\n`, "utf8");
  }

  if (!argv.includes("--keep-state") || !fs.existsSync(p.state)) {
    fs.writeFileSync(p.state, `${JSON.stringify(createState(), null, 2)}\n`, "utf8");
  }

  fs.writeFileSync(
    p.active,
    `armed ${new Date().toISOString()}\n` +
      "Presence of this file arms the continuous-improvement Stop hook for this project.\n" +
      "Delete it (or run loop-ctl.mjs disable) to stop the loop after the current turn.\n",
    "utf8"
  );

  const state = readState(p.state);
  process.stdout.write(
    `continuous-improvement loop ARMED for ${root}\n` +
      `  iteration:    ${state?.iteration ?? 0}\n` +
      `  max:          ${max ?? DEFAULT_CONFIG.maxIterations}\n` +
      `  used angles:  ${state?.usedAngles.length ?? 0}/${ANGLES.length}\n` +
      `  disarm with:  node ${selfPath(root)} disable\n`
  );
}

/**
 * `disable` — disarm the loop. The state file is left in place so `status` still explains
 * what the run did.
 *
 * @returns {void}
 */
function cmdDisable() {
  const p = paths(projectDir());
  const wasArmed = fs.existsSync(p.active);
  fs.rmSync(p.active, { force: true });
  process.stdout.write(
    wasArmed
      ? "continuous-improvement loop DISARMED (state kept; run `status` to review)\n"
      : "continuous-improvement loop was not armed\n"
  );
}

/**
 * `status` — report whether the loop is armed and what it has done.
 *
 * @param {string[]} argv Arguments after the subcommand.
 * @returns {void}
 */
function cmdStatus(argv) {
  const root = projectDir();
  const p = paths(root);
  const armed = fs.existsSync(p.active);
  const state = readState(p.state);

  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ root, armed, state }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`continuous-improvement loop — ${root}\n`);
  process.stdout.write(`  armed:        ${armed ? "yes" : "no"}\n`);
  if (!state) {
    process.stdout.write("  state:        none yet (loop has not run)\n");
    return;
  }
  process.stdout.write(`  iteration:    ${state.iteration}\n`);
  process.stdout.write(`  mode:         ${state.mode}\n`);
  process.stdout.write(`  last trigger: ${state.lastTrigger ?? "—"}\n`);
  process.stdout.write(`  used angles:  ${state.usedAngles.length}/${ANGLES.length}\n`);
  for (const id of state.usedAngles) process.stdout.write(`                · ${id}\n`);
  const last = state.history.at(-1);
  if (last) {
    process.stdout.write(
      `  last decision: ${last.decision}/${last.reasonCode} at ${last.at}\n` +
        `                 ${last.detail ?? ""}\n`
    );
  }
}

/**
 * `angles` — print the investigation catalogue, marking those already swept.
 *
 * @returns {void}
 */
function cmdAngles() {
  const state = readState(paths(projectDir()).state);
  const used = new Set(state?.usedAngles ?? []);
  for (const angle of ANGLES) {
    process.stdout.write(`${used.has(angle.id) ? "[x]" : "[ ]"} ${angle.id} — ${angle.title}\n`);
  }
  process.stdout.write(`\n${used.size}/${ANGLES.length} swept\n`);
}

/**
 * `journal` — tail the append-only decision journal.
 *
 * @param {string[]} argv Arguments after the subcommand.
 * @returns {void}
 */
function cmdJournal(argv) {
  const p = paths(projectDir());
  if (!fs.existsSync(p.journal)) {
    process.stdout.write("no journal yet\n");
    return;
  }
  const n = Number(flagValue(argv, "-n") ?? 20);
  const lines = fs.readFileSync(p.journal, "utf8").split("\n").filter((l) => l.trim() !== "");
  for (const line of lines.slice(-(Number.isInteger(n) && n > 0 ? n : 20))) {
    process.stdout.write(`${line}\n`);
  }
}

const USAGE = `loop-ctl — continuous-improvement loop control

  enable [--max N] [--keep-state]   arm the loop (fresh run unless --keep-state)
  disable                           disarm after the current turn
  status [--json]                   armed? iteration? angles swept?
  angles                            investigation catalogue, [x] = already swept
  journal [-n 20]                   tail the decision journal
`;

const [, , cmd = "", ...rest] = process.argv;
switch (cmd) {
  case "enable":
    cmdEnable(rest);
    break;
  case "disable":
    cmdDisable();
    break;
  case "status":
    cmdStatus(rest);
    break;
  case "angles":
    cmdAngles();
    break;
  case "journal":
    cmdJournal(rest);
    break;
  default:
    process.stdout.write(USAGE);
    process.exit(cmd === "" || cmd === "--help" || cmd === "-h" ? 0 : 1);
}
