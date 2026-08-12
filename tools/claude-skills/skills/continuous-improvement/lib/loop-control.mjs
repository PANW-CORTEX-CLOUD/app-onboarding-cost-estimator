/**
 * loop-control.mjs — Pure logic for the continuous-improvement loop.
 *
 * Everything in this module is deterministic and side-effect free: parsing the agent's
 * end-of-turn control block, advancing the loop state machine, and rendering the follow-up
 * prompt. The Stop hook (`../hooks/stop.mjs`) owns all I/O — stdin, files, clock — and
 * calls into here. That split is what makes the loop unit-testable without spawning a
 * session.
 *
 * The protocol itself is specified in `../LOOP_PROMPT.md` (PART 2). If the wording of the
 * control block changes there, {@link CONTROL_LINE_RE} changes here, and the tests in
 * `../tests/loop-control.test.mjs` must be updated in the same commit.
 *
 * @module continuous-improvement/loop-control
 */

import { formatAngle, nextAngle } from "./angles.mjs";

/**
 * The four trigger words the agent may emit. Anything else is "no marker".
 *
 * @type {readonly ["CONTINUE", "INVESTIGATE", "COMPLETE", "BLOCKED"]}
 */
export const TRIGGERS = Object.freeze(["CONTINUE", "INVESTIGATE", "COMPLETE", "BLOCKED"]);

/**
 * Matches a control line anywhere in the message, at line start (leading whitespace and
 * markdown blockquote/list prefixes tolerated). Deliberately permissive about the separator
 * between trigger and detail so an em dash, hyphen or colon all work.
 *
 * @type {RegExp}
 */
export const CONTROL_LINE_RE =
  /^[ \t>*-]*NEXT-STEP:[ \t]*(CONTINUE|INVESTIGATE|COMPLETE|BLOCKED)\b(.*)$/gim;

/** Matches an explicit angle request, e.g. `[angle:security-and-secrets]`. */
const ANGLE_REQUEST_RE = /\[angle:\s*([a-z0-9][a-z0-9-]*)\s*\]/i;

/** How many trailing non-empty lines still count as a well-placed control block. */
const TRAILING_WINDOW = 8;

/**
 * Loop configuration. Every bound exists so a misbehaving iteration cannot loop forever.
 *
 * @typedef {object} LoopConfig
 * @property {number} maxIterations Hard cap on loop iterations before the hook lets the
 *                                  session stop. Bounds cost, not correctness.
 * @property {number} maxMissingMarker Consecutive turns without a control block that are
 *                                  re-prompted before giving up and allowing the stop.
 * @property {number} maxAnglesExhaustedNudges Times the agent is told to close out after
 *                                  the angle catalogue is exhausted before the hook ends
 *                                  the loop itself.
 */

/**
 * Defaults for {@link LoopConfig}. Overridable per project via
 * `.claude/continuous-improvement.config.json` and per run via environment variables — see
 * `../REFERENCE.md`.
 *
 * @type {Readonly<LoopConfig>}
 */
export const DEFAULT_CONFIG = Object.freeze({
  maxIterations: 40,
  maxMissingMarker: 3,
  maxAnglesExhaustedNudges: 1,
});

/**
 * Parsed end-of-turn control block.
 *
 * @typedef {object} Control
 * @property {"CONTINUE"|"INVESTIGATE"|"COMPLETE"|"BLOCKED"} trigger The trigger word.
 * @property {string} detail Free-text one-liner after the trigger (separators stripped).
 * @property {string | null} requestedAngle Angle id requested via `[angle:<id>]`, if any.
 * @property {"final"|"trailing"|"scattered"} placement Where the line sat in the message.
 *                                  `scattered` means it was probably quoted prose rather
 *                                  than a real control block — honoured, but flagged.
 * @property {string} raw The matched line, trimmed.
 * @property {{summary: string|null, validation: string|null, captured: string|null}} fields
 *                                  The optional companion lines, for the journal.
 */

