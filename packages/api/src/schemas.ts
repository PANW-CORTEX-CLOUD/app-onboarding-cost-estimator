/**
 * Zod request schemas mirroring openapi/openapi.yaml (additionalProperties: false).
 */
import { z } from "zod";
import { PROJECTION_MAX_MONTHS } from "@cloud-connector/cost-engine";

export const CloudProviderSchema = z.enum(["azure", "aws", "gcp"]);

export const CreateEstimateRequestSchema = z
  .object({
    provider: CloudProviderSchema,
    region: z.string().min(1),
    capabilities: z
      .object({
        discovery: z.boolean().optional(),
        auditLogs: z.boolean().optional(),
        adsCloud: z.boolean().optional(),
        adsOutpost: z.boolean().optional(),
        dspm: z.boolean().optional(),
        registry: z.boolean().optional(),
        serverless: z.boolean().optional(),
        egress: z.boolean().optional(),
      })
      .strict(),
    volume: z
      .object({
        // `nonnegative()` owns the bounds check here (no negative volumes). The
        // absent-vs-zero distinction is deliberately NOT enforced at this layer:
        // Zod's `.optional()` cannot distinguish a missing key from an explicit
        // `undefined` (colinhacks/zod#1628), and the rule that actually matters —
        // "if capability X is enabled, its sizing drivers must be present" — is a
        // cross-field dependency keyed on the capability→driver map. Encoding it
        // in a `.superRefine()` would duplicate that map into a second source of
        // truth and invite exactly the drift this repo keeps removing. The engine
        // owns the map and enforces the rule once, for every caller, in
        // cost-engine/providers/capability-drivers.ts (REQ-6/REQ-6.2); the API
        // surfaces its throw as a 400.
        accountCount: z.number().nonnegative().optional(),
        monthlyActiveUsers: z.number().nonnegative().optional(),
        logIntensity: z.enum(["low", "medium", "high"]).optional(),
        ingressGBPerDay: z.number().nonnegative().optional(),
        peakMBps: z.number().nonnegative().optional(),
        peakEventsPerSec: z.number().nonnegative().optional(),
        byoManagedStream: z.boolean().optional(),
        avgStoredGB: z.number().nonnegative().optional(),
        vmCount: z.number().nonnegative().optional(),
        avgUsedDiskGB: z.number().nonnegative().optional(),
        scansPerMonth: z.number().nonnegative().optional(),
        dataEstateGB: z.number().nonnegative().optional(),
        pctScanned: z.number().nonnegative().optional(),
        imageCount: z.number().nonnegative().optional(),
        avgImageGB: z.number().nonnegative().optional(),
        crossRegionPull: z.boolean().optional(),
        packageCount: z.number().nonnegative().optional(),
        egressGB: z.number().nonnegative().optional(),
        overrideStreamMetrics: z.boolean().optional(),
        assumedEventBytes: z.number().positive().optional(),
        avgObjectSizeMB: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    monthHours: z.number().positive().optional(),
    /** as-deployed restricts pricing to what the connector Terraform creates. */
    tfMode: z.enum(["as-deployed", "what-if"]).optional(),
  })
  .strict();

export const CreateProjectionRequestSchema = z
  .object({
    monthlyExpected: z.number().nonnegative(),
    months: z.number().int().min(1).max(PROJECTION_MAX_MONTHS),
    annualGrowthPercent: z.number().optional(),
    provider: CloudProviderSchema.optional(),
    monthlyLow: z.number().nonnegative().optional(),
    monthlyHigh: z.number().nonnegative().optional(),
    lineItems: z
      .array(
        z
          .object({
            provider: z.string().min(1),
            capability: z.string().min(1),
            meterId: z.string().min(1),
            amount: z.number(),
            confidence: z.enum(["High", "Med", "Low"]),
            volumeElastic: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const RefreshRatesRequestSchema = z
  .object({
    provider: CloudProviderSchema,
    region: z.string().min(1),
    forceLive: z.boolean().optional(),
  })
  .strict();

/**
 * Freeze takes the same inputs as an estimate — the server re-runs it and
 * pins the card it actually priced with, rather than trusting a client to
 * echo back totals it could have edited.
 */
export const FreezeEstimateRequestSchema = CreateEstimateRequestSchema.extend({
  /** Required when rates are critically stale (@see core/rate-pinning.ts). */
  ackCriticalStale: z.boolean().optional(),
}).strict();

/**
 * Reload accepts the frozen payload verbatim. Its shape is validated by the
 * engine's own `validateExportSchema` rather than mirrored into zod here —
 * duplicating that contract is exactly the drift this repo keeps finding
 * (@see docs/IMPROVEMENT_PLAN.md REQ-13).
 */
export const ReloadFrozenEstimateRequestSchema = z
  .object({
    payload: z.unknown(),
    requireCurrentModelVersion: z.boolean().optional(),
  })
  .strict();
