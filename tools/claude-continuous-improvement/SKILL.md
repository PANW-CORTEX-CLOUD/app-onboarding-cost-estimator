---
name: continuous-improvement
description: >-
  Run the self-continuing implementation + improvement loop: implement the plan one
  validated unit at a time, and when the plan is empty, sweep the codebase from a fresh
  investigation angle until nothing is left. A Stop hook reads the trigger word at the end
  of each turn (CONTINUE / INVESTIGATE / COMPLETE / BLOCKED) and re-runs, re-aims, or ends
  the loop. Use for "continue implementation", "keep going until done", "next best steps",
  "bug hunt", "improvement loop", "run the loop".
argument-hint: "[start|status|stop|angles|journal]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/bin/loop-ctl.mjs:*)
---

# Continuous improvement loop

An implementation loop that keeps itself going. Each turn does **one** validated unit of
work and ends with a trigger word; a `Stop` hook reads that word and decides what happens
next. No timers, no polling — the loop advances exactly as fast as the work does.

```
turn ends ──► Stop hook reads the last NEXT-STEP line
                │
                ├─ CONTINUE ────► same prompt again, IMPLEMENT mode  ──┐
                ├─ INVESTIGATE ─► same prompt again, INVESTIGATE mode ─┤ (loops)
                │                 + a fresh angle, never repeated      │
                ├─ COMPLETE ────► loop ends, deactivates ◄─────────────┘
                └─ BLOCKED ─────► loop pauses, hands the question to the user
```

## Start / stop / inspect

```bash
node ${CLAUDE_SKILL_DIR}/bin/loop-ctl.mjs enable      # arm this project (fresh run)
node ${CLAUDE_SKILL_DIR}/bin/loop-ctl.mjs enable --max 15
node ${CLAUDE_SKILL_DIR}/bin/loop-ctl.mjs status     # armed? iteration? angles swept?
node ${CLAUDE_SKILL_DIR}/bin/loop-ctl.mjs angles     # catalogue, [x] = already swept
node ${CLAUDE_SKILL_DIR}/bin/loop-ctl.mjs journal    # every decision the hook made
node ${CLAUDE_SKILL_DIR}/bin/loop-ctl.mjs disable    # stop after the current turn
```

`$ARGUMENTS` maps to those subcommands: `start` → `enable`, `stop` → `disable`, and
`status` / `angles` / `journal` pass straight through. With no argument, arm the loop and
begin the first iteration.

## What to do when this skill is invoked

1. **Arm the loop** — run `loop-ctl.mjs enable` (add `--max N` if the user named a budget).
   Say plainly that the loop is armed, what the iteration cap is, and that
   `loop-ctl.mjs disable` (or deleting `.claude/continuous-improvement.active`) stops it.
2. **Read the prompt** — [`LOOP_PROMPT.md`](LOOP_PROMPT.md) is the standing instruction for
   every iteration, including this first one. The hook re-injects it each turn, so it
   survives compaction; read it now so iteration 1 follows the same rules as iteration 12.
3. **Do one iteration** — one coherent unit of work, validated against the repository's own
   gate, discoveries captured.
4. **End the turn with the control block** — this is what keeps the loop alive:

```
=== LOOP CONTROL ===
ITERATION-SUMMARY: <what changed, and what proves it works>
VALIDATION: <the exact gate command and its real result, or "none — why">
CAPTURED: <new todos / TODO markers / doc entries, or "none">
NEXT-STEP: <CONTINUE|INVESTIGATE|COMPLETE|BLOCKED> — <one concrete line>
```

The `NEXT-STEP:` line must be the **last non-empty line** of the message. Without it the
hook re-prompts you (three times, then it lets the session stop).

## Choosing the trigger word

| Word | When | Effect |
|---|---|---|
| `CONTINUE` | A concrete next step exists: unfinished plan item, red gate, captured `TODO:`/`BUG:`, follow-up this turn created. | Next iteration, IMPLEMENT mode, carrying your one-liner. |
| `INVESTIGATE` | Plan empty, gate green — nothing *known* is left. | Next iteration, INVESTIGATE mode, with a fresh angle from the catalogue. |
| `COMPLETE` | Plan empty, gate green, **and** the angle catalogue has been swept without producing work. | Loop ends and disarms itself. |
| `BLOCKED` | A human decision is needed: low confidence after research, approval to delete an abandoned feature, missing access, an irreversible action. | Loop pauses; your one-liner is the question the user sees. |

Pick honestly. The hook cannot see your reasoning — only the word.

- `COMPLETE` used to escape a hard problem silently ends the work. `BLOCKED` with a real
  question is always the better move.
- `CONTINUE — keep improving` is not a next step. If you cannot name it in one concrete
  line, the honest word is `INVESTIGATE`.
- Report the real gate result in `VALIDATION:`, including a red one. A red gate is a
  perfectly good reason to emit `CONTINUE`.

## Investigation angles

When the plan runs dry the loop changes gear rather than stopping: each `INVESTIGATE` turn
gets one angle from an ordered catalogue — fail-open behaviour, persistence drift, trust
boundaries, observability, dead code, hardcoded parameters, coupling, test edges,
concurrency, performance, security, dependencies, docs, user journey.

Each angle is handed out **at most once**, which is what makes the sweep terminate. When
the catalogue is exhausted the hook asks for a close-out and then ends the loop.

Request a specific angle by naming it: `NEXT-STEP: INVESTIGATE [angle:security-and-secrets] — …`.
Full catalogue with per-angle checklists: [`REFERENCE.md`](REFERENCE.md) and
`loop-ctl.mjs angles`.

## Safety properties

- **Opt-in.** The hook does nothing until `.claude/continuous-improvement.active` exists in
  the project. Installed globally, it stays inert everywhere else.
- **Bounded.** Iteration cap (default 40), three re-prompts for a missing control block,
  single-use angles. Every bound holds regardless of what the loop reports.
- **Fail-open.** Any error inside the hook lets the session stop. A broken hook must never
  trap a session.
- **Auditable.** Every decision is appended to
  `.claude/continuous-improvement/journal.jsonl` with the trigger, the mode, the angle and
  the validation line you reported.
- **Interruptible.** Deleting the sentinel, running `loop-ctl.mjs disable`, or setting
  `CONTINUOUS_IMPROVEMENT_DISABLE=1` stops it. A user message during a loop is a normal
  turn — answer it, and it still ends with a control block.

## Install for every project

```bash
node ${CLAUDE_SKILL_DIR}/bin/install-global.mjs             # → ~/.claude, all projects
node ${CLAUDE_SKILL_DIR}/bin/install-global.mjs --dry-run
node ${CLAUDE_SKILL_DIR}/bin/install-global.mjs --uninstall
```

This copies the skill to `~/.claude/skills/continuous-improvement` and registers the Stop
hook in `~/.claude/settings.json`. It arms nothing.

## Files

| Path | Role |
|---|---|
| [`LOOP_PROMPT.md`](LOOP_PROMPT.md) | The prompt itself + protocol. **SSOT** — re-injected every iteration. |
| [`REFERENCE.md`](REFERENCE.md) | Trigger-word grammar, state files, config, angle catalogue, troubleshooting. |
| `hooks/stop.mjs` | The Stop hook (I/O shell). |
| `lib/loop-control.mjs` | Parsing + state machine + follow-up rendering (pure, tested). |
| `lib/angles.mjs` | Investigation angle catalogue. |
| `bin/loop-ctl.mjs` | enable / disable / status / angles / journal. |
| `bin/install-global.mjs` | Global install into `~/.claude`. |
| `tests/` | `node --test` coverage for the parser, state machine and hook. |