/**
 * Read the optional `KEY: value` companion lines of the control block.
 *
 * @param {string} message Full assistant message.
 * @returns {{summary: string|null, validation: string|null, captured: string|null}} Fields.
 */
function parseCompanionFields(message) {
  /**
   * @param {RegExp} re Pattern with one capture group.
   * @returns {string | null} Last match, trimmed, or `null`.
   */
  const last = (re) => {
    const all = [...message.matchAll(re)];
    const hit = all.at(-1);
    return hit ? hit[1].trim() || null : null;
  };
  return {
    summary: last(/^[ \t>*-]*ITERATION-SUMMARY:[ \t]*(.*)$/gim),
    validation: last(/^[ \t>*-]*VALIDATION:[ \t]*(.*)$/gim),
    captured: last(/^[ \t>*-]*CAPTURED:[ \t]*(.*)$/gim),
  };
}

/**
 * Parse the agent's final message for the loop control block.
 *
 * The **last** matching line wins, so a message that quotes the protocol earlier (docs,
 * examples, this file) still resolves to the real control block at the end.
 *
 * @param {string | null | undefined} message The final assistant message of the turn.
 * @returns {Control | null} The parsed control block, or `null` when no trigger is present.
 */
export function parseControl(message) {
  if (typeof message !== "string" || message.trim() === "") return null;

  const matches = [...message.matchAll(CONTROL_LINE_RE)];
  const hit = matches.at(-1);
  if (!hit) return null;

  const trigger = /** @type {Control["trigger"]} */ (hit[1].toUpperCase());
  const tail = hit[2] ?? "";
  const angleHit = ANGLE_REQUEST_RE.exec(tail);

  const detail = tail
    .replace(ANGLE_REQUEST_RE, " ")
    // Strip the separator between trigger and prose: em/en dash, hyphen or colon.
    .replace(/^[\s—–:-]+/, "")
    .trim();

  // Placement: how many non-empty lines follow the control line. `final` means it is the
  // last thing in the message, which is what the protocol asks for.
  const after = message.slice(hit.index + hit[0].length);
  const trailingLines = after.split("\n").filter((l) => l.trim() !== "").length;
  /** @type {Control["placement"]} */
  const placement =
    trailingLines === 0 ? "final" : trailingLines <= TRAILING_WINDOW ? "trailing" : "scattered";

  return {
    trigger,
    detail,
    requestedAngle: angleHit ? angleHit[1].toLowerCase() : null,
    placement,
    raw: hit[0].trim(),
    fields: parseCompanionFields(message),
  };
}

/**
 * Persistent loop state, stored as JSON next to the activation sentinel.
 *
 * @typedef {object} LoopState
 * @property {number} version Schema version; a mismatch resets the state rather than
 *                            guessing at an old shape (no persistence drift).
 * @property {string} startedAt ISO timestamp of the first iteration.
 * @property {string} updatedAt ISO timestamp of the last hook decision.
 * @property {string | null} sessionId Session that owns the run, for the journal.
 * @property {number} iteration Completed loop iterations so far.
 * @property {"implement"|"investigate"|"closeout"} mode Mode handed to the current turn.
 * @property {string | null} lastTrigger Previous turn's trigger word.
 * @property {number} missingMarkerStreak Consecutive turns with no control block.
 * @property {number} anglesExhaustedNudges Close-out nudges already sent.
 * @property {string[]} usedAngles Angle ids already handed out.
 * @property {Array<object>} history Append-only decision journal (bounded).
 */

/** Current {@link LoopState} schema version. */
export const STATE_VERSION = 1;

/** Journal entries kept in state; older ones are dropped to bound file growth. */
const HISTORY_LIMIT = 100;

/**
 * Build a fresh loop state.
 *
 * @param {object} [opts] Options.
 * @param {string} [opts.now] ISO timestamp to stamp.
 * @param {string | null} [opts.sessionId] Owning session id.
 * @returns {LoopState} A new state object.
 */
