/**
 * Package 25 — EDGE+ UI hardening for packages 17–23.
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EstimatorSection } from "../shared/ui/EstimatorSection.tsx";
import { Disclaimer } from "../widgets/Disclaimer/Disclaimer.tsx";
import {
  deserializeShareState,
  readShareFromSearch,
} from "../shared/lib/share-state.ts";
import { writeLocalJson } from "../shared/lib/safe-storage.ts";
import {
  parseBillingCsv,
  CALIBRATION_MAX_BYTES,
} from "../features/calibration/billingCsv.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.resolve(__dirname, "..");

describe("package 17 — EDGE+", () => {
  it("package 17 — EDGE+ web sources never import retail price hosts directly", () => {
    const hits: string[] = [];
    function walk(dir: string) {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(ent.name)) {
          const t = readFileSync(p, "utf8");
          if (
            /prices\.azure\.com|api\.pricing\.|cloudbilling\.googleapis|pricing\.amazonaws/i.test(
              t,
            )
          ) {
            hits.push(path.relative(WEB_SRC, p));
          }
        }
      }
    }
    walk(WEB_SRC);
    expect(hits).toEqual([]);
  });
});

describe("package 18 — EDGE+", () => {
  it("package 18 — EDGE+ section loading exposes skeleton testid", () => {
    render(
      <EstimatorSection id="breakdown" title="Breakdown" loading>
        <p>hidden while loading</p>
      </EstimatorSection>,
    );
    expect(screen.getByTestId("skeleton-breakdown")).toBeInTheDocument();
  });
});

describe("package 19 — EDGE+", () => {
  it("package 19 — EDGE+ mobile viewport resize does not throw on disclaimer mount", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 375,
    });
    window.dispatchEvent(new Event("resize"));
    render(<Disclaimer modelVersion="0.1.0" />);
    expect(screen.getByTestId("disclaimer")).toBeInTheDocument();
  });
});

describe("package 20 — EDGE+", () => {
  it("package 20 — EDGE+ projection charts source includes hatched envelope testids", () => {
    const src = readFileSync(
      path.join(WEB_SRC, "widgets/ProjectionCharts/ProjectionCharts.tsx"),
      "utf8",
    );
    expect(src).toMatch(/envelope-/);
    expect(src).toMatch(/hatched envelope/i);
  });
});

describe("package 21 — EDGE+", () => {
  it("package 21 — EDGE+ localStorage quota fails closed; malformed share errors", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    const r = writeLocalJson("cloud-connector:quota-probe", { a: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("quota");
    setItem.mockRestore();

    const bad = deserializeShareState("!!!not-base64!!!");
    expect(bad.ok).toBe(false);
    const fromSearch = readShareFromSearch("?s=!!!bad!!!");
    expect(fromSearch && fromSearch.ok === false).toBe(true);
  });
});

describe("package 22 — EDGE+", () => {
  it("package 22 — EDGE+ disclaimer collapse is session-only with English baseline", () => {
    cleanup();
    render(<Disclaimer modelVersion="0.1.0" />);
    expect(screen.getByTestId("disclaimer-lang")).toHaveTextContent(
      /English baseline/i,
    );
    fireEvent.click(screen.getByTestId("disclaimer-collapse"));
    expect(screen.getByTestId("disclaimer-collapsed-note")).toHaveTextContent(
      /session only/i,
    );
    expect(screen.getByTestId("disclaimer-collapse")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("package 23 — EDGE+", () => {
  it("package 23 — EDGE+ size cap rejects oversized CSV with fail-closed errors", () => {
    const huge =
      "MeterCategory,CostInBillingCurrency,Currency\n" +
      "Event Hubs,1,USD\n".repeat(50_000);
    const tinyCap = parseBillingCsv(huge, { maxBytes: 100 });
    expect(tinyCap).toMatchObject({ ok: false });
    expect(CALIBRATION_MAX_BYTES).toBeGreaterThan(0);
  });
});
