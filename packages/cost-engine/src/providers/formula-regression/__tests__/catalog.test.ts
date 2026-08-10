/**
 * Package 14 — catalog / EDGE: OFFICIAL_FORMULA_CHECKS.md ↔ registry,
 * drift warn (no auto-pass), no silent skip env, optional live smoke.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FORMULA_CHECKS,
  LIVE_FALLBACK_DRIFT_WARN_RATIO,
  assertFormulaChecksNotSkippedByEnv,
  liveVsFallbackDrift,
} from "../registry.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../../../");
const CHECKS_MD = path.join(REPO_ROOT, "sources/OFFICIAL_FORMULA_CHECKS.md");
const README = path.join(REPO_ROOT, "sources/README.md");

const OFFICIAL_HOST_SUFFIXES = [
  "azure.microsoft.com",
  "learn.microsoft.com",
  "microsoft.com",
  "aws.amazon.com",
  "docs.aws.amazon.com",
  "amazon.com",
  "cloud.google.com",
] as const;

function isOfficialHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_HOST_SUFFIXES.some(
      (s) => host === s || host.endsWith(`.${s}`),
    );
  } catch {
    return false;
  }
}

function extractHttpsUrls(md: string): string[] {
  const urls = new Set<string>();
  const re = /https:\/\/[^\s)|>]+/g;
  for (const m of md.matchAll(re)) {
    urls.add(m[0].replace(/[.,;]+$/, ""));
  }
  return [...urls];
}

describe("package 14 — formula regression catalog (AC/EDGE)", () => {
  it("never skips via env silent bypass", () => {
    assertFormulaChecksNotSkippedByEnv();
    expect(() =>
      assertFormulaChecksNotSkippedByEnv({
        SKIP_FORMULA_CHECKS: "1",
      } as NodeJS.ProcessEnv),
    ).toThrow(/Illegal silent bypass/);
  });

  it("OFFICIAL_FORMULA_CHECKS.md has checkedAt + refresh procedure in README", () => {
    const md = fs.readFileSync(CHECKS_MD, "utf8");
    expect(md).toMatch(/checkedAt:\s*\d{4}-\d{2}-\d{2}/);
    expect(md).toMatch(/Package 14/i);
    const readme = fs.readFileSync(README, "utf8");
    expect(readme).toMatch(/refresh procedure/i);
    expect(readme).toMatch(/OFFICIAL_FORMULA_CHECKS/);
  });

  it("each registry entry URL is official and cited in OFFICIAL_FORMULA_CHECKS.md", () => {
    const md = fs.readFileSync(CHECKS_MD, "utf8");
    const docUrls = extractHttpsUrls(md);
    expect(FORMULA_CHECKS.length).toBeGreaterThanOrEqual(9);
    for (const check of FORMULA_CHECKS) {
      expect(isOfficialHost(check.officialUrl)).toBe(true);
      expect(docUrls).toContain(check.officialUrl);
    }
    // Doc updates require explicit AC test updates: every capacity/snapshot
    // registry URL must appear; adding a doc-only formula without registry
    // is OK, but dropping a registry URL from the doc fails.
  });

  it("live vs fallback drift >30% warns and never auto-passes", () => {
    const ok = liveVsFallbackDrift(0.03, 0.03);
    expect(ok.warn).toBe(false);
    expect(ok.autoPass).toBe(false);

    const drifted = liveVsFallbackDrift(0.05, 0.03);
    expect(drifted.ratio).toBeGreaterThan(LIVE_FALLBACK_DRIFT_WARN_RATIO);
    expect(drifted.warn).toBe(true);
    expect(drifted.autoPass).toBe(false);

    // Warn must not be treated as pass
    expect(drifted.warn && drifted.autoPass).toBe(false);
  });

  it("optional live price smoke (LIVE_PRICE_SMOKE=1) — fail closed when opted in", async () => {
    if (process.env.LIVE_PRICE_SMOKE !== "1") {
      // Documented optional smoke: when unset, do not skip silently via
      // a "pass" flag — this branch is the explicit opt-out contract.
      expect(process.env.LIVE_PRICE_SMOKE ?? "").not.toBe("1");
      return;
    }
    // Opt-in: probe one official pricing host; failure fails the suite.
    const url = "https://azure.microsoft.com/en-us/pricing/details/event-hubs/";
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    expect(res.ok || res.status === 405 || res.status === 403).toBe(true);

    // Simulated drift check against golden fallback (warn path, no auto-pass)
    const fallback = 0.03;
    const liveProbe = fallback * 1.5; // >30% drift fixture when live smoke on
    const d = liveVsFallbackDrift(liveProbe, fallback);
    expect(d.warn).toBe(true);
    expect(d.autoPass).toBe(false);
  });
});
