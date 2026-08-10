/**
 * Fail-closed meter-price lookup, shared by every provider's `*.types.ts`.
 *
 * Was defined byte-for-byte identically in 6 separate files
 * (providers/{ads,dspm,egress,streams/audit-stream,storage/audit-storage,
 * registry-serverless}/*.types.ts) - a future change to this rule (e.g. a
 * different fallback policy) would have needed the same edit applied six
 * times by hand. Each of those files now re-exports this implementation
 * instead of defining its own.
 */

/**
 * Look up a meter's unit price, failing closed instead of defaulting to $0.
 * @throws when `meterId` is absent from `unitPrices`.
 */
export function requireRate(
  unitPrices: Record<string, number>,
  meterId: string,
): number {
  const p = unitPrices[meterId];
  if (p === undefined) {
    throw new Error(`missing unit price for meter '${meterId}' (no invented $0)`);
  }
  return p;
}
