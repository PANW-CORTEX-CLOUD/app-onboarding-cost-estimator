# AWS connector IaC (stub)

No Terraform inventory is present yet for AWS Cortex onboarding.

- Planned root: `aws/` (this directory)
- Cost estimator defaults (until real TF exists): Kinesis Data Streams (+ SQS alternate), S3 Standard audit store, region `us-east-1`
- Meter map SSOT: `packages/cost-engine/src/providers/aws/capability-meter-map.ts`
- Research: `docs/CLOUD_COST_MODEL.md`
