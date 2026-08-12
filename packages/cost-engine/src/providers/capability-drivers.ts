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
 * **Every listed driver is required** (an explicit `0` counts — see
 * {@link findUnsizedCapabilities}). This is stronger than the "at least one"
 * rule that lived here before, and the change fixes a validated silent-$0 bug:
 * ADS Cloud prices `snapshotCost = vmCount × scansPerMonth × prorate(avgUsedDiskGB)`,
 * so `vmCount` and `avgUsedDiskGB` are **multiplicands**. Under "at least one",
 * supplying only `vmCount` let `avgUsedDiskGB ?? 0` zero the product — the user
 * gave a real number and still got a $0 quote for an enabled capability, which
 * is exactly the absent→silent-zero failure REQ-6 exists to prevent.
 *
 * Requiring all *listed* drivers does not reject the partial input the old
 * rationale worried about, because every field with a documented default
 * (`scansPerMonth`, `pctScanned`, `avgObjectSizeMB`, …) is deliberately **not**
 * listed here — those are covered by `defaults.resolve` and legitimately
 * omittable. Only bare `?? 0` multiplicands with no default appear below, and
 * for those "absent" has no honest reading other than refusal.
 *
 * `registry` lists `imageCount` only. Its second input, `avgImageGB`, feeds the
 * cross-region pull path (`amount = crossRegionPull ? pullGb × rate : 0`).
 * `crossRegionPull` now comes from the request (REQ-19), so `avgImageGB` is
 * load-bearing exactly when it is set — but it is still not a *required* driver
 * here, because `create-estimate.ts` gives it a tracked assumption default when
 * `crossRegionPull` is on (and leaves it inert when off). A required driver has
 * no honest default; `avgImageGB` does, so it belongs with `scansPerMonth` et
 * al., not in this list.
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
  registry: ["imageCount"],
  serverless: ["packageCount"],
};

/** Human labels so the error names the field a user actually sees. */
const DRIVER_LABELS: Record<string, string> = {
  vmCount: "VM count",
  avgUsedDiskGB: "average used disk GB",
  dataEstateGB: "data estate GB",
  imageCount: "container image count",
  avgImageGB: "average image GB",
  packageCount: "function package count",
};

export type MissingDrivers = {
  capability: CapabilityId;
  /** The still-missing drivers for this capability (a subset of its list). */
  drivers: readonly string[];
};

/**
 * Enabled capabilities that are missing one or more **required** sizing drivers.
 *
 * A driver is "supplied" when the volume bag holds any value for it, including
 * an explicit `0` — that is a decision, not a gap. Because every driver in
 * {@link CAPABILITY_SIZING_DRIVERS} is a bare `?? 0` multiplicand with no
 * documented default, an absent one has no honest reading and is reported here.
 *
 * @param enabled capability ids the request turned on
 * @param volume the request's volume bag
 * @returns one entry per capability that is missing at least one driver, naming
 *          only the missing fields; empty when every capability is fully sized
 */
export function findUnsizedCapabilities(
  enabled: readonly CapabilityId[],
  volume: VolumeBag,
): MissingDrivers[] {
  const missing: MissingDrivers[] = [];
  for (const capability of enabled) {
    const drivers = CAPABILITY_SIZING_DRIVERS[capability];
    if (!drivers || drivers.length === 0) continue;
    // Explicit 0 counts as supplied; only genuinely-absent fields are gaps.
    const absent = drivers.filter((d) => volume[d] === undefined);
    if (absent.length > 0) missing.push({ capability, drivers: absent });
  }
  return missing;
}

/**
 * Fail closed when an enabled capability is missing a required sizing driver.
 *
 * @throws naming each capability and the exact fields that would resolve it, so
 *         the caller can fix the request rather than guess why it was rejected
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
        `${m.capability} (needs: ${m.drivers
          .map((d) => DRIVER_LABELS[d] ?? d)
          .join(", ")})`,
    )
    .join("; ");

  throw new Error(
    `capability enabled without required sizing input: ${detail}. ` +
      "Refusing to report $0 for something nobody has sized — supply the field, " +
      "or set it explicitly to 0 if the estate really is empty.",
  );
}
