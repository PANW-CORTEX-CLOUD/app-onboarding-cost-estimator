#!/usr/bin/env node
/**
 * install-global.mjs — Install the continuous-improvement skill + Stop hook for every project.
 *
 * Copies this skill directory to `~/.claude/skills/continuous-improvement` and registers its
 * Stop hook in `~/.claude/settings.json` (the user-level settings file, which applies to all
 * projects). The install is idempotent: re-running refreshes the files and leaves exactly one
 * hook entry.
 *
 * Installing globally does **not** arm anything. The hook stays inert in every project until
 * `loop-ctl.mjs enable` drops the activation sentinel there, so a global install cannot
 * surprise an unrelated repository.
 *
 * Usage (from this skill's directory):
 * ```bash
 * node bin/install-global.mjs            # install/refresh
 * node bin/install-global.mjs --dry-run  # show the plan
 * node bin/install-global.mjs --uninstall
 * node bin/install-global.mjs --home /tmp/fake-home
 * ```
 *
 * Exit 0 on success, 1 on failure.
 *
 * @module continuous-improvement/bin/install-global
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_NAME = "continuous-improvement";

/**
 * Entries never copied. `tests/` **is** installed on purpose: the global install is the only
 * copy of this skill, so its self-verification must travel with it
 * (`node --test ~/tests/*.test.mjs`).
 */
const EXCLUDE = new Set(["node_modules", ".DS_Store"]);

/**
 * Substring that identifies our hook entry in settings.json, so install/uninstall can find
 * it again without depending on the exact command string.
 */
const HOOK_MARKER = `skills/${SKILL_NAME}/hooks/stop.mjs`;

/** The hook command, written with `~` so the file stays portable across machines. */
const HOOK_COMMAND = `node ~/.claude/${HOOK_MARKER}`;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const UNINSTALL = argv.includes("--uninstall");
const homeFlag = argv.indexOf("--home");
const HOME = homeFlag >= 0 && argv[homeFlag + 1] ? path.resolve(argv[homeFlag + 1]) : os.homedir();

const CLAUDE_HOME = path.join(HOME, ".claude");
const TARGET_DIR = path.join(CLAUDE_HOME, "skills", SKILL_NAME);
const SETTINGS_FILE = path.join(CLAUDE_HOME, "settings.json");

/** @type {string[]} Human-readable log of what was (or would be) done. */
const actions = [];

/**
 * Recursively copy a directory, skipping {@link EXCLUDE} entries.
 *
 * @param {string} from Source directory.
 * @param {string} to Destination directory.
 * @returns {number} Number of files copied.
 */
function copyTree(from, to) {
  let copied = 0;
  if (!DRY_RUN) fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copied += copyTree(src, dst);
    } else if (entry.isFile()) {
      if (!DRY_RUN) fs.copyFileSync(src, dst);
      copied += 1;
    }
  }
  return copied;
}

/**
 * Read `~/.claude/settings.json`, tolerating absence.
 *
 * A malformed settings file is a hard error rather than something to overwrite: silently
 * replacing a user's settings would be exactly the kind of destructive fallback this skill
 * exists to hunt down.
 *
 * @returns {Record<string, any>} Parsed settings, or `{}` when the file does not exist.
 */
function readSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
  if (raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("settings.json must contain a JSON object");
    }
    return parsed;
  } catch (err) {
    process.stderr.write(
      `refusing to touch ${SETTINGS_FILE}: it is not valid JSON (${String(err)}).\n` +
        "Fix or move the file, then re-run.\n"
    );
    process.exit(1);
  }
}

/**
 * Write settings back, keeping a one-shot backup of what was there before.
 *
 * @param {Record<string, any>} settings Settings to persist.
 * @returns {void}
 */
function writeSettings(settings) {
  if (DRY_RUN) return;
  fs.mkdirSync(CLAUDE_HOME, { recursive: true });
  if (fs.existsSync(SETTINGS_FILE)) {
    const backup = `${SETTINGS_FILE}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(SETTINGS_FILE, backup);
    actions.push(`backed up existing settings → ${backup}`);
  }
  fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/**
 * Drop every registration of this hook from a settings object.
 *
 * @param {Record<string, any>} settings Settings to clean, mutated in place.
 * @returns {number} How many hook entries were removed.
 */
function removeHookEntries(settings) {
  const groups = settings?.hooks?.Stop;
  if (!Array.isArray(groups)) return 0;
  let removed = 0;
  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) continue;
    const before = group.hooks.length;
    group.hooks = group.hooks.filter(
      (h) => !(typeof h?.command === "string" && h.command.includes(HOOK_MARKER))
    );
    removed += before - group.hooks.length;
  }
  settings.hooks.Stop = groups.filter((g) => Array.isArray(g?.hooks) && g.hooks.length > 0);
  if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return removed;
}

/**
 * Install (or refresh) the skill and its hook registration.
 *
 * @returns {void}
 */
function install() {
  if (!DRY_RUN && fs.existsSync(TARGET_DIR)) {
    // Remove first so a file deleted from the source does not survive in the install.
    fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  }
  const copied = copyTree(SKILL_DIR, TARGET_DIR);
  actions.push(`copied ${copied} file(s) → ${TARGET_DIR}`);

  const settings = readSettings();
  const replaced = removeHookEntries(settings);
  settings.hooks ??= {};
  settings.hooks.Stop ??= [];
  settings.hooks.Stop.push({
    hooks: [
      {
        type: "command",
        command: HOOK_COMMAND,
        timeout: 120,
        statusMessage: "Checking the continuous-improvement loop…",
      },
    ],
  });
  writeSettings(settings);
  actions.push(
    replaced > 0
      ? `replaced ${replaced} existing Stop hook registration(s) in ${SETTINGS_FILE}`
      : `registered Stop hook in ${SETTINGS_FILE}`
  );
}

/**
 * Remove the skill and its hook registration.
 *
 * @returns {void}
 */
function uninstall() {
  if (fs.existsSync(TARGET_DIR)) {
    if (!DRY_RUN) fs.rmSync(TARGET_DIR, { recursive: true, force: true });
    actions.push(`removed ${TARGET_DIR}`);
  } else {
    actions.push(`${TARGET_DIR} was not installed`);
  }
  const settings = readSettings();
  const removed = removeHookEntries(settings);
  if (removed > 0) {
    writeSettings(settings);
    actions.push(`removed ${removed} Stop hook registration(s) from ${SETTINGS_FILE}`);
  } else {
    actions.push(`no Stop hook registration found in ${SETTINGS_FILE}`);
  }
}

try {
  if (UNINSTALL) uninstall();
  else install();
} catch (err) {
  process.stderr.write(`install failed: ${String(err?.stack ?? err)}\n`);
  process.exit(1);
}

process.stdout.write(
  `${DRY_RUN ? "[dry-run] " : ""}continuous-improvement ${UNINSTALL ? "uninstall" : "install"}\n` +
    actions.map((a) => `  · ${a}\n`).join("")
);
if (!UNINSTALL) {
  process.stdout.write(
    "\nThe hook is installed but inert. Arm it in a project with:\n" +
      `  node ~/.claude/skills/${SKILL_NAME}/bin/loop-ctl.mjs enable\n` +
      "or by invoking /continuous-improvement in that project.\n"
  );
}
