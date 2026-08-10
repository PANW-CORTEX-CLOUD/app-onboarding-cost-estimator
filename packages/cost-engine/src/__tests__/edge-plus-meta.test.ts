/**
 * Package 25 — meta-gate: every plan EDGE package 01–23 must have an EDGE+ test marker.
 * Fail closed with the list of missing NNs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../");

const SCAN_ROOTS = [
  path.join(REPO_ROOT, "packages"),
  path.join(REPO_ROOT, "apps/web/src/__tests__"),
  path.join(REPO_ROOT, "apps/web/e2e"),
];

const MARKER = /package (\d{2}) — EDGE\+/g;

function collectMarkers(): Set<string> {
  const found = new Set<string>();
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === "dist") continue;
        walk(p);
      } else if (/\.(ts|tsx|mjs|js)$/.test(ent.name)) {
        const text = fs.readFileSync(p, "utf8");
        for (const m of text.matchAll(MARKER)) {
          found.add(m[1]!);
        }
      }
    }
  }
  for (const root of SCAN_ROOTS) walk(root);
  return found;
}

describe("package 25 — EDGE+ meta-gate", () => {
  it("every package 01–23 has a package NN — EDGE+ marker", () => {
    const found = collectMarkers();
    const missing: string[] = [];
    for (let i = 1; i <= 23; i++) {
      const nn = String(i).padStart(2, "0");
      if (!found.has(nn)) missing.push(nn);
    }
    expect(missing, `missing EDGE+ markers for: ${missing.join(", ")}`).toEqual(
      [],
    );
  });
});
