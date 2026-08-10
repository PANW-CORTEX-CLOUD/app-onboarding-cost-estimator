/**
 * Estimator-inputs CSV export/import (package 01/01).
 * Round-trips provider/region/capabilities/volume/assumptions for external edit.
 * Never imports line-item amounts or billing Cost columns — those invent rates.
 */
import {
  isCloudProvider,
  type CloudProvider,
} from "../../shared/model/cloud-provider.ts";

export const INPUTS_CSV_FORMAT = "cloud-connector-estimator-inputs";
export const INPUTS_CSV_FORMAT_VERSION = "1";
export const INPUTS_CSV_MAX_BYTES = 256 * 1024;

export type EstimatorInputsCapabilities = {
  discovery: boolean;
  auditLogs: boolean;
  adsCloud: boolean;
  adsOutpost: boolean;
  dspm: boolean;
  registry: boolean;
  serverless: boolean;
  egress: boolean;
};

export type EstimatorInputsVolume = {
  accountCount: number;
  monthlyActiveUsers: number;
  ingressGBPerDay: number;
  peakMBps: number;
  peakEventsPerSec: number;
  overrideStreamMetrics: boolean;
  dataEstateGB: number;
  pctScanned: number;
  scansPerMonth: number;
  imageCount: number;
  avgImageGB: number;
  packageCount: number;
  egressGB: number;
  vmCount: number;
  avgUsedDiskGB: number;
};

export type EstimatorInputsAssumptions = {
  monthHours: number;
  assumedEventBytes: number;
  avgStoredGB: number;
  logIntensity: "low" | "medium" | "high";
};

/** Full allowlisted state for CSV round-trip. */
export type EstimatorInputsState = {
  provider: CloudProvider;
  region: string;
  capabilities: EstimatorInputsCapabilities;
  volume: EstimatorInputsVolume;
  assumptions: EstimatorInputsAssumptions;
};

export type EstimatorInputsParseOk = {
  ok: true;
  state: EstimatorInputsState;
  keyCount: number;
};

export type EstimatorInputsParseErr = {
  ok: false;
  errors: string[];
};

export type EstimatorInputsParseResult =
  | EstimatorInputsParseOk
  | EstimatorInputsParseErr;

const CAPABILITY_KEYS = [
  "discovery",
  "auditLogs",
  "adsCloud",
  "adsOutpost",
  "dspm",
  "registry",
  "serverless",
  "egress",
] as const;

const VOLUME_CORE_KEYS = [
  "accountCount",
  "ingressGBPerDay",
  "peakMBps",
  "peakEventsPerSec",
  "overrideStreamMetrics",
] as const;

const VOLUME_NUMBER_KEYS = [
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
  "vmCount",
  "avgUsedDiskGB",
] as const;

const ASSUMPTION_NUMBER_KEYS = [
  "monthHours",
  "assumedEventBytes",
  "avgStoredGB",
] as const;

/** RFC-4180-ish CSV field splitter (quoted commas). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseBool(raw: string, key: string, errors: string[]): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  errors.push(`${key}: expected true/false, got "${raw}"`);
  return null;
}

function parseNonNegNumber(
  raw: string,
  key: string,
  errors: string[],
): number | null {
  const t = raw.trim();
  if (t === "") {
    errors.push(`${key}: empty number`);
    return null;
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) {
    errors.push(`${key}: expected non-negative number, got "${raw}"`);
    return null;
  }
  return n;
}

/**
 * Serialize current estimator inputs to key,value CSV.
 */
export function exportEstimatorInputsCsv(state: EstimatorInputsState): string {
  const rows: Array<[string, string]> = [
    ["format", INPUTS_CSV_FORMAT],
    ["formatVersion", INPUTS_CSV_FORMAT_VERSION],
    ["provider", state.provider],
    ["region", state.region],
  ];
  for (const k of CAPABILITY_KEYS) {
    rows.push([`capability.${k}`, String(state.capabilities[k])]);
  }
  for (const k of VOLUME_NUMBER_KEYS) {
    rows.push([`volume.${k}`, String(state.volume[k])]);
  }
  rows.push([
    "volume.overrideStreamMetrics",
    String(state.volume.overrideStreamMetrics),
  ]);
  for (const k of ASSUMPTION_NUMBER_KEYS) {
    rows.push([`assumption.${k}`, String(state.assumptions[k])]);
  }
  rows.push(["assumption.logIntensity", state.assumptions.logIntensity]);

  const lines = ["key,value"];
  for (const [k, v] of rows) {
    lines.push(`${csvEscape(k)},${csvEscape(v)}`);
  }
  return lines.join("\n") + "\n";
}

