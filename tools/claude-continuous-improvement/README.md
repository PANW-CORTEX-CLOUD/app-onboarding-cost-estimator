# `continuous-improvement` — Claude Code skill + Stop hook (install payload)

This directory is **not wired into the project**. Nothing here runs during `pnpm test`,
`pnpm build`, or a normal Claude Code session in this repo. It is a self-contained payload
that installs into `~/.claude`, where it applies to every project you work on.

It is checked in because `~/.claude` is per-machine: this is how the loop travels between
machines, containers and teammates.

## Install

```bash
node tools/claude-continuous-improvement/bin/install-global.mjs
```

That copies the skill to `~/.claude/skills/continuous-improvement` and registers its `Stop`
hook in `~/.claude/settings.json`. It is idempotent — re-running refreshes the files and
leaves exactly one hook entry — and it backs up any existing `settings.json` first.

```bash
node tools/claude-continuous-improvement/bin/install-global.mjs --dry-run    # show the plan
node tools/claude-continuous-improvement/bin/install-global.mjs --uninstall  # remove both
```

Installing arms **nothing**. The hook stays inert in every project until you opt that project
in, so a global install cannot surprise an unrelated repository.

## Use

In any project, once installed:

```bash
/continuous-improvement                                                   # arm + start
node ~/.claude/skills/continuous-improvement/bin/loop-ctl.mjs enable --max 15
node ~/.claude/skills/continuous-improvement/bin/loop-ctl.mjs status
node ~/.claude/skills/continuous-improvement/bin/loop-ctl.mjs disable
```

## What it does

Each turn does one validated unit of work and ends with a trigger word. The `Stop` hook
reads it and decides what happens next:

| Trigger | Next |
|---|---|
| `CONTINUE` | same prompt again, IMPLEMENT mode, carrying the reported next step |
| `INVESTIGATE` | same prompt again, INVESTIGATE mode, with a fresh angle (14, never repeated) |
| `COMPLETE` | loop ends and disarms itself |
| `BLOCKED` | loop pauses and hands a question to the human |

Full documentation: [`SKILL.md`](SKILL.md) (overview), [`LOOP_PROMPT.md`](LOOP_PROMPT.md)
(the prompt and protocol — the single source of truth re-injected every iteration),
[`REFERENCE.md`](REFERENCE.md) (grammar, state files, config, angle catalogue,
troubleshooting).

## Verify

```bash
cd tools/claude-continuous-improvement && node --test 'tests/*.test.mjs'
```

62 tests cover the control-block parser, the state machine and its bounds, the hook's I/O
contract against a throwaway project, the CLI, and the installer.

## Layout

| Path | Role |
|---|---|
| `SKILL.md` | Skill entry point and frontmatter. |
| `LOOP_PROMPT.md` | The prompt + loop protocol. **SSOT** — re-injected every iteration. |
| `REFERENCE.md` | Control-block grammar, state files, config, angles, troubleshooting. |
| `hooks/stop.mjs` | The `Stop` hook (I/O shell; opt-in, bounded, fail-open). |
| `lib/loop-control.mjs` | Parsing, state machine, follow-up rendering (pure). |
| `lib/angles.mjs` | Investigation angle catalogue. |
| `bin/loop-ctl.mjs` | enable / disable / status / angles / journal. |
| `bin/install-global.mjs` | Install / uninstall into `~/.claude`. |
| `tests/` | `node --test` suites. |
