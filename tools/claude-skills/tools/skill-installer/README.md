# skill-installer

Installs this repository's `skills/` into a machine's `~/.claude`, and registers the hooks
each skill declares.

Claude Code reads personal skills from `~/.claude/skills/<name>/` and personal hooks from
`~/.claude/settings.json`. Both are per-machine and committed nowhere, which is what this
installer bridges: the repository is the portable source, and one command puts it on a
machine so it applies to **every** project there.

## Two layouts, both supported

**A — this repository is checked out somewhere else** (e.g. `~/.claude-src`) and installs
into `~/.claude`:

```bash
git clone git@github.com:IFEOMA-CLOUD360/.claude.git ~/.claude-src
bash ~/.claude-src/tools/skill-installer/install.sh
```

After the first clone, that same command is also the update path — it fetches and reinstalls.

**B — this repository *is* `~/.claude`.** Then `skills/<name>/` already sits where Claude
Code reads it and nothing needs copying, but the hooks still have to be registered in
`settings.json`:

```bash
node ~/.claude/tools/skill-installer/install.mjs
```

The installer detects this case by resolved path — source and target being the same
directory — and skips the copy instead of deleting the skill it is installing. It says
`already in place` when that happens.

**C — install into a single repository**, so the skill and its hook are checked in and
travel with that repo for everyone who clones it:

```bash
node tools/skill-installer/install.mjs --project /path/to/repo
```

The hook command is rewritten from `~/.claude/…` to `${CLAUDE_PROJECT_DIR}/.claude/…`, which
is what makes a committed hook resolve on someone else's machine. Existing hooks and skills
in that repository are preserved.

Either way, restart Claude Code (or start a new session) afterwards.

## Options

```bash
node tools/skill-installer/install.mjs                         # install every skill
node tools/skill-installer/install.mjs continuous-improvement  # install just these
node tools/skill-installer/install.mjs --list                  # available, [x] = installed
node tools/skill-installer/install.mjs --dry-run               # show the plan, touch nothing
node tools/skill-installer/install.mjs --uninstall [names…]    # remove skills and their hooks
node tools/skill-installer/install.mjs --project DIR            # install into DIR/.claude (checked in)
node tools/skill-installer/install.mjs --home DIR               # target a different HOME
```

`install.sh` is a thin wrapper: update the checkout, then run `install.mjs` with the same
arguments. Set `CLAUDE_SKILLS_REPO` to use HTTPS instead of SSH, or `CLAUDE_SKILLS_SRC` to
put the checkout somewhere other than `~/.claude-src`.

## Behaviour

- **Idempotent** — re-running leaves exactly one registration per declared hook, however
  often it runs, and a fresh copy of each skill so files deleted upstream do not linger.
- **Non-destructive** — `settings.json` is backed up before every write, and hook entries
  belonging to other tools are preserved through both install and uninstall.
- **Fails closed** — a malformed manifest, a `name` that does not match its directory, a
  missing `SKILL.md`, or a hook command that could not be found again at uninstall time all
  abort the run with a non-zero exit and write nothing. Half-installing is worse than not
  installing.
- **Narrow** — it touches `~/.claude/skills/` and the `hooks` key of `~/.claude/settings.json`.
  Nothing else, in no project.

## Adding a skill

1. Create `skills/<name>/SKILL.md` (see the
   [skills docs](https://code.claude.com/docs/en/skills) for the frontmatter).
2. Add `skills/<name>/skill.json`:

   ```jsonc
   {
     "name": "<name>",              // must equal the directory name
     "description": "One line, shown by --list",
     "hooks": {                      // optional
       "Stop": [
         { "type": "command",
           "command": "node ~/.claude/skills/<name>/hooks/stop.mjs",
           "timeout": 120 }
       ]
     }
   }
   ```

   Every hook command must contain `skills/<name>/`. That marker is how the uninstaller finds
   its own entries again, so the installer refuses to write anything it could not later remove.

3. Put tests in `skills/<name>/tests/`.

The installer is manifest driven and never needs editing to add a skill.

## Tests

```bash
node --test 'tools/skill-installer/tests/*.test.mjs'      # 25 — the installer
node --test 'skills/continuous-improvement/tests/*.test.mjs'  # 72 — the loop skill
```

Both run in CI on every push (`.github/workflows/claude-skills-test.yml`). Node ≥ 18, no
dependencies.

## Optional `.gitignore` entries

If a skill is ever armed inside this checkout, its runtime state lands in `.claude/`. Add:

```gitignore
.claude/continuous-improvement.active
.claude/continuous-improvement.state.json
.claude/continuous-improvement/
```
