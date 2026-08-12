# Continuous improvement loop — reference

Everything the [`SKILL.md`](SKILL.md) summary leaves out: the exact control-block grammar,
the files on disk, the configuration knobs, the angle catalogue, and what to do when the
loop misbehaves.

---

## 1. Control block grammar

The hook reads the turn's final assistant message and looks for the **last** line matching:

```
^[ \t>*-]*NEXT-STEP:[ \t]*(CONTINUE|INVESTIGATE|COMPLETE|BLOCKED)\b(.*)$
```

Notes on the deliberate leniency:

- **Last match wins.** A message may quote the protocol earlier (docs, examples, this file)
  and still resolve correctly, because the real control block is last.
- **Leading `>`, `-`, `*` and whitespace are tolerated**, so the line survives being written
  inside a quote or a list.
- **Case-insensitive** on the trigger word.
- The separator between trigger and prose may be an em dash, en dash, hyphen, colon or
  nothing at all.
- Placement decides whether the line counts at all: `final` (nothing follows — what the
  protocol asks for) and `trailing` (≤ 8 non-empty lines follow) are honoured; `scattered`
  (more than that) is **rejected** and re-prompted exactly like a missing block. A trigger
  word buried in prose is almost always a message *describing* the protocol — a summary
  table, this file — and acting on it would let a status report end the loop.

Optional companion lines, read from the same message for the journal, all optional and
matched the same way: `ITERATION-SUMMARY:`, `VALIDATION:`, `CAPTURED:`.

An explicit angle request may appear anywhere on the control line:

```
NEXT-STEP: INVESTIGATE [angle:security-and-secrets] — want to check proxy logs for PII
```

It is honoured when the id exists and has not been used yet; otherwise the next unused
angle in catalogue order is handed out instead.

### Trigger semantics

| Trigger | Hook decision | Iteration counter | Loop stays armed |
|---|---|---|---|
| `CONTINUE` | `block` → IMPLEMENT mode | +1 | yes |
| `INVESTIGATE` | `block` → INVESTIGATE mode with a fresh angle | +1 | yes |
| `COMPLETE` | allow stop | unchanged | **no** — sentinel removed |
| `BLOCKED` | allow stop | unchanged | yes — resumes on the next turn |
| *(no marker)* | `block` → re-prompt for the block | unchanged | yes |
| *(marker buried in prose)* | `block` → re-prompt, explaining the placement rule | unchanged | yes |

`COMPLETE` and `BLOCKED` are honoured **before** any cap: an explicit request to stop always
wins.

---

## 2. Files on disk

All under `<project>/.claude/`:

| Path | Committed? | Role |
|---|---|---|
| `continuous-improvement.active` | no (gitignored) | Activation sentinel. **Presence = armed.** Deleting it stops the loop after the current turn. |
| `continuous-improvement.state.json` | no (gitignored) | Loop state machine: iteration, mode, used angles, bounded history. |
| `continuous-improvement.config.json` | yes, if you want project bounds | Overrides for the caps below. |
| `continuous-improvement/journal.jsonl` | no (gitignored) | Decision journal, one JSON object per Stop event. Trimmed to the newest 500 entries once it passes 1 MB. |
| `continuous-improvement/turns/*.lock` | no (gitignored) | Per-turn claim files that stop a doubly-registered hook from counting a turn twice. Pruned after 24 h. |

### State shape (`version: 1`)

```jsonc
{
  "version": 1,
  "startedAt": "2026-08-10T12:00:00.000Z",
  "updatedAt": "2026-08-10T12:41:07.220Z",
  "sessionId": "…",
  "iteration": 7,
  "mode": "investigate",          // implement | investigate | closeout
  "lastTrigger": "INVESTIGATE",
  "missingMarkerStreak": 0,
  "anglesExhaustedNudges": 0,
  "usedAngles": ["fail-open-and-silent-fallbacks", "persistence-and-state-drift"],
  "history": [ /* last 100 decisions */ ]
}
```

A state file whose `version` does not match is **discarded, not migrated** — the loop starts
a fresh run rather than half-trusting an unknown shape.

---

## 3. Configuration

Precedence: environment variable → `.claude/continuous-improvement.config.json` → default.

| Key | Env var | Default | Meaning |
|---|---|---|---|
| `maxIterations` | `CONTINUOUS_IMPROVEMENT_MAX_ITERATIONS` | `40` | Hard cap on iterations. On reaching it the hook lets the session stop and disarms. |
| `maxMissingMarker` | `CONTINUOUS_IMPROVEMENT_MAX_MISSING_MARKER` | `3` | Consecutive turns without a control block that are re-prompted before giving up. |
| `maxAnglesExhaustedNudges` | `CONTINUOUS_IMPROVEMENT_MAX_CLOSEOUT_NUDGES` | `1` | Close-out nudges sent after the angle catalogue is exhausted before the hook ends the loop itself. |

Two more environment switches:

| Variable | Effect |
|---|---|
| `CONTINUOUS_IMPROVEMENT_DISABLE=1` | Hard kill switch. The hook exits immediately, whatever the sentinel says. |
| `CONTINUOUS_IMPROVEMENT_ACTIVE=1` | Arms the loop without a sentinel file (useful in CI or a sandbox). |

`loop-ctl.mjs enable --max N` writes `maxIterations` into the project config file.

