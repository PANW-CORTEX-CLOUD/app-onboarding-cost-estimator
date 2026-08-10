# Cost-allocation tagging guidance

Estimator UI surfaces these patterns (package 22). Terraform inventory under `azure/`, `aws/`, and `gcp/` (when present in the wider Cortex onboarding tree) is **read-only reference** — the estimator never mutates cloud resources.

## Azure

- Resource groups: `cortex-onboarding-*`
- Tag: `managed_by=paloaltonetworks`
- Prefer Cost Management + tag inheritance for allocation filters

**TF cite:** Azure data / inventory modules that emit `managed_by` and onboarding RG naming (see Cortex onboarding `azure/data` inventory).

## AWS

- Tag: `ManagedBy=PaloAltoNetworks` (activate as a cost allocation tag)
- Optional: `CortexCloud=true` for filterable spend

**TF cite:** AWS README tagging notes in the onboarding inventory.

## GCP

- Labels: `managed_by=paloaltonetworks`, `cortex_cloud=true`
- Filter BigQuery billing export on those labels

**TF cite:** GCP README labeling notes in the onboarding inventory.
