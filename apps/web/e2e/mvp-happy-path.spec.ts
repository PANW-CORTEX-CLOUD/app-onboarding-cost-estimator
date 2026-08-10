/**
 * Package 19 — Playwright happy-path against local api+web.
 * Package 33 — Azure audit-only meter allowlist (TF-faithful).
 * Journey UX — Inputs → Run → Cost output.
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
      "Step 3 of 3",
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
});