---

## 4. Hook contract

Registered as a `Stop` hook. Input (stdin, JSON) — the fields this hook uses:

| Field | Use |
|---|---|
| `cwd` | Project root, when `CLAUDE_PROJECT_DIR` is not set. |
| `session_id` | Journal attribution and the per-turn claim key. |
| `last_assistant_message` | Primary source for the control block. |
| `transcript_path` | Fallback source; the transcript is walked backwards, skipping `isSidechain` entries so a subagent's message is never mistaken for the turn's own. |
| `stop_reason` | `max_tokens`, `refusal`, `error`, `aborted`, `cancelled` → the hook stands down and lets the session stop. Looping into the same wall helps nobody. |

Output (stdout, JSON, exit 0):

```jsonc
// continue the loop
{ "decision": "block", "reason": "<mode header + the whole LOOP_PROMPT.md>" }

// let the session stop
{ "systemMessage": "Continuous-improvement loop finished after 9 iteration(s): …" }
```

Exit code is always `0`. Claude Code only parses stdout JSON on exit 0, and `decision:
"block"` is the documented way for a `Stop` hook to continue the conversation; a non-zero
exit would downgrade a considered decision into an error notice.

The **whole** prompt is re-injected on every iteration, not a reference to it, so the
protocol survives context compaction mid-run.

### Fail-open, on purpose

The rest of this repository fails **closed**. This hook fails **open**: a missing prompt
file, an unwritable state file, or an unhandled exception all end with the session being
allowed to stop, plus a `systemMessage` explaining why. The dangerous failure mode for a
Stop hook is "cannot stop", not "stopped early".

---

## 5. Investigation angle catalogue

Ordered; handed out one per `INVESTIGATE` turn, never twice. Source of truth:
[`lib/angles.mjs`](lib/angles.mjs) (a unit test asserts this list stays in sync).

| # | Angle id | Hunting for |
|---|---|---|
| 1 | `fail-open-and-silent-fallbacks` | Failures swallowed and replaced with a substitute value. |
| 2 | `persistence-and-state-drift` | Stored state diverging from what the code now expects. |
| 3 | `input-validation-and-trust-boundaries` | Loose validation where untrusted input enters. |
| 4 | `error-handling-and-observability` | Failures that cannot be diagnosed in production. |
| 5 | `dead-code-and-unfinished-features` | Unreachable code and abandoned half-features. |
| 6 | `hardcoded-parameters-and-configuration` | Literals that should be centrally managed. |
| 7 | `architecture-and-coupling` | Layering violations, cycles, duplication, spaghetti. |
| 8 | `test-coverage-and-edge-cases` | Behaviour asserted nowhere; missing edges and contracts. |
| 9 | `concurrency-and-ordering` | Sequence, simultaneity and clock assumptions. |
| 10 | `performance-and-resource-usage` | Work that grows without bound. |
| 11 | `security-and-secrets` | Leaks, over-trust, injection, exposure. |
| 12 | `dependencies-and-supply-chain` | CVEs, deprecations, unpinned versions, install-time trust. |
| 13 | `docs-and-code-comments` | Wrong or missing docs; JSDoc/TSDoc coverage on exports. |
| 14 | `user-journey-and-accessibility` | The product as a user actually meets it. |

Per-angle checklists live in `lib/angles.mjs` and are injected verbatim into the follow-up
prompt, so an `INVESTIGATE` turn gets a checklist rather than a mood.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Turn ends and nothing continues | Loop not armed | `loop-ctl.mjs status`; if `armed: no`, run `enable`. |
| Hook never runs | Not registered | Check `~/.claude/settings.json` for a Stop entry pointing at this skill; re-run the repo installer to re-register. |
| "Turn ended without a LOOP CONTROL block" | The `NEXT-STEP:` line was missing | Put the control block last, as the final non-empty line. |
| "too much text followed it" | The `NEXT-STEP:` line was present but buried in prose | Same fix: nothing may follow the trigger line. |
| Loop stopped early | `COMPLETE`, `BLOCKED`, iteration cap, or a stand-down `stop_reason` | `loop-ctl.mjs journal -n 5` shows the exact `reasonCode`. |
| Loop will not stop | Sentinel still present | `loop-ctl.mjs disable`, or `CONTINUOUS_IMPROVEMENT_DISABLE=1`, or delete `.claude/continuous-improvement.active`. |
| Iterations advancing two at a time | Hook registered twice **and** the turn-claim directory is unwritable | Make `.claude/continuous-improvement/turns/` writable, or remove one registration. |
| Same angle twice | State was reset between runs (`enable` without `--keep-state`) | Use `enable --keep-state` to resume a run. |

Start with `doctor` — it checks, in one command, every precondition that has to hold for the
hook to run at all: node version, the skill's files, whether any settings file registers the
`Stop` hook (and whether more than one does), the kill switch, whether the project is armed,
and whether the state directory is writable. It exits non-zero when something blocking is
wrong, so it also works as a gate in a script.

```bash
node bin/loop-ctl.mjs doctor
```

Then read the journal — it records, per Stop event: trigger, placement, mode, angle,
decision, `reasonCode`, and the `VALIDATION:` line the iteration reported.

```bash
# from this skill's directory, or ~/.claude/skills/continuous-improvement after install
node bin/loop-ctl.mjs journal -n 20
```
