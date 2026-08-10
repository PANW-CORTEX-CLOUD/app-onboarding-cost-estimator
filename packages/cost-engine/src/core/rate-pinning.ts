/**
 * Rate pinning / frozen estimate exports (package 13).
 * Pin unitPrices per provider so re-loading frozen JSON reproduces totals
 * within FREEZE_TOTAL_TOLERANCE_USD regardless of live price changes.
 *
 * Lives in generic core — no provider formula imports.
 */
import { modelVersion as engineModelVersion } from "../model-version.ts";
import {
  ageDaysFromCapturedAt,
  assertExportAllowedForFreshness,
  evaluateRatesFreshness,
} from "./rates/age-days.ts";
import type {
  CloudProvider,
  Confidence,
  EstimateInputs,
  EstimateResult,
  LineItem,
  RateCard,
} from "./models/estimate.types.ts";

/** AC: re-loaded freeze must match original totals within this USD delta. */
export const FREEZE_TOTAL_TOLERANCE_USD = 0.01;

/** EDGE: pinned rates older than this → warning (still loadable). */
export const PINNED_RATES_WARN_AGE_DAYS = 180;

export const FREEZE_SCHEMA_VERSION = 1 as const;

export const DEFAULT_ESTIMATE_DISCLAIMER =
  "Indicative customer-cloud infrastructure estimate only. Not a binding quote. " +
  "Cortex SaaS licenses excluded. Verify rates with your cloud provider.";

export type FrozenEstimateExport = {
  schemaVersion: typeof FREEZE_SCHEMA_VERSION;
  provider: CloudProvider;
  modelVersion: string;
  ratesAsOf: string;
  inputHash: string;
  rateCard: RateCard;
  inputs: EstimateInputs;
  lineItems: LineItem[];
  totals: { expected: number; low?: number; high?: number };
  confidence: Confidence;
  disclaimer: string;
  frozenAt: string;
  warnings: string[];
};

export type FreezeEstimateArgs = {
  result: Pick<
    EstimateResult,
    "provider" | "lineItems" | "totals" | "confidence"
  >;
  rateCard: RateCard;
  inputs: EstimateInputs;
  /** Override engine modelVersion (tests only). */
  modelVersion?: string;
  disclaimer?: string;
  frozenAt?: string;
  now?: Date;
  /**
   * Rates source for freshness gate (package 16).
   * Critical-stale requires ackCriticalStale=true.
   */
  ratesSource?: "live" | "cache" | "fallback";
  /** AC: required when rates are critically stale. */
  ackCriticalStale?: boolean;
};

export type FreezeLoadOk = {
  ok: true;
  payload: FrozenEstimateExport;
  warnings: string[];
};

export type FreezeLoadErr = {
  ok: false;
  code: "corrupt" | "invalid_schema" | "model_version_mismatch";
  error: string;
};

export type FreezeLoadResult = FreezeLoadOk | FreezeLoadErr;

/**
 * Deterministic canonical JSON (sorted object keys) for input hashing.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortKeys(obj[k]);
  }
  return out;
}

/**
 * FNV-1a 32-bit hex hash of canonical JSON (pure TS — no node:crypto).
 */
export function createInputHash(inputs: unknown): string {
  const s = canonicalJson(inputs);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function totalsWithinTolerance(
  a: number,
  b: number,
  toleranceUsd: number = FREEZE_TOTAL_TOLERANCE_USD,
): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= toleranceUsd;
}

/** EDGE — warn when pinned rate card is older than PINNED_RATES_WARN_AGE_DAYS. */
export function pinnedRatesAgeWarning(
  capturedAt: string,
  now: Date = new Date(),
): string | undefined {
  const age = ageDaysFromCapturedAt(capturedAt, now);
  if (age > PINNED_RATES_WARN_AGE_DAYS) {
    return `pinned rates ageDays=${age} exceeds ${PINNED_RATES_WARN_AGE_DAYS}`;
  }
  return undefined;
}