function detectForeignCsv(headerLine: string, errors: string[]): boolean {
  const headers = splitCsvLine(headerLine).map((h) => h.toLowerCase());
  const joined = headers.join("|");
  if (headers.includes("meterid") || (headers.includes("amount") && headers.includes("capability"))) {
    errors.push(
      "This looks like a results (line-item) CSV. Use Download inputs CSV to edit inputs — do not import Export CSV amounts.",
    );
    return true;
  }
  if (
    /costinbillingcurrency|unblendedcost|blendedcost|pretaxcost/i.test(joined) ||
    (/cost/.test(joined) && /service|metercategory|productname/.test(joined))
  ) {
    errors.push(
      "This looks like a billing calibration CSV. Use Inputs CSV (key,value), not billing Cost columns.",
    );
    return true;
  }
  return false;
}

/**
 * Parse inputs CSV. Fail closed on unknown keys, foreign shapes, partial volume.
 */
export function parseEstimatorInputsCsv(
  text: string,
  byteLength = new TextEncoder().encode(text).length,
): EstimatorInputsParseResult {
  const errors: string[] = [];
  if (byteLength > INPUTS_CSV_MAX_BYTES) {
    return {
      ok: false,
      errors: [
        `File exceeds ${INPUTS_CSV_MAX_BYTES} byte cap (${byteLength} bytes)`,
      ],
    };
  }
  const normalized = text.replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    return { ok: false, errors: ["Empty CSV"] };
  }

  const lines = normalized.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { ok: false, errors: ["CSV must have header and at least one data row"] };
  }

  const headerCells = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  if (headerCells[0] !== "key" || headerCells[1] !== "value") {
    if (detectForeignCsv(lines[0]!, errors)) {
      return { ok: false, errors };
    }
    return {
      ok: false,
      errors: ['Header must be "key,value"'],
    };
  }

  const map = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    if (cells.length < 2) {
      errors.push(`Line ${i + 1}: expected key,value`);
      continue;
    }
    const key = cells[0]!;
    const value = cells.slice(1).join(","); // values may contain commas if unquoted split wrong — already handled by splitter
    if (!key) {
      errors.push(`Line ${i + 1}: empty key`);
      continue;
    }
    if (map.has(key)) {
      errors.push(`Duplicate key: ${key}`);
      continue;
    }
    map.set(key, value);
  }

  if (errors.length) return { ok: false, errors };

  const format = map.get("format");
  const formatVersion = map.get("formatVersion");
  if (format !== INPUTS_CSV_FORMAT) {
    return {
      ok: false,
      errors: [
        `Missing or invalid format (expected ${INPUTS_CSV_FORMAT})`,
      ],
    };
  }
  if (formatVersion !== INPUTS_CSV_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        `Unsupported formatVersion "${formatVersion ?? ""}" (expected ${INPUTS_CSV_FORMAT_VERSION})`,
      ],
    };
  }

  const knownKeys = new Set<string>([
    "format",
    "formatVersion",
    "provider",
    "region",
    ...CAPABILITY_KEYS.map((k) => `capability.${k}`),
    ...VOLUME_NUMBER_KEYS.map((k) => `volume.${k}`),
    "volume.overrideStreamMetrics",
    ...ASSUMPTION_NUMBER_KEYS.map((k) => `assumption.${k}`),
    "assumption.logIntensity",
  ]);

  for (const key of map.keys()) {
    if (!knownKeys.has(key)) {
      errors.push(`Unknown key: ${key}`);
    }
  }
  if (errors.length) return { ok: false, errors };

  const providerRaw = map.get("provider");
  const region = map.get("region")?.trim() ?? "";
  if (!providerRaw || !isCloudProvider(providerRaw)) {
    return {
      ok: false,
      errors: [`provider: expected azure|aws|gcp, got "${providerRaw ?? ""}"`],
    };
  }
  if (!region) {
    return { ok: false, errors: ["region: required"] };
  }

  const capPresent = CAPABILITY_KEYS.some((k) =>
    map.has(`capability.${k}`),
  );
  if (!capPresent) {
    return {
      ok: false,
      errors: ["At least one capability.* key is required (explicit caps)"],
    };
  }

  const capabilities = {} as EstimatorInputsCapabilities;
  for (const k of CAPABILITY_KEYS) {
    const raw = map.get(`capability.${k}`);
    if (raw == null) {
      capabilities[k] = false;
    } else {
      const b = parseBool(raw, `capability.${k}`, errors);
      if (b == null) continue;
      capabilities[k] = b;
    }
  }

  const volumePresent = [...VOLUME_NUMBER_KEYS, "overrideStreamMetrics" as const].some(
    (k) => map.has(`volume.${k}`),
  );
  if (!volumePresent) {
    return {
      ok: false,
      errors: ["At least one volume.* key is required"],
    };
  }
  for (const k of VOLUME_CORE_KEYS) {
    if (!map.has(`volume.${k}`)) {
      errors.push(`Missing required volume.${k}`);
    }
  }

  const volume = {
    accountCount: 0,
    monthlyActiveUsers: 0,
    ingressGBPerDay: 0,
    peakMBps: 0,
    peakEventsPerSec: 0,
    overrideStreamMetrics: false,
    dataEstateGB: 0,
    pctScanned: 0,
    scansPerMonth: 0,
    imageCount: 0,
    avgImageGB: 0,
    packageCount: 0,
    egressGB: 0,
    vmCount: 0,
    avgUsedDiskGB: 0,
  } as EstimatorInputsVolume;

  for (const k of VOLUME_NUMBER_KEYS) {
    const raw = map.get(`volume.${k}`);
    if (raw == null) {
      // Optional non-core numbers default to 0 only when core keys present and file is otherwise complete.
      // Core keys already required above; missing optional → 0 is explicit fill for full replace.
      volume[k] = 0;
      continue;
    }
    const n = parseNonNegNumber(raw, `volume.${k}`, errors);
    if (n != null) volume[k] = n;
  }
  const overrideRaw = map.get("volume.overrideStreamMetrics");
  if (overrideRaw != null) {
    const b = parseBool(overrideRaw, "volume.overrideStreamMetrics", errors);
    if (b != null) volume.overrideStreamMetrics = b;
  }

  const assumptionKeys = [
    ...ASSUMPTION_NUMBER_KEYS.map((k) => `assumption.${k}`),
    "assumption.logIntensity",
  ];
  const assumptionPresent = assumptionKeys.some((k) => map.has(k));
  if (!assumptionPresent) {
    errors.push("At least one assumption.* key is required");
  } else {
    for (const k of assumptionKeys) {
      if (!map.has(k)) {
        errors.push(`Missing required ${k} (full assumptions replace)`);
      }
    }
  }

  const assumptions: EstimatorInputsAssumptions = {
    monthHours: 730,
    assumedEventBytes: 1024,
    avgStoredGB: 0,
    logIntensity: "medium",
  };

  for (const k of ASSUMPTION_NUMBER_KEYS) {
    const raw = map.get(`assumption.${k}`);
    if (raw == null) continue;
    const n = parseNonNegNumber(raw, `assumption.${k}`, errors);
    if (n != null) assumptions[k] = n;
  }
  const intensityRaw = map.get("assumption.logIntensity");
  if (intensityRaw != null) {
    const v = intensityRaw.trim().toLowerCase();
    if (v === "low" || v === "medium" || v === "high") {
      assumptions.logIntensity = v;
    } else {
      errors.push(
        `assumption.logIntensity: expected low|medium|high, got "${intensityRaw}"`,
      );
    }
  }

  if (errors.length) return { ok: false, errors };

  // Count data keys excluding format metadata
  let keyCount = 0;
  for (const k of map.keys()) {
    if (k !== "format" && k !== "formatVersion") keyCount++;
  }

  return {
    ok: true,
    keyCount,
    state: {
      provider: providerRaw,
      region,
      capabilities,
      volume,
      assumptions,
    },
  };
}
