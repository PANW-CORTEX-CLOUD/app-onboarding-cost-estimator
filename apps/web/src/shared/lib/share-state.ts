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

export type ShareParseOk = {
  ok: true;
  state: ShareState;
  /** Fields dropped because they were out of range or the wrong type. */
  rejectedFields?: string[];
};
export type ShareParseErr = { ok: false; error: string };
export type ShareParseResult = ShareParseOk | ShareParseErr;


/**
 * Numeric share fields, with the bounds each will accept.
 *
 * A share link is user-editable text: anyone can hand-craft `?s=` and hand it
 * to a colleague. Until now `deserializeShareState` checked `v`, `provider` and
 * `region` and cast the rest, so `volume.dataEstateGB = -999`, `NaN`, or a
 * string went straight into a React state setter and sat in the form looking
 * like a real number until the API rejected it at submit time.
 *
 * Note on prototype pollution: `JSON.parse` gives `__proto__` as an *own*
 * property rather than mutating `Object.prototype`, and the page merges
 * capabilities with object spread, which defines own properties instead of
 * assigning — so it is not a pollution vector here. The allowlist below still
 * drops such keys, because a key nobody declared has no business reaching the
 * form either way.
 *
 * @see https://portswigger.net/web-security/prototype-pollution
 */
const SHARE_VOLUME_BOUNDS: Record<keyof ShareVolume, { max: number }> = {
  // Generous ceilings: the intent is to reject nonsense, not to second-guess a
  // legitimately enormous estate. The API schema enforces the real contract.
  accountCount: { max: 1_000_000 },
  monthlyActiveUsers: { max: 1_000_000_000 },
  ingressGBPerDay: { max: 10_000_000 },
  peakMBps: { max: 1_000_000 },
  peakEventsPerSec: { max: 100_000_000 },
  dataEstateGB: { max: 1_000_000_000 },
  pctScanned: { max: 100 },
  scansPerMonth: { max: 10_000 },
  imageCount: { max: 10_000_000 },
  avgImageGB: { max: 100_000 },
  packageCount: { max: 10_000_000 },
  egressGB: { max: 1_000_000_000 },
};

const SHARE_CAPABILITY_KEYS: readonly (keyof ShareCapabilities)[] = [
  "discovery",
  "auditLogs",
  "adsCloud",
  "adsOutpost",
  "dspm",
  "registry",
  "serverless",
  "egress",
];

/** Keys that must never be copied out of parsed JSON, whatever they contain. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Copy only declared capability flags, and only when they are real booleans.
 * Unknown and forbidden keys are dropped rather than rejected, so an older or
 * newer link still restores the parts this build understands.
 */
function sanitizeCapabilities(raw: unknown): ShareCapabilities {
  const out: ShareCapabilities = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const key of SHARE_CAPABILITY_KEYS) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (typeof obj[key] === "boolean") out[key] = obj[key] as boolean;
  }
  return out;
}

/**
 * Copy only declared volume fields, and only when finite, non-negative and
 * within bounds.
 *
 * @returns the sanitized volume plus a list of rejected fields, so the caller
 *          can tell the user what was dropped instead of silently changing
 *          their numbers
 */
function sanitizeVolume(raw: unknown): {
  volume: ShareVolume;
  rejected: string[];
} {
  const volume: ShareVolume = {};
  const rejected: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { volume, rejected };
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(SHARE_VOLUME_BOUNDS) as (keyof ShareVolume)[]) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > SHARE_VOLUME_BOUNDS[key].max
    ) {
      rejected.push(String(key));
      continue;
    }
    volume[key] = value;
  }
  return { volume, rejected };
}

/**
 * Validate an already-parsed share payload into a `ShareState` that is safe to
 * feed to state setters.
 *
 * Exported so the validation can be tested directly, and reused if another
 * surface ever restores shared state.
 *
 * @param parsed output of `JSON.parse` on a share payload
 * @returns `{ ok: true, state, rejectedFields }`, or `{ ok: false, error }`
 */
export function validateShareState(parsed: unknown): ShareParseResult {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Malformed share payload (not an object)" };
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.v !== 1) {
    return { ok: false, error: "Malformed share payload (missing fields)" };
  }
  if (typeof obj.region !== "string" || !obj.region.trim()) {
    return { ok: false, error: "Malformed share payload (missing fields)" };
  }
  if (
    typeof obj.provider !== "string" ||
    !["azure", "aws", "gcp"].includes(obj.provider)
  ) {
    return { ok: false, error: "Malformed share payload (provider)" };
  }

  const { volume, rejected } = sanitizeVolume(obj.volume);
  const state: ShareState = {
    v: 1,
    provider: obj.provider as CloudProvider,
    region: obj.region,
    capabilities: sanitizeCapabilities(obj.capabilities),
    volume,
  };

  // Totals are display-only, but a non-finite one would render as NaN.
  const totals = obj.totals as Record<string, unknown> | undefined;
  if (totals && typeof totals === "object" && !Array.isArray(totals)) {
    const expected = totals.expected;
    if (typeof expected === "number" && Number.isFinite(expected)) {
      state.totals = { expected };
      for (const k of ["low", "high"] as const) {
        const v = totals[k];
        if (typeof v === "number" && Number.isFinite(v)) state.totals[k] = v;
      }
    }
  }

  if (obj.mode === "providers" || obj.mode === "tiers") {
    state.mode = obj.mode;
  }

  return rejected.length
    ? { ok: true, state, rejectedFields: rejected }
    : { ok: true, state };
}

const SECRET_KEYS = /password|secret|token|apikey|api_key|authorization|bearer|credential/i;

export function assertNoSecretsInShare(raw: string): void {
  if (SECRET_KEYS.test(raw)) {
    throw new Error("Share payload must not contain secrets");
  }
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
    // Validate rather than cast: a share link is user-editable text, and every
    // field below lands in a React state setter.
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