/**
 * Freeze estimate state with pinned unitPrices for reproducible quotes.
 */
export function freezeEstimate(args: FreezeEstimateArgs): FrozenEstimateExport {
  const { result, rateCard, inputs } = args;
  if (result.provider !== rateCard.provider) {
    throw new Error(
      `freezeEstimate provider mismatch: result=${result.provider} rateCard=${rateCard.provider}`,
    );
  }
  if (inputs.provider !== result.provider) {
    throw new Error(
      `freezeEstimate provider mismatch: inputs=${inputs.provider} result=${result.provider}`,
    );
  }
  validateRateCard(rateCard);

  const now = args.now ?? new Date();
  const ratesSource = args.ratesSource ?? "fallback";
  const freshness = evaluateRatesFreshness(
    rateCard.capturedAt,
    ratesSource,
    now,
  );
  assertExportAllowedForFreshness(freshness, {
    ackCriticalStale: args.ackCriticalStale,
  });

  const warnings: string[] = [];
  if (freshness.banner) warnings.push(freshness.banner);
  const ageWarn = pinnedRatesAgeWarning(rateCard.capturedAt, now);
  if (ageWarn) warnings.push(ageWarn);

  const pinned: RateCard = {
    provider: rateCard.provider,
    region: rateCard.region,
    currency: "USD",
    unitPrices: { ...rateCard.unitPrices },
    capturedAt: rateCard.capturedAt,
  };

  return {
    schemaVersion: FREEZE_SCHEMA_VERSION,
    provider: result.provider,
    modelVersion: args.modelVersion ?? engineModelVersion,
    ratesAsOf: rateCard.capturedAt,
    inputHash: createInputHash(inputs),
    rateCard: pinned,
    inputs: structuredCloneInputs(inputs),
    lineItems: result.lineItems.map((l) => ({ ...l })),
    totals: { ...result.totals },
    confidence: result.confidence,
    disclaimer: args.disclaimer ?? DEFAULT_ESTIMATE_DISCLAIMER,
    frozenAt: args.frozenAt ?? now.toISOString(),
    warnings,
  };
}

function structuredCloneInputs(inputs: EstimateInputs): EstimateInputs {
  return JSON.parse(JSON.stringify(inputs)) as EstimateInputs;
}

function validateRateCard(rateCard: RateCard): void {
  if (!rateCard || typeof rateCard !== "object") {
    throw new Error("invalid rateCard");
  }
  if (
    rateCard.provider !== "azure" &&
    rateCard.provider !== "aws" &&
    rateCard.provider !== "gcp"
  ) {
    throw new Error(`invalid rateCard.provider '${String(rateCard.provider)}'`);
  }
  if (rateCard.currency !== "USD") {
    throw new Error("rateCard.currency must be USD (fail closed)");
  }
  if (!rateCard.capturedAt || Number.isNaN(Date.parse(rateCard.capturedAt))) {
    throw new Error("rateCard.capturedAt must be a valid ISO timestamp");
  }
  if (!rateCard.unitPrices || typeof rateCard.unitPrices !== "object") {
    throw new Error("rateCard.unitPrices required");
  }
  for (const [meter, price] of Object.entries(rateCard.unitPrices)) {
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      throw new Error(
        `rateCard.unitPrices['${meter}'] must be a non-negative finite number (no invented NaN/$0 silence)`,
      );
    }
  }
}

/**
 * Validate export shape: provider + modelVersion required (TEST).
 * @throws on invalid schema
 */
