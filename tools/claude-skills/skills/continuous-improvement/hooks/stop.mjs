#!/usr/bin/env node
/**
 * stop.mjs — `Stop` hook driving the continuous-improvement loop.
 *
 * Claude Code runs this when a turn ends. It reads the turn's final assistant message,
 * looks for the `LOOP CONTROL` block specified in `../LOOP_PROMPT.md`, and decides whether
 * the session may stop:
 *
 * | Trigger        | Hook output                                                        |
 * |----------------|--------------------------------------------------------------------|
 * | `CONTINUE`     | `decision: "block"` → next iteration in IMPLEMENT mode              |
 * | `INVESTIGATE`  | `decision: "block"` → next iteration in INVESTIGATE mode, new angle |
 * | `COMPLETE`     | stop allowed, loop deactivated                                      |
 * | `BLOCKED`      | stop allowed, loop stays armed for when the human answers            |
 * | (none)         | `decision: "block"` re-prompting for the block, up to N times        |
 *
 * Design rules, in priority order:
 *
 * 1. **Opt-in.** Does nothing unless `<project>/.claude/continuous-improvement.active`
 *    exists. A hook installed globally must be inert in every project that did not ask
 *    for it.
 * 2. **Fail open.** Any internal error lets the session stop. A broken hook must never
 *    trap a session in a loop; the failure is surfaced via `systemMessage` and the journal.
 *    (Note the asymmetry with the rest of this repository, which fails *closed*: here the
 *    dangerous failure mode is "cannot stop", not "stopped early".)
 * 3. **Bounded.** Iteration cap, missing-marker cap and single-use investigation angles
 *    all bound the run independently of what the agent reports.
 *
 * All decision logic lives in `../lib/loop-control.mjs` so it can be unit-tested; this file
 * is the I/O shell. Kept dependency-free (node: builtins only) so it also works when
 * installed to `~/.claude` outside any repository.
 *
 * Usage: invoked by Claude Code with the hook payload on stdin. See `../REFERENCE.md`.
 *
 * @module continuous-improvement/hooks/stop
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CONFIG,
  buildFollowUp,
  createState,
  decide,
  normalizeState,
  parseControl,
} from "../lib/loop-control.mjs";

const HOOK_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HOOK_DIR, "..");

/** Sentinel + state file names, all under `<project>/.claude/`. */
const PATHS = Object.freeze({
  active: "continuous-improvement.active",
  state: "continuous-improvement.state.json",
  config: "continuous-improvement.config.json",
  journal: path.join("continuous-improvement", "journal.jsonl"),
  turns: path.join("continuous-improvement", "turns"),
});

/** Turn locks older than this are pruned; they only exist to de-duplicate one turn. */
const TURN_LOCK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `stop_reason` values that mean the turn did not end normally. Looping on these would
 * re-prompt into the same wall, so the hook stands down and lets the session stop.
 *
 * @type {ReadonlySet<string>}
 */
const ABORTED_STOP_REASONS = new Set(["max_tokens", "refusal", "error", "aborted", "cancelled"]);

/**
 * Read all of stdin.
 *
 * @returns {Promise<string>} Raw stdin, or `""` when nothing is piped.
 */
