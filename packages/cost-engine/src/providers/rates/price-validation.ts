/**
 * Atomic price-validation ledger (sources/price-validations.json).
 *
 * Every meterId the estimator can bill has exactly one row recording what the
 * repo CLAIMS versus what the official price list SAYS, plus when that check
 * last actually happened (`verifiedAt`). The age of that timestamp is what
 * drives re-crawling — see scripts/validate-prices.mjs.
 *
 * Fail closed: a meter with no row, a stale row, or a row whose verdict is not
 * `verified` may still be estimated, but it can never be presented as a
 * vendor-backed number.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CloudProvider, Confidence } from "../../core/models/estimate.types.ts";
import { ageDaysFromCapturedAt } from "../../core/rates/age-days.ts";
import type { FallbackPricesDocument } from "./fallback-schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** sources/price-validations.json, relative to this module. */
export const PRICE_VALIDATIONS_PATH = path.resolve(
  __dirname,
  "../../../../../sources/price-validations.json",
);

export type PriceValidationVerdict =
  | "verified"
  | "mismatch"
  | "unsupported-meter"
  | "proxy"
  | "unverified";

export type PriceValidationMethod =
  | "azure-retail-api"
  | "aws-price-list-api"
  | "official-doc";

export interface PriceValidationRow {
  meterId: string;
  provider: CloudProvider;
  region: string;
  claimedUnitPrice: number;
  claimedUnit: string;
  verdict: PriceValidationVerdict;
  method: PriceValidationMethod;
  probe: Record<string, unknown>;
  observed: Record<string, unknown>;
  /** ISO date of the last real comparison against the official source; null = never. */
  verifiedAt: string | null;
  /**
   * ISO date of the last verification *attempt*, for rows no automated probe
   * can settle. Only consulted when blockedReason is set.
   */
  lastAttemptedAt?: string | null;
  /** Why this row cannot be auto-verified. Presence keeps it permanently untrusted. */
  blockedReason?: string;
  sourceUrl: string;
  /** Set to "ops" when the price is per-operation and must not be multiplied by GB. */
  dimension?: string;
  notes?: string;
}

export interface PriceValidationLedger {
  schemaVersion: number;
  maxAgeDays: Record<PriceValidationMethod, number>;
  meters: PriceValidationRow[];
}

/** Verdicts whose number may be shown as an official vendor price. */
export const TRUSTED_VERDICTS: readonly PriceValidationVerdict[] = ["verified"];

/**
 * Verdicts that force the owning capability down to a Low-confidence band:
 * the number is either not a vendor SKU at all, or belongs to another service.
 */
export const UNTRUSTED_VERDICTS: readonly PriceValidationVerdict[] = [
  "mismatch",
  "unsupported-meter",
  "proxy",
  "unverified",
];

const VALID_VERDICTS = new Set<string>([
  "verified",
  "mismatch",
  "unsupported-meter",
  "proxy",
  "unverified",
]);

const VALID_METHODS = new Set<string>([
  "azure-retail-api",
  "aws-price-list-api",
  "official-doc",
]);

