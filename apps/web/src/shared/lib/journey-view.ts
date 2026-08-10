/**
 * Journey mode URL sync — ?view=inputs|cost (fail closed to inputs).
 */
export type JourneyMode = "inputs" | "cost";

export type InputsJourneyStep = "start" | "size" | "run";

export function isJourneyMode(raw: string | null | undefined): raw is JourneyMode {
  return raw === "inputs" || raw === "cost";
}

/** Read ?view= from search string. Invalid/missing → inputs. */
export function readJourneyViewFromSearch(
  search: string = typeof window !== "undefined" ? window.location.search : "",
): JourneyMode {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const v = q.get("view");
  return isJourneyMode(v) ? v : "inputs";
}

/** Write ?view= without dropping other query params. */
export function writeJourneyViewToUrl(
  mode: JourneyMode,
  replaceState: (url: string) => void = (url) => {
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", url);
    }
  },
): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("view", mode);
  replaceState(`${url.pathname}${url.search}${url.hash}`);
}

/**
 * Map a CostDrivers jump target (data-testid) to the Inputs wizard step that
 * mounts that field — so jumps never focus a display:none panel.
 */
export function inputsStepForJumpTarget(
  inputTestId: string,
): InputsJourneyStep {
  if (
    inputTestId === "input-avg-stored-gb" ||
    inputTestId.startsWith("input-month-") ||
    inputTestId.startsWith("input-assumed-") ||
    inputTestId === "override-stream-metrics"
  ) {
    return "run";
  }
  if (
    inputTestId.startsWith("cap-") ||
    inputTestId === "provider-select" ||
    inputTestId === "region-select"
  ) {
    return "start";
  }
  return "size";
}