export function createState({ now = new Date().toISOString(), sessionId = null } = {}) {
  return {
    version: STATE_VERSION,
    startedAt: now,
    updatedAt: now,
    sessionId,
    iteration: 0,
    mode: "implement",
    lastTrigger: null,
    missingMarkerStreak: 0,
    anglesExhaustedNudges: 0,
    usedAngles: [],
    history: [],
  };
}

/**
 * Coerce an untrusted value read from disk into a valid {@link LoopState}.
 *
 * Fails closed on drift: an unknown version or a non-object resets to a fresh state instead
 * of being partially trusted.
 *
 * @param {unknown} raw Parsed JSON from the state file, or anything else.
 * @param {object} [opts] Options forwarded to {@link createState} when resetting.
 * @param {string} [opts.now] ISO timestamp.
 * @param {string | null} [opts.sessionId] Owning session id.
 * @returns {LoopState} A valid state.
 */
export function normalizeState(raw, opts = {}) {
  const fresh = createState(opts);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fresh;
  const s = /** @type {Record<string, unknown>} */ (raw);
  if (s.version !== STATE_VERSION) return fresh;

  const int = (v, fallback) => (Number.isInteger(v) && /** @type {number} */ (v) >= 0 ? v : fallback);
  return {
    version: STATE_VERSION,
    startedAt: typeof s.startedAt === "string" ? s.startedAt : fresh.startedAt,
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : fresh.updatedAt,
    sessionId: typeof s.sessionId === "string" ? s.sessionId : (opts.sessionId ?? null),
    iteration: /** @type {number} */ (int(s.iteration, 0)),
    mode:
      s.mode === "investigate" || s.mode === "closeout" || s.mode === "implement"
        ? s.mode
        : "implement",
    lastTrigger: typeof s.lastTrigger === "string" ? s.lastTrigger : null,
    missingMarkerStreak: /** @type {number} */ (int(s.missingMarkerStreak, 0)),
    anglesExhaustedNudges: /** @type {number} */ (int(s.anglesExhaustedNudges, 0)),
    usedAngles: Array.isArray(s.usedAngles) ? s.usedAngles.filter((x) => typeof x === "string") : [],
    history: Array.isArray(s.history) ? s.history.slice(-HISTORY_LIMIT) : [],
  };
}

/**
 * What the hook should do about this Stop event.
 *
 * @typedef {object} Verdict
 * @property {"block"|"allow"} decision `block` continues the session, `allow` lets it stop.
 * @property {string} reasonCode Machine-readable cause, e.g. `continue`, `iteration-cap`.
 * @property {"implement"|"investigate"|"closeout"|null} mode Mode for the next iteration.
 * @property {import("./angles.mjs").Angle | null} angle Angle handed to the next iteration.
 * @property {string} carry The agent's own one-liner, carried into the next iteration.
 * @property {boolean} deactivate Whether the loop should switch itself off.
 * @property {string | null} note Human-facing note surfaced via `systemMessage`.
 */

/**
 * Advance the loop state machine for one Stop event.
 *
 * Pure: returns the next state and the verdict, mutating nothing.
 *
 * @param {object} args Arguments.
 * @param {LoopState} args.state Current state.
 * @param {Control | null} args.control Parsed control block, or `null` when absent.
 * @param {LoopConfig} [args.config] Bounds; defaults to {@link DEFAULT_CONFIG}.
 * @param {string} [args.now] ISO timestamp for the journal entry.
 * @returns {{state: LoopState, verdict: Verdict}} Next state and what to do.
 */
