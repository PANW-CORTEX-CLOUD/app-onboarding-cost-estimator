/**
 * appendTfHonestyWarnings's AWS/GCP path, gated on AWS_TF_PRESENT/
 * GCP_TF_PRESENT rather than a hardcoded provider check. Both flags are
 * hardcoded `false` today (neither provider has a connector TF inventory
 * yet), so the "flag true" branch below is exercised via a module mock -
 * there is no real-world path to flip it without a Terraform-inventory
 * feature that doesn't exist yet.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../aws/capability-meter-map.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../aws/capability-meter-map.ts")
  >();
  return { ...actual, AWS_TF_PRESENT: true };
});

const { appendTfHonestyWarnings } = await import("../tf-honesty-warnings.ts");
const { NO_TF_INVENTORY_WARNING } = await import(
  "../azure/tf-audit-reconciliation.ts"
);

describe("appendTfHonestyWarnings — AWS_TF_PRESENT gate", () => {
  it("does not push the no-TF-inventory note once AWS_TF_PRESENT is true", () => {
    const w: string[] = [];
    appendTfHonestyWarnings("aws", { registry: true }, w);
    expect(w.some((x) => x.includes(NO_TF_INVENTORY_WARNING))).toBe(false);
  });

  it("GCP (still false) is unaffected by the AWS mock", () => {
    const w: string[] = [];
    appendTfHonestyWarnings("gcp", { registry: true }, w);
    expect(w.some((x) => x.includes(NO_TF_INVENTORY_WARNING))).toBe(true);
  });
});
