/**
 * RatesFreshnessBanner — displays rates source / stale / critical from API or cache.
 */
import type { FreshnessLevel } from "../../entities/rates/types.ts";

export type RatesFreshnessBannerProps = {
  level: FreshnessLevel;
  message: string;
  ratesAsOf?: string;
  ratesSource?: string;
  testId?: string;
};

export function RatesFreshnessBanner({
  level,
  message,
  ratesAsOf,
  ratesSource,
  testId = "rates-freshness-banner",
}: RatesFreshnessBannerProps) {
  return (
    <div
      role="status"
      data-testid={testId}
      data-freshness={level}
    >
      <strong>{level}</strong>: {message}
      {ratesAsOf ? ` · ratesAsOf ${ratesAsOf}` : null}
      {ratesSource ? ` · source ${ratesSource}` : null}
    </div>
  );
}
