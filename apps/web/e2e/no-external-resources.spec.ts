/**
 * REQ-24 — the app must be fully self-contained and console-clean.
 *
 * A bug-hunt pass caught the UI reaching out to `fonts.googleapis.com` on every
 * page load (fonts are now self-hosted) and auto-fetching a missing
 * `/favicon.ico` (now an inline SVG data-URI). Both failed in a network-locked
 * environment — silently degrading and logging console errors. This spec locks
 * the property in: driving a real estimate must produce
 *   - no console errors / uncaught page errors,
 *   - no failed requests, and
 *   - no request to any host other than the local dev servers.
 * If someone re-adds a CDN `<link>`, an external image, or a resource that 404s,
 * this fails.
 */
import { test, expect } from "@playwright/test";

const LOCAL_HOST = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;

test("the app makes no external requests and logs no console errors", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) =>
    problems.push(`requestfailed: ${r.url()} — ${r.failure()?.errorText}`),
  );
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`);
  });
  const external: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    if (!LOCAL_HOST.test(url)) external.push(url);
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Cost Estimator/i }),
  ).toBeVisible();

  // A full run exercises fonts, the favicon, the API call, and the results
  // render — every place a stray external fetch could hide.
  await page.getByTestId("journey-step-continue").click();
  await page.getByTestId("demo-preset-azure-audit").click();
  await page.getByTestId("journey-step-continue").click();
  await page.getByTestId("journey-step-continue").click();
  await page.getByTestId("run-estimate").click();
  await expect(page.getByTestId("summary-monthly-expected")).not.toHaveText(
    /\$0\.00$/,
    { timeout: 30_000 },
  );
  await page.getByTestId("results-tab-cost").click();
  await page.getByTestId("result-flip-toggle").click();
  await expect(page.getByTestId("cost-breakdown")).toBeVisible();

  expect(external, `external requests:\n${external.join("\n")}`).toEqual([]);
  expect(problems, `console/network problems:\n${problems.join("\n")}`).toEqual(
    [],
  );
});
