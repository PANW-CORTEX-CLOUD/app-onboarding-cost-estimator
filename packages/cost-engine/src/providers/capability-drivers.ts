/**
 * Which volume inputs each capability needs before it can be priced.
 *
 * The request layer used to coerce every missing driver to zero
 * (`vol.vmCount ?? 0`), which quietly turned "the user told us nothing" into
 * "the answer is nothing". The estimators then warned about a zero — but by
 * then the distinction between *absent* and *deliberately zero* was already
 * gone, and a $0 line for an enabled capability reads as a real quote.
 *
 * The two cases deserve different answers:
 *
 * - **Absent** — nobody has said how big the estate is. There is no honest
 *   number, so refuse. This is the same fail-closed stance the model already
 *   takes on empty discovery telemetry and on critically stale rates.
 * - **Explicitly zero** — someone said "no VMs". $0 is then the right answer,
 *   and the existing estimator warnings cover it.
 *
 * Keeping the table here rather than inline in `createEstimate` means the rule
 * is stated once and can be read without following the pricing path.
 */
import type { CapabilityId } from "./meter-map.types.ts";

/** Volume fields, as they appear on the estimate request. */
export type VolumeBag = Record<string, number | string | boolean | undefined>;

/**
 * Capability → the drivers that size it.
 *
 * A capability is priceable when **at least one** of its drivers was supplied.
 * Requiring all of them would reject reasonable partial input (an estate size
 * without a scan count, say, where a documented default covers the rest).
 *
 * `discovery` and `audit_logs` are absent on purpose: discovery has no meter
 * at all, and audit volume is derived from `accountCount`, which always has a
 * documented default.
 *
 * `egress` is absent too — when audit logs are on it legitimately derives its
 * volume from the audit stream, so an omitted `egressGB` is not ambiguous.
 */
export const CAPABILITY_SIZING_DRIVERS: Partial<Record<CapabilityId, readonly string[]>> = {
  ads_cloud: ["vmCount", "avgUsedDiskGB"],
  ads_outpost: ["vmCount", "avgUsedDiskGB"],
  dspm: ["dataEstateGB"],
  registry: ["imageCount", "avgImageGB"],
  serverless: ["packageCount"],
};

/** Human labels so the error names the field a user actually sees. */
export const DRIVER_LABELS: Record<string, string> = {
  vmCount: "VM count",
  avgUsedDiskGB: "average used disk GB",
  dataEstateGB: "data estate GB",
  imageCount: "container image count",
  avgImageGB: "average image GB",
  packageCount: "function package count",
};

export type MissingDrivers = {
  capability: CapabilityId;
  drivers: readonly string[];
};

/**
 * Capabilities that are switched on but have no sizing information at all.
 *
 * @param enabled capability ids the request turned on
 * @param volume the request's volume bag
 * @returns one entry per capability with every driver absent; empty when fine
 */
export function findUnsizedCapabilities(
  enabled: readonly CapabilityId[],
  volume: VolumeBag,
): MissingDrivers[] {
  const missing: MissingDrivers[] = [];
  for (const capability of enabled) {
    const drivers = CAPABILITY_SIZING_DRIVERS[capability];
    if (!drivers || drivers.length === 0) continue;
    // Explicit 0 counts as supplied — that is a decision, not a gap.
    const anySupplied = drivers.some((d) => volume[d] !== undefined);
    if (!anySupplied) missing.push({ capability, drivers });
  }
  return missing;
}

/**
 * Fail closed when an enabled capability has no sizing at all.
 *
 * @throws naming each capability and the fields that would resolve it, so the
 *         caller can fix the request rather than guess why it was rejected
 */
export function assertCapabilitiesAreSized(
  enabled: readonly CapabilityId[],
  volume: VolumeBag,
): void {
  const missing = findUnsizedCapabilities(enabled, volume);
  if (missing.length === 0) return;

  const detail = missing
    .map(
      (m) =>
        `${m.capability} (needs one of: ${m.drivers
          .map((d) => DRIVER_LABELS[d] ?? d)
          .join(", ")})`,
    )
    .join("; ");

  throw new Error(
    `capability enabled without any sizing input: ${detail}. ` +
      "Refusing to report $0 for something nobody has sized — supply a driver, " +
      "or set it explicitly to 0 if the estate really is empty.",
  );
}
