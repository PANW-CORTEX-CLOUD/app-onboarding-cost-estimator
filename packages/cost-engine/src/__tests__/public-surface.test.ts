/**
 * REQ-8 — the public surface should be the surface we mean.
 *
 * The starting observation was "53 symbols are exported but used only in their
 * own file". Investigating it showed that is not one problem but three, and
 * only one of them is a defect:
 *
 *   A. Types appearing in exported signatures. Public by construction — a
 *      consumer cannot name `priceQuantity`'s return type otherwise.
 *   B. Domain constants that are the package's vocabulary (formula bindings,
 *      redundancy allowlists). Some were exported from the index and their
 *      siblings were not, which is an incoherent surface rather than a large
 *      one. Fixed by exporting the siblings, not by hiding the originals.
 *   C. Genuine internals — a query URL used only by its own adapter, a cache
 *      entry shape. Those lost their `export`.
 *
 * This test guards B: a constant that documents a formula binding must be
 * reachable from the package entry point, so the next reader finds the whole
 * set rather than the half that happened to be exported.
 */
import { describe, expect, it } from "vitest";
import * as engine from "../index.ts";

describe("formula bindings are reachable as a complete set", () => {
  it("Azure Event Hubs sizing constants", () => {
    for (const name of [
      "AZURE_EH_MBPS_PER_TU",
      "AZURE_EH_EPS_PER_TU",
      "AZURE_EH_INCLUDED_GB_PER_TU",
      "AZURE_EH_MIN_TU",
      "AZURE_EH_INGRESS_EVENT_CHUNK_BYTES",
    ]) {
      expect(engine, `${name} must be part of the package surface`).toHaveProperty(name);
    }
  });

  it("AWS Kinesis sizing constants", () => {
    for (const name of [
      "AWS_KINESIS_MBPS_PER_SHARD",
      "AWS_KINESIS_EPS_PER_SHARD",
      "AWS_KINESIS_PUT_PAYLOAD_KB",
      "AWS_KINESIS_MIN_SHARDS",
    ]) {
      expect(engine, `${name} must be part of the package surface`).toHaveProperty(name);
    }
  });

  it("audit-storage meters and redundancy allowlists, for all three providers", () => {
    for (const p of ["AZURE", "AWS", "GCP"]) {
      for (const suffix of [
        "_AUDIT_CAPACITY_METER",
        "_AUDIT_WRITE_OPS_METER",
        "_AUDIT_READ_OPS_METER",
        "_ALLOWED_REDUNDANCY",
      ]) {
        expect(engine, `${p}${suffix} missing`).toHaveProperty(`${p}${suffix}`);
      }
    }
  });

  it("the documented Kinesis payload constant matches OFFICIAL_FORMULA_CHECKS", () => {
    // 25 KB per PUT payload unit is a cited binding, not an implementation detail.
    expect(engine.AWS_KINESIS_PUT_PAYLOAD_KB).toBe(25);
    expect(engine.AWS_KINESIS_MIN_SHARDS).toBe(1);
    expect(engine.AZURE_EH_MIN_TU).toBe(1);
  });
});

describe("genuine internals stay internal", () => {
  it("adapter query URLs are not part of the surface", () => {
    // These are how an adapter talks to a vendor, not something a consumer
    // should reach for; the refresh path is `pnpm rates:validate`.
    expect(engine).not.toHaveProperty("AZURE_RETAIL_PRICES_QUERY_URL");
    expect(engine).not.toHaveProperty("GCP_BILLING_CATALOG_QUERY_URL");
  });
});
