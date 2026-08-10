/**
 * Public package entry — core ports + research provider maps + modelVersion.
 * Core must not import provider implementations. Callers use this index only.
 */
export { modelVersion } from "./model-version.ts";
export type { ModelVersion } from "./model-version.ts";

export type {
  CapabilityId,
  CapabilityMeterRow,
  Confidence as MeterConfidence,
} from "./providers/meter-map.types.ts";
export { REQUIRED_CAPABILITIES } from "./providers/meter-map.types.ts";

export type {
  CloudProvider,
  Confidence,
  EstimateInputs,
  EstimateResult,
  LineItem,
  RateCard,
  RatesSource,
  ProviderEstimator,
  RatesAdapter,
  MeterMap,
  MeterMapRow,
} from "./core/index.ts";

export {
  ageDaysFromCapturedAt,
  staleFallbackWarning,
  evaluateRatesFreshness,
  assertExportAllowedForFreshness,
  FALLBACK_MAX_AGE_DAYS,
  STALE_DAYS_WARN,
  STALE_DAYS_CRITICAL,
  RATES_CACHE_TTL_MS,
} from "./core/index.ts";
export type { FreshnessLevel, RatesFreshness } from "./core/index.ts";

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
} from "./core/index.ts";
export type {
  MonthHoursConvention,
  ResolveMonthHoursInput,
  ResolvedMonthHours,
  PeakFactorInput,
  PeakFactorResult,
} from "./core/index.ts";

export {
  resolveVolumeSignals,
  parseRawStreamMetrics,
  logCategoryMultiplier,
  REFERENCE_ACCOUNT_COUNT,
  VOLUME_ORG_PRESETS,
  LOG_CATEGORY_SETS,
  LOG_INTENSITY_FACTOR,
} from "./core/index.ts";
export type {
  VolumeSignalsInput,
  ResolvedVolumeSignals,
  RawStreamMetrics,
  LogIntensity,
  VolumeOrgPresetId,
} from "./core/index.ts";

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
} from "./core/index.ts";
export type {
  FrozenEstimateExport,
  FreezeEstimateArgs,
  FreezeLoadResult,
  FreezeLoadOk,
  FreezeLoadErr,
} from "./core/index.ts";

export {
  createLogger,
  captureLogs,
  isEnabled as isDebugEnabled,
  setDebugFilter,
  setLogLevel,
  setLogSink,
  ENGINE_LOG_NAMESPACE,
} from "./core/debug-log.ts";
export type { Logger, LogLevel, LogRecord, LogSink } from "./core/debug-log.ts";

export {
  DEFAULT_ACCOUNT_COUNT,
  DEFAULT_ADS_SCANS_PER_MONTH,
  DEFAULT_AVG_OBJECT_SIZE_MB,
  DEFAULT_AVG_PACKAGE_GB,
  DEFAULT_DSPM_PCT_SCANNED,
  DEFAULT_MONTH_HOURS_VALUE,
  DEFAULT_SCANS_PER_MONTH,
  DEFAULT_SNAPSHOT_LIFETIME_HOURS,
  LIST_PAGE_SIZE_BY_PROVIDER,
} from "./core/estimator-defaults.ts";

export { scanOperationCounts, opsCost } from "./providers/dspm/scan-operations.ts";
export type { ScanOperationCounts } from "./providers/dspm/scan-operations.ts";

export { projectCosts } from "./core/index.ts";
export type {
  ProjectCostsInput,
  ProjectCostsResult,
  ProjectionPoint,
  ProjectionLineItem,
  ProjectionStackSlice,
} from "./core/index.ts";
export {
  PROJECTION_MAX_MONTHS,
  THROUGHPUT_STEP_METER_IDS,
  VOLUME_ELASTIC_CAPABILITIES,
  isVolumeElastic,
  isThroughputStepMeter,
  volumeGrowthFactor,
  steppedCapacityMultiplier,
} from "./core/index.ts";

export {
  azureCapabilityMeterMap,
  AZURE_TF_DEFAULTS,
  AZURE_TF_INVENTORY_ROOT,
  AZURE_RETAIL_PRICES_API_URL,
} from "./providers/azure/capability-meter-map.ts";

