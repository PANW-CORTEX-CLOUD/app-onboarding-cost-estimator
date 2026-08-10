/**
 * Multi-cloud createEstimate orchestration (package 15).
 * Maps capability toggles → provider estimators. No formulas in API layer.
 */
import { modelVersion } from "../model-version.ts";
import type {
  CloudProvider,
  Confidence,
  EstimateInputs,
  EstimateResult,
  LineItem,
  RateCard,
  RatesSource,
} from "../core/models/estimate.types.ts";
import {
  createInputHash,
  estimateExportFields,
} from "../core/rate-pinning.ts";
import { resolveVolumeSignals } from "../core/volume-signals.ts";
import { getRates, type GetRatesOptions } from "./rates/get-rates.ts";
import { estimateAuditStream } from "./streams/estimate-audit-stream.ts";
import { estimateAuditStorage } from "./storage/estimate-audit-storage.ts";
import { estimateAds } from "./ads/estimate-ads.ts";
import { estimateDspm } from "./dspm/estimate-dspm.ts";
import {
  estimateRegistryScan,
  estimateServerlessScan,
} from "./registry-serverless/estimate-scans.ts";
import { estimateEgress } from "./egress/estimate-egress.ts";
import { bandFromExpected } from "./dspm/dspm.types.ts";
import { appendTfHonestyWarnings } from "./tf-honesty-warnings.ts";
import {
  DEFAULT_ACCOUNT_COUNT,
  DEFAULT_ADS_SCANS_PER_MONTH,
  DEFAULT_AVG_PACKAGE_GB,
  DEFAULT_DSPM_PCT_SCANNED,
  DEFAULT_MONTH_HOURS_VALUE,
  DEFAULT_SCANS_PER_MONTH,
  DEFAULT_SNAPSHOT_LIFETIME_HOURS,
  HOURS_PER_DAY,
} from "../core/estimator-defaults.ts";
import {
  DEFAULT_TF_MODE,
  gateCapabilitiesByTf,
  type TfMode,
} from "./tf/tf-feature-manifest.ts";
import {
  confidenceForVerification,
  verificationWarnings,
  verifyMeter,
} from "./rates/price-validation.ts";

export type CreateEstimateRequest = {
  provider: CloudProvider;
  region: string;
  capabilities: {
    discovery?: boolean;
    auditLogs?: boolean;
    adsCloud?: boolean;
    adsOutpost?: boolean;
    dspm?: boolean;
    registry?: boolean;
    serverless?: boolean;
    egress?: boolean;
  };
  volume?: {
    accountCount?: number;
    monthlyActiveUsers?: number;
    logIntensity?: "low" | "medium" | "high";
    /**
     * When true, lock explicit ingress/peak fields (presets, paste, manual edit).
     * When false/omit, derive stream volume from accountCount elasticities.
     */
    overrideStreamMetrics?: boolean;
    ingressGBPerDay?: number;
    peakMBps?: number;
    peakEventsPerSec?: number;
    byoManagedStream?: boolean;
    avgStoredGB?: number;
    vmCount?: number;
    avgUsedDiskGB?: number;
    scansPerMonth?: number;
    dataEstateGB?: number;
    pctScanned?: number;
    imageCount?: number;
    avgImageGB?: number;
    packageCount?: number;
    egressGB?: number;
    /** Average event bytes for stream GB→events (Azure ingress). Must be > 0. */
    assumedEventBytes?: number;
    /**
     * Average size of a scanned object, in MB. Object stores bill scanning per
     * API call, so this is what turns a DSPM estate size into billable
     * operations. Defaults to DEFAULT_AVG_OBJECT_SIZE_MB.
     */
    avgObjectSizeMB?: number;
  };
  monthHours?: number;
  /**
   * `as-deployed` prices only what the connector Terraform will actually
   * create, so the total is comparable to the customer's first invoice.
   * `what-if` (default) also prices capabilities with no connector TF.
   */
  tfMode?: TfMode;
  /** Injected clock for deterministic rate-provenance ages in tests. */
  now?: Date;
  /**
   * Rate-resolution seam — inject adapters or a cache to estimate without
   * touching the network (offline mode, reproducible exports, tests).
   * Omitted, rates resolve live → 24h cache → in-repo fallback as before.
   */
  ratesOptions?: GetRatesOptions;
};

