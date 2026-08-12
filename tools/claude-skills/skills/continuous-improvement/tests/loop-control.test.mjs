/**
 * Unit tests for the continuous-improvement loop's pure logic.
 * Run from this skill's directory: node --test 'tests/*.test.mjs'
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ANGLES, formatAngle, getAngle, nextAngle } from "../lib/angles.mjs";
import {
  DEFAULT_CONFIG,
  STATE_VERSION,
  TRIGGERS,
  buildFollowUp,
  createState,
  decide,
  normalizeState,
  parseControl,
} from "../lib/loop-control.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_TEXT = fs.readFileSync(path.join(SKILL_DIR, "LOOP_PROMPT.md"), "utf8");

/**
 * Build a message ending with a control block.
 *
 * @param {string} line The `NEXT-STEP:` line without the prefix.
 * @param {string} [preamble] Text before the block.
 * @returns {string} A realistic final assistant message.
 */
const message = (line, preamble = "Did the work.") =>
  `${preamble}\n\n=== LOOP CONTROL ===\nITERATION-SUMMARY: did a thing\nVALIDATION: pnpm test — green\nCAPTURED: none\nNEXT-STEP: ${line}\n`;

describe("parseControl", () => {
  it("parses each trigger word", () => {
    for (const trigger of TRIGGERS) {
      const control = parseControl(message(`${trigger} — because reasons`));
      assert.equal(control?.trigger, trigger);
      assert.equal(control?.detail, "because reasons");
      assert.equal(control?.placement, "final");
    }
  });

  it("returns null when there is no marker", () => {
    assert.equal(parseControl("Just some prose about next steps."), null);
    assert.equal(parseControl(""), null);
    assert.equal(parseControl(null), null);
    assert.equal(parseControl(undefined), null);
  });

  it("takes the LAST marker so quoted examples do not win", () => {
    const msg = [
      "Here is the protocol I follow:",
      "",
      "```",
      "NEXT-STEP: COMPLETE — example from the docs",
      "NEXT-STEP: BLOCKED — another example",
      "```",
      "",
      "NEXT-STEP: CONTINUE — the real one",
    ].join("\n");
    const control = parseControl(msg);
    assert.equal(control?.trigger, "CONTINUE");
    assert.equal(control?.detail, "the real one");
  });

  it("tolerates quote/list prefixes, casing and separator variants", () => {
    assert.equal(parseControl("> NEXT-STEP: continue - lowercase")?.trigger, "CONTINUE");
    assert.equal(parseControl("- NEXT-STEP: Investigate: colon")?.trigger, "INVESTIGATE");
    assert.equal(parseControl("   NEXT-STEP:COMPLETE done")?.trigger, "COMPLETE");
    assert.equal(parseControl("NEXT-STEP: BLOCKED – en dash")?.detail, "en dash");
  });

  it("does not match a trigger word embedded in a longer token", () => {
    assert.equal(parseControl("NEXT-STEP: CONTINUEDLY unclear"), null);
  });

  it("extracts an explicit angle request and strips it from the detail", () => {
    const control = parseControl("NEXT-STEP: INVESTIGATE [angle:security-and-secrets] — proxy logs");
    assert.equal(control?.requestedAngle, "security-and-secrets");
    assert.equal(control?.detail, "proxy logs");
  });

  it("classifies placement by how much text follows the marker", () => {
    assert.equal(parseControl("NEXT-STEP: CONTINUE — x")?.placement, "final");
    assert.equal(parseControl("NEXT-STEP: CONTINUE — x\n\nps. one more line")?.placement, "trailing");
    const long = `NEXT-STEP: CONTINUE — x\n${"filler\n".repeat(20)}`;
    assert.equal(parseControl(long)?.placement, "scattered");
  });

  it("captures the companion fields for the journal", () => {
    const control = parseControl(message("CONTINUE — next"));
    assert.equal(control?.fields.summary, "did a thing");
    assert.equal(control?.fields.validation, "pnpm test — green");
    assert.equal(control?.fields.captured, "none");
  });

  it("handles a bare trigger with no detail", () => {
    const control = parseControl("NEXT-STEP: COMPLETE");
    assert.equal(control?.trigger, "COMPLETE");
    assert.equal(control?.detail, "");
  });
});

