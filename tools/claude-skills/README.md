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
node --test 'tools/skill-installer/tests/*.test.mjs'          # 25 — installer
node --test 'skills/continuous-improvement/tests/*.test.mjs'   # 72 — the loop skill
```

Node ≥ 18, no dependencies.

## Source of truth

**This tree is a mirror, not the source.** It lives here because `~/.claude` is
per-machine and this repository was the first durable place to put it — not
because the cost estimator owns it.

The intended SSOT is the organisation's **`ai-workflow-platform`** repository, so
that every project installs the same skills from one place. That move has **not
happened yet** (see the checklist below), so today this mirror is still the
newest committed copy.

Known copies, all byte-identical as of 2026-08-12 — verified with `diff -r`, not
assumed:

| Where | Role |
|---|---|
| `ai-workflow-platform` | **intended SSOT — not yet landed** |
| this directory | mirror; becomes a pointer once SSOT lands |
| `rfp-demo-use-case` `.claude/skills/` | project install (a deployment, not a duplicate) |
| a machine's `~/.claude/skills/` | install target |

### When the SSOT lands

1. Push the payload to `ai-workflow-platform` (`skills/` + `tools/skill-installer/`).
2. Delete this directory and leave a one-line pointer in the root `README.md`.
   Do not keep both — two editable copies is how the tier-selection and currency
   bugs would get fixed in one and not the other.
3. Re-install everywhere from SSOT:
   `CLAUDE_SKILLS_REPO=<platform-url> bash tools/skill-installer/install.sh`
   The installer already reads that variable, so **no code change is needed** to
   repoint it.

Until step 1 happens, edit the skill **here** and re-run the installer, so there
is exactly one place changes are made.

## Tests

```bash
cd tools/claude-skills
node --test 'tools/skill-installer/tests/*.test.mjs'          # 25 — installer
node --test 'skills/continuous-improvement/tests/*.test.mjs'   # 72 — the loop skill
```

Node ≥ 18, no dependencies. The bundled
`.github/workflows/claude-skills-test.yml` runs both suites **in the repository
that owns them**; it is inert here, because GitHub only reads workflows from a
repository's own root `.github/`.
