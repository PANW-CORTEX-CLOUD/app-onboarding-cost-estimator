/**
 * Named defaults for the estimate pipeline.
 *
 * These used to be bare literals inside `createEstimate`, where a reader could
 * not tell a billing *convention* (730 hours is how clouds define a month)
 * from an *assumption* about the customer's estate (10 accounts) — and only
 * the second kind changes someone's quote when it is wrong.
 *
 * Each constant says where its number comes from. Anything tagged ASSUMPTION
 * should also surface in the estimate's assumption snapshot so the customer
 * can see what was guessed on their behalf.
 *
 * TODO(REQ-5): split these into CONVENTION and ASSUMPTION groups and feed the
 * ASSUMPTION values into the results assumption snapshot automatically, rather
 * than relying on each widget to remember to display them.
 */

/** CONVENTION — the hour count cloud providers bill a "month" as (365×24/12). */
export const DEFAULT_MONTH_HOURS_VALUE = 730;

/** CONVENTION — reference estate the volume elasticities are calibrated against. */
export const REFERENCE_ACCOUNT_COUNT_DEFAULT = 10;

/** ASSUMPTION — accounts in scope when the caller says nothing. */
export const DEFAULT_ACCOUNT_COUNT = 10;

/** ASSUMPTION — agentless disk scans per month (roughly weekly). */
export const DEFAULT_ADS_SCANS_PER_MONTH = 4;

/**
 * ASSUMPTION — hours a disk snapshot exists before the scanner deletes it.
 * Snapshot storage is billed per GB-month, so this prorates a short-lived
 * snapshot instead of charging a full month for a scan that lasted a day.
 */
export const DEFAULT_SNAPSHOT_LIFETIME_HOURS = 24;

/** ASSUMPTION — scans per month for capabilities that scan less often than ADS. */
export const DEFAULT_SCANS_PER_MONTH = 1;

/** ASSUMPTION — share of the data estate covered by one DSPM scan cycle, percent. */
export const DEFAULT_DSPM_PCT_SCANNED = 10;

/**
 * ASSUMPTION — average serverless deployment package size in GB (10 MB).
 * Tracked for reporting only; the serverless scan bills per invocation, so
 * this never multiplies a rate.
 */
export const DEFAULT_AVG_PACKAGE_GB = 0.01;

/** CONVENTION — hours per day, for day↔month conversions. */
export const HOURS_PER_DAY = 24;

/**
 * ASSUMPTION — average size of a scanned object, in MB.
 *
 * This is the number that converts an estate measured in gigabytes into the
 * count of API calls a scanner actually makes, which is what object storage
 * bills for. 4 MB is a deliberately conservative middle for mixed estates: too
 * small over-counts operations, too large under-counts them.
 *
 * There is no vendor-published figure for this — it is a property of the
 * customer's data, not of the cloud — so it is exposed as an input and named
 * in the estimate notes rather than buried.
 */
export const DEFAULT_AVG_OBJECT_SIZE_MB = 4;

/** Bytes-per-unit conversions, so call sites stop hard-coding 1024. */
export const MB_PER_GB = 1024;

/** Operations are quoted per 10,000 across all three clouds. */
export const OPS_PRICING_BATCH = 10_000;

/**
 * Maximum objects one list call returns, per provider. Object stores paginate
 * enumeration, so scanning N objects costs ceil(N / pageSize) list operations
 * on top of the per-object reads.
 *
 * @see https://learn.microsoft.com/en-us/rest/api/storageservices/list-blobs — maxresults caps at 5000
 * @see https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html — MaxKeys caps at 1000
 * @see https://cloud.google.com/storage/docs/json_api/v1/objects/list — maxResults caps at 1000
 */
export const LIST_PAGE_SIZE_BY_PROVIDER = {
  azure: 5_000,
  aws: 1_000,
  gcp: 1_000,
} as const;
