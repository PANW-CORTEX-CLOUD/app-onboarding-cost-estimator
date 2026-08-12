#!/usr/bin/env node
/**
 * refresh-fonts.mjs — regenerate the self-hosted web fonts for apps/web.
 *
 * WHY these fonts are self-hosted (not loaded from fonts.googleapis.com):
 * The app ships two Google Fonts (IBM Plex Sans for the UI, Newsreader for
 * headings). Pulling them from Google's CDN at runtime has two costs an
 * internal tool should not pay:
 *   1. Privacy / data-egress — every page load pings Google and leaks the
 *      visitor's IP + User-Agent to a third party, for a tool that otherwise
 *      talks only to its own API.
 *   2. It fails closed the wrong way in air-gapped / CSP-locked networks —
 *      exactly where an internal estimator gets deployed. The stylesheet
 *      request silently fails, the UI degrades to system fonts, and the
 *      browser console fills with errors. This was caught in the REQ-24
 *      bug-hunt; see docs/IMPROVEMENT_PLAN.md, UC-24.4 (T-24.4.1).
 * So the latin-subset variable woff2 for the exact same families/weights are
 * checked in under apps/web/public/fonts/ and referenced by a local
 * fonts.css. The typography is unchanged and works with no network at all.
 *
 * WHAT this script does: it re-derives those checked-in binaries + CSS from
 * Google Fonts so they can be audited and reproduced instead of being a
 * hand-fetched black box. It fetches the css2 stylesheet for the same
 * families/weights the app uses (with a desktop Chrome UA so Google returns
 * woff2), keeps ONLY the `latin` subset @font-face blocks, downloads each
 * unique woff2 under stable names, and rewrites fonts.css to point at the
 * local copies. It is deterministic: as long as Google serves the same font
 * version, the output is byte-identical to what is committed. It prints the
 * sha256 of every file it writes so a reviewer can diff against git.
 *
 * HOW to run (manual / refresh only — deliberately NOT in build or test):
 *   pnpm fonts:refresh
 *   # or: node scripts/refresh-fonts.mjs
 *
 * If the sha256 changes, Google published a new font version. Decide whether
 * to adopt it (commit the new binaries) or pin to the old one; do not commit
 * a silent drift.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FONTS_DIR = path.join(ROOT, "apps", "web", "public", "fonts");

// A desktop Chrome UA makes Google Fonts serve woff2 (older/unknown UAs get
// ttf or the legacy formats, which would change the bytes we download).
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// The exact families/weights apps/web uses. Keep in sync with
// apps/web/public/fonts/fonts.css and apps/web/index.html. The css2 `family`
// query params below are what produced the currently committed fonts:
//   - IBM Plex Sans, weights 400;500;600;700 (wght axis, one variable woff2)
//   - Newsreader, optical-size 6..72 at weights 500;600 (one variable woff2)
// `localName` maps each family to its stable on-disk filename. Google serves a
// single variable woff2 per family covering the whole weight range, so every
// per-weight latin @font-face block for a family points at the same file.
const FAMILIES = [
  { family: "IBM Plex Sans", query: "IBM+Plex+Sans:wght@400;500;600;700", localName: "IBMPlexSans-latin.woff2" },
  { family: "Newsreader", query: "Newsreader:opsz,wght@6..72,500;6..72,600", localName: "Newsreader-latin.woff2" },
];

// First line of the generated CSS. Kept identical to the committed file.
const CSS_HEADER =
  "/* Self-hosted latin-subset variable fonts (wght axis) for the UI. " +
  "Generated from Google Fonts; see index.html for why. */";

const CSS2_URL =
  "https://fonts.googleapis.com/css2?" +
  FAMILIES.map((f) => `family=${f.query}`).join("&") +
  "&display=swap";

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function fetchText(url, what) {
  const res = await fetch(url, { headers: { "User-Agent": CHROME_UA } });
  if (!res.ok) throw new Error(`Failed to fetch ${what} (${url}): HTTP ${res.status}`);
  return res.text();
}

async function fetchBinary(url, what) {
  const res = await fetch(url, { headers: { "User-Agent": CHROME_UA } });
  if (!res.ok) throw new Error(`Failed to fetch ${what} (${url}): HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Parse Google's css2 output into subset-labelled @font-face blocks. Google
 * emits each block preceded by a `/* subset *​/` comment (latin, latin-ext,
 * cyrillic, greek, vietnamese, …). We keep only `latin`.
 */
function extractLatinBlocks(css) {
  const blockRe = /\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[\s\S]*?\})/g;
  const blocks = [];
  let m;
  while ((m = blockRe.exec(css)) !== null) {
    const subset = m[1];
    const block = m[2];
    if (subset !== "latin") continue;
    const famMatch = block.match(/font-family:\s*'([^']+)'/);
    const urlMatch = block.match(/src:\s*url\(([^)]+)\)/);
    if (!famMatch || !urlMatch) {
      throw new Error(`Could not parse family/src from block:\n${block}`);
    }
    blocks.push({ family: famMatch[1], remoteUrl: urlMatch[1], block });
  }
  return blocks;
}

async function main() {
  console.log(`Fetching CSS: ${CSS2_URL}`);
  const css = await fetchText(CSS2_URL, "Google Fonts css2");

  const latinBlocks = extractLatinBlocks(css);
  if (latinBlocks.length === 0) throw new Error("No latin @font-face blocks found in Google response.");

  // Resolve each block's family -> committed local filename.
  const familyToLocal = new Map(FAMILIES.map((f) => [f.family, f.localName]));
  for (const b of latinBlocks) {
    const localName = familyToLocal.get(b.family);
    if (!localName) throw new Error(`Unexpected family in latin blocks: '${b.family}'`);
    b.localName = localName;
  }

  // Dedupe downloads by remote URL — Google serves one variable woff2 per
  // family, so all of a family's per-weight latin blocks share it.
  const byUrl = new Map();
  for (const b of latinBlocks) {
    if (!byUrl.has(b.remoteUrl)) byUrl.set(b.remoteUrl, b.localName);
  }

  fs.mkdirSync(FONTS_DIR, { recursive: true });

  const written = [];
  for (const [remoteUrl, localName] of byUrl) {
    console.log(`Downloading ${localName} <- ${remoteUrl}`);
    const buf = await fetchBinary(remoteUrl, localName);
    const outPath = path.join(FONTS_DIR, localName);
    fs.writeFileSync(outPath, buf);
    written.push(outPath);
  }

  // Rebuild fonts.css: keep each latin block verbatim, rewriting only the src
  // to a relative local path. Block order is Google's encounter order, which
  // matches the committed file.
  const cssBlocks = latinBlocks.map((b) =>
    b.block.replace(/src:\s*url\([^)]+\)/, `src: url(./${b.localName})`),
  );
  const cssOut = `${CSS_HEADER}\n${cssBlocks.join("\n")}\n`;
  const cssPath = path.join(FONTS_DIR, "fonts.css");
  fs.writeFileSync(cssPath, cssOut);
  written.push(cssPath);

  console.log("\nWrote:");
  for (const p of written) {
    const buf = fs.readFileSync(p);
    console.log(`  ${sha256(buf)}  ${path.relative(ROOT, p)}  (${buf.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
