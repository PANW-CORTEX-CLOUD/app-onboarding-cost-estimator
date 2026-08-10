/**
 * Cost-allocation tagging guidance (package 22) — Azure RG/tags, AWS tags, GCP labels.
 */
import type { CloudProvider } from "../../entities/provider/model.ts";

export const TAGGING_GUIDANCE: Record<
  CloudProvider,
  { title: string; patterns: string[]; tfCite?: string }
> = {
  azure: {
    title: "Azure resource groups & tags",
    patterns: [
      "Resource groups: cortex-onboarding-* (Cortex onboarding inventory)",
      "Tag: managed_by=paloaltonetworks",
      "Use Cost Management + tag inheritance for allocation",
    ],
    tfCite: "docs/TAGGING.md → azure/data Terraform inventory (read-only)",
  },
  aws: {
    title: "AWS cost allocation tags",
    patterns: [
      "Tag key: ManagedBy = PaloAltoNetworks (or managed_by)",
      "Activate cost allocation tags in Billing console",
      "Optional: CortexCloud = true for filterable spend",
    ],
    tfCite: "docs/TAGGING.md → aws/ README tagging notes",
  },
  gcp: {
    title: "GCP labels",
    patterns: [
      "Label: managed_by=paloaltonetworks",
      "Label: cortex_cloud=true",
      "Export via BigQuery billing export filtered on labels",
    ],
    tfCite: "docs/TAGGING.md → gcp/ README labeling notes",
  },
};

export type TaggingGuidanceProps = {
  provider: CloudProvider;
};

export function TaggingGuidance({ provider }: TaggingGuidanceProps) {
  const g = TAGGING_GUIDANCE[provider];
  return (
    <section
      data-testid="tagging-guidance"
      aria-labelledby="tagging-guidance-heading"
    >
      <h3 id="tagging-guidance-heading">{g.title}</h3>
      <ul>
        {g.patterns.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {g.tfCite ? (
        <p data-testid="tagging-tf-cite" className="muted">
          Source note: {g.tfCite}
        </p>
      ) : null}
    </section>
  );
}