export type CreateEstimateResponse = EstimateResult & {
  inputHash: string;
  ratesSource: RatesSource;
  warnings: string[];
  /** Stream volume after elasticities / optional override (UI sync). */
  resolvedVolume: {
    ingressGBPerDay: number;
    peakMBps: number;
    peakEventsPerSec: number;
    overrideStreamMetrics: boolean;
  };
  /** Which TF grounding rule produced this number. */
  tfMode: TfMode;
  /** Capabilities dropped because the Terraform will not deploy them. */
  excludedCapabilities: Array<{ capability: string; reason: string }>;
};

/** Worst-case (most conservative) confidence across all line items: Low > Med > High. */
function worstConfidence(items: LineItem[]): Confidence {
  if (items.some((i) => i.confidence === "Low")) return "Low";
  if (items.some((i) => i.confidence === "Med")) return "Med";
  return "High";
}

/**
 * Build a monthly estimate for one provider by calling each enabled
 * capability's shared estimator and flattening their line items.
 *
 * `totals.expected` is summed once from the flattened `lineItems` (never
 * from pre-aggregated sub-estimator totals) so no capability's cost can be
 * counted twice. Overall `confidence` is the worst confidence across all
 * line items (@see worstConfidence); when that is "Low", the response
 * exposes a `{low, expected, high}` band via `bandFromExpected` instead of
 * a bare point (AC pkg 19 — reuses the DSPM 0.5×/2.0× band factors for any
 * Low-confidence mix, not DSPM-specific math).
 *
 * Uses fallback/live rates via getRates — never invents $0 meters.
 * @throws when `monthHours` ≤ 0, `assumedEventBytes` ≤ 0 (when provided), or
 * `rates.provider` doesn't match the requested provider.
 */