export {
  AZURE_TF_AUDIT_BILLABLE_METERS,
  AZURE_AUDIT_ONLY_METER_ALLOWLIST,
  AZURE_TF_EXCLUDED_FROM_METERS,
  AZURE_MODELED_NO_TF_CAPABILITIES,
  AZURE_MODELED_NO_TF_WARNING_PREFIX,
  NO_TF_INVENTORY_WARNING,
  assertAzureAuditMapMatchesReconciliation,
  isAzureAuditOnlyMeterAllowed,
} from "./providers/azure/tf-audit-reconciliation.ts";

export { appendTfHonestyWarnings } from "./providers/tf-honesty-warnings.ts";

export {
  createAzureRatesAdapter,
  AZURE_DEFAULT_REGION,
  AZURE_FALLBACK_PRICES_PATH,
  parseAzureRetailPrices,
} from "./providers/azure/azure-rates-adapter.ts";

export {
  awsCapabilityMeterMap,
  AWS_TF_DEFAULTS,
  AWS_TF_INVENTORY_ROOT,
  AWS_TF_PRESENT,
  AWS_PRICE_LIST_API_URL,
} from "./providers/aws/capability-meter-map.ts";

export {
  createAwsRatesAdapter,
  AWS_DEFAULT_REGION,
  AWS_FALLBACK_PRICES_PATH,
} from "./providers/aws/aws-rates-adapter.ts";

export {
  gcpCapabilityMeterMap,
  GCP_TF_DEFAULTS,
  GCP_TF_INVENTORY_ROOT,
  GCP_TF_PRESENT,
  GCP_BILLING_CATALOG_API_URL,
} from "./providers/gcp/capability-meter-map.ts";

export {
  createGcpRatesAdapter,
  GCP_DEFAULT_REGION,
  GCP_FALLBACK_PRICES_PATH,
  parseGcpBillingCatalog,
} from "./providers/gcp/gcp-rates-adapter.ts";

export {
  estimateAzureAuditStream,
  sizeAzureEventHubTus,
  AZURE_EH_INCLUDED_GB_PER_TU,
  AZURE_EH_MBPS_PER_TU,
  AZURE_EH_EPS_PER_TU,
} from "./providers/azure/azure-stream-estimator.ts";

export {
  estimateAwsAuditStream,
  sizeKinesisShards,
  kinesisPutPayloadUnits,
} from "./providers/aws/aws-stream-estimator.ts";

export {
  estimateGcpAuditStream,
  gbToGib,
} from "./providers/gcp/gcp-stream-estimator.ts";

export { estimateAuditStream } from "./providers/streams/estimate-audit-stream.ts";
export { volumeSignalsToStreamInputs } from "./providers/streams/volume-to-stream.ts";
export {
  ORG_STREAM_PRESETS,
  applyOrgPreset,
  DEFAULT_RETENTION_DAYS,
} from "./providers/streams/audit-stream.types.ts";
export type {
  AuditStreamInputs,
  AuditStreamResult,
  OrgPresetId,
} from "./providers/streams/audit-stream.types.ts";

export { estimateAuditStorage } from "./providers/storage/estimate-audit-storage.ts";
export {
  estimateAzureAuditStorage,
  AZURE_AUDIT_CAPACITY_METER,
} from "./providers/azure/azure-storage-estimator.ts";
export {
  estimateAwsAuditStorage,
  AWS_AUDIT_CAPACITY_METER,
} from "./providers/aws/aws-storage-estimator.ts";
export {
  estimateGcpAuditStorage,
  GCP_AUDIT_CAPACITY_METER,
} from "./providers/gcp/gcp-storage-estimator.ts";
export {
  DEFAULT_AUDIT_STORAGE_FLOOR_GB,
} from "./providers/storage/audit-storage.types.ts";
export type {
  AuditStorageInputs,
  AuditStorageResult,
} from "./providers/storage/audit-storage.types.ts";

export { estimateAds } from "./providers/ads/estimate-ads.ts";
export { estimateAzureAds, AZURE_ADS_SNAPSHOT_METER, AZURE_ADS_OUTPOST_METER } from "./providers/azure/azure-ads-estimator.ts";
export { estimateAwsAds, AWS_ADS_SNAPSHOT_METER, AWS_ADS_OUTPOST_METER } from "./providers/aws/aws-ads-estimator.ts";
export { estimateGcpAds, GCP_ADS_SNAPSHOT_METER, GCP_ADS_OUTPOST_METER } from "./providers/gcp/gcp-ads-estimator.ts";
export { snapshotGbMonthsUsedSize, isGovCloudRegion } from "./providers/ads/ads.types.ts";
export type { AdsInputs, AdsResult, AdsMode } from "./providers/ads/ads.types.ts";

