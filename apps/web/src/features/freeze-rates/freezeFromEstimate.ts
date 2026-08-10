/**
 * Feature: freeze — client-side pin of ratesAsOf / modelVersion for export UI.
 * Does not recompute prices; stores last successful metadata only.
 */
export type FrozenRatesMeta = {
  ratesAsOf: string;
  modelVersion: string;
  inputHash: string;
  frozenAt: string;
};

export function freezeFromEstimate(args: {
  ratesAsOf: string;
  modelVersion: string;
  inputHash: string;
}): FrozenRatesMeta {
  return {
    ratesAsOf: args.ratesAsOf,
    modelVersion: args.modelVersion,
    inputHash: args.inputHash,
    frozenAt: new Date().toISOString(),
  };
}
