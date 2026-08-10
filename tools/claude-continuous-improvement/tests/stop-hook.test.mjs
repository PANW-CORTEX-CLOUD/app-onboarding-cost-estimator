/**
 * Integration tests for the continuous-improvement Stop hook.
 *
 * These spawn the real hook process against a throwaway project directory and assert on the
 * JSON it writes to stdout — the same contract Claude Code consumes.
 *
 * Run from this skill's directory: node --test 'tests/*.test.mjs'
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ANGLES } from "../lib/angles.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(SKILL_DIR, "hooks", "stop.mjs");

/** @type {string} Throwaway project root for the test currently running. */
let projectDir;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-loop-"));
  fs.mkdirSync(path.join(projectDir, ".claude"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

/** Absolute path of the activation sentinel for the current test project. */
const activeFile = () => path.join(projectDir, ".claude", "continuous-improvement.active");

/**
 * Arm the loop for the throwaway project.
 *
 * @returns {void}
 */
function arm() {
  fs.writeFileSync(activeFile(), "armed by test\n", "utf8");
}

/**
 * Run the hook with a payload and return its parsed stdout.
 *
 * @param {Record<string, unknown>} payload Hook input.
 * @param {Record<string, string>} [env] Extra environment variables.
 * @returns {Record<string, any>} Parsed hook output.
 */
function runHook(payload, env = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "Stop", cwd: projectDir, ...payload }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...env },
  });
  assert.equal(result.status, 0, `hook must always exit 0, got ${result.status}: ${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`hook stdout was not JSON: ${JSON.stringify(result.stdout)} (${err})`);
  }
}

/**
 * Build a final assistant message ending in a control block. The suffix keeps each message
 * unique, so the hook's per-turn claim does not treat two calls as the same turn.
 *
 * @param {string} line The `NEXT-STEP:` line content.
 * @param {string} [suffix] Uniquifier.
 * @returns {string} Message text.
 */
const finalMessage = (line, suffix = "") =>
  `Did the work.${suffix}\n\n=== LOOP CONTROL ===\nVALIDATION: pnpm test — green\nNEXT-STEP: ${line}\n`;

/**
 * Read the persisted loop state.
 *
 * @returns {any} Parsed state, or `null` when absent.
 */
function readState() {
  const file = path.join(projectDir, ".claude", "continuous-improvement.state.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

describe("stop hook — activation", () => {
  it("is inert when the project has not armed the loop", () => {
    const out = runHook({ last_assistant_message: finalMessage("CONTINUE — go") });
    assert.deepEqual(out, {});
    assert.equal(readState(), null, "an unarmed project must not be written to");
  });

  it("honours the kill switch even when armed", () => {
    arm();
    const out = runHook(
      { last_assistant_message: finalMessage("CONTINUE — go") },
      { CONTINUOUS_IMPROVEMENT_DISABLE: "1" }
    );
    assert.deepEqual(out, {});
  });

  it("can be armed by environment instead of a sentinel", () => {
    const out = runHook(
      { last_assistant_message: finalMessage("CONTINUE — go") },
      { CONTINUOUS_IMPROVEMENT_ACTIVE: "1" }
    );
    assert.equal(out.decision, "block");
  });
});

describe("stop hook — triggers", () => {
  beforeEach(arm);

  it("CONTINUE blocks the stop and re-injects the prompt", () => {
    const out = runHook({ last_assistant_message: finalMessage("CONTINUE — fix the drift stamp") });
    assert.equal(out.decision, "block");
    assert.match(out.reason, /IMPLEMENT/);
    assert.match(out.reason, /fix the drift stamp/);
    assert.match(out.reason, /CONTINUE IMPLEMENTATION AND BEST NEXT STEPS/);
    assert.equal(readState().iteration, 1);
  });

  it("INVESTIGATE blocks with a fresh angle", () => {
    const out = runHook({ last_assistant_message: finalMessage("INVESTIGATE — plan empty") });
    assert.equal(out.decision, "block");
    assert.ok(out.reason.includes(ANGLES[0].id));
    assert.deepEqual(readState().usedAngles, [ANGLES[0].id]);
  });

  it("COMPLETE allows the stop and disarms the loop", () => {
    const out = runHook({ last_assistant_message: finalMessage("COMPLETE — all green") });
    assert.equal(out.decision, undefined);
    assert.match(out.systemMessage, /finished/i);
    assert.equal(fs.existsSync(activeFile()), false, "sentinel must be removed");
  });

  it("BLOCKED allows the stop but stays armed", () => {
    const out = runHook({ last_assistant_message: finalMessage("BLOCKED — delete or finish?") });
    assert.equal(out.decision, undefined);
    assert.match(out.systemMessage, /paused for you/i);
    assert.match(out.systemMessage, /delete or finish\?/);
    assert.equal(fs.existsSync(activeFile()), true, "sentinel must survive a BLOCKED pause");
  });

  it("re-prompts a missing control block, then lets the session stop", () => {
    for (let i = 1; i <= 3; i += 1) {
      const out = runHook({ last_assistant_message: `No marker here. Attempt ${i}.` });
      assert.equal(out.decision, "block", `re-prompt ${i}`);
      assert.match(out.reason, /without a `LOOP CONTROL` block/);
    }
    const out = runHook({ last_assistant_message: "Still no marker. Attempt 4." });
    assert.equal(out.decision, undefined);
    assert.match(out.systemMessage, /No LOOP CONTROL block/);
    assert.equal(fs.existsSync(activeFile()), true, "loop stays armed after giving up on a turn");
  });

  it("stops at the configured iteration cap", () => {
    const env = { CONTINUOUS_IMPROVEMENT_MAX_ITERATIONS: "2" };
    assert.equal(runHook({ last_assistant_message: finalMessage("CONTINUE — a") }, env).decision, "block");
    assert.equal(runHook({ last_assistant_message: finalMessage("CONTINUE — b") }, env).decision, "block");
    const out = runHook({ last_assistant_message: finalMessage("CONTINUE — c") }, env);
    assert.equal(out.decision, undefined);
    assert.match(out.systemMessage, /2-iteration cap/);
    assert.equal(fs.existsSync(activeFile()), false);
  });

  it("reads the cap from the project config file", () => {
    fs.writeFileSync(
      path.join(projectDir, ".claude", "continuous-improvement.config.json"),
      JSON.stringify({ maxIterations: 1 }),
      "utf8"
    );
    assert.equal(runHook({ last_assistant_message: finalMessage("CONTINUE — a") }).decision, "block");
    const out = runHook({ last_assistant_message: finalMessage("CONTINUE — b") });
    assert.match(out.systemMessage, /1-iteration cap/);
  });
});

describe("stop hook — inputs and robustness", () => {
  beforeEach(arm);

  it("falls back to the transcript when the payload has no last message", () => {
    const transcript = path.join(projectDir, "transcript.jsonl");
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({ type: "user", message: { content: "go" } }),
        // A subagent's message must never be mistaken for the turn's own.
        JSON.stringify({
          type: "assistant",
          isSidechain: true,
          message: { content: [{ type: "text", text: "NEXT-STEP: COMPLETE — subagent" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: finalMessage("CONTINUE — from transcript") }] },
        }),
        "",
      ].join("\n"),
      "utf8"
    );
    const out = runHook({ transcript_path: transcript });
    assert.equal(out.decision, "block");
    assert.match(out.reason, /from transcript/);
  });

  it("stands down when the turn ended abnormally", () => {
    const out = runHook({
      last_assistant_message: finalMessage("CONTINUE — go"),
      stop_reason: "max_tokens",
    });
    assert.equal(out.decision, undefined);
    assert.match(out.systemMessage, /stop_reason=max_tokens/);
    assert.equal(fs.existsSync(activeFile()), true);
    assert.equal(readState(), null, "a stand-down must not advance the loop");
  });

  it("counts a turn once even when the hook is registered twice", () => {
    const payload = { last_assistant_message: finalMessage("CONTINUE — only once") };
    assert.equal(runHook(payload).decision, "block");
    assert.deepEqual(runHook(payload), {}, "the second registration must stand down");
    assert.equal(readState().iteration, 1);
  });

  it("survives a corrupt state file by starting a fresh run", () => {
    fs.writeFileSync(
      path.join(projectDir, ".claude", "continuous-improvement.state.json"),
      "{ not json",
      "utf8"
    );
    const out = runHook({ last_assistant_message: finalMessage("CONTINUE — go") });
    assert.equal(out.decision, "block");
    assert.equal(readState().iteration, 1);
  });

  it("survives an empty payload", () => {
    const result = spawnSync(process.execPath, [HOOK], {
      input: "",
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).decision, "block", "no message = missing marker");
  });

  it("writes an auditable journal entry per decision", () => {
    runHook({ last_assistant_message: finalMessage("INVESTIGATE — plan empty"), session_id: "s1" });
    const journal = fs
      .readFileSync(path.join(projectDir, ".claude", "continuous-improvement", "journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const entry = journal.at(-1);
    assert.equal(entry.event, "decision");
    assert.equal(entry.trigger, "INVESTIGATE");
    assert.equal(entry.decision, "block");
    assert.equal(entry.angle, ANGLES[0].id);
    assert.equal(entry.validation, "pnpm test — green");
    assert.equal(entry.sessionId, "s1");
  });
});

describe("loop-ctl CLI", () => {
  /**
   * @param {string[]} args CLI arguments.
   * @returns {import("node:child_process").SpawnSyncReturns<string>} Result.
   */
  const ctl = (args) =>
    spawnSync(process.execPath, [path.join(SKILL_DIR, "bin", "loop-ctl.mjs"), ...args], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });

  it("enable arms the loop and disable disarms it", () => {
    assert.equal(ctl(["enable"]).status, 0);
    assert.equal(fs.existsSync(activeFile()), true);
    assert.match(ctl(["status"]).stdout, /armed:\s+yes/);

    assert.equal(ctl(["disable"]).status, 0);
    assert.equal(fs.existsSync(activeFile()), false);
    assert.match(ctl(["status"]).stdout, /armed:\s+no/);
  });

  it("enable starts a fresh run unless --keep-state is given", () => {
    ctl(["enable"]);
    runHook({ last_assistant_message: finalMessage("CONTINUE — one") });
    assert.equal(readState().iteration, 1);

    ctl(["enable", "--keep-state"]);
    assert.equal(readState().iteration, 1, "--keep-state resumes the run");

    ctl(["enable"]);
    assert.equal(readState().iteration, 0, "a plain enable resets the run");
  });

  it("enable --max writes the project config and rejects nonsense", () => {
    assert.equal(ctl(["enable", "--max", "7"]).status, 0);
    const config = JSON.parse(
      fs.readFileSync(path.join(projectDir, ".claude", "continuous-improvement.config.json"), "utf8")
    );
    assert.equal(config.maxIterations, 7);
    assert.equal(ctl(["enable", "--max", "zero"]).status, 1);
  });

  it("angles marks what has already been swept", () => {
    ctl(["enable"]);
    runHook({ last_assistant_message: finalMessage("INVESTIGATE — sweep") });
    const out = ctl(["angles"]).stdout;
    assert.match(out, new RegExp(`\\[x\\] ${ANGLES[0].id}`));
    assert.match(out, new RegExp(`\\[ \\] ${ANGLES[1].id}`));
    assert.match(out, new RegExp(`1/${ANGLES.length} swept`));
  });

  it("status --json is machine readable and journal tails the log", () => {
    ctl(["enable"]);
    runHook({ last_assistant_message: finalMessage("CONTINUE — x") });
    const status = JSON.parse(ctl(["status", "--json"]).stdout);
    assert.equal(status.armed, true);
    assert.equal(status.state.iteration, 1);
    assert.match(ctl(["journal", "-n", "1"]).stdout, /"reasonCode":"continue"/);
  });

  it("exits non-zero on an unknown subcommand", () => {
    assert.equal(ctl(["frobnicate"]).status, 1);
    assert.equal(ctl(["--help"]).status, 0);
  });
});

describe("install-global", () => {
  it("installs the skill and registers exactly one Stop hook, idempotently", () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ci-home-"));
    /**
     * @param {string[]} args Installer arguments.
     * @returns {import("node:child_process").SpawnSyncReturns<string>} Result.
     */
    const install = (args) =>
      spawnSync(
        process.execPath,
        [path.join(SKILL_DIR, "bin", "install-global.mjs"), "--home", fakeHome, ...args],
        { encoding: "utf8" }
      );
    const settingsFile = path.join(fakeHome, ".claude", "settings.json");
    /** @returns {any} Parsed settings. */
    const settings = () => JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    /**
     * @param {any} s Settings object.
     * @returns {any[]} Every Stop hook handler.
     */
    const stopHooks = (s) => (s.hooks?.Stop ?? []).flatMap((g) => g.hooks ?? []);

    try {
      assert.equal(install([]).status, 0);
      const target = path.join(fakeHome, ".claude", "skills", "continuous-improvement");
      assert.ok(fs.existsSync(path.join(target, "SKILL.md")));
      assert.ok(fs.existsSync(path.join(target, "hooks", "stop.mjs")));
      assert.ok(fs.existsSync(path.join(target, "LOOP_PROMPT.md")));
      assert.ok(
        fs.existsSync(path.join(target, "tests", "stop-hook.test.mjs")),
        "the install must carry its own tests — it is the only copy of the skill"
      );
      assert.equal(stopHooks(settings()).length, 1);

      assert.equal(install([]).status, 0);
      assert.equal(stopHooks(settings()).length, 1, "re-install must not duplicate the hook");

      // A pre-existing unrelated hook must survive install and uninstall.
      const existing = settings();
      existing.hooks.Stop.push({ hooks: [{ type: "command", command: "echo unrelated" }] });
      fs.writeFileSync(settingsFile, JSON.stringify(existing, null, 2), "utf8");
      assert.equal(install([]).status, 0);
      assert.equal(stopHooks(settings()).length, 2);

      assert.equal(install(["--uninstall"]).status, 0);
      assert.equal(fs.existsSync(target), false);
      const after = stopHooks(settings());
      assert.equal(after.length, 1);
      assert.equal(after[0].command, "echo unrelated");
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("refuses to touch a settings.json it cannot parse", () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "ci-home-"));
    try {
      fs.mkdirSync(path.join(fakeHome, ".claude"), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, ".claude", "settings.json"), "{ broken", "utf8");
      const result = spawnSync(
        process.execPath,
        [path.join(SKILL_DIR, "bin", "install-global.mjs"), "--home", fakeHome],
        { encoding: "utf8" }
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /not valid JSON/);
      assert.equal(fs.readFileSync(path.join(fakeHome, ".claude", "settings.json"), "utf8"), "{ broken");
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
