/**
 * Tests for the skill installer.
 *
 * Every case runs the real `install.mjs` against a throwaway HOME, so what is asserted is
 * the actual on-disk result: files copied, `settings.json` merged, other tools' hooks intact.
 *
 * Run from the repository root: node --test 'tools/skill-installer/tests/*.test.mjs'
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const INSTALLER = path.join(REPO_DIR, "tools", "skill-installer", "install.mjs");

/** @type {string} Throwaway HOME for the running test. */
let home;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-home-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

/**
 * Run the installer against the throwaway HOME.
 *
 * @param {string[]} [args] Installer arguments.
 * @param {string} [repoDir] Repository to install from (defaults to this one).
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Result.
 */
function install(args = [], repoDir = REPO_DIR) {
  return spawnSync(process.execPath, [path.join(repoDir, "tools", "skill-installer", "install.mjs"), "--home", home, ...args], {
    encoding: "utf8",
  });
}

/** @returns {string} Absolute settings path in the throwaway HOME. */
const settingsFile = () => path.join(home, ".claude", "settings.json");

/** @returns {any} Parsed settings. */
const settings = () => JSON.parse(fs.readFileSync(settingsFile(), "utf8"));

/**
 * Every Stop hook handler currently registered.
 *
 * @param {any} [s] Settings object.
 * @returns {any[]} Handlers.
 */
const stopHooks = (s = settings()) => (s.hooks?.Stop ?? []).flatMap((g) => g.hooks ?? []);

/**
 * Absolute path of an installed skill.
 *
 * @param {string} name Skill name.
 * @returns {string} Path.
 */
const installedDir = (name) => path.join(home, ".claude", "skills", name);

/**
 * Build a throwaway repository with synthetic skills, for the validation cases.
 *
 * @param {Record<string, object|null>} manifests Skill name → manifest (null writes no manifest).
 * @param {object} [opts] Options.
 * @param {boolean} [opts.withSkillMd] Whether to write SKILL.md (default true).
 * @returns {string} Absolute path of the throwaway repository.
 */
