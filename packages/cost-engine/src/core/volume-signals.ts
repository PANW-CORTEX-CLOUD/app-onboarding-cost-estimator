/**
 * Multi-cloud volume signals (package 12).
 * Universal inputs → resolved stream ingress/peak via elasticities in CLOUD_COST_MODEL.md.
 * Lives in core (provider-agnostic); log-category multipliers are keyed by CloudProvider only.
 *
 * These are internal business-rule elasticities (not a cloud provider's published pricing
 * formula) — SSOT is `docs/CLOUD_COST_MODEL.md` § "Volume elasticities (package 12)"; the
 * constants below (REFERENCE_ACCOUNT_COUNT, LOG_INTENSITY_FACTOR, LOG_CATEGORY_SETS,
 * MAU_*) must be kept 1:1 with that table.
 */
import type { CloudProvider } from "./models/estimate.types.ts";

export type LogIntensity = "low" | "medium" | "high";

export type OrgPresetId = "small" | "medium" | "large";

/** Parsed raw stream metrics (from structured object or paste string). */
export type RawStreamMetrics = {
  ingressGBPerDay?: number;
  peakMBps?: number;
  peakEventsPerSec?: number;
};

export type VolumeSignalsInput = {
  provider: CloudProvider;
  /**
   * Account / subscription / project count.
   * Scales ingress & peak linearly vs REFERENCE_ACCOUNT_COUNT (AC/TEST).
   */
  accountCount: number;
  /** Monthly active users / sign-ins — mild ingress uplift. */
  monthlyActiveUsers?: number;
  logIntensity?: LogIntensity;
  /** Baseline preset before elasticities (default medium). */
  orgPreset?: OrgPresetId;
  /**
   * Raw metric paste — object or string. Overrides preset+elasticity values
   * for any fields present (TEST). Invalid paste rejected (EDGE).
   */
  rawMetrics?: RawStreamMetrics | string;
  /**
   * BYO Event Hub / Kinesis / Pub/Sub — zeros managed stream capacity lines (AC).
   */
  byoManagedStream?: boolean;
  /**
   * Optional override for how many log categories are enabled
   * (default = full provider set).
   */
  enabledLogCategories?: number;
};

export type ResolvedVolumeSignals = {
  ingressGBPerDay: number;
  peakMBps: number;
  peakEventsPerSec: number;
  byoManagedStream: boolean;
  /** Convenience alias — true when BYO (stream estimators zero capacity). */
  zeroManagedStreamCapacity: boolean;
  logCategoryMultiplier: number;
  accountScale: number;
  warnings: string[];
  notes: string[];
};

/** Reference account count where scale factor = 1. */
export const REFERENCE_ACCOUNT_COUNT = 10;

/** Baseline org presets (same numbers as stream ORG_STREAM_PRESETS). */
export const VOLUME_ORG_PRESETS: Record<
  OrgPresetId,
  { ingressGBPerDay: number; peakMBps: number; peakEventsPerSec: number }
> = {
  small: { ingressGBPerDay: 1, peakMBps: 0.25, peakEventsPerSec: 250 },
  medium: { ingressGBPerDay: 10, peakMBps: 1, peakEventsPerSec: 1000 },
  large: { ingressGBPerDay: 100, peakMBps: 10, peakEventsPerSec: 10_000 },
};

export const LOG_INTENSITY_FACTOR: Record<LogIntensity, number> = {
  low: 0.5,
  medium: 1,
  high: 2,
};

/**
 * Provider log category sets (EDGE).
 * Azure Entra ~8 categories; AWS CloudTrail+GuardDuty; GCP Audit Logs (admin/data/system).
 */
export const LOG_CATEGORY_SETS: Record<
  CloudProvider,
  { label: string; categories: number }
> = {
  azure: { label: "Azure Entra ID sign-in / audit categories", categories: 8 },
  aws: { label: "AWS CloudTrail + GuardDuty", categories: 2 },
  gcp: { label: "GCP Cloud Audit Logs (admin/data/system)", categories: 3 },
};

/** Mild MAU uplift: +10% ingress per 10k MAU (capped). */
export const MAU_PER_UNIT = 10_000;
export const MAU_UPLIFT_PER_UNIT = 0.1;
export const MAU_UPLIFT_CAP = 1.0;

/**
 * Parse raw metric paste. Accepts JSON or `key=value` pairs separated by commas/newlines.
 * @throws on invalid paste (EDGE).
 */
export function parseRawStreamMetrics(raw: RawStreamMetrics | string): RawStreamMetrics {
  if (typeof raw !== "string") {
    validateRawNumbers(raw);
    return { ...raw };
  }
  const text = raw.trim();
  if (!text) {
    throw new Error("invalid raw metric paste: empty string");
  }
  if (text.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("invalid raw metric paste: malformed JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid raw metric paste: JSON must be an object");
    }
    const obj = parsed as Record<string, unknown>;
    const out: RawStreamMetrics = {};
    for (const key of ["ingressGBPerDay", "peakMBps", "peakEventsPerSec"] as const) {
      if (obj[key] !== undefined) {
        if (typeof obj[key] !== "number" || !Number.isFinite(obj[key])) {
          throw new Error(`invalid raw metric paste: ${key} must be a finite number`);
        }
        out[key] = obj[key];
      }
    }
    if (Object.keys(out).length === 0) {
      throw new Error("invalid raw metric paste: no recognized metric fields");
    }
    validateRawNumbers(out);
    return out;
  }
  // key=value form
  const out: RawStreamMetrics = {};
  const parts = text.split(/[,\n;]+/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = /^([a-zA-Z]+)\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(part);
    if (!m) {
      throw new Error(`invalid raw metric paste: cannot parse '${part}'`);
    }
    const key = m[1];
    const val = Number(m[2]);
    if (
      key !== "ingressGBPerDay" &&
      key !== "peakMBps" &&
      key !== "peakEventsPerSec"
    ) {
      throw new Error(`invalid raw metric paste: unknown field '${key}'`);
    }
    out[key] = val;
  }
  if (Object.keys(out).length === 0) {
    throw new Error("invalid raw metric paste: no fields");
  }
  validateRawNumbers(out);
  return out;
}

