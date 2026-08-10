/**
 * Share-state serialize/deserialize for estimator URLs (package 21).
 * No secrets — only provider, region, capabilities, volume, optional totals snapshot.
 * Oversized payloads fall back to JSON export (TEST/EDGE).
 * Lives in shared — capability shape duplicated (no upward import to entities).
 */
import type { CloudProvider } from "../model/cloud-provider.ts";

export const SHARE_PARAM = "s";
export const MAX_SHARE_URL_CHARS = 2000;

/** Capability flags — mirror of estimate capabilities without importing entities. */
export type ShareCapabilities = {
  discovery?: boolean;
  auditLogs?: boolean;
  adsCloud?: boolean;
  adsOutpost?: boolean;
  dspm?: boolean;
  registry?: boolean;
  serverless?: boolean;
  egress?: boolean;
};

export type ShareVolume = {
  accountCount?: number;
  monthlyActiveUsers?: number;
  ingressGBPerDay?: number;
  peakMBps?: number;
  peakEventsPerSec?: number;
  dataEstateGB?: number;
  pctScanned?: number;
  scansPerMonth?: number;
  imageCount?: number;
  avgImageGB?: number;
  packageCount?: number;
  egressGB?: number;
};

export type ShareState = {
  v: 1;
  provider: CloudProvider;
  region: string;
  capabilities: ShareCapabilities;
  volume: ShareVolume;
  totals?: { expected: number; low?: number; high?: number };
  mode?: "providers" | "tiers";
};

export type ShareParseOk = { ok: true; state: ShareState };
export type ShareParseErr = { ok: false; error: string };
export type ShareParseResult = ShareParseOk | ShareParseErr;

const SECRET_KEYS = /password|secret|token|apikey|api_key|authorization|bearer|credential/i;

export function assertNoSecretsInShare(raw: string): void {
  if (SECRET_KEYS.test(raw)) {
    throw new Error("Share payload must not contain secrets");
  }
}

const SHARE_CAPABILITY_KEYS: ReadonlyArray<keyof ShareCapabilities> = [
  "discovery",
  "auditLogs",
  "adsCloud",
  "adsOutpost",
  "dspm",
  "registry",
  "serverless",
  "egress",
];

const SHARE_VOLUME_KEYS: ReadonlyArray<keyof ShareVolume> = [
  "accountCount",
  "monthlyActiveUsers",
  "ingressGBPerDay",
  "peakMBps",
  "peakEventsPerSec",
  "dataEstateGB",
  "pctScanned",
  "scansPerMonth",
  "imageCount",
  "avgImageGB",
  "packageCount",
  "egressGB",
];

/**
 * Runtime-validate an untrusted share payload (a hand-editable `?s=` param or
 * a localStorage blob written by an older build) before any of it reaches a
 * state setter.
 *
 * Previously only `v`/`provider`/`region` were checked and the rest was cast
 * through with `as ShareState`, so `volume.dataEstateGB = -999` or a
 * string-where-a-number-belongs flowed straight into the estimator and was
 * caught (if at all) only later by the API schema. Numeric fields must be
 * finite and non-negative here for the same reason they are on the API's
 * `CreateEstimateRequestSchema`.
 *
 * @param candidate Parsed-but-unverified JSON.
 * @returns `{ ok: true, state }` only when every present field has the right
 *   runtime type; otherwise a named reason.
 */
export function validateShareState(candidate: unknown): ShareParseResult {
  if (typeof candidate !== "object" || candidate === null) {
    return { ok: false, error: "Malformed share payload (not an object)" };
  }
  const c = candidate as Record<string, unknown>;
  if (c.v !== 1 || !c.provider || !c.region) {
    return { ok: false, error: "Malformed share payload (missing fields)" };
  }
  if (
    typeof c.provider !== "string" ||
    !["azure", "aws", "gcp"].includes(c.provider)
  ) {
    return { ok: false, error: "Malformed share payload (provider)" };
  }
  if (typeof c.region !== "string" || c.region.length === 0) {
    return { ok: false, error: "Malformed share payload (region)" };
  }

  if (c.capabilities !== undefined) {
    if (typeof c.capabilities !== "object" || c.capabilities === null) {
      return { ok: false, error: "Malformed share payload (capabilities)" };
    }
    const caps = c.capabilities as Record<string, unknown>;
    for (const key of SHARE_CAPABILITY_KEYS) {
      if (caps[key] !== undefined && typeof caps[key] !== "boolean") {
        return {
          ok: false,
          error: `Malformed share payload (capabilities.${key} must be boolean)`,
        };
      }
    }
  }

  if (c.volume !== undefined) {
    if (typeof c.volume !== "object" || c.volume === null) {
      return { ok: false, error: "Malformed share payload (volume)" };
    }
    const vol = c.volume as Record<string, unknown>;
    for (const key of SHARE_VOLUME_KEYS) {
      const value = vol[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return {
          ok: false,
          error: `Malformed share payload (volume.${key} must be a non-negative number)`,
        };
      }
    }
  }

  if (c.mode !== undefined && c.mode !== "providers" && c.mode !== "tiers") {
    return { ok: false, error: "Malformed share payload (mode)" };
  }

  return { ok: true, state: candidate as ShareState };
}

