/**
 * Capability toggles — maps to EstimateCapabilities; no formula logic.
 */
import type { EstimateCapabilities } from "../../entities/estimate/types.ts";
import {
  capabilityHint,
  capabilityLabel,
} from "../../shared/model/capability-labels.ts";

export const CAPABILITY_KEYS = [
  "discovery",
  "auditLogs",
  "adsCloud",
  "adsOutpost",
  "dspm",
  "registry",
  "serverless",
  "egress",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/** @deprecated Prefer capabilityLabel() — kept for callers expecting short names. */
export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  discovery: capabilityLabel("discovery"),
  auditLogs: capabilityLabel("auditLogs"),
  adsCloud: capabilityLabel("adsCloud"),
  adsOutpost: capabilityLabel("adsOutpost"),
  dspm: capabilityLabel("dspm"),
  registry: capabilityLabel("registry"),
  serverless: capabilityLabel("serverless"),
  egress: capabilityLabel("egress"),
};

export type CapabilityTogglesProps = {
  value: EstimateCapabilities;
  onChange: (next: EstimateCapabilities) => void;
  disabled?: boolean;
};

export function CapabilityToggles({
  value,
  onChange,
  disabled = false,
}: CapabilityTogglesProps) {
  return (
    <fieldset data-testid="capability-toggles" disabled={disabled}>
      <legend className="sr-only">Capabilities to include in the estimate</legend>
      <p className="section-lede">
        Turn on workloads to price. Discovery alone stays $0.
      </p>
      <ul className="cap-toggle-list">
        {CAPABILITY_KEYS.map((key) => (
          <li key={key} className="cap-toggle-item">
            <label data-selected={value[key] ? "true" : undefined}>
              <input
                type="checkbox"
                checked={Boolean(value[key])}
                data-testid={`cap-toggle-${key}`}
                onChange={(e) =>
                  onChange({ ...value, [key]: e.target.checked })
                }
              />
              <span className="cap-toggle-text">
                <span className="cap-toggle-title">{capabilityLabel(key)}</span>
                {capabilityHint(key) ? (
                  <span className="field-hint">{capabilityHint(key)}</span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** True when discovery is the only enabled billable-facing toggle. */
export function isDiscoveryOnly(caps: EstimateCapabilities): boolean {
  const enabled = CAPABILITY_KEYS.filter((k) => Boolean(caps[k]));
  return enabled.length === 1 && enabled[0] === "discovery";
}