/** @throws when the ledger is malformed — never returns a partial ledger. */
export function parsePriceValidationLedger(raw: unknown): PriceValidationLedger {
  if (!raw || typeof raw !== "object") {
    throw new Error("price-validations: document must be an object");
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.schemaVersion !== "number") {
    throw new Error("price-validations: schemaVersion required");
  }
  const maxAgeDays = doc.maxAgeDays as Record<string, unknown> | undefined;
  if (!maxAgeDays || typeof maxAgeDays !== "object") {
    throw new Error("price-validations: maxAgeDays required");
  }
  for (const method of VALID_METHODS) {
    const v = maxAgeDays[method];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      throw new Error(`price-validations: maxAgeDays.${method} must be > 0`);
    }
  }
  if (!Array.isArray(doc.meters) || doc.meters.length === 0) {
    throw new Error("price-validations: meters[] required");
  }

  const seen = new Set<string>();
  const meters: PriceValidationRow[] = [];
  for (const row of doc.meters) {
    if (!row || typeof row !== "object") {
      throw new Error("price-validations: meter row must be an object");
    }
    const m = row as Record<string, unknown>;
    if (typeof m.meterId !== "string" || !m.meterId) {
      throw new Error("price-validations: meterId required");
    }
    if (seen.has(m.meterId)) {
      throw new Error(`price-validations: duplicate meterId ${m.meterId}`);
    }
    seen.add(m.meterId);
    if (m.provider !== "azure" && m.provider !== "aws" && m.provider !== "gcp") {
      throw new Error(`price-validations: bad provider for ${m.meterId}`);
    }
    if (typeof m.claimedUnitPrice !== "number" || !Number.isFinite(m.claimedUnitPrice)) {
      throw new Error(`price-validations: claimedUnitPrice required for ${m.meterId}`);
    }
    if (typeof m.claimedUnit !== "string" || !m.claimedUnit) {
      throw new Error(`price-validations: claimedUnit required for ${m.meterId}`);
    }
    if (typeof m.verdict !== "string" || !VALID_VERDICTS.has(m.verdict)) {
      throw new Error(`price-validations: bad verdict for ${m.meterId}`);
    }
    if (typeof m.method !== "string" || !VALID_METHODS.has(m.method)) {
      throw new Error(`price-validations: bad method for ${m.meterId}`);
    }
    if (typeof m.sourceUrl !== "string" || !m.sourceUrl.startsWith("http")) {
      throw new Error(`price-validations: sourceUrl required for ${m.meterId}`);
    }
    if (m.verifiedAt !== null) {
      if (typeof m.verifiedAt !== "string" || Number.isNaN(Date.parse(m.verifiedAt))) {
        throw new Error(`price-validations: verifiedAt must be ISO or null for ${m.meterId}`);
      }
    }
    // A verified row must actually carry an observation.
    if (m.verdict === "verified" && m.verifiedAt === null) {
      throw new Error(
        `price-validations: ${m.meterId} is verified but has no verifiedAt`,
      );
    }
    meters.push({
      meterId: m.meterId,
      provider: m.provider,
      region: typeof m.region === "string" ? m.region : "",
      claimedUnitPrice: m.claimedUnitPrice,
      claimedUnit: m.claimedUnit,
      verdict: m.verdict as PriceValidationVerdict,
      method: m.method as PriceValidationMethod,
      probe: (m.probe as Record<string, unknown>) ?? {},
      observed: (m.observed as Record<string, unknown>) ?? {},
      verifiedAt: (m.verifiedAt as string | null) ?? null,
      lastAttemptedAt: (m.lastAttemptedAt as string | null) ?? null,
      blockedReason:
        typeof m.blockedReason === "string" ? m.blockedReason : undefined,
      sourceUrl: m.sourceUrl,
      dimension: typeof m.dimension === "string" ? m.dimension : undefined,
      notes: typeof m.notes === "string" ? m.notes : undefined,
    });
  }

  return {
    schemaVersion: doc.schemaVersion,
    maxAgeDays: maxAgeDays as unknown as Record<PriceValidationMethod, number>,
    meters,
  };
}

let cachedLedger: PriceValidationLedger | undefined;

export function loadPriceValidationLedger(
  filePath: string = PRICE_VALIDATIONS_PATH,
): PriceValidationLedger {
  if (filePath === PRICE_VALIDATIONS_PATH && cachedLedger) return cachedLedger;
  const ledger = parsePriceValidationLedger(
    JSON.parse(fs.readFileSync(filePath, "utf8")),
  );
  if (filePath === PRICE_VALIDATIONS_PATH) cachedLedger = ledger;
  return ledger;
}

export function validationForMeter(
  meterId: string,
  ledger: PriceValidationLedger = loadPriceValidationLedger(),
): PriceValidationRow | undefined {
  return ledger.meters.find((m) => m.meterId === meterId);
}

/**
 * Days since this row was last looked at. Normally that means the last real
 * comparison; for a row no probe can settle (blockedReason) the last attempt
 * counts instead, so a permanently unverifiable price still gets revisited on
 * schedule without pinning CI red forever. Never looked at → Infinity.
 */
export function validationAgeDays(
  row: PriceValidationRow,
  now: Date = new Date(),
): number {
  const clock = row.verifiedAt ?? (row.blockedReason ? row.lastAttemptedAt : null);
  if (!clock) return Number.POSITIVE_INFINITY;
  return ageDaysFromCapturedAt(clock, now);
}

/**
 * True when this row is due for a re-crawl. This is the age factor the
 * crawler uses to decide what to re-fetch: rows checked against a live API
 * age out faster than rows transcribed from a documentation page.
 */
export function isValidationStale(
  row: PriceValidationRow,
  ledger: PriceValidationLedger = loadPriceValidationLedger(),
  now: Date = new Date(),
): boolean {
  const max = ledger.maxAgeDays[row.method];
  return validationAgeDays(row, now) > max;
}

/** Rows due for re-crawl, oldest first — the crawler's work queue. */
export function staleValidations(
  ledger: PriceValidationLedger = loadPriceValidationLedger(),
  now: Date = new Date(),
): PriceValidationRow[] {
  return ledger.meters
    .filter((row) => isValidationStale(row, ledger, now))
    .sort((a, b) => validationAgeDays(b, now) - validationAgeDays(a, now));
}

export type MeterVerification = {
  meterId: string;
  verdict: PriceValidationVerdict;
  verifiedAt: string | null;
  ageDays: number;
  stale: boolean;
  sourceUrl: string;
  /** Safe to present as a vendor price. */
  trusted: boolean;
};

