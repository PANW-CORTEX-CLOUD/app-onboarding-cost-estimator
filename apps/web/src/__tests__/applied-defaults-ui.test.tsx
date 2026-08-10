/**
 * T-5.1.2 (UI) — the assumptions panel renders whatever the engine reports.
 *
 * It used to hardcode four values, so a new engine default stayed invisible.
 * These pin the generic rendering: nothing here names a specific default.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResultsAssumptionsSnapshot } from "../widgets/ResultsAssumptionsSnapshot/ResultsAssumptionsSnapshot.tsx";

afterEach(cleanup);

const base = {
  monthHours: 730,
  assumedEventBytes: 1024,
  avgStoredGB: 100,
  logIntensity: "medium",
};

describe("what the tool guessed is visible", () => {
  it("lists each guessed value with its rationale", () => {
    render(
      <ResultsAssumptionsSnapshot
        {...base}
        appliedDefaults={[
          {
            field: "volume.accountCount",
            label: "Accounts in scope",
            value: 10,
            kind: "assumption",
            rationale: "Audit volume scales with the number of accounts.",
          },
        ]}
      />,
    );
    const row = screen.getByTestId("applied-default-volume.accountCount");
    expect(row.textContent).toMatch(/Accounts in scope/);
    expect(row.textContent).toMatch(/10/);
    expect(row.textContent).toMatch(/scales with the number of accounts/);
  });

  it("billing conventions are not presented as guesses", () => {
    // 730 hours is definitional; arguing with it is not useful.
    render(
      <ResultsAssumptionsSnapshot
        {...base}
        appliedDefaults={[
          {
            field: "monthHours",
            label: "Hours per month",
            value: 730,
            kind: "convention",
            rationale: "Providers bill a month as 730 hours.",
          },
        ]}
      />,
    );
    expect(screen.queryByTestId("applied-default-monthHours")).toBeNull();
    expect(screen.getByTestId("applied-defaults-none")).toBeTruthy();
  });

  it("EDGE: nothing guessed says so plainly rather than showing an empty list", () => {
    render(<ResultsAssumptionsSnapshot {...base} appliedDefaults={[]} />);
    expect(screen.getByTestId("applied-defaults-none").textContent).toMatch(
      /nothing was guessed/i,
    );
  });

  it("EDGE: an engine default this file has never heard of still renders", () => {
    // The drift guard: the widget must not need updating for a new default.
    render(
      <ResultsAssumptionsSnapshot
        {...base}
        appliedDefaults={[
          {
            field: "volume.futureThing",
            label: "Something added later",
            value: 7,
            kind: "assumption",
            rationale: "A default introduced after this test was written.",
          },
        ]}
      />,
    );
    expect(
      screen.getByTestId("applied-default-volume.futureThing").textContent,
    ).toMatch(/Something added later/);
  });

  it("counts the guesses so the summary reads naturally", () => {
    render(
      <ResultsAssumptionsSnapshot
        {...base}
        appliedDefaults={[
          { field: "a", label: "A", value: 1, kind: "assumption", rationale: "x".repeat(25) },
          { field: "b", label: "B", value: 2, kind: "assumption", rationale: "y".repeat(25) },
        ]}
      />,
    );
    expect(screen.getByTestId("applied-defaults").textContent).toMatch(
      /2 values we guessed/,
    );
  });
});
