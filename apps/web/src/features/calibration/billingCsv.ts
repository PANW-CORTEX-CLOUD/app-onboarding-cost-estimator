/**
 * Local-only billing CSV calibration (package 23).
 * Parses Azure Cost Management / AWS Cost Explorer / GCP Billing exports.
 * Never uploads data; Apply factor scales volume fields only (not unit prices).
 */
export type CalibrationProvider = "azure" | "aws" | "gcp";

export type CalibrationRow = {
  provider: CalibrationProvider;
  service: string;
  amount: number;
  currency: string;
  matched: boolean;
};

export type CalibrationParseResult = {
  provider: CalibrationProvider;
  rows: CalibrationRow[];
  totalActual: number;
  unmatched: CalibrationRow[];
  currency: string;
  warnings: string[];
};

export type CalibrationParseError = {
  ok: false;
  errors: string[];
};

export const CALIBRATION_MAX_BYTES = 1_000_000; // 1 MiB cap (EDGE)
export const LIST_VS_ACTUAL_NOTE =
  "Estimates use List/Retail rates. EA, Savings Plans, and CUDs often make Actual < List.";

const AZURE_SERVICE = /MeterCategory|ServiceName|Product/i;
const AZURE_COST = /CostInBillingCurrency|Cost|PretaxCost/i;
const AWS_SERVICE = /ProductName|Service|product\/ProductName/i;
const AWS_COST = /UnblendedCost|BlendedCost|NetAmortizedCost|Amount/i;
const GCP_SERVICE = /Service description|Service|sku\.description/i;
const GCP_COST = /Cost|cost|Amount/i;

function splitCsvLine(line: string): string[] {
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

function findCol(headers: string[], re: RegExp): number {
  return headers.findIndex((h) => re.test(h));
}

function detectProvider(headers: string[]): CalibrationProvider | null {
  const h = headers.join("|");
  if (/CostInBillingCurrency|MeterCategory|SubscriptionName/i.test(h)) return "azure";
  if (/UnblendedCost|BlendedCost|lineItem\/|ProductName/i.test(h)) return "aws";
  if (/Service description|Project ID|Billing account/i.test(h)) return "gcp";
  return null;
}

const MATCH_HINTS = [
  /event.?hub|kinesis|pubsub|pub\/sub|stream/i,
  /storage|blob|s3|disk/i,
  /egress|data transfer|network/i,
  /registry|ecr|acr|artifact/i,
  /function|lambda|serverless/i,
];

function isMatchedService(service: string): boolean {
  return MATCH_HINTS.some((re) => re.test(service));
}

export function parseBillingCsv(
  text: string,
  opts: { maxBytes?: number } = {},
): CalibrationParseResult | CalibrationParseError {
  const maxBytes = opts.maxBytes ?? CALIBRATION_MAX_BYTES;
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > maxBytes) {
    return {
      ok: false,
      errors: [`CSV exceeds size cap (${maxBytes} bytes)`],
    };
  }
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length < 2) {
    return { ok: false, errors: ["CSV must include a header and at least one data row"] };
  }
  const headers = splitCsvLine(lines[0]!);
  const provider = detectProvider(headers);
  if (!provider) {
    return {
      ok: false,
      errors: ["Unrecognized billing CSV (expected Azure, AWS, or GCP columns)"],
    };
  }

  let svcIdx: number;
  let costIdx: number;
  let currencyIdx = headers.findIndex((h) =>
    /^(billing)?currency$/i.test(h.trim()) || /^currency$/i.test(h.trim()),
  );
  // Prefer exact Currency column — never CostInBillingCurrency (contains "Currency").
  if (currencyIdx < 0) {
    currencyIdx = headers.findIndex(
      (h) => /currency/i.test(h) && !/cost|amount|price/i.test(h),
    );
  }
  if (provider === "azure") {
    svcIdx = findCol(headers, AZURE_SERVICE);
    costIdx = findCol(headers, AZURE_COST);
  } else if (provider === "aws") {
    svcIdx = findCol(headers, AWS_SERVICE);
    costIdx = findCol(headers, AWS_COST);
  } else {
    svcIdx = findCol(headers, GCP_SERVICE);
    costIdx = findCol(headers, GCP_COST);
  }
  if (svcIdx < 0 || costIdx < 0) {
    return {
      ok: false,
      errors: [`Missing required columns for ${provider} billing export`],
    };
  }

  const rows: CalibrationRow[] = [];
  const errors: string[] = [];
  const currencies = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!);
    const service = cols[svcIdx] ?? "";
    const amountRaw = cols[costIdx] ?? "";
    const amount = Number(amountRaw.replace(/[$,]/g, ""));
    if (!Number.isFinite(amount)) {
      errors.push(`Row ${i + 1}: invalid amount "${amountRaw}"`);
      continue;
    }
    const currency =
      currencyIdx >= 0 && cols[currencyIdx]
        ? cols[currencyIdx]!.toUpperCase()
        : "USD";
    currencies.add(currency);
    rows.push({
      provider,
      service,
      amount,
      currency,
      matched: isMatchedService(service),
    });
  }

  if (errors.length && rows.length === 0) {
    return { ok: false, errors };
  }
  if (currencies.size > 1) {
    return {
      ok: false,
      errors: [
        `Mixed currencies rejected: ${[...currencies].join(", ")} (USD-only v1)`,
      ],
    };
  }
  const currency = [...currencies][0] ?? "USD";
  if (currency !== "USD") {
    return {
      ok: false,
      errors: [`Currency ${currency} rejected — estimates are USD List/Retail only`],
    };
  }

  const unmatched = rows.filter((r) => !r.matched);
  const totalActual = rows.reduce((s, r) => s + r.amount, 0);
  const warnings = [LIST_VS_ACTUAL_NOTE, ...errors];

  return {
    provider,
    rows,
    totalActual,
    unmatched,
    currency,
    warnings,
  };
}

/**
 * Suggest volume calibration factor from estimated vs actual totals.
 * factor = actual / estimated when estimated > 0.
 */
export function suggestCalibrationFactor(
  estimated: number,
  actual: number,
): number | null {
  if (!Number.isFinite(estimated) || !Number.isFinite(actual) || estimated <= 0) {
    return null;
  }
  return actual / estimated;
}

/** Scale volume numeric fields by factor (not unit prices). */
export function scaleVolumeFields<T extends Record<string, number>>(
  volume: T,
  factor: number,
): T {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error("calibration factor must be a positive finite number");
  }
  const out = { ...volume };
  for (const k of Object.keys(out)) {
    out[k as keyof T] = (Number(out[k]) * factor) as T[keyof T];
  }
  return out;
}
