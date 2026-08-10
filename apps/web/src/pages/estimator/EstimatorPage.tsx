/**
 * Estimator page — package 18 IA + package 19 MVP acceptance (presets, export, bands).
 * No pricing formulas; OpenAPI client only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApiClient } from "../../shared/api/api-client-context.tsx";
import type {
  EstimateCapabilities,
  EstimateResponse,
} from "../../entities/estimate/types.ts";
import type { CloudProvider } from "../../entities/provider/model.ts";
import {
  runEstimate,
  EstimateApiError,
} from "../../features/run-estimate/runEstimate.ts";
import { fetchCapabilities } from "../../features/toggle-capabilities/fetchCapabilities.ts";
import type { FrozenRatesMeta } from "../../features/freeze-rates/freezeFromEstimate.ts";
import {
  initialOfflineEngineEnabled,
  setOfflineEngineEnabled,
} from "../../features/offline-mode/offlineEngine.ts";
import type { DemoPreset } from "../../features/demo-presets/demoPresets.ts";
import { DEFAULT_VOLUME_PRESET } from "../../features/demo-presets/demoPresets.ts";
import {
  fetchProjection,
  ProjectionApiError,
  type ProjectionResponse,
} from "../../features/run-projection/fetchProjection.ts";
import {
  assertNoSaasLines,
  buildEstimateExport,
  downloadBlob,
  ExportBlockedError,
  exportToCsv,
  exportToJson,
  exportToPdf,
  type ExportFreshness,
} from "../../features/export-estimate/buildExport.ts";
import {
  loadEstimateCache,
  saveEstimateCache,
  clearEstimateCache,
} from "../../shared/lib/estimate-cache.ts";
import { CAPABILITY_DEBOUNCE_MS, debounce } from "../../shared/lib/debounce.ts";
import { formatUsd } from "../../shared/lib/format-currency.ts";
import {
  readProviderFromSearch,
  writeProviderToUrl,
} from "../../shared/lib/url-state.ts";
import {
  defaultRegionFor,
  REGIONS_BY_PROVIDER,
} from "../../shared/model/regions.ts";
import { EstimatorSection } from "../../shared/ui/EstimatorSection.tsx";
import { SectionErrorBoundary } from "../../shared/ui/SectionErrorBoundary.tsx";
import { ProviderSelector } from "../../widgets/ProviderSelector/ProviderSelector.tsx";
import { ResultsSummary } from "../../widgets/ResultsSummary/ResultsSummary.tsx";
import {
  CapabilityToggles,
  isDiscoveryOnly,
} from "../../widgets/CapabilityToggles/CapabilityToggles.tsx";
import { ScopeAccounts } from "../../widgets/ScopeAccounts/ScopeAccounts.tsx";
import type { TfMode } from "../../shared/model/tf-grounding.ts";
import { VolumeSignalsForm } from "../../widgets/VolumeSignals/VolumeSignalsForm.tsx";
import { CostBreakdown } from "../../widgets/CostBreakdown/CostBreakdown.tsx";
import { CostDrivers } from "../../widgets/CostDrivers/CostDrivers.tsx";
import { AssumptionsPanel } from "../../widgets/AssumptionsPanel/AssumptionsPanel.tsx";
import { CapabilityVolumeFields } from "../../widgets/CapabilityVolumeFields/CapabilityVolumeFields.tsx";
import { ResultsCanvas, type ResultsTab } from "../../widgets/ResultsCanvas/ResultsCanvas.tsx";
import { ResultFlipCard } from "../../widgets/ResultFlipCard/ResultFlipCard.tsx";
import {
  buildBreakdownRows,
  enabledCapabilitiesForLegend,
} from "../../shared/lib/capability-breakdown.ts";
import { buildAffectsByField } from "../../shared/lib/affects-chips.ts";
import { RatesFreshnessBanner } from "../../widgets/RatesFreshnessBanner/RatesFreshnessBanner.tsx";
import { EstimateHonestyBanner } from "../../widgets/EstimateHonestyBanner/EstimateHonestyBanner.tsx";
import { EstimateWarningsList } from "../../widgets/EstimateWarningsList/EstimateWarningsList.tsx";
import { ResultsProvenance } from "../../widgets/ResultsProvenance/ResultsProvenance.tsx";
import { ResultsAssumptionsSnapshot } from "../../widgets/ResultsAssumptionsSnapshot/ResultsAssumptionsSnapshot.tsx";
import { BillingHelpPanel } from "../../widgets/BillingHelpPanel/BillingHelpPanel.tsx";
import { Disclaimer } from "../../widgets/Disclaimer/Disclaimer.tsx";
import { ProjectionCharts } from "../../widgets/ProjectionCharts/ProjectionCharts.tsx";
import { CompareScenarios, type CompareColumn, tierLiteracyNote } from "../../widgets/CompareScenarios/CompareScenarios.tsx";
import { AdvancedDisclosure } from "../../widgets/AdvancedDisclosure/AdvancedDisclosure.tsx";
import { DemoPresetPicker } from "../../widgets/DemoPresetPicker/DemoPresetPicker.tsx";
import { TaggingGuidance } from "../../widgets/TaggingGuidance/TaggingGuidance.tsx";
import { CalibrationPanel } from "../../widgets/CalibrationPanel/CalibrationPanel.tsx";
import { InputsCsvPanel } from "../../widgets/InputsCsvPanel/InputsCsvPanel.tsx";
import { JourneyIntro } from "../../widgets/JourneyIntro/JourneyIntro.tsx";
import { EstimatorJourneyShell } from "../../widgets/EstimatorJourneyShell/EstimatorJourneyShell.tsx";
import { InputsJourneySteps } from "../../widgets/InputsJourneySteps/InputsJourneySteps.tsx";
import { ScopeOverview } from "../../widgets/ScopeOverview/ScopeOverview.tsx";
import { CostOutputEmpty } from "../../widgets/CostOutputEmpty/CostOutputEmpty.tsx";
import { JourneyChecklist } from "../../widgets/JourneyChecklist/JourneyChecklist.tsx";
import type { EstimatorInputsState } from "../../features/estimator-inputs-csv/estimatorInputsCsv.ts";
import {
  readJourneyViewFromSearch,
  writeJourneyViewToUrl,
  inputsStepForJumpTarget,
  type InputsJourneyStep,
  type JourneyMode,
} from "../../shared/lib/journey-view.ts";
import { jumpToInputTestId } from "../../shared/lib/cost-driver-explain.ts";
import {
  buildShareUrl,
  readShareFromSearch,
  validateShareState,
  type ShareState,
} from "../../shared/lib/share-state.ts";
import {
  loadLastShareState,
  saveLastShareState,
} from "../../shared/lib/safe-storage.ts";
import { getDemoPreset } from "../../features/demo-presets/demoPresets.ts";
import { CLOUD_PROVIDERS } from "../../shared/model/cloud-provider.ts";
import { deriveVolumeFromAccounts } from "../../shared/lib/volume-elasticity.ts";
import {
  markEstimatorBootstrapped,
  shouldBootstrapAzureAudit,
} from "../../shared/lib/estimator-bootstrap.ts";

type Freshness = {
  level: "fresh" | "warn" | "critical" | "stale-cache";
  message: string;
  ratesAsOf?: string;
  ratesSource?: string;
};

const DEFAULT_CAPS: EstimateCapabilities = {
  discovery: false,
  auditLogs: true,
  adsCloud: false,
  adsOutpost: false,
  dspm: false,
  registry: false,
  serverless: false,
  egress: false,
};

export function EstimatorPage() {
  const client = useApiClient();
  const [provider, setProvider] = useState<CloudProvider>(() =>
    readProviderFromSearch(),
  );
  const [region, setRegion] = useState(() =>
    defaultRegionFor(readProviderFromSearch()),
  );
  const [caps, setCaps] = useState<EstimateCapabilities>(DEFAULT_CAPS);
  const [accountCount, setAccountCount] = useState<number>(
    DEFAULT_VOLUME_PRESET.accountCount,
  );
  const [mau, setMau] = useState<number>(DEFAULT_VOLUME_PRESET.monthlyActiveUsers);
  const [ingressGBPerDay, setIngress] = useState<number>(
    DEFAULT_VOLUME_PRESET.ingressGBPerDay,
  );
  const [peakMBps, setPeakMBps] = useState<number>(DEFAULT_VOLUME_PRESET.peakMBps);
  const [peakEventsPerSec, setPeakEps] = useState<number>(
    DEFAULT_VOLUME_PRESET.peakEventsPerSec,
  );
  /** When true, lock explicit ingress/peak (presets, paste, manual volume edit). */
  const [overrideStreamMetrics, setOverrideStreamMetrics] = useState(false);
  const [dataEstateGB, setDataEstateGB] = useState<number>(
    DEFAULT_VOLUME_PRESET.dataEstateGB,
  );
  const [pctScanned, setPctScanned] = useState<number>(
    DEFAULT_VOLUME_PRESET.pctScanned,
  );
  const [scansPerMonth, setScansPerMonth] = useState<number>(
    DEFAULT_VOLUME_PRESET.scansPerMonth,
  );
  // Object stores bill DSPM scanning per API call, so estate GB has to become
  // an object count. 4 MB mirrors DEFAULT_AVG_OBJECT_SIZE_MB in the engine.
  const [avgObjectSizeMB, setAvgObjectSizeMB] = useState<number>(4);
  const [imageCount, setImageCount] = useState<number>(
    DEFAULT_VOLUME_PRESET.imageCount,
  );
  const [avgImageGB, setAvgImageGB] = useState<number>(
    DEFAULT_VOLUME_PRESET.avgImageGB,
  );
  const [packageCount, setPackageCount] = useState<number>(
    DEFAULT_VOLUME_PRESET.packageCount,
  );
  const [egressGB, setEgressGB] = useState<number>(DEFAULT_VOLUME_PRESET.egressGB);
  const [vmCount, setVmCount] = useState<number>(0);
  const [avgUsedDiskGB, setAvgUsedDiskGB] = useState<number>(0);
  const [monthHours, setMonthHours] = useState<number>(730);
  const [assumedEventBytes, setAssumedEventBytes] = useState<number>(1024);
  const [avgStoredGB, setAvgStoredGB] = useState<number>(0);
  const [logIntensity, setLogIntensity] = useState<"low" | "medium" | "high">(
    "medium",
  );
  const [estimateWarnings, setEstimateWarnings] = useState<string[]>([]);
  const [resultsTab, setResultsTab] = useState<ResultsTab>("cost");

  const [capsLoading, setCapsLoading] = useState(false);
  const [capsError, setCapsError] = useState<string | null>(null);

  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sectionLoad, setSectionLoad] = useState<Record<string, boolean>>({});
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const [exportFreshness, setExportFreshness] =
    useState<ExportFreshness | null>(null);
  const [ackCriticalStale, setAckCriticalStale] = useState(false);
  const [frozen, setFrozen] = useState<FrozenRatesMeta | null>(null);
  const [freezing, setFreezing] = useState(false);
  const [freezeError, setFreezeError] = useState<string | null>(null);
  const [offlineEngine, setOfflineEngine] = useState(() =>
    initialOfflineEngineEnabled(),
  );
  const [fromCache, setFromCache] = useState(false);
  const [autoRunEnabled, setAutoRunEnabled] = useState(true);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [projectionMonths, setProjectionMonths] = useState(12);
  const [projectionGrowth, setProjectionGrowth] = useState(0);
  const [projection, setProjection] = useState<ProjectionResponse | null>(null);
  const [projectionLoading, setProjectionLoading] = useState(false);
  const [projectionError, setProjectionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<"providers" | "tiers">(
    "providers",
  );
  const [compareColumns, setCompareColumns] = useState<CompareColumn[]>([]);
  const [compareRunning, setCompareRunning] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [activeCapability, setActiveCapability] = useState<string | null>(null);
  const [openWhyCapability, setOpenWhyCapability] = useState<string | null>(
    null,
  );
  const [previousExpected, setPreviousExpected] = useState<number | null>(null);
  const [presetNonce, setPresetNonce] = useState(0);
  const [journeyMode, setJourneyMode] = useState<JourneyMode>(() =>
    readJourneyViewFromSearch(),
  );
  const [inputsStep, setInputsStep] = useState<InputsJourneyStep>("overview");
  // Default to what-if so existing links and presets keep their totals; the
  // overview step is where a user opts into as-deployed pricing.
  const [tfMode, setTfMode] = useState<TfMode>("what-if");
  const switchToCostOnSuccessRef = useRef(false);

  const discoveryOnly = isDiscoveryOnly(caps);

  function setJourneyModeAndUrl(mode: JourneyMode) {
    setJourneyMode(mode);
    writeJourneyViewToUrl(mode);
  }

  function goToInputsStep(step: InputsJourneyStep) {
    setJourneyModeAndUrl("inputs");
    setInputsStep(step);
  }

  const breakdownRows = useMemo(
    () =>
      estimate && !discoveryOnly
        ? buildBreakdownRows(estimate, caps, estimateWarnings)
        : [],
    [estimate, caps, discoveryOnly, estimateWarnings],
  );

  const affectsByField = useMemo(
    () =>
      estimate
        ? buildAffectsByField(provider, estimate.lineItems)
        : {},
    [estimate, provider],
  );

  const legendCapabilities = useMemo(
    () => enabledCapabilitiesForLegend(caps),
    [caps],
  );

  const assumptionsSnapshot = useMemo(
    () => ({
      monthHours,
      assumedEventBytes,
      avgStoredGB,
      logIntensity,
      overrideStreamMetrics,
      accountCount,
      monthlyActiveUsers: mau,
      ingressGBPerDay,
      peakMBps,
      peakEventsPerSec,
      dataEstateGB,
      pctScanned,
      scansPerMonth,
      vmCount,
      avgUsedDiskGB,
      imageCount,
      avgImageGB,
      packageCount,
      egressGB,
    }),
    [
      accountCount,
      assumedEventBytes,
      avgImageGB,
      avgStoredGB,
      avgUsedDiskGB,
      dataEstateGB,
      egressGB,
      imageCount,
      ingressGBPerDay,
      logIntensity,
      mau,
      monthHours,
      overrideStreamMetrics,
      packageCount,
      peakEventsPerSec,
      peakMBps,
      pctScanned,
      scansPerMonth,
      vmCount,
    ],
  );

  /** Apply a validated share state to every input setter. */
  const applyShareState = useCallback((s: ShareState) => {
    setProvider(s.provider);
    writeProviderToUrl(s.provider);
    setRegion(s.region);
    setCaps({ ...DEFAULT_CAPS, ...s.capabilities });
    if (s.volume.accountCount != null) setAccountCount(s.volume.accountCount);
    if (s.volume.monthlyActiveUsers != null) setMau(s.volume.monthlyActiveUsers);
    if (s.volume.ingressGBPerDay != null) setIngress(s.volume.ingressGBPerDay);
    if (s.volume.peakMBps != null) setPeakMBps(s.volume.peakMBps);
    if (s.volume.peakEventsPerSec != null)
      setPeakEps(s.volume.peakEventsPerSec);
    setOverrideStreamMetrics(true);
    if (s.volume.dataEstateGB != null) setDataEstateGB(s.volume.dataEstateGB);
    if (s.volume.pctScanned != null) setPctScanned(s.volume.pctScanned);
    if (s.volume.scansPerMonth != null) setScansPerMonth(s.volume.scansPerMonth);
    if (s.volume.imageCount != null) setImageCount(s.volume.imageCount);
    if (s.volume.avgImageGB != null) setAvgImageGB(s.volume.avgImageGB);
    if (s.volume.packageCount != null) setPackageCount(s.volume.packageCount);
    if (s.volume.egressGB != null) setEgressGB(s.volume.egressGB);
    if (s.mode) setCompareMode(s.mode);
  }, []);

  // Package 21 — restore share URL on load (no server-side PII).
  useEffect(() => {
    const parsed = readShareFromSearch();
    if (!parsed) return;
    if (!parsed.ok) {
      setToast(`Share link warning: ${parsed.error}`);
      return;
    }
    applyShareState(parsed.state);
    setShareMsg("Restored inputs from share URL.");
  }, [applyShareState]);

  const focusAuditDriver = useCallback(() => {
    setJourneyModeAndUrl("cost");
    setResultsTab("cost");
    setActiveCapability("audit_logs");
    setOpenWhyCapability("audit_logs");
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-testid="driver-why-audit_logs"]',
      );
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }, []);

  const toggleAutoRunFromChip = useCallback(() => {
    setAutoRunEnabled((v) => !v);
  }, []);

  const jumpFromCostDriver = useCallback((inputTestId: string) => {
    const step = inputsStepForJumpTarget(inputTestId);
    setJourneyModeAndUrl("inputs");
    setInputsStep(step);
    requestAnimationFrame(() => {
      if (step === "run") {
        const collapse = document.querySelector<HTMLDetailsElement>(
          '[data-testid="assumptions-collapse"]',
        );
        if (collapse) collapse.open = true;
      }
      requestAnimationFrame(() => {
        jumpToInputTestId(inputTestId);
      });
    });
  }, []);

  const auditChipsActive = activeCapability === "audit_logs";

  // Package 03/07 — first-run Azure audit bootstrap (once per session).
  useEffect(() => {
    const search =
      typeof window !== "undefined" ? window.location.search : "";
    if (!shouldBootstrapAzureAudit(search)) return;
    markEstimatorBootstrapped();

    // A share link is copied far more often than it is kept. saveLastShareState
    // has always written a local backup on every copy; this is the read half,
    // so losing the URL no longer means retyping the inputs. Validated rather
    // than cast, because this blob may have been written by an older build
    // with a different shape. Preferred over the demo preset: someone with a
    // saved state is returning, not arriving.
    const saved = loadLastShareState<unknown>();
    if (saved) {
      const parsed = validateShareState(saved);
      if (parsed.ok) {
        applyShareState(parsed.state);
        setShareMsg("Restored your last shared inputs.");
        setPresetNonce((n) => n + 1);
        return;
      }
    }

    const preset = getDemoPreset("azure-audit");
    setProvider(preset.provider);
    writeProviderToUrl(preset.provider);
    setRegion(preset.region);
    setCaps(preset.capabilities);
    setAccountCount(preset.volume.accountCount);
    setMau(preset.volume.monthlyActiveUsers);
    setIngress(preset.volume.ingressGBPerDay);
    setPeakMBps(preset.volume.peakMBps);
    setPeakEps(preset.volume.peakEventsPerSec);
    setOverrideStreamMetrics(true);
    setDataEstateGB(preset.volume.dataEstateGB);
    setPctScanned(preset.volume.pctScanned);
    setScansPerMonth(preset.volume.scansPerMonth);
    setImageCount(preset.volume.imageCount);
    setAvgImageGB(preset.volume.avgImageGB);
    setPackageCount(preset.volume.packageCount);
    setEgressGB(preset.volume.egressGB);
    setVmCount(preset.volume.vmCount ?? 0);
    setAvgUsedDiskGB(preset.volume.avgUsedDiskGB ?? 0);
    setPresetNonce((n) => n + 1);
  }, [applyShareState]);

  const currentShareState = useCallback((): ShareState => {
    return {
      v: 1,
      provider,
      region,
      capabilities: caps,
      volume: {
        accountCount,
        monthlyActiveUsers: mau,
        ingressGBPerDay,
        peakMBps,
        peakEventsPerSec,
        dataEstateGB,
        pctScanned,
        scansPerMonth,
        imageCount,
        avgImageGB,
        packageCount,
        egressGB,
      },
      totals: estimate
        ? {
            expected: estimate.totals.expected,
            low: estimate.totals.low,
            high: estimate.totals.high,
          }
        : undefined,
      mode: compareMode,
    };
  }, [
    accountCount,
    avgImageGB,
    caps,
    compareMode,
    dataEstateGB,
    egressGB,
    estimate,
    imageCount,
    ingressGBPerDay,
    mau,
    packageCount,
    peakEventsPerSec,
    peakMBps,
    pctScanned,
    provider,
    region,
    scansPerMonth,
  ]);

  function onCopyShareLink() {
    setShareMsg(null);
    const state = currentShareState();
    const built = buildShareUrl(state);
    const stored = saveLastShareState(state);
    if (!stored.ok) {
      setToast(`Storage warning: ${stored.error}`);
    }
    if (!built.ok) {
      downloadBlob(
        `share-state-${state.provider}.json`,
        new Blob([built.json], { type: "application/json" }),
      );
      setShareMsg(
        "Share URL too long — downloaded JSON export instead (no secrets).",
      );
      return;
    }
    void navigator.clipboard?.writeText(built.url);
    window.history.replaceState({}, "", built.url);
    setShareMsg("Share link copied to clipboard.");
  }

  async function onRunCompare() {
    setCompareRunning(true);
    setToast(null);
    try {
      const cols: CompareColumn[] = [];
      if (compareMode === "providers") {
        for (const p of CLOUD_PROVIDERS) {
          cols.push({
            id: p,
            label: `${p} (current volume)`,
            provider: p,
            expected: null,
            loading: true,
          });
        }
        setCompareColumns(cols);
        const results: CompareColumn[] = [];
        for (const p of CLOUD_PROVIDERS) {
          try {
            const r = await runEstimate(client, {
              provider: p,
              region: defaultRegionFor(p),
              capabilities: caps,
              volume: {
                accountCount,
                monthlyActiveUsers: mau,
                overrideStreamMetrics,
                ingressGBPerDay,
                peakMBps,
                peakEventsPerSec,
                dataEstateGB,
                pctScanned,
                scansPerMonth,
                imageCount,
                avgImageGB,
                packageCount,
                egressGB,
              },
            });
            results.push({
              id: p,
              label: `${p} equivalent workload`,
              provider: p,
              expected: r.totals.expected,
              low: r.totals.low ?? null,
              high: r.totals.high ?? null,
              confidence: r.confidence,
            });
          } catch (e) {
            results.push({
              id: p,
              label: `${p} equivalent workload`,
              provider: p,
              expected: null,
              error: e instanceof Error ? e.message : "failed",
            });
          }
        }
        setCompareColumns(results);
      } else {
        const foundational = getDemoPreset(
          `${provider}-audit` as "azure-audit" | "aws-audit" | "gcp-audit",
        );
        const comprehensive = getDemoPreset(
          `${provider}-comprehensive` as
            | "azure-comprehensive"
            | "aws-comprehensive"
            | "gcp-comprehensive",
        );
        const tiers = [
          { id: "foundational", preset: foundational, label: "Foundational (audit)" },
          {
            id: "comprehensive",
            preset: comprehensive,
            label: "Comprehensive",
          },
        ];
        setCompareColumns(
          tiers.map((t) => ({
            id: t.id,
            label: t.label,
            provider: t.preset.provider,
            expected: null,
            loading: true,
            literacyNote: tierLiteracyNote(t.preset.provider, t.id),
          })),
        );
        const results: CompareColumn[] = [];
        for (const t of tiers) {
          try {
            const r = await runEstimate(client, {
              provider: t.preset.provider,
              region: t.preset.region,
              capabilities: t.preset.capabilities,
              volume: t.preset.volume,
            });
            results.push({
              id: t.id,
              label: t.label,
              provider: t.preset.provider,
              expected: r.totals.expected,
              low: r.totals.low ?? null,
              high: r.totals.high ?? null,
              confidence: r.confidence,
              literacyNote: tierLiteracyNote(t.preset.provider, t.id),
            });
          } catch (e) {
            results.push({
              id: t.id,
              label: t.label,
              provider: t.preset.provider,
              expected: null,
              error: e instanceof Error ? e.message : "failed",
              literacyNote: tierLiteracyNote(t.preset.provider, t.id),
            });
          }
        }
        setCompareColumns(results);
      }
    } finally {
      setCompareRunning(false);
    }
  }

  const onProviderChange = useCallback((next: CloudProvider) => {
    setProvider(next);
    writeProviderToUrl(next);
    setRegion(defaultRegionFor(next));
    setEstimate(null);
    setError(null);
    setFrozen(null);
    setFromCache(false);
    setAckCriticalStale(false);
    setProjection(null);
  }, []);

  const applyPreset = useCallback(
    (preset: DemoPreset) => {
      setProvider(preset.provider);
      writeProviderToUrl(preset.provider);
      setRegion(preset.region);
      setCaps(preset.capabilities);
      setAccountCount(preset.volume.accountCount);
      setMau(preset.volume.monthlyActiveUsers);
      setIngress(preset.volume.ingressGBPerDay);
      setPeakMBps(preset.volume.peakMBps);
      setPeakEps(preset.volume.peakEventsPerSec);
      setOverrideStreamMetrics(true);
      setDataEstateGB(preset.volume.dataEstateGB);
      setPctScanned(preset.volume.pctScanned);
      setScansPerMonth(preset.volume.scansPerMonth);
      setImageCount(preset.volume.imageCount);
      setAvgImageGB(preset.volume.avgImageGB);
      setPackageCount(preset.volume.packageCount);
      setEgressGB(preset.volume.egressGB);
      setVmCount(preset.volume.vmCount ?? 0);
      setAvgUsedDiskGB(preset.volume.avgUsedDiskGB ?? 0);
      setEstimate(null);
      setError(null);
      setFrozen(null);
      setFromCache(false);
      setAckCriticalStale(false);
      setProjection(null);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setCapsLoading(true);
    setCapsError(null);
    (async () => {
      try {
        const res = await fetchCapabilities(client, provider);
        if (!cancelled) {
          setCapsError(null);
        }
      } catch {
        if (!cancelled) {
          setCapsError("Failed to load capabilities. Other sections remain.");
        }
      } finally {
        if (!cancelled) setCapsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, provider]);

  const refreshRatesMeta = useCallback(async () => {
    try {
      const { data } = await client.GET("/rates", {
        params: { query: { provider, region } },
      });
      if (data?.freshness) {
        setExportFreshness({
          level: data.freshness.level,
          requiresAckBeforeExport: data.freshness.requiresAckBeforeExport,
          banner: data.freshness.banner,
        });
      } else {
        setExportFreshness(null);
      }
    } catch {
      // Fail closed: a network error here means we could not confirm rates
      // are fresh, which is not the same as confirming they are. Clearing
      // this to null would make buildEstimateExport's `needsAck` check treat
      // "unknown" as "no gate needed," silently disabling the documented
      // fail-closed export guarantee for exactly the case (flaky network)
      // where it matters most.
      setExportFreshness({
        requiresAckBeforeExport: true,
        banner:
          "Could not verify rate freshness (network error) — acknowledge before export.",
      });
    }
  }, [client, provider, region]);

  const applyCached = useCallback(
    (reason: string) => {
      const cached = loadEstimateCache(provider);
      if (!cached) {
        setEstimate(null);
        setFromCache(false);
        setFreshness(null);
        return false;
      }
      setEstimate(cached.estimate);
      setFromCache(true);
      setFreshness({
        level: "stale-cache",
        message: reason,
        ratesAsOf: cached.estimate.ratesAsOf,
        ratesSource: cached.estimate.ratesSource,
      });
      return true;
    },
    [provider],
  );

  const executeEstimate = useCallback(async (opts?: { switchToCost?: boolean }) => {
    if (opts?.switchToCost) {
      switchToCostOnSuccessRef.current = true;
    }
    setLoading(true);
    setSectionLoad((s) => ({ ...s, results: true, breakdown: true }));
    setError(null);
    setExportMsg(null);

    const finishMaybeSwitch = (ok: boolean) => {
      if (ok && switchToCostOnSuccessRef.current) {
        setJourneyModeAndUrl("cost");
      }
      switchToCostOnSuccessRef.current = false;
    };

    if (discoveryOnly) {
      setEstimate(null);
      setFromCache(false);
      setFreshness({
        level: "fresh",
        message: "Discovery-only — $0 (no billable meters)",
      });
      setLoading(false);
      setSectionLoad((s) => ({ ...s, results: false, breakdown: false }));
      finishMaybeSwitch(true);
      return;
    }

    if (caps.dspm && !(dataEstateGB > 0)) {
      setEstimate(null);
      setFromCache(false);
      setEstimateWarnings([]);
      setError(
        "DSPM requires dataEstateGB > 0. Set Data estate GB under capability volume or use a comprehensive preset, or disable DSPM.",
      );
      setLoading(false);
      setSectionLoad((s) => ({ ...s, results: false, breakdown: false }));
      finishMaybeSwitch(false);
      return;
    }

    if (offlineEngine) {
      const ok = applyCached(
        "Offline engine enabled — showing cached estimate only (explicit toggle).",
      );
      if (!ok) {
        setError(
          "Offline engine is on but no cached estimate exists for this provider. Turn off offline engine and run against the API.",
        );
      }
      setLoading(false);
      setSectionLoad((s) => ({ ...s, results: false, breakdown: false }));
      finishMaybeSwitch(ok);
      return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const ok = applyCached("Browser offline — showing cached estimate.");
      if (!ok) {
        setError("Offline and no cached estimate. Reconnect and retry.");
      }
      setLoading(false);
      setSectionLoad((s) => ({ ...s, results: false, breakdown: false }));
      finishMaybeSwitch(ok);
      return;
    }

    try {
      const result = await runEstimate(client, {
        provider,
        region,
        capabilities: caps,
        tfMode,
        monthHours,
        volume: {
          accountCount,
          monthlyActiveUsers: mau,
          logIntensity,
          overrideStreamMetrics,
          ingressGBPerDay,
          peakMBps,
          peakEventsPerSec,
          avgStoredGB,
          vmCount,
          avgUsedDiskGB,
          dataEstateGB,
          pctScanned,
          scansPerMonth,
          imageCount,
          avgImageGB,
          packageCount,
          egressGB,
          avgObjectSizeMB,
          assumedEventBytes,
        },
      });
      setEstimate(result);
      setEstimateWarnings(result.warnings ?? []);
      setFromCache(false);
      // Sync resolved volume only when values change — avoid auto-run input loops.
      if (!overrideStreamMetrics && result.resolvedVolume) {
        const rv = result.resolvedVolume;
        setIngress((prev) =>
          prev === rv.ingressGBPerDay ? prev : rv.ingressGBPerDay,
        );
        setPeakMBps((prev) => (prev === rv.peakMBps ? prev : rv.peakMBps));
        setPeakEps((prev) =>
          prev === rv.peakEventsPerSec ? prev : rv.peakEventsPerSec,
        );
      }
      saveEstimateCache({
        provider,
        estimate: result,
        cachedAt: new Date().toISOString(),
      });
      setFreshness({
        level: "fresh",
        message: "Estimate from live API",
        ratesAsOf: result.ratesAsOf,
        ratesSource: result.ratesSource,
      });
      await refreshRatesMeta();
      finishMaybeSwitch(true);
    } catch (e) {
      const msg =
        e instanceof EstimateApiError
          ? `${e.message} (HTTP ${e.status || "network"}). Retry or load cached estimate explicitly.`
          : "API failure. Retry or load cached estimate explicitly.";
      setError(msg);
      setEstimate(null);
      setEstimateWarnings([]);
      setFromCache(false);
      setFreshness(null);
      finishMaybeSwitch(false);
    } finally {
      setLoading(false);
      setSectionLoad((s) => ({ ...s, results: false, breakdown: false }));
    }
  }, [
    accountCount,
    assumedEventBytes,
    avgImageGB,
    avgStoredGB,
    avgUsedDiskGB,
    caps,
    client,
    dataEstateGB,
    discoveryOnly,
    egressGB,
    imageCount,
    ingressGBPerDay,
    logIntensity,
    mau,
    monthHours,
    offlineEngine,
    overrideStreamMetrics,
    packageCount,
    peakEventsPerSec,
    peakMBps,
    pctScanned,
    provider,
    refreshRatesMeta,
    region,
    scansPerMonth,
    vmCount,
  ]);

  const executeRef = useRef(executeEstimate);
  executeRef.current = executeEstimate;

  /** Apply calibrated volume then re-estimate with those values (avoid stale state). */
  const applyCalibratedVolume = useCallback(
    async (next: Record<string, number>) => {
      const volume = {
        accountCount: next.accountCount ?? accountCount,
        monthlyActiveUsers: next.monthlyActiveUsers ?? mau,
        ingressGBPerDay: next.ingressGBPerDay ?? ingressGBPerDay,
        peakMBps: next.peakMBps ?? peakMBps,
        peakEventsPerSec: next.peakEventsPerSec ?? peakEventsPerSec,
        dataEstateGB: next.dataEstateGB ?? dataEstateGB,
        pctScanned: next.pctScanned ?? pctScanned,
        scansPerMonth: next.scansPerMonth ?? scansPerMonth,
        imageCount: next.imageCount ?? imageCount,
        avgImageGB: next.avgImageGB ?? avgImageGB,
        packageCount: next.packageCount ?? packageCount,
        egressGB: next.egressGB ?? egressGB,
      };
      setAccountCount(volume.accountCount);
      setMau(volume.monthlyActiveUsers);
      setIngress(volume.ingressGBPerDay);
      setPeakMBps(volume.peakMBps);
      setPeakEps(volume.peakEventsPerSec);
      setOverrideStreamMetrics(true);
      setDataEstateGB(volume.dataEstateGB);
      setPctScanned(volume.pctScanned);
      setScansPerMonth(volume.scansPerMonth);
      setImageCount(volume.imageCount);
      setAvgImageGB(volume.avgImageGB);
      setPackageCount(volume.packageCount);
      setEgressGB(volume.egressGB);

      setLoading(true);
      setError(null);
      try {
        const result = await runEstimate(client, {
          provider,
          region,
          capabilities: caps,
          volume: {
            ...volume,
            overrideStreamMetrics: true,
          },
        });
        setEstimate(result);
        setFromCache(false);
        saveEstimateCache({
          provider,
          estimate: result,
          cachedAt: new Date().toISOString(),
        });
        setFreshness({
          level: "fresh",
          message: "Estimate after calibration factor (live API)",
          ratesAsOf: result.ratesAsOf,
          ratesSource: result.ratesSource,
        });
        await refreshRatesMeta();
      } catch (e) {
        const msg =
          e instanceof EstimateApiError
            ? `API failure (${e.status || "network"}) after calibration.`
            : "API failure after calibration.";
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [
      accountCount,
      avgImageGB,
      caps,
      client,
      dataEstateGB,
      egressGB,
      imageCount,
      ingressGBPerDay,
      mau,
      packageCount,
      peakEventsPerSec,
      peakMBps,
      pctScanned,
      provider,
      refreshRatesMeta,
      region,
      scansPerMonth,
    ],
  );

  const debouncedRun = useMemo(
    () =>
      debounce(() => {
        void executeRef.current();
      }, CAPABILITY_DEBOUNCE_MS),
    [],
  );

  useEffect(() => () => debouncedRun.cancel(), [debouncedRun]);

  /**
   * Auto-recalculate whenever checkboxes / numbers / provider / region change.
   * Coalesce rapid edits via debounce (≤300ms). Gated by autoRunEnabled (default on).
   * Compare a serialized input key so React Strict Mode remounts do not fire a phantom run.
   */
  const autoRunPrevKey = useRef<string | null>(null);
  const autoRunWasEnabled = useRef(autoRunEnabled);
  useEffect(() => {
    if (!autoRunEnabled) {
      debouncedRun.cancel();
      autoRunWasEnabled.current = false;
      return;
    }
    const key = JSON.stringify({
      provider,
      region,
      caps,
      accountCount,
      mau,
      ingressGBPerDay,
      peakMBps,
      peakEventsPerSec,
      overrideStreamMetrics,
      dataEstateGB,
      pctScanned,
      scansPerMonth,
      vmCount,
      avgUsedDiskGB,
      imageCount,
      avgImageGB,
      packageCount,
      egressGB,
      monthHours,
      assumedEventBytes,
      avgStoredGB,
      logIntensity,
      offlineEngine,
    });
    const reenabled = !autoRunWasEnabled.current;
    autoRunWasEnabled.current = true;
    if (autoRunPrevKey.current === null) {
      autoRunPrevKey.current = key;
      return;
    }
    if (autoRunPrevKey.current === key && !reenabled) return;
    autoRunPrevKey.current = key;
    debouncedRun();
  }, [
    autoRunEnabled,
    debouncedRun,
    provider,
    region,
    caps,
    accountCount,
    mau,
    ingressGBPerDay,
    peakMBps,
    peakEventsPerSec,
    overrideStreamMetrics,
    dataEstateGB,
    pctScanned,
    scansPerMonth,
    vmCount,
    avgUsedDiskGB,
    imageCount,
    avgImageGB,
    packageCount,
    egressGB,
    monthHours,
    assumedEventBytes,
    avgStoredGB,
    logIntensity,
    offlineEngine,
  ]);

  // Package 20 — project estimate via createProjection REST (default 12 months).
  // Offline engine uses cached estimate only — never silently call projection API.
  useEffect(() => {
    if (!estimate || discoveryOnly || offlineEngine) {
      if (offlineEngine) setProjection(null);
      if (!estimate || discoveryOnly) setProjection(null);
      return;
    }
    let cancelled = false;
    setProjectionLoading(true);
    setProjectionError(null);
    (async () => {
      try {
        const proj = await fetchProjection(client, {
          monthlyExpected: estimate.totals.expected,
          months: projectionMonths,
          annualGrowthPercent: projectionGrowth,
          provider: estimate.provider,
          monthlyLow: estimate.totals.low,
          monthlyHigh: estimate.totals.high,
          lineItems: estimate.lineItems.map((li) => ({
            provider: li.provider,
            capability: li.capability,
            meterId: li.meterId,
            amount: li.amount,
            confidence: li.confidence,
          })),
        });
        if (!cancelled) setProjection(proj);
      } catch (e) {
        if (!cancelled) {
          setProjection(null);
          setProjectionError(
            e instanceof ProjectionApiError
              ? `Projection failed (${e.status || "network"}).`
              : "Projection failed.",
          );
        }
      } finally {
        if (!cancelled) setProjectionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    client,
    discoveryOnly,
    estimate,
    offlineEngine,
    projectionGrowth,
    projectionMonths,
  ]);

  useEffect(() => {
    if (presetNonce === 0) return;
    debouncedRun.cancel();
    void executeRef.current();
    // Immediate run on demo preset (auto-run effect also sees input changes).
  }, [presetNonce, debouncedRun]);

  function onCapsChange(next: EstimateCapabilities) {
    setCaps(next);
  }

  function onOfflineToggle(checked: boolean) {
    setOfflineEngine(checked);
    setOfflineEngineEnabled(checked);
  }

  /**
   * Freeze the current estimate server-side and download the pinned payload.
   *
   * Previously this only stamped ratesAsOf/modelVersion locally: the button
   * said "freeze" but nothing was actually pinned, so the quote could not be
   * reproduced later. It now calls /estimates/freeze, which re-runs the
   * estimate and pins the rate card it priced with, and hands the user the
   * file that /estimates/reload can replay.
   */
  async function onFreeze() {
    if (!estimate) return;
    setFreezeError(null);
    setFreezing(true);
    try {
      const { data, error } = await client.POST("/estimates/freeze", {
        body: {
          provider,
          region,
          capabilities: caps,
          tfMode,
          monthHours,
          // Same volume the estimate was run with - freezing a different
          // shape would pin a quote the user never saw.
          volume: {
            accountCount,
            monthlyActiveUsers: mau,
            logIntensity,
            overrideStreamMetrics,
            ingressGBPerDay,
            peakMBps,
            peakEventsPerSec,
            avgStoredGB,
            vmCount,
            avgUsedDiskGB,
            dataEstateGB,
            pctScanned,
            scansPerMonth,
            imageCount,
            avgImageGB,
            packageCount,
            egressGB,
            avgObjectSizeMB,
            assumedEventBytes,
          },
          ...(ackCriticalStale ? { ackCriticalStale: true } : {}),
        },
      });
      if (error || !data) {
        // Fail closed and say why - a freeze that silently produced nothing
        // would leave the user believing they have a reproducible quote.
        const detail =
          (error as { detail?: string; title?: string } | undefined)?.detail ??
          (error as { title?: string } | undefined)?.title ??
          "Freeze failed.";
        setFreezeError(detail);
        return;
      }
      setFrozen({
        ratesAsOf: data.ratesAsOf,
        modelVersion: data.modelVersion,
        inputHash: data.inputHash,
        frozenAt: data.frozenAt,
      });
      downloadBlob(
        `cortex-frozen-estimate-${data.provider}-${data.inputHash}.json`,
        new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        }),
      );
      setExportMsg("Frozen estimate downloaded — reload it to reproduce this quote.");
    } catch (e) {
      setFreezeError(
        e instanceof Error ? e.message : "Freeze failed (network error).",
      );
    } finally {
      setFreezing(false);
    }
  }

  function onDemoApply(preset: DemoPreset) {
    applyPreset(preset);
    setPresetNonce((n) => n + 1);
  }

  function snapshotEstimatorInputs(): EstimatorInputsState {
    return {
      provider,
      region,
      capabilities: {
        discovery: Boolean(caps.discovery),
        auditLogs: Boolean(caps.auditLogs),
        adsCloud: Boolean(caps.adsCloud),
        adsOutpost: Boolean(caps.adsOutpost),
        dspm: Boolean(caps.dspm),
        registry: Boolean(caps.registry),
        serverless: Boolean(caps.serverless),
        egress: Boolean(caps.egress),
      },
      volume: {
        accountCount,
        monthlyActiveUsers: mau,
        ingressGBPerDay,
        peakMBps,
        peakEventsPerSec,
        overrideStreamMetrics,
        dataEstateGB,
        pctScanned,
        scansPerMonth,
        imageCount,
        avgImageGB,
        packageCount,
        egressGB,
        vmCount,
        avgUsedDiskGB,
      },
      assumptions: {
        monthHours,
        assumedEventBytes,
        avgStoredGB,
        logIntensity,
      },
    };
  }

  function onImportEstimatorInputs(state: EstimatorInputsState) {
    setProvider(state.provider);
    writeProviderToUrl(state.provider);
    setRegion(state.region);
    setCaps(state.capabilities);
    setAccountCount(state.volume.accountCount);
    setMau(state.volume.monthlyActiveUsers);
    setIngress(state.volume.ingressGBPerDay);
    setPeakMBps(state.volume.peakMBps);
    setPeakEps(state.volume.peakEventsPerSec);
    setOverrideStreamMetrics(state.volume.overrideStreamMetrics);
    setDataEstateGB(state.volume.dataEstateGB);
    setPctScanned(state.volume.pctScanned);
    setScansPerMonth(state.volume.scansPerMonth);
    setImageCount(state.volume.imageCount);
    setAvgImageGB(state.volume.avgImageGB);
    setPackageCount(state.volume.packageCount);
    setEgressGB(state.volume.egressGB);
    setVmCount(state.volume.vmCount);
    setAvgUsedDiskGB(state.volume.avgUsedDiskGB);
    setMonthHours(state.assumptions.monthHours);
    setAssumedEventBytes(state.assumptions.assumedEventBytes);
    setAvgStoredGB(state.assumptions.avgStoredGB);
    setLogIntensity(state.assumptions.logIntensity);
    setPresetNonce((n) => n + 1);
  }

  function doExport(format: "json" | "csv" | "pdf") {
    setExportMsg(null);
    if (!estimate) {
      setExportMsg("No estimate to export.");
      return;
    }
    try {
      const payload = buildEstimateExport(estimate, {
        freshness: exportFreshness,
        ackCriticalStale,
        assumptions: assumptionsSnapshot,
        projection: projection
          ? {
              series: projection.series.map((p) => ({
                month: p.month,
                expected: p.expected,
                cumulative: p.cumulative,
                volumeIndex: p.volumeIndex,
              })),
              total: projection.total,
              annualGrowthPercent: projection.annualGrowthPercent,
              disclaimer: projection.disclaimer,
            }
          : undefined,
      });
      assertNoSaasLines(payload);
      if (format === "json") {
        downloadBlob(
          `estimate-${payload.provider}.json`,
          new Blob([exportToJson(payload)], { type: "application/json" }),
        );
      } else if (format === "csv") {
        downloadBlob(
          `estimate-${payload.provider}.csv`,
          new Blob([exportToCsv(payload)], { type: "text/csv" }),
        );
      } else {
        downloadBlob(
          `estimate-${payload.provider}.pdf`,
          new Blob([exportToPdf(payload).buffer as ArrayBuffer], {
            type: "application/pdf",
          }),
        );
      }
      setExportMsg(`Exported ${format.toUpperCase()}.`);
    } catch (e) {
      setExportMsg(
        e instanceof ExportBlockedError
          ? e.message
          : "Export failed (fail closed).",
      );
    }
  }

  function onLoadCachedEstimate() {
    const ok = applyCached("Loaded cached estimate (explicit opt-in).");
    if (!ok) {
      setError("No cached estimate for this provider.");
    }
  }

  function onClearCachedEstimate() {
    clearEstimateCache();
    setEstimate(null);
    setFromCache(false);
    setFreshness(null);
    setEstimateWarnings([]);
    setError(null);
  }

  const monthlyExpected = discoveryOnly
    ? 0
    : (estimate?.totals.expected ?? null);
  const monthlyLow = discoveryOnly ? 0 : (estimate?.totals.low ?? null);
  const monthlyHigh = discoveryOnly ? 0 : (estimate?.totals.high ?? null);

  const displayFreshness = useMemo((): Freshness | null => {
    if (freshness?.level === "stale-cache" || freshness?.level === "critical") {
      return freshness;
    }
    if (
      exportFreshness?.level === "critical" ||
      exportFreshness?.requiresAckBeforeExport
    ) {
      return {
        level: "critical",
        message:
          exportFreshness.banner ??
          freshness?.message ??
          "Rates critically stale — acknowledge before export.",
        ratesAsOf: freshness?.ratesAsOf,
        ratesSource: freshness?.ratesSource,
      };
    }
    if (exportFreshness?.level === "warn") {
      return {
        level: "warn",
        message: exportFreshness.banner ?? freshness?.message ?? "Rates aging.",
        ratesAsOf: freshness?.ratesAsOf,
        ratesSource: freshness?.ratesSource,
      };
    }
    return freshness;
  }, [exportFreshness, freshness]);

  return (
    <>
      <a href="#main-estimator" className="skip-link">
        Skip to estimator
      </a>
      <main id="main-estimator" className="estimator">
        <div className="estimator-brand">
          <p className="estimator-brand__eyebrow">Palo Alto Networks · Cortex</p>
          <h1>Cloud Connector Cost Estimator</h1>
          <p className="estimator-brand__lede">
            Indicative customer-cloud infrastructure spend by capability —
            not SaaS license pricing.
          </p>
        </div>
        {toast ? (
          <p role="alert" data-testid="toast-message">
            {toast}
          </p>
        ) : null}
        {shareMsg ? (
          <p role="status" data-testid="share-message">
            {shareMsg}
          </p>
        ) : null}

        <JourneyIntro
          minimized={journeyMode === "cost" && estimate != null}
        />

        <EstimatorJourneyShell
          mode={journeyMode}
          onModeChange={setJourneyModeAndUrl}
          inputs={
            <InputsJourneySteps
              step={inputsStep}
              onStepChange={setInputsStep}
              checklist={
                <JourneyChecklist
                  caps={caps}
                  volume={{
                    dataEstateGB,
                    vmCount,
                    avgUsedDiskGB,
                    imageCount,
                    avgImageGB,
                    packageCount,
                    egressGB,
                  }}
                />
              }
              overview={
                <SectionErrorBoundary sectionId="scope-overview">
                  <EstimatorSection
                    id="scope-overview"
                    title="What do you want to estimate?"
                    loading={capsLoading}
                    error={capsError}
                  >
                    <ScopeOverview
                      provider={provider}
                      value={caps}
                      onChange={onCapsChange}
                      tfMode={tfMode}
                      onTfModeChange={setTfMode}
                      disabled={loading}
                    />
                  </EstimatorSection>
                </SectionErrorBoundary>
              }
              start={
                <>
                  <SectionErrorBoundary sectionId="provider-region">
                    <EstimatorSection id="provider-region" title="Provider & region">
                      <ProviderSelector value={provider} onChange={onProviderChange} />
                      <label>
                        Region
                        <select
                          data-testid="region-select"
                          value={region}
                          onChange={(e) => setRegion(e.target.value)}
                        >
                          {REGIONS_BY_PROVIDER[provider].map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <span className="field-hint">
                          Rates and meters are region-scoped
                        </span>
                      </label>
                      <h3>Quick-start presets</h3>
                      <DemoPresetPicker onApply={onDemoApply} disabled={loading} />
                    </EstimatorSection>
                  </SectionErrorBoundary>
                  <SectionErrorBoundary sectionId="capability-toggles">
                    <EstimatorSection
                      id="capability-toggles"
                      title="What to estimate"
                      loading={capsLoading}
                      error={capsError}
                    >
                      <CapabilityToggles value={caps} onChange={onCapsChange} />
                      {(caps.adsCloud || caps.adsOutpost || caps.dspm) ? (
                        <details data-testid="billing-help-details">
                          <summary>Billing help</summary>
                          {caps.adsCloud || caps.adsOutpost ? (
                            <BillingHelpPanel provider={provider} family="ads" />
                          ) : null}
                          {caps.dspm ? (
                            <BillingHelpPanel provider={provider} family="dspm" />
                          ) : null}
                        </details>
                      ) : null}
                    </EstimatorSection>
                  </SectionErrorBoundary>
                </>
              }
              size={
                <>
                  <SectionErrorBoundary sectionId="scope-accounts">
                    <EstimatorSection id="scope-accounts" title="Estate size">
                      <ScopeAccounts
                        accountCount={accountCount}
                        monthlyActiveUsers={mau}
                        affectsAccountCount={affectsByField.accountCount}
                        auditChipsActive={auditChipsActive}
                        onAuditChipClick={focusAuditDriver}
                        onAccountCount={(n) => {
                          setAccountCount(n);
                          setOverrideStreamMetrics(false);
                          try {
                            const v = deriveVolumeFromAccounts(n, mau);
                            setIngress(v.ingressGBPerDay);
                            setPeakMBps(v.peakMBps);
                            setPeakEps(v.peakEventsPerSec);
                          } catch {
                            /* invalid account — leave volume; estimate will fail closed */
                          }
                        }}
                        onMau={(n) => {
                          setMau(n);
                          setOverrideStreamMetrics(false);
                          try {
                            const v = deriveVolumeFromAccounts(accountCount, n);
                            setIngress(v.ingressGBPerDay);
                            setPeakMBps(v.peakMBps);
                            setPeakEps(v.peakEventsPerSec);
                          } catch {
                            /* invalid — leave volume */
                          }
                        }}
                      />
                    </EstimatorSection>
                  </SectionErrorBoundary>
                  <SectionErrorBoundary sectionId="volume-signals">
                    <EstimatorSection id="volume-signals" title="Volume & workload size">
                      {caps.auditLogs ? (
                        <details data-testid="audit-billing-help-details">
                          <summary>Audit billing help</summary>
                          <BillingHelpPanel provider={provider} family="audit" />
                        </details>
                      ) : null}
                      <VolumeSignalsForm
                        ingressGBPerDay={ingressGBPerDay}
                        peakMBps={peakMBps}
                        peakEventsPerSec={peakEventsPerSec}
                        affectsIngress={affectsByField.ingressGBPerDay}
                        affectsPeakMBps={affectsByField.peakMBps}
                        affectsPeakEps={affectsByField.peakEventsPerSec}
                        auditChipsActive={auditChipsActive}
                        onAuditChipClick={focusAuditDriver}
                        onChange={(patch) => {
                          setOverrideStreamMetrics(true);
                          if (patch.ingressGBPerDay != null)
                            setIngress(patch.ingressGBPerDay);
                          if (patch.peakMBps != null) setPeakMBps(patch.peakMBps);
                          if (patch.peakEventsPerSec != null)
                            setPeakEps(patch.peakEventsPerSec);
                        }}
                      />
                      <CapabilityVolumeFields
                        caps={caps}
                        avgObjectSizeMB={avgObjectSizeMB}
                        dataEstateGB={dataEstateGB}
                        pctScanned={pctScanned}
                        scansPerMonth={scansPerMonth}
                        vmCount={vmCount}
                        avgUsedDiskGB={avgUsedDiskGB}
                        imageCount={imageCount}
                        avgImageGB={avgImageGB}
                        packageCount={packageCount}
                        egressGB={egressGB}
                        onChange={(patch) => {
                          if (patch.dataEstateGB != null) setDataEstateGB(patch.dataEstateGB);
                          if (patch.avgObjectSizeMB != null)
                            setAvgObjectSizeMB(patch.avgObjectSizeMB);
                          if (patch.pctScanned != null) setPctScanned(patch.pctScanned);
                          if (patch.scansPerMonth != null)
                            setScansPerMonth(patch.scansPerMonth);
                          if (patch.vmCount != null) setVmCount(patch.vmCount);
                          if (patch.avgUsedDiskGB != null)
                            setAvgUsedDiskGB(patch.avgUsedDiskGB);
                          if (patch.imageCount != null) setImageCount(patch.imageCount);
                          if (patch.avgImageGB != null) setAvgImageGB(patch.avgImageGB);
                          if (patch.packageCount != null)
                            setPackageCount(patch.packageCount);
                          if (patch.egressGB != null) setEgressGB(patch.egressGB);
                        }}
                      />
                      <AdvancedDisclosure>
                        <CalibrationPanel
                          estimatedExpected={estimate?.totals.expected ?? null}
                          volume={{
                            accountCount,
                            monthlyActiveUsers: mau,
                            ingressGBPerDay,
                            peakMBps,
                            peakEventsPerSec,
                            dataEstateGB,
                            pctScanned,
                            scansPerMonth,
                            imageCount,
                            avgImageGB,
                            packageCount,
                            egressGB,
                          }}
                          onApplyVolume={(next) => {
                            void applyCalibratedVolume(next);
                          }}
                        />
                      </AdvancedDisclosure>
                    </EstimatorSection>
                  </SectionErrorBoundary>
                </>
              }
              run={
                <>
                  {displayFreshness && displayFreshness.level !== "fresh" ? (
                    <RatesFreshnessBanner
                      level={displayFreshness.level}
                      message={displayFreshness.message}
                      ratesAsOf={displayFreshness.ratesAsOf}
                      ratesSource={displayFreshness.ratesSource}
                      testId="estimate-freshness-banner"
                    />
                  ) : null}
                  {error ? (
                    <p role="alert" data-testid="estimate-error">
                      {error}
                      <button
                        type="button"
                        data-testid="clear-estimate-cache"
                        onClick={onClearCachedEstimate}
                      >
                        Clear cache & re-run
                      </button>
                      <button
                        type="button"
                        data-testid="load-cached-estimate"
                        onClick={onLoadCachedEstimate}
                      >
                        Load cached estimate
                      </button>
                    </p>
                  ) : null}
                  <SectionErrorBoundary sectionId="model-assumptions">
                    <EstimatorSection id="model-assumptions" title="Model assumptions">
                      <p className="field-hint" data-testid="assumptions-status-line">
                        Stream lock: {overrideStreamMetrics ? "on" : "off"} · intensity{" "}
                        {logIntensity}
                      </p>
                      <details
                        className="config-collapse"
                        data-testid="assumptions-collapse"
                      >
                        <summary>
                          Advanced model knobs (month hours, event bytes, storage)
                          {overrideStreamMetrics ? " · stream lock on" : ""}
                        </summary>
                        <AssumptionsPanel
                          monthHours={monthHours}
                          assumedEventBytes={assumedEventBytes}
                          avgStoredGB={avgStoredGB}
                          logIntensity={logIntensity}
                          overrideStreamMetrics={overrideStreamMetrics}
                          affectsAvgStored={affectsByField.avgStoredGB}
                          auditChipsActive={auditChipsActive}
                          onAuditChipClick={focusAuditDriver}
                          onMonthHours={setMonthHours}
                          onAssumedEventBytes={setAssumedEventBytes}
                          onAvgStoredGB={setAvgStoredGB}
                          onLogIntensity={setLogIntensity}
                          onOverrideStreamMetrics={setOverrideStreamMetrics}
                        />
                      </details>
                    </EstimatorSection>
                  </SectionErrorBoundary>
                  <SectionErrorBoundary sectionId="rates-freshness">
                    <EstimatorSection
                      id="rates-freshness"
                      title="Run controls"
                      landmark="complementary"
                    >
                      <details
                        className="config-collapse"
                        data-testid="run-controls-collapse"
                        open={Boolean(error) || offlineEngine}
                      >
                        <summary>
                          Offline / freeze / auto-update options
                          {autoRunEnabled ? " · auto-update on" : " · auto-update off"}
                        </summary>
                        <p className="field-hint">
                          Auto-update refreshes results when inputs change. Offline uses
                          cache only.
                        </p>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={offlineEngine}
                            onChange={(e) => onOfflineToggle(e.target.checked)}
                            data-testid="offline-engine-toggle"
                          />
                          <span>
                            <span className="cap-toggle-title">Offline — cached estimate only</span>
                            <span className="field-hint">
                              Does not call the API. Fail closed if no cache exists.
                            </span>
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => void onFreeze()}
                          disabled={!estimate || freezing}
                          data-testid="freeze-rates"
                          title="Pin this estimate's rate card and download a payload that reproduces it"
                        >
                          {freezing
                            ? "Freezing…"
                            : "Freeze rates snapshot"}
                        </button>
                        {fromCache ? (
                          <p data-testid="cached-estimate-note">
                            Showing a cached estimate — not a fresh API result.
                          </p>
                        ) : null}
                        {freezeError ? (
                          <p role="alert" data-testid="freeze-error">
                            {freezeError}
                          </p>
                        ) : null}
                        {frozen ? (
                          <p data-testid="frozen-meta">
                            Frozen at {frozen.frozenAt} · ratesAsOf {frozen.ratesAsOf} ·{" "}
                            {frozen.modelVersion}
                          </p>
                        ) : null}
                      </details>
                      <div className="run-actions">
                        <button
                          type="button"
                          className="run-estimate-primary"
                          onClick={() => void executeEstimate({ switchToCost: true })}
                          disabled={loading}
                          data-testid="run-estimate"
                        >
                          {loading
                            ? "Updating…"
                            : error
                              ? "Retry estimate"
                              : "Run estimate"}
                        </button>
                        <label className="checkbox-row run-auto-beside">
                          <input
                            type="checkbox"
                            checked={autoRunEnabled}
                            onChange={(e) => setAutoRunEnabled(e.target.checked)}
                            data-testid="auto-run-toggle"
                          />
                          <span>
                            <span className="cap-toggle-title">Auto-update</span>
                            <span className="field-hint">
                              Refreshes as you edit. Run switches you to Cost when
                              ready.
                            </span>
                          </span>
                        </label>
                      </div>
                      {loading ? (
                        <p role="status" data-testid="estimate-live-status" className="live-status">
                          Updating estimate…
                        </p>
                      ) : null}
                    </EstimatorSection>
                  </SectionErrorBoundary>
                </>
              }
            />
          }
          cost={
            <div className="estimator-canvas" data-testid="estimator-canvas">
              <SectionErrorBoundary sectionId="results-summary">
                <EstimatorSection
                  id="results-summary"
                  title="Cost output"
                  loading={sectionLoad.results}
                >
                  {!estimate && !discoveryOnly ? (
                    <CostOutputEmpty
                      onGoToInputs={() => goToInputsStep("start")}
                    />
                  ) : null}
                  <ResultsSummary
                    slim
                    provider={provider}
                    region={region}
                    monthlyExpected={error && !fromCache ? null : monthlyExpected}
                    monthlyLow={error && !fromCache ? null : monthlyLow}
                    monthlyHigh={error && !fromCache ? null : monthlyHigh}
                    confidence={
                      discoveryOnly ? "High" : (estimate?.confidence ?? null)
                    }
                    freshnessLevel={displayFreshness?.level ?? null}
                    freshnessLabel={
                      displayFreshness
                        ? `${displayFreshness.level}${displayFreshness.ratesSource ? ` (${displayFreshness.ratesSource})` : ""}`
                        : null
                    }
                    ratesSource={
                      estimate?.ratesSource ?? displayFreshness?.ratesSource ?? null
                    }
                    ratesAsOf={estimate?.ratesAsOf ?? displayFreshness?.ratesAsOf ?? null}
                    autoRunEnabled={autoRunEnabled}
                    loading={loading}
                    offlineEngine={offlineEngine}
                    onAutoUpdateChipClick={toggleAutoRunFromChip}
                  />
                  <details
                    className="results-grounding"
                    data-testid="results-grounding"
                  >
                    <summary>What this estimate is based on</summary>
                    {monthlyLow != null && monthlyHigh != null ? (
                      <p className="grounding-bands" data-testid="summary-bands">
                        Range (low → high):{" "}
                        {formatUsd(monthlyLow)}{" "}
                        →{" "}
                        {monthlyExpected == null
                          ? "—"
                          : formatUsd(monthlyExpected)}{" "}
                        →{" "}
                        {formatUsd(monthlyHigh)}
                      </p>
                    ) : null}
                    {estimate?.confidence || discoveryOnly ? (
                      <p
                        className="grounding-confidence"
                        data-testid="summary-confidence"
                      >
                        Confidence:{" "}
                        <strong>
                          {discoveryOnly ? "High" : estimate?.confidence}
                        </strong>
                      </p>
                    ) : null}
                    {estimate ? (
                      <p
                        className="grounding-provenance"
                        data-testid="summary-provenance"
                      >
                        {region} · {estimate.ratesSource ?? "n/a"} · ratesAsOf{" "}
                        {estimate.ratesAsOf?.trim() ? estimate.ratesAsOf : "n/a"}
                      </p>
                    ) : null}
                    <ResultsProvenance
                      inputHash={estimate?.inputHash ?? null}
                      modelVersion={
                        estimate?.modelVersion ?? (discoveryOnly ? "—" : null)
                      }
                      resolvedVolume={estimate?.resolvedVolume ?? null}
                      loading={loading}
                    />
                    {estimate ? (
                      <ResultsAssumptionsSnapshot
                        monthHours={monthHours}
                        assumedEventBytes={assumedEventBytes}
                        avgStoredGB={avgStoredGB}
                        logIntensity={logIntensity}
                      />
                    ) : null}
                  </details>
                  <EstimateHonestyBanner warnings={estimateWarnings} />
                  <EstimateWarningsList
                    warnings={estimateWarnings}
                    freshnessMessage={
                      displayFreshness && displayFreshness.level !== "fresh"
                        ? displayFreshness.message
                        : null
                    }
                  />
                  <ResultsCanvas activeTab={resultsTab} onTabChange={setResultsTab}>
                    {resultsTab === "cost" ? (
                      <ResultFlipCard
                        high={
                          <CostDrivers
                            estimate={estimate}
                            breakdownRows={breakdownRows}
                            discoveryOnlyEmpty={discoveryOnly}
                            onJumpToInput={jumpFromCostDriver}
                            activeCapability={activeCapability}
                            openWhyCapability={openWhyCapability}
                            onDriverFocus={(cap) => {
                              setActiveCapability(cap);
                              setOpenWhyCapability(cap);
                            }}
                            previousExpected={previousExpected}
                            sensitivityUpdating={
                              loading && previousExpected != null
                            }
                            onApplyPeakMinus20={() => {
                              if (estimate) {
                                setPreviousExpected(estimate.totals.expected);
                              }
                              setOverrideStreamMetrics(true);
                              setPeakMBps((p) =>
                                Math.max(0, Number((p * 0.8).toFixed(4))),
                              );
                              goToInputsStep("size");
                            }}
                            onApplyPeakPlus1={() => {
                              if (estimate) {
                                setPreviousExpected(estimate.totals.expected);
                              }
                              setOverrideStreamMetrics(true);
                              setPeakMBps((p) => p + 1);
                              goToInputsStep("size");
                            }}
                          />
                        }
                        low={
                          <CostBreakdown
                            estimate={estimate}
                            capabilities={caps}
                            warnings={estimateWarnings}
                            breakdownRows={breakdownRows}
                            discoveryOnlyEmpty={discoveryOnly}
                          />
                        }
                      />
                    ) : null}
                    {resultsTab === "projections" ? (
                      <ProjectionCharts
                        projection={projection}
                        loading={projectionLoading}
                        error={projectionError}
                        months={projectionMonths}
                        growthPercent={projectionGrowth}
                        onMonthsChange={setProjectionMonths}
                        onGrowthChange={setProjectionGrowth}
                        enabledCapabilities={legendCapabilities}
                      />
                    ) : null}
                    {resultsTab === "compare" ? (
                      <CompareScenarios
                        mode={compareMode}
                        onModeChange={setCompareMode}
                        columns={compareColumns}
                        onRunCompare={() => void onRunCompare()}
                        running={compareRunning}
                      />
                    ) : null}
                  </ResultsCanvas>
                </EstimatorSection>
              </SectionErrorBoundary>
              <SectionErrorBoundary sectionId="export-disclaimer">
                <EstimatorSection
                  id="export-disclaimer"
                  title="Export & notes"
                  landmark="complementary"
                >
                  <Disclaimer modelVersion={estimate?.modelVersion} />
                  <details data-testid="tagging-guidance-details">
                    <summary>Tagging guidance</summary>
                    <TaggingGuidance provider={provider} />
                  </details>
                  {exportFreshness?.requiresAckBeforeExport ||
                  exportFreshness?.level === "critical" ? (
                    <label data-testid="ack-critical-stale">
                      <input
                        type="checkbox"
                        checked={ackCriticalStale}
                        onChange={(e) => setAckCriticalStale(e.target.checked)}
                        data-testid="ack-critical-stale-checkbox"
                      />{" "}
                      Acknowledge critically stale rates before export
                    </label>
                  ) : null}
                  <p className="field-hint" data-testid="export-group-label">
                    Results export
                  </p>
                  <p className="export-actions">
                    <button
                      type="button"
                      data-testid="copy-share-link"
                      onClick={onCopyShareLink}
                    >
                      Copy share link
                    </button>
                    <button
                      type="button"
                      data-testid="export-json"
                      disabled={!estimate}
                      onClick={() => doExport("json")}
                    >
                      Results JSON
                    </button>
                    <button
                      type="button"
                      data-testid="export-csv"
                      disabled={!estimate}
                      onClick={() => doExport("csv")}
                    >
                      Results CSV
                    </button>
                    <button
                      type="button"
                      data-testid="export-pdf"
                      disabled={!estimate}
                      onClick={() => doExport("pdf")}
                    >
                      Results PDF
                    </button>
                  </p>
                  <p className="field-hint" data-testid="inputs-csv-hint">
                    To edit inputs externally, use Download inputs CSV.
                  </p>
                  <InputsCsvPanel
                    getState={snapshotEstimatorInputs}
                    onImport={(state) => onImportEstimatorInputs(state)}
                  />
                  {exportMsg ? (
                    <p role="status" data-testid="export-message">
                      {exportMsg}
                    </p>
                  ) : null}
                </EstimatorSection>
              </SectionErrorBoundary>
            </div>
          }
        />

      </main>
    </>
  );
}