/**
 * Verification metadata for one meter, for attaching to a LineItem so the API
 * and UI can show provenance per line rather than one blanket disclaimer.
 * An unknown meterId is treated as unverified (fail closed), not as fine.
 */
export function verifyMeter(
  meterId: string,
  ledger: PriceValidationLedger = loadPriceValidationLedger(),
  now: Date = new Date(),
): MeterVerification {
  const row = validationForMeter(meterId, ledger);
  if (!row) {
    return {
      meterId,
      verdict: "unverified",
      verifiedAt: null,
      ageDays: Number.POSITIVE_INFINITY,
      stale: true,
      sourceUrl: "",
      trusted: false,
    };
  }
  const ageDays = validationAgeDays(row, now);
  const stale = isValidationStale(row, ledger, now);
  return {
    meterId,
    verdict: row.verdict,
    verifiedAt: row.verifiedAt,
    ageDays,
    stale,
    sourceUrl: row.sourceUrl,
    trusted: TRUSTED_VERDICTS.includes(row.verdict) && !stale,
  };
}

/**
 * Cap confidence for a line item whose rate is not vendor-backed.
 * A number the vendor does not publish can never be a High-confidence quote.
 */
export function confidenceForVerification(
  declared: Confidence,
  verification: MeterVerification,
): Confidence {
  if (verification.trusted) return declared;
  return "Low";
}

/**
 * Human warnings for the meters an estimate actually billed.
 * One line per problem meter — deduped, never per-line spam.
 */
export function verificationWarnings(
  meterIds: readonly string[],
  ledger: PriceValidationLedger = loadPriceValidationLedger(),
  now: Date = new Date(),
): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const meterId of meterIds) {
    if (seen.has(meterId)) continue;
    seen.add(meterId);
    const v = verifyMeter(meterId, ledger, now);
    if (v.trusted) continue;
    if (v.verdict === "unsupported-meter") {
      warnings.push(
        `${meterId}: the provider price list has no such meter — this line is a repo-invented proxy, not a vendor price (${v.sourceUrl})`,
      );
    } else if (v.verdict === "proxy") {
      warnings.push(
        `${meterId}: price is officially correct but comes from a different service's price list than this meter claims (${v.sourceUrl})`,
      );
    } else if (v.verdict === "mismatch") {
      warnings.push(
        `${meterId}: claimed price disagrees with the official price list — estimate is wrong until refreshed (${v.sourceUrl})`,
      );
    } else if (v.verdict === "unverified") {
      warnings.push(
        `${meterId}: never checked against an official source — treat as indicative only`,
      );
    } else if (v.stale) {
      warnings.push(
        `${meterId}: last verified ${Number.isFinite(v.ageDays) ? `${v.ageDays}d` : "never"} ago, past its re-check window — run \`pnpm rates:validate\``,
      );
    }
  }
  return warnings;
}

/**
 * Atomic binding: every price the engine can bill must equal the price the
 * ledger says was checked, and every ledger row must exist in the rate file.
 * Any drift between the two means the ledger is describing a different number
 * from the one the estimator uses.
 *
 * @throws with every mismatch listed, so a refresh fixes them in one pass.
 */
export function assertFallbackMatchesLedger(
  doc: FallbackPricesDocument,
  ledger: PriceValidationLedger = loadPriceValidationLedger(),
): void {
  const problems: string[] = [];
  const ledgerForProvider = ledger.meters.filter(
    (m) => m.provider === doc.provider,
  );
  const ledgerById = new Map(ledgerForProvider.map((m) => [m.meterId, m]));

  for (const meter of doc.meters) {
    const row = ledgerById.get(meter.meterId);
    if (!row) {
      problems.push(
        `${doc.provider}/${meter.meterId}: priced by the engine but absent from sources/price-validations.json`,
      );
      continue;
    }
    if (row.claimedUnitPrice !== meter.unitPrice) {
      problems.push(
        `${doc.provider}/${meter.meterId}: rate file says ${meter.unitPrice}, ledger says ${row.claimedUnitPrice}`,
      );
    }
    if (row.claimedUnit !== meter.unit) {
      problems.push(
        `${doc.provider}/${meter.meterId}: rate file unit '${meter.unit}', ledger unit '${row.claimedUnit}'`,
      );
    }
    if (row.region && doc.region && row.region !== doc.region) {
      problems.push(
        `${doc.provider}/${meter.meterId}: rate file region '${doc.region}', ledger region '${row.region}'`,
      );
    }
  }

  const fileIds = new Set(doc.meters.map((m) => m.meterId));
  for (const row of ledgerForProvider) {
    if (!fileIds.has(row.meterId)) {
      problems.push(
        `${doc.provider}/${row.meterId}: in the ledger but missing from fallback-prices.json`,
      );
    }
  }

  if (problems.length) {
    throw new Error(
      `price-validations drift (${problems.length}):\n  ${problems.join("\n  ")}`,
    );
  }
}