export { estimateDspm } from "./providers/dspm/estimate-dspm.ts";
export {
  estimateAzureDspm,
  AZURE_DSPM_READ_METER,
  AZURE_DSPM_LIST_METER,
  AZURE_DSPM_EPHEMERAL_METER,
} from "./providers/azure/azure-dspm-estimator.ts";
export {
  estimateAwsDspm,
  AWS_DSPM_READ_METER,
  AWS_DSPM_LIST_METER,
  AWS_DSPM_EPHEMERAL_METER,
} from "./providers/aws/aws-dspm-estimator.ts";
export {
  estimateGcpDspm,
  GCP_DSPM_READ_METER,
  GCP_DSPM_LIST_METER,
  GCP_DSPM_EPHEMERAL_METER,
} from "./providers/gcp/gcp-dspm-estimator.ts";
export {
  scannedGbFromInputs,
  bandFromExpected,
  DSPM_BAND_LOW_FACTOR,
  DSPM_BAND_HIGH_FACTOR,
} from "./providers/dspm/dspm.types.ts";
export type {
  DspmInputs,
  DspmResult,
  DspmBand,
} from "./providers/dspm/dspm.types.ts";

export {
  estimateRegistryScan,
  estimateServerlessScan,
} from "./providers/registry-serverless/estimate-scans.ts";
export {
  estimateAzureRegistryScan,
  estimateAzureServerlessScan,
  AZURE_REGISTRY_METER,
  AZURE_SERVERLESS_METER,
} from "./providers/azure/azure-registry-serverless.ts";
export {
  estimateAwsRegistryScan,
  estimateAwsServerlessScan,
  AWS_REGISTRY_METER,
  AWS_SERVERLESS_METER,
} from "./providers/aws/aws-registry-serverless.ts";
export {
  estimateGcpRegistryScan,
  estimateGcpServerlessScan,
  GCP_REGISTRY_METER,
  GCP_SERVERLESS_METER,
} from "./providers/gcp/gcp-registry-serverless.ts";
export type {
  RegistryScanInputs,
  ServerlessScanInputs,
  ScanEstimateResult,
} from "./providers/registry-serverless/scan.types.ts";

export { estimateEgress } from "./providers/egress/estimate-egress.ts";
export {
  estimateAzureEgress,
  AZURE_EGRESS_METER,
} from "./providers/azure/azure-egress-estimator.ts";
export {
  estimateAwsEgress,
  AWS_EGRESS_METER,
} from "./providers/aws/aws-egress-estimator.ts";
export {
  estimateGcpEgress,
  GCP_EGRESS_METER,
} from "./providers/gcp/gcp-egress-estimator.ts";
export {
  AZURE_EGRESS_ZONES,
  AWS_EGRESS_ZONES,
  GCP_EGRESS_ZONES,
  lookupEgressZone,
} from "./providers/egress/egress-zone-cards.ts";
export type {
  EgressInputs,
  EgressResult,
} from "./providers/egress/egress.types.ts";

export {
  getRates,
  lookupUnitPrice,
  createRatesCache,
  defaultRatesCache,
  ratesCacheKey,
} from "./providers/rates/get-rates.ts";
export type { RatesCache, GetRatesOptions } from "./providers/rates/get-rates.ts";

export {
  FORMULA_CHECKS,
  LIVE_FALLBACK_DRIFT_WARN_RATIO,
  FORBIDDEN_FORMULA_SKIP_ENV_KEYS,
  formulaChecksForProvider,
  assertFormulaChecksNotSkippedByEnv,
  liveVsFallbackDrift,
} from "./providers/formula-regression/registry.ts";
export type {
  FormulaCheck,
  FormulaCheckKind,
  DriftCompareResult,
} from "./providers/formula-regression/registry.ts";

export { createEstimate } from "./providers/create-estimate.ts";
export type {
  CreateEstimateRequest,
  CreateEstimateResponse,
} from "./providers/create-estimate.ts";

export type {
  FallbackMeterRow,
  FallbackPricesDocument,
  RatesResult,
} from "./providers/rates/fallback-schema.ts";
export {
  parseFallbackDocument,
  loadFallbackFile,
  fallbackToRateCard,
} from "./providers/rates/fallback-schema.ts";
