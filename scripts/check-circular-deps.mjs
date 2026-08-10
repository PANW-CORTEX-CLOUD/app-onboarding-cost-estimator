#!/usr/bin/env node
/**
 * check-circular-deps.mjs — Fail-closed workspace package.json dependency cycle detector.
 * Usage: node scripts/check-circular-deps.mjs [--root DIR]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(
  process.argv.includes("--root")
    ? process.argv[process.argv.indexOf("--root") + 1]
    : path.join(__dirname, ".."),
);

const PKG_DIRS = [
  "packages/cost-engine",
  "packages/api",
  "apps/web",
];

/** @type {Map<string, string[]>} */
const graph = new Map();

for (const dir of PKG_DIRS) {
  const pkgPath = path.join(ROOT, dir, "package.json");
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const name = pkg.name;
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };
  const workspaceDeps = Object.keys(deps).filter(
    (d) => d.startsWith("@cloud-connector/") || deps[d].startsWith("workspace:"),
  );
  graph.set(name, workspaceDeps.filter((d) => d.startsWith("@cloud-connector/")));
}

/** @returns {string[] | null} cycle path */
function findCycle() {
  const visiting = new Set();
  const visited = new Set();
  /** @type {string[]} */
  const stack = [];

  function dfs(node) {
    if (visiting.has(node)) {
      const i = stack.indexOf(node);
      return stack.slice(i).concat(node);
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      const c = dfs(next);
      if (c) return c;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    const c = dfs(node);
    if (c) return c;
  }
  return null;
}

const cycle = findCycle();
if (cycle) {
  console.error(`CIRCULAR DEPS: ${cycle.join(" → ")}`);
  process.exit(1);
}

console.log("CIRCULAR DEPS: OK");
process.exit(0);
