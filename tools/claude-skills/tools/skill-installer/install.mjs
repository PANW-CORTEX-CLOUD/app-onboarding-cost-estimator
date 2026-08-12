#!/usr/bin/env node
/**
 * install.mjs — Install skills from this repository into `~/.claude`.
 *
 * Claude Code reads personal skills from `~/.claude/skills/<name>/` and personal settings
 * (including hooks) from `~/.claude/settings.json`. Both are per-machine, which is why this
 * repository exists: it is the portable source, and this script is the only way its contents
 * are meant to reach a machine.
 *
 * The installer is **manifest driven**. Every skill declares what it needs in its own
 * `skill.json`, so adding a skill to this repository never means editing this file:
 *
 * ```jsonc
 * {
 *   "name": "continuous-improvement",          // must equal the directory name
 *   "description": "…",                        // shown by --list
 *   "hooks": {                                  // optional
 *     "Stop": [
 *       { "type": "command",
 *         "command": "node ~/.claude/skills/continuous-improvement/hooks/stop.mjs",
 *         "timeout": 120 }
 *     ]
 *   }
 * }
 * ```
 *
 * Usage:
 * ```bash
 * node tools/skill-installer/install.mjs                       # install every skill
 * node tools/skill-installer/install.mjs continuous-improvement  # install just these
 * node tools/skill-installer/install.mjs --list                # what is available, and what is installed
 * node tools/skill-installer/install.mjs --dry-run             # show the plan, touch nothing
 * node tools/skill-installer/install.mjs --uninstall [names…]  # remove skills and their hooks
 * node tools/skill-installer/install.mjs --home /tmp/fake-home # target a different HOME (used by the tests)
 * ```
 *
 * Guarantees:
 * - **Idempotent.** Re-running refreshes files and leaves exactly one hook registration per
 *   declared hook. Files deleted from a skill do not survive in the install.
 * - **Non-destructive.** `settings.json` is backed up before every write, hook entries
 *   belonging to other tools are preserved, and an unparseable settings file aborts the run
 *   rather than being overwritten.
 * - **Fail closed.** A malformed manifest, a name/directory mismatch, or a hook command that
 *   does not point into its own installed skill directory stops the install with a non-zero
 *   exit. Half-installing a skill is worse than not installing it.
 *
 * Exit 0 on success, 1 on any validation or I/O failure.
 *
 * @module tools/skill-installer/install
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate the repository root by walking up from this script until a `skills/` directory
 * appears. Derived rather than hardcoded so the installer keeps working wherever it is
 * filed inside the repository — including when the repository is itself checked out as
 * `~/.claude`.
 *
 * @param {string} start Directory to start from.
 * @returns {string} Absolute repository root.
 */
function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, "skills"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  process.stderr.write(`install: no skills/ directory found above ${start}\n`);
  process.exit(1);
}

const REPO_DIR = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const SKILLS_DIR = path.join(REPO_DIR, "skills");

/** Entries never copied into an install. */
const EXCLUDE = new Set(["node_modules", ".DS_Store", ".git"]);

/**
 * A skill discovered in this repository.
 *
 * @typedef {object} Skill
 * @property {string} name Directory name, and the name Claude Code invokes it by.
 * @property {string} dir Absolute source directory.
 * @property {string} description One-line description from the manifest.
 * @property {Record<string, object[]>} hooks Hook handlers keyed by hook event name.
 */

/**
 * Parse CLI arguments.
 *
 * @param {string[]} argv Raw arguments (without node and script path).
 * @returns {{names: string[], list: boolean, dryRun: boolean, uninstall: boolean, home: string}} Options.
 */
function parseArgs(argv) {
  /** @type {string[]} */
  const names = [];
  let home = os.homedir();
  let list = false;
  let dryRun = false;
  let uninstall = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--home") {
      const value = argv[i + 1];
      if (!value) fail("--home needs a directory");
      home = path.resolve(value);
      i += 1;
    } else if (arg === "--list") list = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--uninstall") uninstall = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg.startsWith("-")) fail(`unknown option: ${arg}`);
    else names.push(arg);
  }
  return { names, list, dryRun, uninstall, home };
}

/**
 * Abort with a message. Used for every validation failure — the installer fails closed.
 *
 * @param {string} message What went wrong.
 * @returns {never} Exits the process with status 1.
 */
function fail(message) {
  process.stderr.write(`install: ${message}\n`);
  process.exit(1);
}

/**
 * Read and validate one skill manifest.
 *
 * @param {string} dir Absolute skill directory.
 * @returns {Skill} The validated skill.
 */