function fakeRepo(manifests, { withSkillMd = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-repo-"));
  fs.mkdirSync(path.join(dir, "tools", "skill-installer"), { recursive: true });
  fs.copyFileSync(INSTALLER, path.join(dir, "tools", "skill-installer", "install.mjs"));
  for (const [name, manifest] of Object.entries(manifests)) {
    const skillDir = path.join(dir, "skills", name);
    fs.mkdirSync(skillDir, { recursive: true });
    if (withSkillMd) fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${name}\n`, "utf8");
    if (manifest !== null) {
      fs.writeFileSync(
        path.join(skillDir, "skill.json"),
        typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2),
        "utf8"
      );
    }
  }
  return dir;
}

describe("install", () => {
  it("installs every skill and registers its declared hooks", () => {
    const result = install();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(installedDir("continuous-improvement"), "SKILL.md")));
    assert.ok(fs.existsSync(path.join(installedDir("continuous-improvement"), "hooks", "stop.mjs")));
    assert.ok(fs.existsSync(path.join(installedDir("continuous-improvement"), "LOOP_PROMPT.md")));

    const hooks = stopHooks();
    assert.equal(hooks.length, 1);
    assert.match(hooks[0].command, /skills\/continuous-improvement\/hooks\/stop\.mjs/);
    assert.equal(hooks[0].type, "command");
    assert.equal(hooks[0].timeout, 120);
  });

  it("is idempotent — re-running does not duplicate hooks", () => {
    install();
    install();
    install();
    assert.equal(stopHooks().length, 1);
  });

  it("does not leave behind files deleted upstream", () => {
    install();
    const stray = path.join(installedDir("continuous-improvement"), "STALE.md");
    fs.writeFileSync(stray, "left over from an older version\n", "utf8");
    install();
    assert.equal(fs.existsSync(stray), false);
  });

  it("preserves hook entries belonging to other tools", () => {
    install();
    const s = settings();
    s.hooks.Stop.push({ hooks: [{ type: "command", command: "echo unrelated" }] });
    s.hooks.SessionStart = [{ hooks: [{ type: "command", command: "echo session" }] }];
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), "utf8");

    install();
    assert.equal(stopHooks().length, 2);
    assert.equal(settings().hooks.SessionStart.length, 1);

    install(["--uninstall"]);
    const after = stopHooks();
    assert.equal(after.length, 1);
    assert.equal(after[0].command, "echo unrelated");
    assert.equal(settings().hooks.SessionStart.length, 1);
  });

  it("backs settings up before every write", () => {
    install();
    install();
    const backups = fs.readdirSync(path.join(home, ".claude")).filter((f) => f.includes(".bak-"));
    assert.equal(backups.length, 1, "the first run had nothing to back up, the second did");
  });

  it("installs only the named skills", () => {
    const repo = fakeRepo({
      alpha: { name: "alpha", description: "a" },
      beta: { name: "beta", description: "b" },
    });
    try {
      assert.equal(install(["alpha"], repo).status, 0);
      assert.ok(fs.existsSync(installedDir("alpha")));
      assert.equal(fs.existsSync(installedDir("beta")), false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("uninstalls skills and their hooks", () => {
    install();
    assert.equal(install(["--uninstall"]).status, 0);
    assert.equal(fs.existsSync(installedDir("continuous-improvement")), false);
    assert.equal(settings().hooks, undefined, "an empty hooks map is removed, not left as {}");
  });

  it("--dry-run touches nothing", () => {
    const result = install(["--dry-run"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[dry-run\]/);
    assert.equal(fs.existsSync(installedDir("continuous-improvement")), false);
    assert.equal(fs.existsSync(settingsFile()), false);
  });

  it("--list reports what is available and what is installed", () => {
    assert.match(install(["--list"]).stdout, /\[ \] continuous-improvement/);
    install();
    assert.match(install(["--list"]).stdout, /\[x\] continuous-improvement/);
  });
});

describe("install — repository checked out AS ~/.claude", () => {
  it("registers hooks without destroying the skill it is installing", () => {
    // Reproduce the layout where this repository IS the config directory: the checkout sits
    // at ~/.claude, so skills/<name>/ is already exactly where Claude Code reads it and the
    // installer's source and target are the same path.
    const claudeDir = path.join(home, ".claude");
    fs.mkdirSync(path.join(claudeDir, "tools", "skill-installer"), { recursive: true });
    fs.copyFileSync(INSTALLER, path.join(claudeDir, "tools", "skill-installer", "install.mjs"));
    const skillDir = path.join(claudeDir, "skills", "continuous-improvement");
    fs.cpSync(path.join(REPO_DIR, "skills", "continuous-improvement"), skillDir, { recursive: true });

    const result = spawnSync(
      process.execPath,
      [path.join(claudeDir, "tools", "skill-installer", "install.mjs"), "--home", home],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /already in place/);

    // The skill must still be there — the whole point of the in-place guard.
    assert.ok(fs.existsSync(path.join(skillDir, "SKILL.md")));
    assert.ok(fs.existsSync(path.join(skillDir, "hooks", "stop.mjs")));
    assert.ok(fs.existsSync(path.join(skillDir, "LOOP_PROMPT.md")));
    assert.equal(stopHooks().length, 1);
  });

  it("stays idempotent in that layout too", () => {
    const claudeDir = path.join(home, ".claude");
    fs.mkdirSync(path.join(claudeDir, "tools", "skill-installer"), { recursive: true });
    fs.copyFileSync(INSTALLER, path.join(claudeDir, "tools", "skill-installer", "install.mjs"));
    fs.cpSync(
      path.join(REPO_DIR, "skills", "continuous-improvement"),
      path.join(claudeDir, "skills", "continuous-improvement"),
      { recursive: true }
    );
    const run = () =>
      spawnSync(process.execPath, [path.join(claudeDir, "tools", "skill-installer", "install.mjs"), "--home", home], {
        encoding: "utf8",
      });
    run();
    run();
    assert.equal(stopHooks().length, 1);
    assert.ok(fs.existsSync(path.join(claudeDir, "skills", "continuous-improvement", "SKILL.md")));
  });
});

describe("install — fails closed", () => {
  /**
   * @param {Record<string, any>} manifests Synthetic skills.
   * @param {RegExp} expected Expected stderr.
   * @param {object} [opts] fakeRepo options.
   * @returns {void}
   */
  const rejects = (manifests, expected, opts) => {
    const repo = fakeRepo(manifests, opts);
    try {
      const result = install([], repo);
      assert.equal(result.status, 1, `expected a non-zero exit, got: ${result.stdout}`);
      assert.match(result.stderr, expected);
      assert.equal(fs.existsSync(path.join(home, ".claude", "skills")), false, "nothing may be written");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  };

  it("rejects a missing manifest", () => {
    rejects({ alpha: null }, /missing skill\.json/);
  });

  it("rejects an unparseable manifest", () => {
    rejects({ alpha: "{ not json" }, /not valid JSON/);
  });

  it("rejects a name that does not match the directory", () => {
    rejects({ alpha: { name: "beta" } }, /must match the directory/);
  });

  it("rejects a skill with no SKILL.md", () => {
    rejects({ alpha: { name: "alpha" } }, /missing SKILL\.md/, { withSkillMd: false });
  });

  it("rejects a hook command that could never be uninstalled", () => {
    rejects(
      { alpha: { name: "alpha", hooks: { Stop: [{ command: "node /somewhere/else.mjs" }] } } },
      /must reference skills\/alpha\//
    );
  });

  it("rejects a hook entry with no command", () => {
    rejects({ alpha: { name: "alpha", hooks: { Stop: [{ timeout: 5 }] } } }, /needs a string command/);
  });

  it("rejects an unknown skill name", () => {
    const result = install(["does-not-exist"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown skill/);
  });

  it("refuses to overwrite a settings.json it cannot parse", () => {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(settingsFile(), "{ broken", "utf8");
    const result = install();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not valid JSON/);
    assert.equal(fs.readFileSync(settingsFile(), "utf8"), "{ broken");
  });

  it("rejects an unknown option instead of ignoring it", () => {
    const result = install(["--frobnicate"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown option/);
  });
});

describe("installed skill works from ~/.claude", () => {
  it("the continuous-improvement hook runs from its installed location", () => {
    install();
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-project-"));
    try {
      fs.mkdirSync(path.join(projectDir, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, ".claude", "continuous-improvement.active"),
        "armed by test\n",
        "utf8"
      );
      const result = spawnSync(
        process.execPath,
        [path.join(installedDir("continuous-improvement"), "hooks", "stop.mjs")],
        {
          input: JSON.stringify({
            hook_event_name: "Stop",
            cwd: projectDir,
            last_assistant_message: "Work done.\n\nNEXT-STEP: CONTINUE — next thing",
          }),
          encoding: "utf8",
          env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
        }
      );
      assert.equal(result.status, 0, result.stderr);
      const out = JSON.parse(result.stdout);
      assert.equal(out.decision, "block");
      assert.match(out.reason, /next thing/);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("its own test suite passes from the installed location", () => {
    install();
    const result = spawnSync(process.execPath, ["--test", "tests/*.test.mjs"], {
      cwd: installedDir("continuous-improvement"),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stdout.slice(-2000));
  });
});
