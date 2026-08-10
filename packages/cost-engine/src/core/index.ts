/**
 * Core public surface — ports + shared models only.
 * No React, no fetch, no provider formula imports.
 */
export type {
  CloudProvider,
  Confidence,
  EstimateInputs,
  EstimateResult,
  LineItem,
  RateCard,
  RatesSource,
} from "./models/estimate.types.ts";

export type { ProviderEstimator } from "./ports/provider-estimator.interface.ts";
export type { RatesAdapter } from "./ports/rates-adapter.interface.ts";
export type { MeterMap, MeterMapRow } from "./ports/meter-map.interface.ts";

export {
  ageDaysFromCapturedAt,
  staleFallbackWarning,
  evaluateRatesFreshness,
  assertExportAllowedForFreshness,
  FALLBACK_MAX_AGE_DAYS,
  STALE_DAYS_WARN,
  STALE_DAYS_CRITICAL,
  RATES_CACHE_TTL_MS,
} from "./rates/age-days.ts";
export type { FreshnessLevel, RatesFreshness } from "./rates/age-days.ts";

export {
  DEFAULT_MONTH_HOURS,
  MONTH_HOURS_31_DAY,
  FORBIDDEN_SILENT_MONTH_HOURS,
  daysInMonth,
  isLeapYear,
  resolveMonthHours,
  labelForMonthHours,
  scaleHourlyCost,
  prorateSnapshotCost,
  applyPeakFactor,
  splitAverageAndPeakCost,
} from "./hours.ts";
export type {
  MonthHoursConvention,
  ResolveMonthHoursInput,
  ResolvedMonthHours,
  PeakFactorInput,
  PeakFactorResult,
} from "./hours.ts";

export {
  resolveVolumeSignals,
  parseRawStreamMetrics,
  logCategoryMultiplier,
  REFERENCE_ACCOUNT_COUNT,
  VOLUME_ORG_PRESETS,
  LOG_CATEGORY_SETS,
  LOG_INTENSITY_FACTOR,
} from "./volume-signals.ts";
export type {
  VolumeSignalsInput,
  ResolvedVolumeSignals,
  RawStreamMetrics,
  LogIntensity,
  OrgPresetId as VolumeOrgPresetId,
} from "./volume-signals.ts";

export { projectCosts } from "./project-costs.ts";
export type {
  ProjectCostsInput,
  ProjectCostsResult,
  ProjectionPoint,
  ProjectionLineItem,
  ProjectionStackSlice,
} from "./project-costs.ts";
export {
  PROJECTION_MAX_MONTHS,
  THROUGHPUT_STEP_METER_IDS,
  VOLUME_ELASTIC_CAPABILITIES,
  isVolumeElastic,
  isThroughputStepMeter,
  volumeGrowthFactor,
  steppedCapacityMultiplier,
} from "./project-costs.ts";

export {
  FREEZE_TOTAL_TOLERANCE_USD,
  PINNED_RATES_WARN_AGE_DAYS,
  FREEZE_SCHEMA_VERSION,
  DEFAULT_ESTIMATE_DISCLAIMER,
  canonicalJson,
  createInputHash,
  totalsWithinTolerance,
  pinnedRatesAgeWarning,
  freezeEstimate,
  validateExportSchema,
  rateCardFromFreeze,
  loadFrozenEstimate,
  estimateExportFields,
} from "./rate-pinning.ts";
export type {
  FrozenEstimateExport,
  FreezeEstimateArgs,
  FreezeLoadResult,
  FreezeLoadOk,
  FreezeLoadErr,
} from "./rate-pinning.ts";