describe("normalizeState", () => {
  it("resets on a version mismatch rather than migrating blindly", () => {
    const state = normalizeState({ version: 0, iteration: 99, usedAngles: ["x"] });
    assert.equal(state.version, STATE_VERSION);
    assert.equal(state.iteration, 0);
    assert.deepEqual(state.usedAngles, []);
  });

  it("resets on junk input", () => {
    for (const junk of [null, undefined, 42, "nope", []]) {
      assert.equal(normalizeState(junk).iteration, 0);
    }
  });

  it("drops fields with impossible values instead of trusting them", () => {
    const state = normalizeState({
      version: STATE_VERSION,
      iteration: -5,
      missingMarkerStreak: "many",
      mode: "hyperdrive",
      usedAngles: ["ok", 7, null],
    });
    assert.equal(state.iteration, 0);
    assert.equal(state.missingMarkerStreak, 0);
    assert.equal(state.mode, "implement");
    assert.deepEqual(state.usedAngles, ["ok"]);
  });

  it("round-trips a valid state", () => {
    const original = { ...createState(), iteration: 3, usedAngles: [ANGLES[0].id] };
    assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(original))), original);
  });
});

describe("decide", () => {
  /**
   * @param {string | null} line Control line, or `null` for a missing marker.
   * @param {Partial<import("../lib/loop-control.mjs").LoopState>} [patch] State overrides.
   * @param {Partial<import("../lib/loop-control.mjs").LoopConfig>} [configPatch] Config overrides.
   * @returns {{state: import("../lib/loop-control.mjs").LoopState, verdict: import("../lib/loop-control.mjs").Verdict}} Result.
   */
  const run = (line, patch = {}, configPatch = {}) =>
    decide({
      state: { ...createState(), ...patch },
      control: line === null ? null : parseControl(`NEXT-STEP: ${line}`),
      config: { ...DEFAULT_CONFIG, ...configPatch },
      now: "2026-08-10T00:00:00.000Z",
    });

  it("CONTINUE blocks in implement mode and advances the iteration", () => {
    const { state, verdict } = run("CONTINUE — fix the drift stamp");
    assert.equal(verdict.decision, "block");
    assert.equal(verdict.reasonCode, "continue");
    assert.equal(verdict.mode, "implement");
    assert.equal(verdict.carry, "fix the drift stamp");
    assert.equal(state.iteration, 1);
    assert.equal(verdict.deactivate, false);
  });

  it("INVESTIGATE hands out the first unused angle and records it", () => {
    const { state, verdict } = run("INVESTIGATE — plan empty");
    assert.equal(verdict.decision, "block");
    assert.equal(verdict.mode, "investigate");
    assert.equal(verdict.angle?.id, ANGLES[0].id);
    assert.deepEqual(state.usedAngles, [ANGLES[0].id]);
  });

  it("never repeats an angle", () => {
    let state = createState();
    const seen = [];
    for (let i = 0; i < ANGLES.length; i += 1) {
      const result = decide({ state, control: parseControl("NEXT-STEP: INVESTIGATE — again") });
      state = result.state;
      seen.push(result.verdict.angle?.id);
    }
    assert.equal(new Set(seen).size, ANGLES.length);
    assert.deepEqual([...seen].sort(), ANGLES.map((a) => a.id).sort());
  });

  it("honours an explicit angle request", () => {
    const { verdict } = run("INVESTIGATE [angle:security-and-secrets] — targeted");
    assert.equal(verdict.angle?.id, "security-and-secrets");
  });

  it("ignores an unknown or already-used angle request", () => {
    assert.equal(run("INVESTIGATE [angle:does-not-exist] — x").verdict.angle?.id, ANGLES[0].id);
    const used = [ANGLES[0].id];
    const { verdict } = run(`INVESTIGATE [angle:${ANGLES[0].id}] — x`, { usedAngles: used });
    assert.equal(verdict.angle?.id, ANGLES[1].id);
  });

  it("nudges once for close-out when the catalogue is exhausted, then ends the loop", () => {
    const exhausted = { usedAngles: ANGLES.map((a) => a.id) };
    const first = run("INVESTIGATE — nothing left", exhausted);
    assert.equal(first.verdict.decision, "block");
    assert.equal(first.verdict.mode, "closeout");

    const second = run("INVESTIGATE — still nothing", {
      ...exhausted,
      anglesExhaustedNudges: first.state.anglesExhaustedNudges,
    });
    assert.equal(second.verdict.decision, "allow");
    assert.equal(second.verdict.reasonCode, "angles-exhausted");
    assert.equal(second.verdict.deactivate, true);
  });

  it("COMPLETE allows the stop and disarms the loop", () => {
    const { verdict } = run("COMPLETE — everything green");
    assert.equal(verdict.decision, "allow");
    assert.equal(verdict.reasonCode, "complete");
    assert.equal(verdict.deactivate, true);
  });

  it("BLOCKED allows the stop but stays armed for the human's answer", () => {
    const { verdict } = run("BLOCKED — delete the abandoned refresher?");
    assert.equal(verdict.decision, "allow");
    assert.equal(verdict.reasonCode, "blocked");
    assert.equal(verdict.deactivate, false);
  });

  it("honours COMPLETE even past the iteration cap", () => {
    const { verdict } = run("COMPLETE — done", { iteration: 999 }, { maxIterations: 3 });
    assert.equal(verdict.reasonCode, "complete");
  });

  it("stops at the iteration cap regardless of what the agent reports", () => {
    const { verdict } = run("CONTINUE — one more", { iteration: 3 }, { maxIterations: 3 });
    assert.equal(verdict.decision, "allow");
    assert.equal(verdict.reasonCode, "iteration-cap");
    assert.equal(verdict.deactivate, true);
  });

  it("re-prompts a missing marker N times without burning iterations, then gives up", () => {
    let state = createState();
    for (let i = 1; i <= DEFAULT_CONFIG.maxMissingMarker; i += 1) {
      const result = decide({ state, control: null });
      state = result.state;
      assert.equal(result.verdict.decision, "block", `re-prompt ${i}`);
      assert.equal(result.verdict.reasonCode, "missing-marker");
      assert.equal(state.iteration, 0, "missing markers must not advance the iteration");
    }
    const final = decide({ state, control: null });
    assert.equal(final.verdict.decision, "allow");
    assert.equal(final.verdict.reasonCode, "missing-marker-cap");
    assert.equal(final.verdict.deactivate, false, "the loop stays armed for the next turn");
  });

  it("resets the missing-marker streak once a marker comes back", () => {
    const { state } = decide({
      state: { ...createState(), missingMarkerStreak: 2 },
      control: parseControl("NEXT-STEP: CONTINUE — back on track"),
    });
    assert.equal(state.missingMarkerStreak, 0);
  });

  it("flags a scattered control block without discarding it", () => {
    const control = parseControl(`NEXT-STEP: CONTINUE — x\n${"filler\n".repeat(20)}`);
    const { verdict } = decide({ state: createState(), control });
    assert.equal(verdict.decision, "block");
    assert.match(String(verdict.note), /not near the end/i);
  });

  it("journals every decision and bounds the history", () => {
    let state = { ...createState(), history: Array.from({ length: 100 }, (_, i) => ({ i })) };
    const result = decide({ state, control: parseControl("NEXT-STEP: CONTINUE — x") });
    assert.equal(result.state.history.length, 100);
    assert.equal(result.state.history.at(-1).reasonCode, "continue");
  });

  it("does not mutate the state it is given", () => {
    const state = createState();
    const frozen = JSON.stringify(state);
    decide({ state, control: parseControl("NEXT-STEP: INVESTIGATE — x") });
    assert.equal(JSON.stringify(state), frozen);
  });
});

