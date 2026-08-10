/**
 * Converting an estate measured in bytes into the API calls a scanner is
 * actually billed for.
 *
 * Object stores do not charge to *read* bytes from their hot/standard tiers —
 * they charge per **operation**. Microsoft states it directly: `Get Blob` is a
 * Read operation, downloading a blob from the Blob Service endpoint costs one
 * read operation regardless of the blob's size, and hot-tier data retrieval is
 * free. S3 Standard likewise has no retrieval fee, and Cloud Storage has no
 * per-GB read charge.
 *
 * So the only honest way from "50 TB estate" to dollars is through an object
 * count, and the only way to an object count is an assumption about average
 * object size. That assumption is therefore an explicit input, reported in the
 * estimate notes — never a buried constant.
 *
 * Enumerating the estate costs extra: `List Blobs` / `ListObjectsV2` /
 * `objects.list` are a dearer operation class than a read, and they paginate,
 * so a scan pays `ceil(objects / pageSize)` list calls on top of the reads.
 *
 * @see https://learn.microsoft.com/en-us/azure/storage/blobs/map-rest-apis-transaction-categories
 * @see https://learn.microsoft.com/en-us/azure/storage/blobs/blob-storage-estimate-costs
 * @see https://aws.amazon.com/s3/pricing/
 * @see https://cloud.google.com/storage/pricing
 */
import {
  LIST_PAGE_SIZE_BY_PROVIDER,
  MB_PER_GB,
  OPS_PRICING_BATCH,
} from "../../core/estimator-defaults.ts";
import type { CloudProvider } from "../../core/models/estimate.types.ts";

export type ScanOperationCounts = {
  /** Objects a scan cycle touches, derived from bytes and average object size. */
  objects: number;
  /** One read (Get Blob / GetObject) per object. */
  readOps: number;
  /** Paginated enumeration of the estate. */
  listOps: number;
  /** Page size used, so the note can state it. */
  listPageSize: number;
};

/**
 * @param scannedGB total bytes covered by the scan cycle(s), in GB
 * @param avgObjectSizeMB average size of one scanned object, in MB
 * @throws when the object size is not a positive finite number — dividing by it
 *         would otherwise yield Infinity or NaN and silently poison the total
 */
export function scanOperationCounts(
  provider: CloudProvider,
  scannedGB: number,
  avgObjectSizeMB: number,
): ScanOperationCounts {
  if (!Number.isFinite(scannedGB) || scannedGB < 0) {
    throw new Error(
      `scanOperationCounts: scannedGB must be a non-negative number, got ${scannedGB}`,
    );
  }
  if (!Number.isFinite(avgObjectSizeMB) || avgObjectSizeMB <= 0) {
    throw new Error(
      `scanOperationCounts: avgObjectSizeMB must be > 0, got ${avgObjectSizeMB} (cannot convert GB to object count)`,
    );
  }

  const listPageSize = LIST_PAGE_SIZE_BY_PROVIDER[provider];
  const objects = (scannedGB * MB_PER_GB) / avgObjectSizeMB;

  // An empty estate costs nothing at all — not even one list call, because
  // there is no scan to run. Any non-empty estate pays at least one page.
  const listOps = objects > 0 ? Math.ceil(objects / listPageSize) : 0;

  return { objects, readOps: objects, listOps, listPageSize };
}

/** Operations are quoted per 10,000 on all three clouds. */
export function opsCost(operations: number, ratePer10k: number): number {
  return (operations / OPS_PRICING_BATCH) * ratePer10k;
}
