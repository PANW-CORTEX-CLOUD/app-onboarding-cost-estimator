/**
 * MeterMap port — capability → permission → meter rows for a provider.
 * Concrete maps live under providers/*; core must not import provider modules.
 */
import type { CloudProvider, Confidence } from "../models/estimate.types.ts";

/** Core-facing meter row (mirrors research maps without importing providers/). */
export interface MeterMapRow {
  capability: string;
  permissionSignal: string;
  meterId: string;
  meterSku: string;
  unit: string;
  confidence: Confidence;
  sourceUrl: string;
}

export interface MeterMap {
  readonly provider: CloudProvider;
  list(): readonly MeterMapRow[];
}