function validateRawNumbers(raw: RawStreamMetrics): void {
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`invalid raw metric paste: ${k} must be a non-negative finite number`);
    }
  }
}

export function logCategoryMultiplier(
  provider: CloudProvider,
  enabledLogCategories?: number,
): number {
  const set = LOG_CATEGORY_SETS[provider];
  const enabled = enabledLogCategories ?? set.categories;
  if (!Number.isFinite(enabled) || enabled <= 0) {
    throw new Error("enabledLogCategories must be a positive number");
  }
  if (enabled > set.categories) {
    throw new Error(
      `enabledLogCategories ${enabled} exceeds ${provider} max ${set.categories} (${set.label})`,
    );
  }
  // Relative to full category set (=1.0 when all enabled)
  return enabled / set.categories;
}

/**
 * Resolve universal volume signals → stream ingress/peak.
 *
 * Formula: `resolved = basePreset × accountScale × logIntensity × logCategoryMultiplier × (1 + mauUplift)`,
 * applied independently to `ingressGBPerDay`, `peakMBps`, `peakEventsPerSec` — see
 * per-factor docs on {@link REFERENCE_ACCOUNT_COUNT}, {@link LOG_INTENSITY_FACTOR},
 * {@link logCategoryMultiplier}, {@link MAU_UPLIFT_PER_UNIT}.
 * Raw metrics override computed fields per-key (not all-or-nothing). BYO sets
 * zeroManagedStreamCapacity; ingress/peak values are still returned (stream
 * estimators, not this function, are responsible for zeroing capacity lines).
 *
 * @returns `warnings` is always `[]` here by design — this function only resolves
 * signals; capacity/billing-minimum warnings (e.g. "zero ingress still bills 1 shard")
 * are the responsibility of the provider stream estimators that consume this output,
 * since only they know their own minimums.
 */
export function resolveVolumeSignals(
  input: VolumeSignalsInput,
): ResolvedVolumeSignals {
  if (!Number.isFinite(input.accountCount) || input.accountCount <= 0) {
    throw new Error("accountCount must be a positive finite number");
  }

  const warnings: string[] = [];
  const notes: string[] = [];
  const presetId = input.orgPreset ?? "medium";
  const base = { ...VOLUME_ORG_PRESETS[presetId] };
  notes.push(`orgPreset=${presetId} baseline before elasticities`);

  const accountScale = input.accountCount / REFERENCE_ACCOUNT_COUNT;
  const intensity = LOG_INTENSITY_FACTOR[input.logIntensity ?? "medium"];
  const catMult = logCategoryMultiplier(
    input.provider,
    input.enabledLogCategories,
  );
  notes.push(
    `elasticities: accountScale=${accountScale} (accounts/${REFERENCE_ACCOUNT_COUNT}), ` +
      `logIntensity=${intensity}, logCategories=${catMult} (${LOG_CATEGORY_SETS[input.provider].label})`,
  );

  let mauUplift = 0;
  if (input.monthlyActiveUsers !== undefined) {
    if (
      !Number.isFinite(input.monthlyActiveUsers) ||
      input.monthlyActiveUsers < 0
    ) {
      throw new Error("monthlyActiveUsers must be a non-negative finite number");
    }
    mauUplift = Math.min(
      MAU_UPLIFT_CAP,
      (input.monthlyActiveUsers / MAU_PER_UNIT) * MAU_UPLIFT_PER_UNIT,
    );
    notes.push(`MAU uplift factor=+${mauUplift}`);
  }

  const scale = accountScale * intensity * catMult * (1 + mauUplift);
  let ingressGBPerDay = base.ingressGBPerDay * scale;
  let peakMBps = base.peakMBps * scale;
  let peakEventsPerSec = base.peakEventsPerSec * scale;

  if (input.rawMetrics !== undefined) {
    const raw = parseRawStreamMetrics(input.rawMetrics);
    notes.push("raw metric paste overrides preset/elasticity fields present");
    if (raw.ingressGBPerDay !== undefined) ingressGBPerDay = raw.ingressGBPerDay;
    if (raw.peakMBps !== undefined) peakMBps = raw.peakMBps;
    if (raw.peakEventsPerSec !== undefined) {
      peakEventsPerSec = raw.peakEventsPerSec;
    }
  }

  const byo = input.byoManagedStream === true;
  if (byo) {
    notes.push(
      "BYO managed stream: namespace/capacity lines must be zeroed by stream estimators",
    );
  }

  return {
    ingressGBPerDay,
    peakMBps,
    peakEventsPerSec,
    byoManagedStream: byo,
    zeroManagedStreamCapacity: byo,
    logCategoryMultiplier: catMult,
    accountScale,
    warnings,
    notes,
  };
}
