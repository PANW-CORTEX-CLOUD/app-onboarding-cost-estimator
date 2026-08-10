import { defineConfig } from "vitest/config";

/**
 * Vitest projects: core + per-provider suites (package 03 AC/TEST).
 */
export default defineConfig({
  test: {
    testTimeout: 60_000,
    fileParallelism: false,
    maxWorkers: 1,
    projects: [
      {
        test: {
          name: "core",
          include: ["src/core/**/*.test.ts", "src/core/__tests__/**/*.ts"],
        },
      },
      {
        test: {
          name: "azure",
          include: [
            "src/providers/azure/**/*.test.ts",
            "src/providers/__tests__/capability-meter-map.test.ts",
            "src/providers/__tests__/create-estimate-mvp.test.ts",
            "src/providers/__tests__/tf-audit-reconciliation.test.ts",
            "src/providers/__tests__/tf-vs-retail-audit.test.ts",
          ],
        },
      },
      {
        test: {
          name: "aws",
          include: ["src/providers/aws/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "gcp",
          include: ["src/providers/gcp/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "rates",
          include: ["src/providers/rates/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "streams",
          include: ["src/providers/streams/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "storage",
          include: ["src/providers/storage/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "ads",
          include: ["src/providers/ads/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "dspm",
          include: ["src/providers/dspm/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "registry-serverless",
          include: ["src/providers/registry-serverless/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "egress",
          include: ["src/providers/egress/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "formula-regression",
          include: ["src/providers/formula-regression/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "monorepo",
          include: [
            "src/__tests__/monorepo.test.ts",
            "src/__tests__/edge-plus-hardening.test.ts",
            "src/__tests__/edge-plus-meta.test.ts",
          ],
        },
      },
    ],
  },
});
