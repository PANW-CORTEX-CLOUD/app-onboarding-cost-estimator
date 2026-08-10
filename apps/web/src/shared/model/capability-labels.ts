/**
 * Human-readable capability names and short “why it matters” hints for the UI.
 * Engine IDs stay snake_case / camelCase; display only uses these labels.
 */
export const CAPABILITY_DISPLAY: Record<
  string,
  { label: string; hint: string }
> = {
  discovery: {
    label: "Discovery",
    hint: "Inventory / identity only — no billable cloud meters in this model",
  },
  auditLogs: {
    label: "Audit logs",
    hint: "TF-grounded on Azure (Event Hubs + blob); modeled stream/store on AWS/GCP",
  },
  audit_logs: {
    label: "Audit logs",
    hint: "TF-grounded on Azure (Event Hubs + blob)",
  },
  adsCloud: {
    label: "Agentless disk scan (cloud)",
    hint: "Modeled · no connector TF — snapshot / scan VMs (ADS Cloud)",
  },
  ads_cloud: {
    label: "Agentless disk scan (cloud)",
    hint: "Modeled · no connector TF — snapshot / scan VMs",
  },
  adsOutpost: {
    label: "Agentless disk scan (outpost)",
    hint: "Modeled · no connector TF — outpost scanner path (ADS Outpost)",
  },
  ads_outpost: {
    label: "Agentless disk scan (outpost)",
    hint: "Modeled · no connector TF — outpost scanner path",
  },
  dspm: {
    label: "Data security posture (DSPM)",
    hint: "Modeled · no connector TF — scan a share of your data estate",
  },
  registry: {
    label: "Container registry scan",
    hint: "Modeled · no connector TF — pull and scan container images",
  },
  serverless: {
    label: "Serverless package scan",
    hint: "Modeled · no connector TF — scan function packages",
  },
  egress: {
    label: "Egress / data transfer",
    hint: "Modeled · no connector TF — outbound data leaving the region",
  },
};

/** Short label for tables / bars (engine capability id or toggle key). */
export function capabilityLabel(id: string): string {
  return CAPABILITY_DISPLAY[id]?.label ?? id.replace(/_/g, " ");
}

export function capabilityHint(id: string): string | undefined {
  return CAPABILITY_DISPLAY[id]?.hint;
}