export async function createEstimate(
  req: CreateEstimateRequest,
): Promise<CreateEstimateResponse> {
  const { provider, region } = req;
  const monthHours = req.monthHours ?? DEFAULT_MONTH_HOURS_VALUE;
  if (monthHours <= 0) {
    throw new Error(`monthHours must be > 0, got ${monthHours}`);
  }
  const requestedCaps = req.capabilities ?? {};
  const vol = req.volume ?? {};
  const warnings: string[] = [];
  const now = req.now ?? new Date();
  const tfMode = req.tfMode ?? DEFAULT_TF_MODE;

  // Gate before any pricing happens: in as-deployed mode a capability the
  // Terraform will not create must never reach an estimator.
  const gate = gateCapabilitiesByTf(provider, requestedCaps, tfMode);
  const caps = gate.effective;
  warnings.push(...gate.warnings);
  if (vol.assumedEventBytes !== undefined && vol.assumedEventBytes <= 0) {
    throw new Error(
      `assumedEventBytes must be > 0, got ${vol.assumedEventBytes}`,
    );
  }

  const ratesResult = await getRates(provider, region, {
    now,
    ...(req.ratesOptions ?? {}),
  });
  warnings.push(...ratesResult.warnings);
  const rates: RateCard = ratesResult.rates;
  if (rates.provider !== provider) {
    throw new Error(
      `RateCard provider '${rates.provider}' does not match request '${provider}'`,
    );
  }

  const accountCount = vol.accountCount ?? DEFAULT_ACCOUNT_COUNT;
  const overrideStreamMetrics = vol.overrideStreamMetrics === true;
  const resolvedVol = resolveVolumeSignals({
    provider,
    accountCount,
    monthlyActiveUsers: vol.monthlyActiveUsers,
    logIntensity: vol.logIntensity,
    byoManagedStream: vol.byoManagedStream,
    // EDGE: do not treat UI default ingress fields as a silent raw override —
    // account elasticities apply unless overrideStreamMetrics is explicit.
    rawMetrics: overrideStreamMetrics
      ? {
          ingressGBPerDay: vol.ingressGBPerDay,
          peakMBps: vol.peakMBps,
          peakEventsPerSec: vol.peakEventsPerSec,
        }
      : undefined,
  });
  if (
    !overrideStreamMetrics &&
    (vol.ingressGBPerDay !== undefined ||
      vol.peakMBps !== undefined ||
      vol.peakEventsPerSec !== undefined)
  ) {
    warnings.push(
      "Stream volume derived from accountCount elasticities; set overrideStreamMetrics=true to lock explicit ingress/peak",
    );
  }

  const lineItems: LineItem[] = [];
  let streamIngressGbPerDay = resolvedVol.ingressGBPerDay;

  if (caps.auditLogs) {
    const stream = estimateAuditStream(
      provider,
      {
        enabled: true,
        region,
        ingressGBPerDay: resolvedVol.ingressGBPerDay,
        peakMBps: resolvedVol.peakMBps,
        peakEventsPerSec: resolvedVol.peakEventsPerSec,
        monthHours,
        assumedEventBytes: vol.assumedEventBytes,
        byoManagedStream: resolvedVol.byoManagedStream,
      },
      rates,
    );
    lineItems.push(...stream.lineItems);
    warnings.push(...stream.warnings);
    streamIngressGbPerDay = resolvedVol.ingressGBPerDay;

    const storage = estimateAuditStorage(
      provider,
      {
        enabled: true,
        region,
        avgGB: vol.avgStoredGB,
      },
      rates,
    );
    lineItems.push(...storage.lineItems);
    warnings.push(...storage.warnings);
  }

  // TODO(REQ-6): `?? 0` below collapses "the user told us nothing" into "the
  // answer is zero". The estimators warn on a zero, so the output is not
  // silent, but by then the request layer has already destroyed the difference
  // between absent and deliberately-zero. Carry `undefined` through and let
  // each estimator decide whether to refuse or to price an explicit zero.
  if (caps.adsCloud || caps.adsOutpost) {
    const ads = estimateAds(
      provider,
      {
        enabled: true,
        mode: caps.adsOutpost ? "Outpost" : "Cloud",
        region,
        vmCount: vol.vmCount ?? 0,
        avgUsedDiskGB: vol.avgUsedDiskGB ?? 0,
        scansPerMonth: vol.scansPerMonth ?? DEFAULT_ADS_SCANS_PER_MONTH,
        snapshotLifetimeHours: DEFAULT_SNAPSHOT_LIFETIME_HOURS,
        monthHours,
      },
      rates,
    );
    lineItems.push(...ads.lineItems);
    warnings.push(...ads.warnings);
  }

  if (caps.dspm) {
    const dspm = estimateDspm(
      provider,
      {
        enabled: true,
        region,
        dataEstateGB: vol.dataEstateGB ?? 0,
        pctScanned: vol.pctScanned ?? DEFAULT_DSPM_PCT_SCANNED,
        scansPerMonth: vol.scansPerMonth ?? DEFAULT_SCANS_PER_MONTH,
        avgObjectSizeMB: vol.avgObjectSizeMB,
      },
      rates,
    );
    lineItems.push(...dspm.lineItems);
    warnings.push(...dspm.warnings);
  }

  if (caps.registry) {
    const reg = estimateRegistryScan(
      provider,
      {
        enabled: true,
        region,
        imageCount: vol.imageCount ?? 0,
        avgImageGB: vol.avgImageGB ?? 0,
        scansPerMonth: vol.scansPerMonth ?? DEFAULT_SCANS_PER_MONTH,
        crossRegionPull: false,
      },
      rates,
    );
    lineItems.push(...reg.lineItems);
    warnings.push(...reg.warnings);
  }

  if (caps.serverless) {
    const sev = estimateServerlessScan(
      provider,
      {
        enabled: true,
        region,
        packageCount: vol.packageCount ?? 0,
        avgPackageGB: DEFAULT_AVG_PACKAGE_GB,
        scansPerMonth: vol.scansPerMonth ?? DEFAULT_SCANS_PER_MONTH,
      },
      rates,
    );
    lineItems.push(...sev.lineItems);
    warnings.push(...sev.warnings);
  }

  if (caps.egress) {
    // Deliberately NOT alreadyBilledElsewhere: this bills the customer's
    // internet-egress bandwidth meter (VNet/VPC → Cortex SaaS backend), which
    // is a distinct real-world charge from the stream-ingestion meter billed
    // above (EH/Kinesis/Pub·Sub) even though both derive their volume from the
    // same audit-log bytes — ingesting into the managed stream and then
    // egressing that stream's data to the internet are two separate billable
    // hops in each provider's real pricing model. `alreadyBilledElsewhere` is
    // for genuinely redundant meters (e.g. registry pull bandwidth already
    // covered by a stream meter), not this case.
    const monthlyIngress =
      streamIngressGbPerDay * (monthHours / HOURS_PER_DAY);
    const eg = estimateEgress(
      provider,
      {
        enabled: true,
        region,
        egressGB: vol.egressGB,
        auditStreamIngressGBPerMonth: caps.auditLogs ? monthlyIngress : undefined,
        destinationZone: "internet",
      },
      rates,
    );
    lineItems.push(...eg.lineItems);
    warnings.push(...eg.warnings);
  }

  if (caps.discovery) {
    warnings.push(
      "discovery capability has no customer-cloud meter in v1 (TF empty / identity-only)",
    );
  }

  // Honesty: Azure TF bills audit only; AWS/GCP have no connector TF inventory.
  appendTfHonestyWarnings(provider, caps, warnings);

  // Rate provenance: stamp every line with when its price was last seen in the
  // vendor's own price list, and refuse to call a line High confidence when the
  // number behind it is not vendor-backed.
  const verifiedLineItems: LineItem[] = lineItems.map((item) => {
    const verification = verifyMeter(item.meterId, undefined, now);
    return {
      ...item,
      confidence: confidenceForVerification(item.confidence, verification),
      verification,
    };
  });
  warnings.push(
    ...verificationWarnings(
      verifiedLineItems.map((i) => i.meterId),
      undefined,
      now,
    ),
  );

  const estimateInputs: EstimateInputs = {
    provider,
    region,
    monthHours,
    capabilities: {
      discovery: caps.discovery,
      auditLogs: caps.auditLogs,
      adsCloud: caps.adsCloud,
      adsOutpost: caps.adsOutpost,
      dspm: caps.dspm,
      registry: caps.registry,
      serverless: caps.serverless,
    },
    volume: vol as Record<string, number | string | boolean>,
  };

  const meta = estimateExportFields(provider, rates, estimateInputs);
  const expected = verifiedLineItems.reduce((s, i) => s + i.amount, 0);
  const confidence =
    verifiedLineItems.length === 0 ? "High" : worstConfidence(verifiedLineItems);
  // AC (pkg 19): Low-confidence capabilities expose low/expected/high bands.
  const totals =
    confidence === "Low" ? bandFromExpected(expected) : { expected };

  return {
    provider,
    lineItems: verifiedLineItems,
    totals,
    confidence,
    modelVersion: meta.modelVersion ?? modelVersion,
    ratesAsOf: meta.ratesAsOf,
    inputHash: meta.inputHash ?? createInputHash(estimateInputs),
    ratesSource: ratesResult.ratesSource,
    warnings,
    resolvedVolume: {
      ingressGBPerDay: resolvedVol.ingressGBPerDay,
      peakMBps: resolvedVol.peakMBps,
      peakEventsPerSec: resolvedVol.peakEventsPerSec,
      overrideStreamMetrics,
    },
    tfMode,
    excludedCapabilities: gate.excluded,
  };
}
