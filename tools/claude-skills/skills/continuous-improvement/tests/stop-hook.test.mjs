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

  it("emits the whole blocking payload without truncation", () => {
    // The reason carries the entire loop prompt (~9 KB). stdout to a pipe can flush
    // asynchronously, so an exit that does not wait would cut the JSON in half and Claude
    // Code would see a malformed hook result rather than a decision.
    const out = runHook({ last_assistant_message: finalMessage("CONTINUE — big payload") });
    assert.equal(out.decision, "block");
    assert.ok(out.reason.length > 8000, `reason was only ${out.reason.length} bytes`);
    assert.match(
      out.reason.trimEnd(),
      /is a valid, useful outcome\.$/,
      "the reason must end with the prompt's own last line, not mid-stream"
    );
  });

  it("re-prompts twice in a row when the turn yields no message at all", () => {
    // Two message-less turns hash identically, so a naive per-turn claim would treat the
    // second as a duplicate and let the session stop instead of re-prompting.
    const first = runHook({});
    assert.equal(first.decision, "block");
    const second = runHook({});
    assert.equal(second.decision, "block", "the second empty turn must still be re-prompted");
    assert.equal(readState().missingMarkerStreak, 2);
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

  it("trims the journal instead of letting it grow forever", () => {
    const journalFile = path.join(projectDir, ".claude", "continuous-improvement", "journal.jsonl");
    fs.mkdirSync(path.dirname(journalFile), { recursive: true });
    // One line per Stop event, forever, in a directory nobody cleans: write past the 1 MB
    // rotation threshold and confirm the next decision trims it.
    const filler = `${JSON.stringify({ event: "old", pad: "x".repeat(400) })}\n`;
    fs.writeFileSync(journalFile, filler.repeat(3000), "utf8");
    assert.ok(fs.statSync(journalFile).size > 1024 * 1024);

    runHook({ last_assistant_message: finalMessage("CONTINUE — after a long run") });

    const lines = fs.readFileSync(journalFile, "utf8").trim().split("\n");
    assert.ok(lines.length <= 501, `journal kept ${lines.length} lines`);
    assert.ok(fs.statSync(journalFile).size < 1024 * 1024);
    assert.equal(JSON.parse(lines.at(-1)).event, "decision", "the newest entry survives");
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

  it("doctor passes when everything is in place, and warns when unarmed", () => {
    const out = ctl(["doctor"]);
    assert.equal(out.status, 0, out.stdout);
    assert.match(out.stdout, /\[warn\] armed for this project/);
    assert.match(out.stdout, /arm it with/);

    ctl(["enable"]);
    const armedOut = ctl(["doctor"]);
    assert.equal(armedOut.status, 0);
    assert.match(armedOut.stdout, /loop is ready and armed/);
  });

  it("doctor fails, with a non-zero exit, when the kill switch is set", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(SKILL_DIR, "bin", "loop-ctl.mjs"), "doctor"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: projectDir,
          CONTINUOUS_IMPROVEMENT_DISABLE: "1",
        },
      }
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[FAIL\] kill switch off/);
    assert.match(result.stdout, /the loop will not run/);
  });

  it("exits non-zero on an unknown subcommand", () => {
    assert.equal(ctl(["frobnicate"]).status, 1);
    assert.equal(ctl(["--help"]).status, 0);
  });
});