export function validateExportSchema(
  payload: unknown,
): asserts payload is FrozenEstimateExport {
  if (!payload || typeof payload !== "object") {
    throw new Error("invalid freeze export: not an object");
  }
  const p = payload as Record<string, unknown>;
  if (p.schemaVersion !== FREEZE_SCHEMA_VERSION) {
    throw new Error(
      `invalid freeze export: schemaVersion must be ${FREEZE_SCHEMA_VERSION}`,
    );
  }
  if (p.provider !== "azure" && p.provider !== "aws" && p.provider !== "gcp") {
    throw new Error("invalid freeze export: provider required (azure|aws|gcp)");
  }
  if (typeof p.modelVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(p.modelVersion)) {
    throw new Error("invalid freeze export: modelVersion semver required");
  }
  if (typeof p.ratesAsOf !== "string" || !p.ratesAsOf) {
    throw new Error("invalid freeze export: ratesAsOf required");
  }
  if (typeof p.inputHash !== "string" || !p.inputHash) {
    throw new Error("invalid freeze export: inputHash required");
  }
  if (!p.rateCard || typeof p.rateCard !== "object") {
    throw new Error("invalid freeze export: rateCard required");
  }
  validateRateCard(p.rateCard as RateCard);
  if (!p.totals || typeof p.totals !== "object") {
    throw new Error("invalid freeze export: totals required");
  }
  const totals = p.totals as Record<string, unknown>;
  if (typeof totals.expected !== "number" || !Number.isFinite(totals.expected)) {
    throw new Error("invalid freeze export: totals.expected must be finite");
  }
  if (!Array.isArray(p.lineItems)) {
    throw new Error("invalid freeze export: lineItems must be an array");
  }
  if (!p.inputs || typeof p.inputs !== "object") {
    throw new Error("invalid freeze export: inputs required");
  }
}

/** Deep-clone pinned RateCard from a freeze payload. */
export function rateCardFromFreeze(payload: FrozenEstimateExport): RateCard {
  validateExportSchema(payload);
  return {
    provider: payload.rateCard.provider,
    region: payload.rateCard.region,
    currency: "USD",
    unitPrices: { ...payload.rateCard.unitPrices },
    capturedAt: payload.rateCard.capturedAt,
  };
}

/**
 * Parse frozen JSON. Corrupt payloads fail closed.
 * modelVersion mismatch invalidates pin gracefully (ok:false, no throw).
 */
export function loadFrozenEstimate(
  raw: string | unknown,
  options?: {
    currentModelVersion?: string;
    now?: Date;
    /** When true (default), mismatched modelVersion → model_version_mismatch. */
    requireCurrentModelVersion?: boolean;
  },
): FreezeLoadResult {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {
      ok: false,
      code: "corrupt",
      error: "corrupt freeze payload: malformed JSON",
    };
  }

  try {
    validateExportSchema(parsed);
  } catch (e) {
    return {
      ok: false,
      code: "invalid_schema",
      error: e instanceof Error ? e.message : "invalid freeze schema",
    };
  }

  const payload = parsed as FrozenEstimateExport;
  const current = options?.currentModelVersion ?? engineModelVersion;
  const requireVersion = options?.requireCurrentModelVersion !== false;
  if (requireVersion && payload.modelVersion !== current) {
    return {
      ok: false,
      code: "model_version_mismatch",
      error:
        `frozen modelVersion=${payload.modelVersion} incompatible with engine ${current}; ` +
        `re-estimate with current model (pin invalidated gracefully)`,
    };
  }

  const warnings = [...(payload.warnings ?? [])];
  const ageWarn = pinnedRatesAgeWarning(
    payload.rateCard.capturedAt,
    options?.now ?? new Date(),
  );
  if (ageWarn && !warnings.includes(ageWarn)) warnings.push(ageWarn);

  return { ok: true, payload: { ...payload, warnings }, warnings };
}

/**
 * Build EstimateResult metadata fields from a freeze / live card.
 */
export function estimateExportFields(
  provider: CloudProvider,
  rateCard: RateCard,
  inputs: EstimateInputs,
  version: string = engineModelVersion,
): Pick<EstimateResult, "provider" | "modelVersion" | "ratesAsOf"> & {
  inputHash: string;
} {
  return {
    provider,
    modelVersion: version,
    ratesAsOf: rateCard.capturedAt,
    inputHash: createInputHash(inputs),
  };
}
