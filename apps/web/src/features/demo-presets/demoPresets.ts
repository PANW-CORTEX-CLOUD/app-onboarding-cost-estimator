/**
 * One-click demo presets — Azure/AWS/GCP × audit-only & comprehensive (MVP).
 * Volume numbers are explicit presets (EDGE: never silent zeros for empty advanced).
 */
import type { CloudProvider } from "../../shared/model/cloud-provider.ts";
import type { EstimateCapabilities } from "../../entities/estimate/types.ts";
import { defaultRegionFor } from "../../shared/model/regions.ts";

export type DemoPresetId =
  | "azure-audit"
  | "azure-comprehensive"
  | "aws-audit"
  | "aws-comprehensive"
  | "gcp-audit"
  | "gcp-comprehensive";

export type DemoPreset = {
  id: DemoPresetId;
  label: string;
  provider: CloudProvider;
  region: string;
  capabilities: EstimateCapabilities;
  volume: {
    accountCount: number;
    monthlyActiveUsers: number;
    ingressGBPerDay: number;
    peakMBps: number;
    peakEventsPerSec: number;
    dataEstateGB: number;
    pctScanned: number;
    scansPerMonth: number;
    imageCount: number;
    avgImageGB: number;
    packageCount: number;
    egressGB: number;
    vmCount?: number;
    avgUsedDiskGB?: number;
  };
};

const AUDIT_VOLUME = {
  accountCount: 10,
  monthlyActiveUsers: 1000,
  ingressGBPerDay: 10,
  peakMBps: 1,
  peakEventsPerSec: 1000,
  dataEstateGB: 0,
  pctScanned: 0,
  scansPerMonth: 0,
  imageCount: 0,
  avgImageGB: 0,
  packageCount: 0,
  egressGB: 0,
} as const;

const COMPREHENSIVE_VOLUME = {
  accountCount: 25,
  monthlyActiveUsers: 5000,
  ingressGBPerDay: 50,
  peakMBps: 5,
  peakEventsPerSec: 5000,
  dataEstateGB: 10_000,
  pctScanned: 10,
  scansPerMonth: 1,
  imageCount: 100,
  avgImageGB: 2,
  packageCount: 200,
  egressGB: 100,
  vmCount: 10,
  avgUsedDiskGB: 100,
} as const;

const AUDIT_CAPS: EstimateCapabilities = {
  discovery: false,
  auditLogs: true,
  adsCloud: false,
  adsOutpost: false,
  dspm: false,
  registry: false,
  serverless: false,
  egress: false,
};

const COMPREHENSIVE_CAPS: EstimateCapabilities = {
  discovery: true,
  auditLogs: true,
  adsCloud: true,
  adsOutpost: false,
  dspm: true,
  registry: true,
  serverless: true,
  egress: true,
};

function preset(
  id: DemoPresetId,
  label: string,
  provider: CloudProvider,
  kind: "audit" | "comprehensive",
): DemoPreset {
  return {
    id,
    label,
    provider,
    region: defaultRegionFor(provider),
    capabilities: kind === "audit" ? { ...AUDIT_CAPS } : { ...COMPREHENSIVE_CAPS },
    volume: {
      ...(kind === "audit" ? AUDIT_VOLUME : COMPREHENSIVE_VOLUME),
    },
  };
}

export const DEMO_PRESETS: DemoPreset[] = [
  preset("azure-audit", "Azure · audit-only", "azure", "audit"),
  preset("azure-comprehensive", "Azure · comprehensive", "azure", "comprehensive"),
  preset("aws-audit", "AWS · audit-only", "aws", "audit"),
  preset("aws-comprehensive", "AWS · comprehensive", "aws", "comprehensive"),
  preset("gcp-audit", "GCP · audit-only", "gcp", "audit"),
  preset("gcp-comprehensive", "GCP · comprehensive", "gcp", "comprehensive"),
];

export function getDemoPreset(id: DemoPresetId): DemoPreset {
  const p = DEMO_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown demo preset: ${id}`);
  return p;
}

/** Default volume when advanced fields are empty — never invent silent zeros. */
export const DEFAULT_VOLUME_PRESET = { ...AUDIT_VOLUME };
