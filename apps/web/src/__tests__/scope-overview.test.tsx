/**
 * Overview step — what you want, whether the Terraform deploys it, and what
 * that means for the questions and the total.
 *
 * The deployability labels the UI shows are a claim about the customer's real
 * infrastructure, so they are bound here to sources/tf-feature-manifest.json,
 * which scripts/derive-tf-manifest.mjs derives by walking azure/data. Toggling
 * a module in the Terraform must move both, or this fails.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScopeOverview } from "../widgets/ScopeOverview/ScopeOverview.tsx";
import {
  AZURE_CAPABILITY_DEPLOYABILITY,
  CAPABILITY_KEY_TO_ENGINE_ID,
  capabilityDeployability,
  costDriversForSelection,
} from "../shared/model/tf-grounding.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(
  __dirname,
  "../../../../sources/tf-feature-manifest.json",
);

type Manifest = {
  capabilities: Record<string, { availability: string; billableMeters: string[] }>;
};

function loadManifest(): Manifest {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

describe("UI deployability labels are bound to the real Terraform", () => {
  it("every capability agrees with the derived manifest", () => {
    const manifest = loadManifest();
    for (const [uiKey, uiValue] of Object.entries(AZURE_CAPABILITY_DEPLOYABILITY)) {
      const engineId = CAPABILITY_KEY_TO_ENGINE_ID[uiKey];
      expect(engineId, `no engine id mapped for ${uiKey}`).toBeTruthy();
      const derived = manifest.capabilities[engineId];
      expect(derived, `manifest has no row for ${engineId}`).toBeDefined();
      // deployed-no-meter still means the Terraform creates it.
      const expected =
        derived.availability === "deployed-no-meter"
          ? "deployed"
          : derived.availability;
      expect(uiValue, `${uiKey} (${engineId})`).toBe(expected);
    }
  });

  it("only audit logs is billable as deployed on Azure today", () => {
    expect(capabilityDeployability("azure", "auditLogs")).toBe("deployed");
    expect(capabilityDeployability("azure", "discovery")).toBe("not-deployed");
    expect(capabilityDeployability("azure", "dspm")).toBe("no-connector-tf");
  });

  it("AWS and GCP never inherit Azure's deployability", () => {
    for (const provider of ["aws", "gcp"] as const) {
      expect(capabilityDeployability(provider, "auditLogs")).toBe(
        "no-connector-tf",
      );
    }
  });
});

describe("cost-driver questions follow the selection", () => {
  it("nothing selected asks nothing", () => {
    expect(costDriversForSelection([])).toStrictEqual([]);
  });

  it("discovery alone asks nothing because it has no meter", () => {
    expect(costDriversForSelection(["discovery"])).toStrictEqual([]);
  });

  it("shared drivers are asked once, not per capability", () => {
    const drivers = costDriversForSelection(["dspm", "registry"]);
    expect(drivers.filter((d) => d === "Scans per month")).toHaveLength(1);
    expect(drivers).toContain("Data estate GB");
    expect(drivers).toContain("Container image count");
  });
});

// This suite renders the widget directly rather than through App, so it has
// to unmount between cases itself.
afterEach(cleanup);

function renderOverview(overrides: Partial<React.ComponentProps<typeof ScopeOverview>> = {}) {
  const onChange = vi.fn();
  const onTfModeChange = vi.fn();
  const props = {
    provider: "azure" as const,
    value: { auditLogs: true },
    onChange,
    tfMode: "what-if" as const,
    onTfModeChange,
    ...overrides,
  };
  render(<ScopeOverview {...props} />);
  return { onChange, onTfModeChange };
}

describe("overview step behaviour", () => {
  it("badges each capability with whether the Terraform deploys it", () => {
    renderOverview();
    expect(screen.getByTestId("scope-badge-auditLogs").textContent).toMatch(
      /Deployed by your Terraform/,
    );
    expect(screen.getByTestId("scope-badge-discovery").textContent).toMatch(
      /switched off/i,
    );
    expect(screen.getByTestId("scope-badge-dspm").textContent).toMatch(
      /No Terraform/i,
    );
  });

  it("says up front which questions a capability will add", () => {
    renderOverview();
    expect(screen.getByTestId("scope-drivers-dspm").textContent).toMatch(
      /Data estate GB/,
    );
    expect(screen.getByTestId("scope-drivers-discovery").textContent).toMatch(
      /Asks nothing/,
    );
  });

  it("summarises how much of the selection is really billable", () => {
    renderOverview({ value: { auditLogs: true, dspm: true } });
    const counts = screen.getByTestId("scope-summary-counts").textContent ?? "";
    expect(counts).toMatch(/2 selected/);
    expect(counts).toMatch(/1 billed from your Terraform/);
    expect(counts).toMatch(/1 modelled without Terraform/);
  });

  it("warns before running that as-deployed will drop the modelled picks", () => {
    renderOverview({ value: { auditLogs: true, dspm: true }, tfMode: "as-deployed" });
    const dropped = screen.getByTestId("scope-summary-dropped").textContent ?? "";
    expect(dropped).toMatch(/Data security posture/);
    expect(dropped).toMatch(/not created by the Terraform/);
  });

  it("does not warn when every pick is deployed", () => {
    renderOverview({ value: { auditLogs: true }, tfMode: "as-deployed" });
    expect(screen.queryByTestId("scope-summary-dropped")).toBeNull();
  });

  it("prompts for a selection instead of showing an empty cost", () => {
    renderOverview({ value: {} });
    expect(screen.getByTestId("scope-summary-empty").textContent).toMatch(
      /pick at least one capability/i,
    );
  });

  it("toggling a capability and the pricing mode reports upward", () => {
    const { onChange, onTfModeChange } = renderOverview();
    fireEvent.click(screen.getByTestId("scope-cap-dspm"));
    expect(onChange).toHaveBeenCalledWith({ auditLogs: true, dspm: true });
    fireEvent.click(screen.getByTestId("tf-mode-as-deployed"));
    expect(onTfModeChange).toHaveBeenCalledWith("as-deployed");
  });
});
