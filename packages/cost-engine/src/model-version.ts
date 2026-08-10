/**
 * Shared semantic version for the cost model / engine formulas.
 * Bumped when estimate rules or constants change — see docs/COST_MODEL_CHANGELOG.md.
 */
export const modelVersion = "0.1.3" as const;

export type ModelVersion = typeof modelVersion;
