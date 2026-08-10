/**
 * Boundary regression — FSD upward imports and web→engine/api must fail closed.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../../..");
const LINTER = path.join(REPO, "scripts/check-boundaries.mjs");

describe("package 17 — boundary linter", () => {
  it("passes on current apps/web tree", () => {
    const out = execFileSync(process.execPath, [LINTER], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(out).toContain("BOUNDARY CHECK: OK");
  });

  it("forbids FSD upward imports (features → widgets)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsd-bound-"));
    const webSrc = path.join(tmp, "apps/web/src");
    fs.mkdirSync(path.join(webSrc, "features/bad"), { recursive: true });
    fs.mkdirSync(path.join(webSrc, "widgets/Good"), { recursive: true });
    fs.writeFileSync(
      path.join(webSrc, "widgets/Good/Good.tsx"),
      "export const Good = () => null;\n",
    );
    fs.writeFileSync(
      path.join(webSrc, "features/bad/bad.ts"),
      'import { Good } from "../../widgets/Good/Good.tsx";\nexport const x = Good;\n',
    );
    // minimal stubs so walk finds only these
    fs.mkdirSync(path.join(tmp, "packages/cost-engine/src"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "packages/api/src"), { recursive: true });

    let code = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [LINTER, "--root", tmp], {
        encoding: "utf8",
      });
    } catch (e: unknown) {
      const err = e as { status?: number; stderr?: string; stdout?: string };
      code = err.status ?? 1;
      stderr = `${err.stderr ?? ""}${err.stdout ?? ""}`;
    }
    expect(code).toBe(1);
    expect(stderr).toMatch(/web-fsd-no-upward-import/);
  });

  it("forbids web import of packages/api or cost-engine providers", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "web-eng-bound-"));
    const webSrc = path.join(tmp, "apps/web/src/shared");
    fs.mkdirSync(webSrc, { recursive: true });
    fs.writeFileSync(
      path.join(webSrc, "bad.ts"),
      'import x from "../../../../packages/api/src/app.ts";\nexport { x };\n',
    );
    fs.mkdirSync(path.join(tmp, "packages/cost-engine/src"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "packages/api/src"), { recursive: true });

    let code = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [LINTER, "--root", tmp], {
        encoding: "utf8",
      });
    } catch (e: unknown) {
      const err = e as { status?: number; stderr?: string; stdout?: string };
      code = err.status ?? 1;
      stderr = `${err.stderr ?? ""}${err.stdout ?? ""}`;
    }
    expect(code).toBe(1);
    expect(stderr).toMatch(
      /web-no-engine-internals-or-api-src|no-deep-cross-package-relative/,
    );
  });
});
