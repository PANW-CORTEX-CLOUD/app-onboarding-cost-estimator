/**
 * Guard against the silent-no-op trap in vitest.config.ts.
 *
 * The per-provider projects glob a directory, but the two cross-cutting test
 * directories — `src/providers/__tests__/` and `src/__tests__/` — were once
 * enumerated file-by-file. A test dropped into either that no `include`
 * pattern matched would run **nowhere**: `pnpm test` stays green while none
 * of its assertions execute. That is the worst failure a test can have,
 * because it looks exactly like success.
 *
 * This test closes the loop: every physical `*.test.ts` under those two
 * directories must be matched by at least one `include` glob in the config.
 * It fails loudly if anyone reverts to hand-listing and misses a file, or
 * narrows a glob so a file falls out of coverage. (It is itself one of the
 * files it checks — if the `src/__tests__/**` glob were removed, this guard
 * would stop running, but the total test-file count would drop and the meta
 * gate / CI diff would surface it.)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const CONFIG = path.join(PACKAGE_ROOT, "vitest.config.ts");

/** The directories that hold cross-cutting tests and must be glob-covered. */
const SHARED_TEST_DIRS = [
  "src/providers/__tests__",
  "src/__tests__",
];

/** Every include string across every project in the config. */
function configIncludeGlobs(): string[] {
  const text = fs.readFileSync(CONFIG, "utf8");
  // Match quoted paths that look like an include pattern (end in .ts / **/... ).
  return [...text.matchAll(/["'](src\/[^"']+?\.test\.ts|src\/[^"']+?\*\*\/[^"']+?)["']/g)].map(
    (m) => m[1]!,
  );
}

/** Minimal glob → RegExp for the `**` / `*` patterns this config uses. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped
    .replace(/\*\*\//g, "§§") // `**/` → optional path segments (placeholder)
    .replace(/\*\*/g, "§") // bare `**` → anything
    .replace(/\*/g, "[^/]*") // `*` → within one segment
    .replace(/§§/g, "(?:.*/)?")
    .replace(/§/g, ".*");
  return new RegExp(`^${body}$`);
}

function physicalTestFiles(relDir: string): string[] {
  const abs = path.join(PACKAGE_ROOT, relDir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => `${relDir}/${f}`);
}

describe("vitest test-discovery guard", () => {
  const globs = configIncludeGlobs();
  const matchers = globs.map(globToRegExp);

  for (const dir of SHARED_TEST_DIRS) {
    it(`every *.test.ts in ${dir} is covered by a config include glob`, () => {
      const files = physicalTestFiles(dir);
      // Sanity: the dir exists and has tests, so a false "0 files, all covered"
      // pass is impossible.
      expect(files.length).toBeGreaterThan(0);
      const uncovered = files.filter((f) => !matchers.some((re) => re.test(f)));
      expect(
        uncovered,
        `these files are not matched by any include glob in vitest.config.ts, ` +
          `so they run nowhere:\n  ${uncovered.join("\n  ")}`,
      ).toEqual([]);
    });
  }

  it("the shared dirs are glob-covered, not enumerated file-by-file", () => {
    // The rule, stated directly: no include pattern may name an individual
    // .test.ts file inside a shared dir — those must be covered by a `**`
    // glob so a new file can never be a no-op.
    const perFileInSharedDir = globs.filter(
      (g) =>
        g.endsWith(".test.ts") &&
        !g.includes("*") && // a `**/*.test.ts` glob is fine; a literal path is not
        SHARED_TEST_DIRS.some((d) => g.startsWith(`${d}/`)),
    );
    expect(
      perFileInSharedDir,
      `vitest.config.ts lists these shared-dir tests by name; glob the ` +
        `directory instead:\n  ${perFileInSharedDir.join("\n  ")}`,
    ).toEqual([]);
  });
});
