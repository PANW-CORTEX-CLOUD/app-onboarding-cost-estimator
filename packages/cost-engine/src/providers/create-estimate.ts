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
import { getRates } from "./rates/get-rates.ts";
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
  };
  monthHours?: number;
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
  const monthHours = req.monthHours ?? 730;
  if (monthHours <= 0) {
    throw new Error(`monthHours must be > 0, got ${monthHours}`);
  }
  const caps = req.capabilities ?? {};
  const vol = req.volume ?? {};
  const warnings: string[] = [];
  if (vol.assumedEventBytes !== undefined && vol.assumedEventBytes <= 0) {
    throw new Error(
      `assumedEventBytes must be > 0, got ${vol.assumedEventBytes}`,
    );
  }

  const ratesResult = await getRates(provider, region);
  warnings.push(...ratesResult.warnings);
  const rates: RateCard = ratesResult.rates;
  if (rates.provider !== provider) {
    throw new Error(
      `RateCard provider '${rates.provider}' does not match request '${provider}'`,
    );
  }

  const accountCount = vol.accountCount ?? 10;
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

  if (caps.adsCloud || caps.adsOutpost) {
    const ads = estimateAds(
      provider,
      {
        enabled: true,
        mode: caps.adsOutpost ? "Outpost" : "Cloud",
        region,
        vmCount: vol.vmCount ?? 0,
        avgUsedDiskGB: vol.avgUsedDiskGB ?? 0,
        scansPerMonth: vol.scansPerMonth ?? 4,
        snapshotLifetimeHours: 24,
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
        pctScanned: vol.pctScanned ?? 10,
        scansPerMonth: vol.scansPerMonth ?? 1,
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
        scansPerMonth: vol.scansPerMonth ?? 1,
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
        avgPackageGB: 0.01,
        scansPerMonth: vol.scansPerMonth ?? 1,
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
      streamIngressGbPerDay * (monthHours / 24);
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
  const expected = lineItems.reduce((s, i) => s + i.amount, 0);
  const confidence =
    lineItems.length === 0 ? "High" : worstConfidence(lineItems);
  // AC (pkg 19): Low-confidence capabilities expose low/expected/high bands.
  const totals =
    confidence === "Low" ? bandFromExpected(expected) : { expected };

  return {
    provider,
    lineItems,
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
  };
}
