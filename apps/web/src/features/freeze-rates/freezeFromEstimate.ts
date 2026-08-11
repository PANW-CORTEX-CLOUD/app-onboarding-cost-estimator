/**
 * Display metadata for a frozen estimate.
 *
 * The local `freezeFromEstimate()` helper that used to build this is gone: it
 * only stamped ratesAsOf/modelVersion client-side, which meant the "Freeze
 * rates snapshot" button pinned nothing and the quote could not actually be
 * reproduced. These fields now come from the real frozen payload returned by
 * `POST /estimates/freeze` (@see packages/cost-engine core/rate-pinning.ts).
 */
export type FrozenRatesMeta = {
  ratesAsOf: string;
  modelVersion: string;
  inputHash: string;
  frozenAt: string;
};
