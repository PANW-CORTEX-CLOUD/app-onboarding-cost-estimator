/**
 * Map resolved volume signals → AuditStreamInputs (package 12).
 */
import type { AuditStreamInputs } from "../streams/audit-stream.types.ts";
import type { ResolvedVolumeSignals, VolumeSignalsInput } from "../../core/volume-signals.ts";
import { resolveVolumeSignals } from "../../core/volume-signals.ts";

export function volumeSignalsToStreamInputs(
  volume: VolumeSignalsInput,
  streamDefaults: Pick<AuditStreamInputs, "enabled" | "region"> &
    Partial<Omit<AuditStreamInputs, "ingressGBPerDay" | "peakMBps" | "peakEventsPerSec" | "byoManagedStream" | "orgPreset">>,
): { stream: AuditStreamInputs; resolved: ResolvedVolumeSignals } {
  const resolved = resolveVolumeSignals(volume);
  return {
    resolved,
    stream: {
      enabled: streamDefaults.enabled,
      region: streamDefaults.region,
      ingressGBPerDay: resolved.ingressGBPerDay,
      peakMBps: resolved.peakMBps,
      peakEventsPerSec: resolved.peakEventsPerSec,
      retentionDays: streamDefaults.retentionDays,
      monthHours: streamDefaults.monthHours,
      peakFactor: streamDefaults.peakFactor,
      partitionOrShardTopologyCount:
        streamDefaults.partitionOrShardTopologyCount,
      byoManagedStream: resolved.byoManagedStream,
    },
  };
}
