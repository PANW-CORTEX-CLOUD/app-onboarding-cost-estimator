/**
 * Package 19 — Playwright happy-path against local api+web.
 * Package 33 — Azure audit-only meter allowlist (TF-faithful).
 * Journey UX — Overview → Inputs → Run → Cost output.
 */
import { test, expect } from "@playwright/test";

const AZURE_AUDIT_ALLOWLIST = new Set([
  "eh-standard-tu",
  "eh-standard-ingress-events",
  "blob-hot-lrs-capacity",
  "blob-hot-lrs-write-10k",
  "blob-hot-lrs-read-10k",
]);

test.describe("MVP happy path", () => {
  test("journey Inputs → azure audit → Run → Cost meters allowlist", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Cost Estimator/i })).toBeVisible();
    await expect(page.getByTestId("journey-tab-inputs")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Step 1 — decide what to price. Audit logs is the only Azure capability
    // the connector Terraform actually deploys, so it is the only one that can
    // survive as-deployed mode.
    await expect(page.getByTestId("journey-step-progress")).toContainText(
      "Step 1 of 4",
    );
    await expect(page.getByTestId("scope-badge-auditLogs")).toContainText(
      "Deployed by your Terraform",
    );
    await expect(page.getByTestId("scope-badge-dspm")).toContainText(
      "No Terraform",
    );
    await page.getByTestId("scope-cap-dspm").check();
    await page.getByTestId("tf-mode-as-deployed").check();
    await expect(page.getByTestId("scope-summary-dropped")).toContainText(
      "not created by the Terraform",
    );
    // Back to what-if and drop DSPM so the rest of the run is the audit-only path.
    await page.getByTestId("scope-cap-dspm").uncheck();
    await page.getByTestId("tf-mode-what-if").check();
    await page.getByTestId("journey-step-continue").click();

    await page
      .getByTestId("section-provider-region")
      .getByRole("radio", { name: "AWS", exact: true })
      .click();
    await expect(page.getByTestId("region-select")).toHaveValue("us-east-1");

    await page.getByTestId("demo-preset-azure-audit").click();
    await expect(page.getByTestId("region-select")).toHaveValue("eastus");

    await page.getByTestId("journey-step-continue").click();
    await page.getByTestId("journey-step-continue").click();
    await expect(page.getByTestId("journey-step-progress")).toContainText(
      "Step 4 of 4",
    );
    await expect(page.getByTestId("journey-step-continue")).toHaveCount(0);
    await expect(page.getByTestId("view-cost-output")).toHaveCount(0);
    await page.getByTestId("run-estimate").click();

    await expect(page.getByTestId("journey-tab-cost")).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 60_000 },
    );
    await expect(page.getByTestId("summary-monthly-expected")).not.toHaveText(
      /—\s*$/,
      { timeout: 60_000 },
    );
    await page.getByTestId("results-tab-cost").click();
    await page.getByTestId("result-flip-toggle").click();
    await expect(page.getByTestId("cost-breakdown")).toBeVisible();
    await expect(page.getByTestId("summary-provider")).toContainText("Azure");

    await expect(page.getByTestId("estimate-honesty-banner")).toHaveCount(0);
    const meterIds = await page
      .getByTestId("cost-breakdown")
      .locator(".meter-id")
      .allTextContents();
    expect(meterIds.length).toBeGreaterThan(0);
    for (const id of meterIds) {
      expect(AZURE_AUDIT_ALLOWLIST.has(id.trim())).toBe(true);
    }
    expect(meterIds.join(" ")).not.toMatch(/capture|ads|dspm|acr/i);

    await expect(page.getByTestId("export-json")).toBeEnabled();
    await expect(page.getByTestId("disclaimer")).toContainText("Indicative");
  });

  test("DSPM asks for average object size and prices operations, not gigabytes", async ({
    page,
  }) => {
    await page.goto("/");

    // Overview: DSPM has no connector Terraform, so it is a what-if only.
    await page.getByTestId("scope-cap-dspm").check();
    await expect(page.getByTestId("scope-badge-dspm")).toContainText("No Terraform");
    await expect(page.getByTestId("scope-drivers-dspm")).toContainText("Data estate GB");
    await page.getByTestId("tf-mode-what-if").check();
    await page.getByTestId("journey-step-continue").click();
    await page.getByTestId("journey-step-continue").click();

    // The driver step must ask what converts an estate size into billable
    // API calls — object stores charge per call, not per gigabyte.
    const objectSize = page.getByTestId("input-avg-object-size-mb");
    await expect(objectSize).toBeVisible();
    await page.getByTestId("input-estate-main").fill("51200");
    await objectSize.fill("4");

    await page.getByTestId("journey-step-continue").click();
    await page.getByTestId("run-estimate").click();

    await expect(page.getByTestId("journey-tab-cost")).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 60_000 },
    );
    await page.getByTestId("results-tab-cost").click();
    await page.getByTestId("result-flip-toggle").click();

    const meterIds = await page
      .getByTestId("cost-breakdown")
      .locator(".meter-id")
      .allTextContents();
    const ids = meterIds.map((m) => m.trim());
    expect(ids).toContain("blob-hot-lrs-read-10k");
    expect(ids).toContain("blob-hot-lrs-list-10k");
    // The invented per-GB scan meters must never reach the breakdown again.
    expect(ids).not.toContain("blob-data-read-ops");
  });
});
