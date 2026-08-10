/**
 * Fail-closed checklist of missing volume fields for enabled capabilities.
 * Never invents values — lists what the user still needs to enter.
 */
import type { EstimateCapabilities } from "../../entities/estimate/types.ts";

export type JourneyChecklistVolume = {
  dataEstateGB: number;
  vmCount: number;
  avgUsedDiskGB: number;
  imageCount: number;
  avgImageGB: number;
  packageCount: number;
  egressGB: number;
};

export type JourneyChecklistProps = {
  caps: EstimateCapabilities;
  volume: JourneyChecklistVolume;
};

export function missingJourneyFields(
  caps: EstimateCapabilities,
  volume: JourneyChecklistVolume,
): string[] {
  const missing: string[] = [];
  if (caps.dspm && !(volume.dataEstateGB > 0)) {
    missing.push("DSPM requires data estate GB > 0");
  }
  if (
    (caps.adsCloud || caps.adsOutpost) &&
    !(volume.vmCount > 0 && volume.avgUsedDiskGB > 0)
  ) {
    missing.push("ADS requires VM count and avg used disk GB > 0");
  }
  if (caps.registry && !(volume.imageCount > 0 && volume.avgImageGB > 0)) {
    missing.push("Registry requires image count and avg image GB > 0");
  }
  if (caps.serverless && !(volume.packageCount > 0)) {
    missing.push("Serverless requires package count > 0");
  }
  if (caps.egress && !(volume.egressGB > 0)) {
    missing.push("Egress requires egress GB > 0");
  }
  return missing;
}

export function JourneyChecklist({ caps, volume }: JourneyChecklistProps) {
  const missing = missingJourneyFields(caps, volume);
  if (missing.length === 0) return null;
  return (
    <ul
      role="status"
      data-testid="journey-checklist"
      className="journey-checklist"
    >
      {missing.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}