describe("buildFollowUp", () => {
  /**
   * @param {string} line Control line.
   * @param {Partial<import("../lib/loop-control.mjs").LoopState>} [patch] State overrides.
   * @returns {string} Rendered follow-up.
   */
  const render = (line, patch = {}) => {
    const { state, verdict } = decide({
      state: { ...createState(), ...patch },
      control: parseControl(`NEXT-STEP: ${line}`),
    });
    return buildFollowUp({ verdict, state, config: DEFAULT_CONFIG, promptText: PROMPT_TEXT });
  };

  it("re-injects the whole prompt so it survives compaction", () => {
    const out = render("CONTINUE — next thing");
    assert.ok(out.includes("CONTINUE IMPLEMENTATION AND BEST NEXT STEPS"));
    assert.ok(out.includes("At the end of every turn, ask"));
  });

  it("carries the agent's own next step into the implement prompt", () => {
    assert.match(render("CONTINUE — fix the drift stamp"), /fix the drift stamp/);
    assert.match(render("CONTINUE — x"), /IMPLEMENT/);
  });

  it("injects the angle checklist in investigate mode", () => {
    const out = render("INVESTIGATE — plan empty");
    assert.match(out, /INVESTIGATE/);
    assert.ok(out.includes(ANGLES[0].id));
    for (const check of ANGLES[0].checks) assert.ok(out.includes(check), check);
  });

  it("asks for a close-out when the catalogue is exhausted", () => {
    const out = render("INVESTIGATE — nothing", { usedAngles: ANGLES.map((a) => a.id) });
    assert.match(out, /close-out/i);
    assert.match(out, /Do not emit `INVESTIGATE` again/);
  });

  it("explains the format when the marker was missing", () => {
    const { state, verdict } = decide({ state: createState(), control: null });
    const out = buildFollowUp({ verdict, state, config: DEFAULT_CONFIG, promptText: PROMPT_TEXT });
    assert.match(out, /without a `LOOP CONTROL` block/);
    assert.match(out, /Do not redo the work/);
  });
});