function readManifest(dir) {
  const name = path.basename(dir);
  const file = path.join(dir, "skill.json");
  if (!fs.existsSync(file)) fail(`${name}: missing skill.json`);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return fail(`${name}: skill.json is not valid JSON (${String(err)})`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(`${name}: skill.json must contain a JSON object`);
  }
  if (manifest.name !== name) {
    fail(`${name}: skill.json declares name ${JSON.stringify(manifest.name)}; it must match the directory`);
  }
  if (!fs.existsSync(path.join(dir, "SKILL.md"))) fail(`${name}: missing SKILL.md`);

  const hooks = manifest.hooks ?? {};
  if (typeof hooks !== "object" || Array.isArray(hooks)) fail(`${name}: hooks must be an object`);
  for (const [event, handlers] of Object.entries(hooks)) {
    if (!Array.isArray(handlers)) fail(`${name}: hooks.${event} must be an array`);
    for (const handler of handlers) {
      if (typeof handler?.command !== "string") {
        fail(`${name}: every hooks.${event} entry needs a string command`);
      }
      // The uninstaller identifies our entries by this marker, so an entry that cannot be
      // found again must never be written in the first place.
      if (!handler.command.includes(hookMarker(name))) {
        fail(
          `${name}: hooks.${event} command must reference ${hookMarker(name)} so it can be ` +
            `uninstalled again; got ${JSON.stringify(handler.command)}`
        );
      }
    }
  }

  return {
    name,
    dir,
    description: typeof manifest.description === "string" ? manifest.description : "",
    hooks,
  };
}

/**
 * The substring that identifies a skill's hook entries in `settings.json`.
 *
 * @param {string} name Skill name.
 * @returns {string} Marker substring.
 */
function hookMarker(name) {
  return `skills/${name}/`;
}

/**
 * Discover every skill in the repository, sorted by name.
 *
 * @returns {Skill[]} All skills.
 */
