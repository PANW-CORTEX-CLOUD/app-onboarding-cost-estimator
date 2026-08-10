/**
 * Local last-estimate cache for offline / fail-closed recovery (package 17 EDGE).
 * Stores API responses only — never invents $0 line items.
 */
import type { components } from "../api/generated/openapi.types.ts";
import type { CloudProvider } from "../model/cloud-provider.ts";

type EstimateResponse = components["schemas"]["EstimateResponse"];

const KEY = "cloud-connector:last-estimate:v1";

export type CachedEstimate = {
  provider: CloudProvider;
  estimate: EstimateResponse;
  cachedAt: string;
};

export function saveEstimateCache(entry: CachedEstimate): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(entry));
}

export function loadEstimateCache(
  provider?: CloudProvider,
): CachedEstimate | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedEstimate;
    if (!parsed?.estimate || !parsed?.provider || !parsed?.cachedAt) return null;
    if (provider && parsed.provider !== provider) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearEstimateCache(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY);
}