export function decide({ state, control, config = DEFAULT_CONFIG, now = new Date().toISOString() }) {
  const next = { ...state, usedAngles: [...state.usedAngles], history: [...state.history] };
  next.updatedAt = now;
  next.lastTrigger = control?.trigger ?? null;

  /**
   * @param {Partial<Verdict>} v Verdict fields.
   * @returns {Verdict} Completed verdict.
   */
  const verdictOf = (v) => ({
    decision: "allow",
    reasonCode: "unknown",
    mode: null,
    angle: null,
    carry: control?.detail ?? "",
    deactivate: false,
    note: null,
    ...v,
  });

  /**
   * @param {Verdict} verdict Verdict to journal and return.
   * @returns {{state: LoopState, verdict: Verdict}} Result.
   */
  const finish = (verdict) => {
    next.history.push({
      at: now,
      iteration: next.iteration,
      trigger: control?.trigger ?? null,
      placement: control?.placement ?? null,
      decision: verdict.decision,
      reasonCode: verdict.reasonCode,
      mode: verdict.mode,
      angle: verdict.angle?.id ?? null,
      detail: control?.detail ?? null,
      validation: control?.fields.validation ?? null,
    });
    next.history = next.history.slice(-HISTORY_LIMIT);
    return { state: next, verdict };
  };

  const placementNote =
    control?.placement === "scattered"
      ? "Control block was not near the end of the message; the last NEXT-STEP line was used."
      : null;

  // Terminal triggers are honoured before any bound: the agent asking to stop always wins.
  if (control?.trigger === "COMPLETE") {
    return finish(
      verdictOf({
        decision: "allow",
        reasonCode: "complete",
        deactivate: true,
        note: placementNote,
      })
    );
  }
  if (control?.trigger === "BLOCKED") {
    // The loop stays armed: once the human answers, the next turn's Stop resumes it.
    return finish(
      verdictOf({ decision: "allow", reasonCode: "blocked", deactivate: false, note: placementNote })
    );
  }

  if (next.iteration >= config.maxIterations) {
    return finish(
      verdictOf({
        decision: "allow",
        reasonCode: "iteration-cap",
        deactivate: true,
        note: `Loop stopped at the ${config.maxIterations}-iteration cap. Re-arm with /continuous-improvement to keep going.`,
      })
    );
  }

  if (!control) {
    next.missingMarkerStreak += 1;
    if (next.missingMarkerStreak > config.maxMissingMarker) {
      return finish(
        verdictOf({
          decision: "allow",
          reasonCode: "missing-marker-cap",
          deactivate: false,
          note: `No LOOP CONTROL block for ${next.missingMarkerStreak} turns; letting the session stop. The loop is still armed.`,
        })
      );
    }
    // Re-prompt without burning an iteration — the turn produced no loop signal at all.
    return finish(
      verdictOf({
        decision: "block",
        reasonCode: "missing-marker",
        mode: next.mode,
        note: "Turn ended without a LOOP CONTROL block.",
      })
    );
  }

  next.missingMarkerStreak = 0;

  if (control.trigger === "CONTINUE") {
    next.iteration += 1;
    next.mode = "implement";
    return finish(
      verdictOf({ decision: "block", reasonCode: "continue", mode: "implement", note: placementNote })
    );
  }

  // INVESTIGATE
  const angle = nextAngle(next.usedAngles, control.requestedAngle);
  if (!angle) {
    next.anglesExhaustedNudges += 1;
    if (next.anglesExhaustedNudges > config.maxAnglesExhaustedNudges) {
      return finish(
        verdictOf({
          decision: "allow",
          reasonCode: "angles-exhausted",
          deactivate: true,
          note: "Every investigation angle has been swept and no new work was reported; ending the loop.",
        })
      );
    }
    next.iteration += 1;
    next.mode = "closeout";
    return finish(
      verdictOf({ decision: "block", reasonCode: "angles-exhausted-nudge", mode: "closeout" })
    );
  }

  next.iteration += 1;
  next.mode = "investigate";
  next.usedAngles.push(angle.id);
  return finish(
    verdictOf({ decision: "block", reasonCode: "investigate", mode: "investigate", angle, note: placementNote })
  );
}