async function readStdin() {
  if (process.stdin.isTTY) return "";
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Parse JSON without throwing.
 *
 * @param {string} raw Candidate JSON.
 * @param {unknown} [fallback] Value returned on parse failure.
 * @returns {unknown} Parsed value or `fallback`.
 */
function parseJsonSafe(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Read a JSON file without throwing.
 *
 * @param {string} file Absolute path.
 * @returns {unknown} Parsed contents, or `null` when missing/unreadable/invalid.
 */
function readJsonFile(file) {
  try {
    return parseJsonSafe(fs.readFileSync(file, "utf8"), null);
  } catch {
    return null;
  }
}

/**
 * Resolve the project root the loop is armed in.
 *
 * Prefers `CLAUDE_PROJECT_DIR` (set by Claude Code for hooks), then the payload's `cwd`,
 * then the process cwd. Never derives it from the hook's own location: when installed
 * globally the hook lives in `~/.claude`, which is not the project.
 *
 * @param {Record<string, unknown>} payload Hook payload.
 * @returns {string} Absolute project directory.
 */
function resolveProjectDir(payload) {
  const fromEnv = process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv && fromEnv.trim() !== "") return path.resolve(fromEnv);
  if (typeof payload.cwd === "string" && payload.cwd.trim() !== "") return path.resolve(payload.cwd);
  return process.cwd();
}

/**
 * Extract the turn's final assistant text.
 *
 * Uses the payload's `last_assistant_message` when present (Claude Code supplies it for
 * `Stop`), and otherwise walks the transcript backwards. The transcript path exists on
 * every version, so the fallback keeps the hook working on older clients.
 *
 * @param {Record<string, unknown>} payload Hook payload.
 * @returns {{text: string, source: "payload"|"transcript"|"none"}} Message and where it came from.
 */
function lastAssistantMessage(payload) {
  const direct = payload.last_assistant_message;
  if (typeof direct === "string" && direct.trim() !== "") return { text: direct, source: "payload" };

  const transcript = payload.transcript_path;
  if (typeof transcript !== "string" || transcript.trim() === "") return { text: "", source: "none" };

  try {
    const lines = fs.readFileSync(transcript, "utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i].trim();
      if (line === "") continue;
      const entry = /** @type {any} */ (parseJsonSafe(line, null));
      // Sidechain entries belong to subagents, not to the turn that is trying to stop.
      if (!entry || entry.type !== "assistant" || entry.isSidechain) continue;
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      const text = content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text !== "") return { text, source: "transcript" };
    }
  } catch {
    /* fall through to "none" — treated as a missing marker, which is re-prompted, not fatal */
  }
  return { text: "", source: "none" };
}

/**
 * Load loop bounds: defaults, overridden by the project config file, overridden by env.
 *
 * @param {string} claudeDir Absolute path to `<project>/.claude`.
 * @returns {import("../lib/loop-control.mjs").LoopConfig} Effective configuration.
 */
function loadConfig(claudeDir) {
  const fromFile = /** @type {Record<string, unknown>} */ (
    readJsonFile(path.join(claudeDir, PATHS.config)) ?? {}
  );
  /**
   * @param {string} key Config key.
   * @param {string} envVar Environment override.
   * @returns {number} Effective positive integer, or the default.
   */
  const pick = (key, envVar) => {
    const candidates = [process.env[envVar], fromFile[key]];
    for (const candidate of candidates) {
      const n = Number(candidate);
      if (Number.isInteger(n) && n >= 0) return n;
    }
    return /** @type {Record<string, number>} */ (DEFAULT_CONFIG)[key];
  };
  return {
    maxIterations: pick("maxIterations", "CONTINUOUS_IMPROVEMENT_MAX_ITERATIONS"),
    maxMissingMarker: pick("maxMissingMarker", "CONTINUOUS_IMPROVEMENT_MAX_MISSING_MARKER"),
    maxAnglesExhaustedNudges: pick(
      "maxAnglesExhaustedNudges",
      "CONTINUOUS_IMPROVEMENT_MAX_CLOSEOUT_NUDGES"
    ),
  };
}

/**
 * Append one line to the decision journal. Best effort — journalling must never break the hook.
 *
 * @param {string} claudeDir Absolute path to `<project>/.claude`.
 * @param {object} entry Serialisable journal entry.
 * @returns {void}
 */
