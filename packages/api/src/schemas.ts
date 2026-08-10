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
        // TODO(REQ-6, docs/IMPROVEMENT_PLAN.md): these are `?? 0`'d together
        // with genuinely-absent fields downstream, collapsing "not provided"
        // and "explicitly zero" into one warning path. nonnegative() here
        // only closes the negative-input gap; it doesn't address that.
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
