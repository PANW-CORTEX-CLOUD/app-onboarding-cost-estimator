/**
 * Collapsed “How billing works” panel — one per section (package 36).
 */
import type { CloudProvider } from "../../shared/model/cloud-provider.ts";
import {
  getBillingHelp,
  type BillingHelpFamily,
} from "../../shared/model/billing-help.ts";

export type BillingHelpPanelProps = {
  provider: CloudProvider;
  family: BillingHelpFamily;
  testId?: string;
  /** Package 07/07: stay closed unless caller opts in. */
  defaultOpen?: boolean;
};

export function BillingHelpPanel({
  provider,
  family,
  testId = `billing-help-${family}`,
  defaultOpen = false,
}: BillingHelpPanelProps) {
  const content = getBillingHelp(provider, family);
  return (
    <details
      className="billing-help-panel"
      data-testid={testId}
      open={defaultOpen || undefined}
    >
      <summary>{content.title}</summary>
      <p className="field-hint">{content.summary}</p>
      <p className="field-hint">Meters in this model:</p>
      <ul data-testid={`${testId}-meters`}>
        {content.meters.map((m) => (
          <li key={m}>
            <code className="billing-help-meter">{m}</code>
          </li>
        ))}
      </ul>
      <p>
        <a href={content.pricingUrl} target="_blank" rel="noreferrer">
          Official pricing page
        </a>
      </p>
      <ul className="billing-help-notes">
        {content.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </details>
  );
}