/**
 * JSON-encode then URL-safe base64 (`+`/`/` → `-`/`_`, no `=` padding) a share state.
 * @param state Share payload (no secrets — enforced by {@link assertNoSecretsInShare}).
 * @returns URL-safe base64 string suitable for a query param value.
 */
export function serializeShareState(state: ShareState): string {
  const json = JSON.stringify(state);
  assertNoSecretsInShare(json);
  // URL-safe base64
  const b64 =
    typeof btoa === "function"
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Inverse of {@link serializeShareState}: restores base64 alphabet/padding
 * (`padded.length % 4` determines how many `=` were stripped), decodes, and
 * validates required fields (`v`, `provider`, `region`) and provider enum.
 * @param encoded URL-safe base64 string, e.g. from the `?s=` query param.
 * @returns `{ ok: true, state }` on success, or `{ ok: false, error }` for malformed/foreign payloads.
 */
export function deserializeShareState(encoded: string): ShareParseResult {
  try {
    assertNoSecretsInShare(encoded);
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const json =
      typeof atob === "function"
        ? decodeURIComponent(escape(atob(padded + pad)))
        : Buffer.from(padded + pad, "base64").toString("utf8");
    assertNoSecretsInShare(json);
    return validateShareState(JSON.parse(json));
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Malformed share payload",
    };
  }
}

/**
 * Build a shareable URL for `state`, falling back to a JSON export when the
 * full URL (including the `s` and `provider` params) exceeds
 * {@link MAX_SHARE_URL_CHARS}. Length is measured on the final `href`, not the
 * encoded payload alone, so it accounts for `baseHref`'s own length too.
 * @returns `{ ok: true, url }`, or `{ ok: false, reason: "oversized", json }` with a
 *   pretty-printed JSON fallback the caller can offer for manual copy/paste.
 */
export function buildShareUrl(
  state: ShareState,
  baseHref = typeof window !== "undefined" ? window.location.href : "http://localhost/",
): { ok: true; url: string } | { ok: false; reason: "oversized"; json: string } {
  const encoded = serializeShareState(state);
  const url = new URL(baseHref);
  url.searchParams.set(SHARE_PARAM, encoded);
  url.searchParams.set("provider", state.provider);
  const href = url.toString();
  if (href.length > MAX_SHARE_URL_CHARS) {
    return { ok: false, reason: "oversized", json: JSON.stringify(state, null, 2) };
  }
  return { ok: true, url: href };
}

export function readShareFromSearch(
  search = typeof window !== "undefined" ? window.location.search : "",
): ShareParseResult | null {
  const params = new URLSearchParams(search);
  const raw = params.get(SHARE_PARAM);
  if (!raw) return null;
  return deserializeShareState(raw);
}

/**
 * Absolute and percent delta of `b` relative to `a` (the baseline/first column
 * in a scenario compare): `absolute = b - a`, `percent = (b - a) / a * 100`.
 * `percent` is `null` when `a === 0` (would divide by zero) — callers should
 * render that as "—", not "0%" or "∞%".
 * @param a Baseline value (e.g. the first compared scenario's expected cost).
 * @param b Value being compared against the baseline.
 */
export function compareDelta(
  a: number,
  b: number,
): { absolute: number; percent: number | null } {
  const absolute = b - a;
  if (a === 0) return { absolute, percent: null };
  return { absolute, percent: (absolute / a) * 100 };
}