/**
 * Render the text injected back into the session when the hook blocks the stop.
 *
 * The full loop prompt is re-injected every iteration on purpose: the session may have been
 * compacted, and the protocol must survive that.
 *
 * @param {object} args Arguments.
 * @param {Verdict} args.verdict The verdict from {@link decide}.
 * @param {LoopState} args.state The state *after* {@link decide}.
 * @param {LoopConfig} args.config Active bounds.
 * @param {string} args.promptText Contents of `LOOP_PROMPT.md`.
 * @returns {string} The `reason` string for the Stop hook's JSON output.
 */
export function buildFollowUp({ verdict, state, config, promptText }) {
  const header = [
    "# CONTINUOUS IMPROVEMENT LOOP — next iteration",
    "",
    `Iteration ${state.iteration} of at most ${config.maxIterations}. Mode: **${verdict.mode?.toUpperCase()}**.`,
    "",
  ];

  /** @type {string[]} */
  const body = [];

  if (verdict.reasonCode === "missing-marker") {
    body.push(
      "Your last turn ended without a `LOOP CONTROL` block, so the loop could not tell what to do next.",
      "",
      "Do not redo the work. Report on what you just did, then end the message with the control block —",
      "the `NEXT-STEP:` line must be the final non-empty line. Re-read PART 2 below for the exact format.",
      `This is re-prompt ${state.missingMarkerStreak} of ${config.maxMissingMarker}; after that the loop lets the session stop.`,
      ""
    );
  } else if (verdict.reasonCode === "continue") {
    body.push(
      "You reported a concrete next step. Carry it out now — **one** unit of work, validated, then hand off.",
      "",
      `> Your own hand-off: ${verdict.carry || "(none given — pick the highest-value next step yourself)"}`,
      "",
      "If that step is already done or turns out to be wrong, say so plainly and do the genuinely",
      "highest-value next step instead. Fail-closed order: red gate first, then the plan, then captured",
      "`BUG:` markers, then `TODO:` markers.",
      ""
    );
  } else if (verdict.reasonCode === "investigate") {
    body.push(
      "You reported that nothing is known to be left, so this is an **investigation** iteration:",
      "a fresh angle on the same codebase. Work only this angle.",
      "",
      verdict.angle ? formatAngle(verdict.angle) : "",
      "",
      `Angles used so far: ${state.usedAngles.join(", ") || "none"} (${state.usedAngles.length} of the catalogue).`,
      "",
      "Capture every real finding as an atomic todo (requirement → use case → test case incl. edge →",
      "end-to-end test) and/or a `TODO:`/`BUG:` comment at the site. Then:",
      "- found real work → `NEXT-STEP: CONTINUE — <the first thing to fix>`",
      "- angle genuinely clean → `NEXT-STEP: INVESTIGATE — <what you checked and why it is clean>`",
      "",
      "Do not manufacture findings to justify the angle. A clean angle, evidenced, is a good result.",
      ""
    );
  } else if (verdict.reasonCode === "angles-exhausted-nudge") {
    body.push(
      "Every investigation angle in the catalogue has been handed out, and you are still reporting",
      "nothing left to build. This is the **close-out** iteration.",
      "",
      "Do exactly this, then end the loop:",
      "1. Run the repository's full gate one more time and paste the real result.",
      "2. `grep -rn \"TODO\\|BUG\" --include=\"*.ts\" --include=\"*.tsx\" --include=\"*.mjs\" .` and confirm every",
      "   marker is either resolved or captured as a plan todo.",
      "3. Confirm the implementation plan has no unfinished items.",
      "4. Write a short close-out summary: what was built, what was swept, what is knowingly left.",
      "",
      "Then emit `NEXT-STEP: COMPLETE — <evidence>`, or `NEXT-STEP: BLOCKED — <question>` if the",
      "close-out surfaced something that needs a human decision. Do not emit `INVESTIGATE` again.",
      ""
    );
  }

  return [
    ...header,
    ...body,
    "---",
    "",
    "The full loop prompt follows. It is re-injected every iteration so it survives compaction —",
    "treat it as the standing instruction for this turn.",
    "",
    promptText.trim(),
  ].join("\n");
}