function journal(claudeDir, entry) {
  try {
    const file = path.join(claudeDir, PATHS.journal);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

/**
 * Claim this turn, so exactly one hook process decides it.
 *
 * The hook can legitimately be registered twice — once in the project's
 * `.claude/settings.json` (committed, works for anyone who clones) and once in
 * `~/.claude/settings.json` (installed globally). Both fire on the same `Stop` event and
 * would each advance the iteration counter. The claim is a `wx` file create, which is
 * atomic on POSIX: the first process wins, later ones stand down with a no-op.
 *
 * Keyed on the session plus a digest of the final message rather than on `prompt_id`,
 * because a hook-continued turn can carry the same prompt id as the turn that spawned it.
 *
 * An empty message is **not** claimed. Its digest is a constant, so two different turns that
 * both failed to yield a message would collide: the second would look like a duplicate of
 * the first and stand down, ending the loop instead of re-prompting for the missing control
 * block. Skipping the claim costs nothing — a message-less turn never advances the iteration
 * counter, so a double-registered hook can only shorten the missing-marker streak, which is
 * capped anyway.
 *
 * @param {string} claudeDir Absolute path to `<project>/.claude`.
 * @param {string | null} sessionId Session id from the payload.
 * @param {string} message The turn's final assistant message.
 * @returns {boolean} `true` when this process owns the turn.
 */
function claimTurn(claudeDir, sessionId, message) {
  if (message.trim() === "") return true;
  const key = crypto
    .createHash("sha256")
    .update(`${sessionId ?? "no-session"} ${message}`)
    .digest("hex")
    .slice(0, 32);
  const dir = path.join(claudeDir, PATHS.turns);
  try {
    fs.mkdirSync(dir, { recursive: true });
    pruneTurnLocks(dir);
    fs.writeFileSync(path.join(dir, `${key}.lock`), `${new Date().toISOString()}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return true;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err)?.code === "EEXIST") return false;
    // Any other failure (read-only fs, permissions) must not stop the loop working; the
    // worst case is the duplicate-registration double count, which the caps still bound.
    return true;
  }
}

/**
 * Delete turn locks past {@link TURN_LOCK_TTL_MS}. Best effort.
 *
 * @param {string} dir Turn lock directory.
 * @returns {void}
 */
function pruneTurnLocks(dir) {
  try {
    const cutoff = Date.now() - TURN_LOCK_TTL_MS;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    }
  } catch {
    /* ignore */
  }
}

/**
 * Emit the hook result and exit 0.
 *
 * Exit 0 is always correct here: Claude Code only parses stdout JSON on exit 0, and
 * `decision: "block"` is how a Stop hook continues the conversation. A non-zero exit would
 * turn a considered decision into an error notice.
 *
 * Written with `fs.writeSync` rather than `process.stdout.write`, because the payload is
 * large — a blocking decision carries the entire loop prompt, ~9 KB — and
 * `process.stdout.write` to a pipe can complete asynchronously, which `process.exit()` on
 * the next line would cut short. Truncated JSON reads to Claude Code as a malformed hook
 * result, so the flush has to be guaranteed before exiting. `EAGAIN` is retried because a
 * non-blocking pipe can refuse a partial write when the reader is briefly behind.
 *
 * @param {object} output Hook JSON output.
 * @returns {never} Exits the process.
 */
function emit(output) {
  const buffer = Buffer.from(`${JSON.stringify(output)}\n`, "utf8");
  let written = 0;
  while (written < buffer.length) {
    try {
      written += fs.writeSync(1, buffer, written, buffer.length - written);
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
      if (code === "EAGAIN") continue;
      // Nothing useful is left to do if stdout is gone; exiting 0 keeps the failure
      // non-blocking for the session, which is the fail-open rule for this hook.
      break;
    }
  }
  process.exit(0);
}

/**
 * Hook entry point.
 *
 * @returns {Promise<void>} Never resolves — always exits via {@link emit}.
 */
async function main() {
  const payload = /** @type {Record<string, unknown>} */ (
    parseJsonSafe(await readStdin(), {}) ?? {}
  );

  if (process.env.CONTINUOUS_IMPROVEMENT_DISABLE === "1") emit({});

  const projectDir = resolveProjectDir(payload);
  const claudeDir = path.join(projectDir, ".claude");
  const activeFile = path.join(claudeDir, PATHS.active);

  const armed = fs.existsSync(activeFile) || process.env.CONTINUOUS_IMPROVEMENT_ACTIVE === "1";
  if (!armed) emit({});

  const stopReason = typeof payload.stop_reason === "string" ? payload.stop_reason : null;
  if (stopReason && ABORTED_STOP_REASONS.has(stopReason)) {
    journal(claudeDir, { at: new Date().toISOString(), event: "stand-down", stopReason });
    emit({
      systemMessage: `Continuous-improvement loop stood down: turn ended with stop_reason=${stopReason}. The loop is still armed.`,
    });
  }

  const promptFile = path.join(SKILL_DIR, "LOOP_PROMPT.md");
  let promptText;
  try {
    promptText = fs.readFileSync(promptFile, "utf8");
  } catch {
    journal(claudeDir, { at: new Date().toISOString(), event: "error", error: "prompt-missing", promptFile });
    emit({
      systemMessage: `Continuous-improvement loop disarmed: ${promptFile} is unreadable, so the loop prompt cannot be re-injected.`,
    });
  }

  const now = new Date().toISOString();
  const sessionId = typeof payload.session_id === "string" ? payload.session_id : null;
  const config = loadConfig(claudeDir);
  const stateFile = path.join(claudeDir, PATHS.state);
  const state = normalizeState(readJsonFile(stateFile), { now, sessionId });

  const { text: message, source } = lastAssistantMessage(payload);

  if (!claimTurn(claudeDir, sessionId, message)) {
    // Another registration of this same hook already decided this turn.
    emit({});
  }

  const control = parseControl(message);
  const { state: nextState, verdict } = decide({ state, control, config, now });

  // Persist before emitting: if the write fails the loop must not advance silently.
  try {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(stateFile, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  } catch (err) {
    journal(claudeDir, {
      at: now,
      event: "error",
      error: "state-write-failed",
      message: String(err),
    });
    emit({
      systemMessage: `Continuous-improvement loop stopped: could not write ${stateFile} (${String(err)}).`,
    });
  }

  journal(claudeDir, {
    at: now,
    event: "decision",
    sessionId,
    iteration: nextState.iteration,
    messageSource: source,
    trigger: control?.trigger ?? null,
    placement: control?.placement ?? null,
    detail: control?.detail ?? null,
    validation: control?.fields.validation ?? null,
    captured: control?.fields.captured ?? null,
    decision: verdict.decision,
    reasonCode: verdict.reasonCode,
    mode: verdict.mode,
    angle: verdict.angle?.id ?? null,
  });

  if (verdict.deactivate) {
    try {
      fs.rmSync(activeFile, { force: true });
    } catch {
      /* the state file still records the terminal decision */
    }
  }

  if (verdict.decision === "allow") {
    const summary = {
      complete: `Continuous-improvement loop finished after ${nextState.iteration} iteration(s): ${control?.detail || "reported COMPLETE"}`,
      blocked: `Continuous-improvement loop paused for you after ${nextState.iteration} iteration(s): ${control?.detail || "reported BLOCKED"}`,
    };
    const note =
      /** @type {Record<string, string>} */ (summary)[verdict.reasonCode] ?? verdict.note ?? null;
    emit(note ? { systemMessage: note } : {});
  }

  emit({
    decision: "block",
    reason: buildFollowUp({ verdict, state: nextState, config, promptText }),
    ...(verdict.note ? { systemMessage: verdict.note } : {}),
  });
}

main().catch((err) => {
  // Last-resort fail-open: never trap the session because of a bug in here.
  process.stderr.write(`continuous-improvement stop hook failed: ${String(err?.stack ?? err)}\n`);
  emit({ systemMessage: `Continuous-improvement loop skipped this turn: ${String(err)}` });
});