function discoverSkills() {
  if (!fs.existsSync(SKILLS_DIR)) fail(`no skills/ directory at ${SKILLS_DIR}`);
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !EXCLUDE.has(e.name))
    .map((e) => readManifest(path.join(SKILLS_DIR, e.name)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Select the skills named on the command line, or all of them.
 *
 * @param {Skill[]} all Every discovered skill.
 * @param {string[]} names Requested names; empty means all.
 * @returns {Skill[]} The selection.
 */
function select(all, names) {
  if (names.length === 0) return all;
  return names.map((name) => {
    const hit = all.find((s) => s.name === name);
    if (!hit) fail(`unknown skill ${JSON.stringify(name)}; try --list`);
    return /** @type {Skill} */ (hit);
  });
}

/**
 * Recursively copy a directory, skipping {@link EXCLUDE} entries.
 *
 * @param {string} from Source directory.
 * @param {string} to Destination directory.
 * @param {boolean} dryRun When true, count files without writing.
 * @returns {number} Files copied.
 */
function copyTree(from, to, dryRun) {
  let copied = 0;
  if (!dryRun) fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copied += copyTree(src, dst, dryRun);
    else if (entry.isFile()) {
      if (!dryRun) fs.copyFileSync(src, dst);
      copied += 1;
    }
  }
  return copied;
}

/**
 * Read `<home>/.claude/settings.json`, tolerating absence but never junk.
 *
 * @param {string} file Absolute settings path.
 * @returns {Record<string, any>} Parsed settings, or `{}` when the file does not exist.
 */
function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8");
  if (raw.trim() === "") return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return fail(`refusing to touch ${file}: not valid JSON (${String(err)}). Fix or move it, then re-run.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(`refusing to touch ${file}: it must contain a JSON object`);
  }
  return parsed;
}

/**
 * Write settings back, keeping a timestamped backup of the previous contents.
 *
 * @param {string} file Absolute settings path.
 * @param {Record<string, any>} settings Settings to persist.
 * @param {boolean} dryRun When true, do nothing.
 * @param {string[]} log Action log to append to.
 * @returns {void}
 */
function writeSettings(file, settings, dryRun, log) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(file, backup);
    log.push(`backed up settings → ${path.basename(backup)}`);
  }
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/**
 * Remove every hook entry belonging to a skill, leaving other tools' entries alone.
 *
 * @param {Record<string, any>} settings Settings object, mutated in place.
 * @param {string} name Skill name.
 * @returns {number} Entries removed.
 */
function removeHooks(settings, name) {
  const marker = hookMarker(name);
  let removed = 0;
  const events = settings.hooks;
  if (!events || typeof events !== "object") return 0;

  for (const [event, groups] of Object.entries(events)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) continue;
      const before = group.hooks.length;
      group.hooks = group.hooks.filter(
        (h) => !(typeof h?.command === "string" && h.command.includes(marker))
      );
      removed += before - group.hooks.length;
    }
    events[event] = groups.filter((g) => Array.isArray(g?.hooks) && g.hooks.length > 0);
    if (events[event].length === 0) delete events[event];
  }
  if (Object.keys(events).length === 0) delete settings.hooks;
  return removed;
}

/**
 * Add a skill's declared hooks to the settings object.
 *
 * @param {Record<string, any>} settings Settings object, mutated in place.
 * @param {Skill} skill The skill being installed.
 * @returns {number} Entries added.
 */
function addHooks(settings, skill) {
  let added = 0;
  for (const [event, handlers] of Object.entries(skill.hooks)) {
    if (handlers.length === 0) continue;
    settings.hooks ??= {};
    settings.hooks[event] ??= [];
    settings.hooks[event].push({ hooks: handlers.map((h) => ({ type: "command", ...h })) });
    added += handlers.length;
  }
  return added;
}

/**
 * Install one skill.
 *
 * @param {Skill} skill The skill.
 * @param {string} claudeHome Absolute `<home>/.claude`.
 * @param {Record<string, any>} settings Settings object, mutated in place.
 * @param {boolean} dryRun Plan only.
 * @param {string[]} log Action log.
 * @returns {void}
 */
function installSkill(skill, claudeHome, settings, dryRun, log) {
  const target = path.join(claudeHome, "skills", skill.name);

  // When this repository IS the config directory (checked out at ~/.claude, so that
  // skills/<name>/ already sits where Claude Code reads it), source and target are the same
  // path. Copying would mean deleting the skill and then reading from the hole it left, so
  // the copy is skipped entirely and only the hook registration runs. Detected by resolved
  // path rather than by a flag, because the destructive case must not depend on the caller
  // remembering to pass one.
  const inPlace = path.resolve(skill.dir) === path.resolve(target);
  let copied = 0;
  if (!inPlace) {
    // Remove first so a file deleted upstream does not survive in the install. Safe only
    // because the in-place case was ruled out above.
    if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
    copied = copyTree(skill.dir, target, dryRun);
  }

  const replaced = removeHooks(settings, skill.name);
  const added = addHooks(settings, skill);

  const what = inPlace
    ? "already in place (this repository is the config directory); files untouched"
    : `${copied} file(s) → ~/.claude/skills/${skill.name}`;
  log.push(
    `${skill.name}: ${what}` +
      (added > 0 ? `, ${added} hook(s) registered${replaced > 0 ? ` (replaced ${replaced})` : ""}` : "")
  );
}

/**
 * Uninstall one skill.
 *
 * @param {Skill} skill The skill.
 * @param {string} claudeHome Absolute `<home>/.claude`.
 * @param {Record<string, any>} settings Settings object, mutated in place.
 * @param {boolean} dryRun Plan only.
 * @param {string[]} log Action log.
 * @returns {void}
 */
function uninstallSkill(skill, claudeHome, settings, dryRun, log) {
  const target = path.join(claudeHome, "skills", skill.name);
  const existed = fs.existsSync(target);
  if (existed && !dryRun) fs.rmSync(target, { recursive: true, force: true });
  const removed = removeHooks(settings, skill.name);
  log.push(
    `${skill.name}: ${existed ? "removed" : "was not installed"}` +
      (removed > 0 ? `, ${removed} hook(s) unregistered` : "")
  );
}

const USAGE = `install — install this repository's Claude Code skills into ~/.claude

  node tools/skill-installer/install.mjs [names…]      install all skills, or just the named ones
  node tools/skill-installer/install.mjs --list        show available and installed skills
  node tools/skill-installer/install.mjs --dry-run     show the plan without touching anything
  node tools/skill-installer/install.mjs --uninstall [names…]
  node tools/skill-installer/install.mjs --home DIR    target a different HOME
`;

const opts = parseArgs(process.argv.slice(2));
const claudeHome = path.join(opts.home, ".claude");
const settingsFile = path.join(claudeHome, "settings.json");
const skills = discoverSkills();

if (opts.list) {
  for (const skill of skills) {
    const installed = fs.existsSync(path.join(claudeHome, "skills", skill.name));
    process.stdout.write(`${installed ? "[x]" : "[ ]"} ${skill.name} — ${skill.description}\n`);
  }
  process.stdout.write(`\n${skills.length} skill(s) in this repository; [x] = installed in ${claudeHome}\n`);
  process.exit(0);
}

const selected = select(skills, opts.names);
const settings = readSettings(settingsFile);
/** @type {string[]} */
const log = [];

try {
  for (const skill of selected) {
    if (opts.uninstall) uninstallSkill(skill, claudeHome, settings, opts.dryRun, log);
    else installSkill(skill, claudeHome, settings, opts.dryRun, log);
  }
  writeSettings(settingsFile, settings, opts.dryRun, log);
} catch (err) {
  fail(String(err?.stack ?? err));
}

process.stdout.write(
  `${opts.dryRun ? "[dry-run] " : ""}${opts.uninstall ? "uninstall" : "install"} → ${claudeHome}\n` +
    log.map((a) => `  · ${a}\n`).join("")
);
if (!opts.uninstall && !opts.dryRun) {
  process.stdout.write("\nRestart Claude Code (or start a new session) to pick up the changes.\n");
}
