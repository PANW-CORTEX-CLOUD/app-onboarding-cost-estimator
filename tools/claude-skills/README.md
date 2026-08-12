# claude-skills (mirror — not part of the app)

Claude Code skills that install into `~/.claude` and apply to **every** repository on a
machine. Nothing in this directory runs during `pnpm build` or `pnpm test`, and no
project-level hook is registered — the app is unaffected by its presence.

It lives here because `~/.claude` is per-machine and committed nowhere: this is the durable,
version-controlled copy.

## Install

```bash
node tools/claude-skills/tools/skill-installer/install.mjs
```

Copies `skills/<name>/` → `~/.claude/skills/<name>/` and registers each skill's declared
hooks in `~/.claude/settings.json`. Idempotent, backs up settings, preserves hook entries
belonging to other tools, and fails closed rather than half-installing. Installing arms
nothing.

Full documentation: [`tools/skill-installer/README.md`](tools/skill-installer/README.md).

## Skills

- **`continuous-improvement`** — a self-continuing implementation loop. Each turn does one
  validated unit of work and ends with a trigger word that a `Stop` hook reads: `CONTINUE`
  re-runs the prompt in implement mode, `INVESTIGATE` re-runs it with a fresh angle from a
  14-angle catalogue, `COMPLETE` ends the loop, `BLOCKED` hands a question back to the human.
  Opt-in per project, bounded by an iteration cap, fail-open.
  → [`skills/continuous-improvement/SKILL.md`](skills/continuous-improvement/SKILL.md)

## Tests

```bash
cd tools/claude-skills
node --test 'tools/skill-installer/tests/*.test.mjs'          # 22 — installer
node --test 'skills/continuous-improvement/tests/*.test.mjs'   # 62 — the loop skill
```

Node ≥ 18, no dependencies.

## Mirror status

This tree is kept byte-identical to the payload intended for the organisation's `.claude`
configuration repository, so the two never drift. The bundled
`.github/workflows/claude-skills-test.yml` runs both suites **in that repository**; it is
inert here, because GitHub only reads workflows from a repository's own root `.github/`.
Run the suites above by hand after changing anything in this directory.
