/**
 * Feature: offline-engine — explicit opt-in to serve cached estimate without API.
 * Never silent: requires toggle or ?offlineEngine=1 URL flag.
 */
import {
  readOfflineEngineFromSearch,
  writeOfflineEngineToUrl,
} from "../../shared/lib/url-state.ts";

export function initialOfflineEngineEnabled(): boolean {
  return readOfflineEngineFromSearch();
}

export function setOfflineEngineEnabled(enabled: boolean): void {
  writeOfflineEngineToUrl(enabled);
}
