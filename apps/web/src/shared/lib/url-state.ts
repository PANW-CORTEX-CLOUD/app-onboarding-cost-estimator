/**
 * URL search-param helpers for estimator state (provider, offlineEngine).
 * Fail closed: unknown provider → default azure (never invent other clouds).
 */
import {
  DEFAULT_PROVIDER,
  isCloudProvider,
  type CloudProvider,
} from "../model/cloud-provider.ts";

export function readProviderFromSearch(
  search = typeof window !== "undefined" ? window.location.search : "",
): CloudProvider {
  const params = new URLSearchParams(search);
  const raw = params.get("provider");
  if (raw && isCloudProvider(raw)) return raw;
  return DEFAULT_PROVIDER;
}

export function writeProviderToUrl(provider: CloudProvider): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("provider", provider);
  window.history.replaceState({}, "", url);
}

/** Explicit offline-engine flag — never inferred from silence/env. */
export function readOfflineEngineFromSearch(
  search = typeof window !== "undefined" ? window.location.search : "",
): boolean {
  const params = new URLSearchParams(search);
  return params.get("offlineEngine") === "1";
}

export function writeOfflineEngineToUrl(enabled: boolean): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.set("offlineEngine", "1");
  else url.searchParams.delete("offlineEngine");
  window.history.replaceState({}, "", url);
}
