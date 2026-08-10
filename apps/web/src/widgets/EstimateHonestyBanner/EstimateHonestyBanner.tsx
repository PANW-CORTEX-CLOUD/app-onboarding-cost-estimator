/**
 * Surfaces TF honesty / modeled-capability warnings from createEstimate.
 * Filters to honesty-relevant lines to avoid rate-freshness spam in the banner.
 */
import {
  AZURE_MODELED_NO_TF_WARNING_PREFIX,
  NO_TF_INVENTORY_WARNING,
} from "./tfHonestyConstants.ts";

export type EstimateHonestyBannerProps = {
  warnings: string[];
};

export function isHonestyWarning(w: string): boolean {
  return (
    w.startsWith(AZURE_MODELED_NO_TF_WARNING_PREFIX) ||
    w.includes(NO_TF_INVENTORY_WARNING) ||
    /modeled · no connector TF/i.test(w)
  );
}

export function EstimateHonestyBanner({ warnings }: EstimateHonestyBannerProps) {
  const honesty = warnings.filter(isHonestyWarning);
  if (honesty.length === 0) return null;

  return (
    <aside
      data-testid="estimate-honesty-banner"
      className="honesty-banner"
      aria-label="Terraform grounding notes"
    >
      <p className="section-lede">
        Azure connector TF bills audit stream+store only; other capabilities are
        modeled. AWS/GCP have no connector TF inventory.
      </p>
      <ul>
        {honesty.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </aside>
  );
}
