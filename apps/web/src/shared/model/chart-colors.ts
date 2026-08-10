/**
 * Capability → chart color legend (display only).
 */
export const CAPABILITY_COLORS: Record<string, string> = {
  auditLogs: "#0b6e4f",
  adsCloud: "#1d4e89",
  adsOutpost: "#3d5a80",
  dspm: "#9a031e",
  registry: "#e36414",
  serverless: "#5f0f40",
  egress: "#0f4c5c",
  discovery: "#6c757d",
  other: "#495057",
};

export function colorForCapability(capability: string): string {
  return CAPABILITY_COLORS[capability] ?? CAPABILITY_COLORS.other!;
}
