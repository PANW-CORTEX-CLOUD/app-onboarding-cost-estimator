/**
 * Vite /v1 proxy target helper — local default vs Docker Compose service DNS.
 * Compose sets API_PROXY_TARGET=http://api:8787 so the web container reaches api.
 */

export const DEFAULT_API_PROXY_TARGET = "http://127.0.0.1:8787";

/**
 * Resolve the upstream API URL for Vite's `/v1` proxy.
 * Empty / whitespace-only API_PROXY_TARGET fails closed (no silent localhost fallback).
 */
export function resolveApiProxyTarget(
  env: Record<string, string | undefined> = process.env,
): string {
  if (!Object.prototype.hasOwnProperty.call(env, "API_PROXY_TARGET")) {
    return DEFAULT_API_PROXY_TARGET;
  }
  const raw = env.API_PROXY_TARGET;
  if (raw === undefined) {
    throw new Error("API_PROXY_TARGET must be a non-empty http(s) URL when set");
  }
  const target = raw.trim();
  if (!target) {
    throw new Error("API_PROXY_TARGET must be a non-empty http(s) URL when set");
  }
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new Error(`API_PROXY_TARGET is not a valid URL: ${target}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `API_PROXY_TARGET must use http: or https: (got ${url.protocol})`,
    );
  }
  return target.replace(/\/$/, "");
}