describe("angles catalogue", () => {
  it("has unique, kebab-case ids and non-empty checklists", () => {
    const ids = ANGLES.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length, "angle ids must be unique");
    for (const angle of ANGLES) {
      assert.match(angle.id, /^[a-z][a-z0-9-]*$/, angle.id);
      assert.ok(angle.title.length > 0, angle.id);
      assert.ok(angle.focus.length > 0, angle.id);
      assert.ok(angle.checks.length >= 3, `${angle.id} needs a real checklist`);
    }
  });

  it("nextAngle returns null only once every angle is used", () => {
    assert.equal(nextAngle(ANGLES.slice(0, -1).map((a) => a.id))?.id, ANGLES.at(-1)?.id);
    assert.equal(nextAngle(ANGLES.map((a) => a.id)), null);
  });

  it("getAngle looks up by id", () => {
    assert.equal(getAngle(ANGLES[0].id)?.title, ANGLES[0].title);
    assert.equal(getAngle("nope"), undefined);
  });

  it("formatAngle renders the id, focus and every check", () => {
    const out = formatAngle(ANGLES[0]);
    assert.ok(out.includes(ANGLES[0].id));
    assert.ok(out.includes(ANGLES[0].focus));
    for (const check of ANGLES[0].checks) assert.ok(out.includes(check));
  });

  it("stays in sync with REFERENCE.md (docs drift is a bug, not a nit)", () => {
    const reference = fs.readFileSync(path.join(SKILL_DIR, "REFERENCE.md"), "utf8");
    for (const angle of ANGLES) {
      assert.ok(reference.includes(`\`${angle.id}\``), `REFERENCE.md is missing ${angle.id}`);
    }
    const documented = [...reference.matchAll(/^\| \d+ \| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
    assert.deepEqual(documented, ANGLES.map((a) => a.id), "catalogue order must match REFERENCE.md");
  });
});
