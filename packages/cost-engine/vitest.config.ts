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
          include: ["src/providers/azure/**/*.test.ts"],
        },
      },
      {
        test: {
          // Cross-provider tests that don't belong to one cloud. This project
          // GLOBS the directory rather than listing files by name: a shared
          // test dropped in here that no project matched would run nowhere and
          // report nothing — passing `pnpm test` while testing zero of its
          // assertions. test-discovery.test.ts asserts every physical file in
          // this dir is discovered, so a future config regression fails loudly.
          name: "providers-shared",
          include: ["src/providers/__tests__/**/*.test.ts"],
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
          // Same rule as providers-shared: glob the directory so a new
          // top-level test file can't silently no-op. edge-plus-meta.test.ts
          // guards the discovery.
          name: "monorepo",
          include: ["src/__tests__/**/*.test.ts"],
        },
      },
    ],
  },
});
