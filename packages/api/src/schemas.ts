/**
 * Zod request schemas mirroring openapi/openapi.yaml (additionalProperties: false).
 */
import { z } from "zod";

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
        accountCount: z.number().optional(),
        monthlyActiveUsers: z.number().optional(),
        logIntensity: z.enum(["low", "medium", "high"]).optional(),
        ingressGBPerDay: z.number().optional(),
        peakMBps: z.number().optional(),
        peakEventsPerSec: z.number().optional(),
        byoManagedStream: z.boolean().optional(),
        avgStoredGB: z.number().optional(),
        vmCount: z.number().optional(),
        avgUsedDiskGB: z.number().optional(),
        scansPerMonth: z.number().optional(),
        dataEstateGB: z.number().optional(),
        pctScanned: z.number().optional(),
        imageCount: z.number().optional(),
        avgImageGB: z.number().optional(),
        packageCount: z.number().optional(),
        egressGB: z.number().optional(),
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
    months: z.number().int().min(1).max(36),
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
