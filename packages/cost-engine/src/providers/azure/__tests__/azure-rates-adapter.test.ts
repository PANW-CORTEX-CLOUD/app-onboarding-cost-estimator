/**
 * Package 31/33 audit follow-up — Azure Retail Prices SKU/tier disambiguation.
 *
 * Regression coverage for an EDGE bug found during the Azure pricing audit:
 * `parseAzureRetailPrices` used to pick `items.find`'s first meterName-substring
 * hit, which is order-dependent and ambiguous for real Retail Prices API
 * responses (Basic vs Standard Event Hubs Throughput Unit share a substring;
 * several Managed Disk/Blob SKUs share "LRS Snapshots" / "Hot LRS Data Stored").
 * Fixtures below mirror real API shapes captured live 2026-08 (see
 * azure-rates-adapter.ts `parseAzureRetailPrices` EDGE doc).
 */
import { describe, expect, it } from "vitest";
import {
  AZURE_METER_NAME_HINTS,
  buildAzureRetailFilter,
  parseAzureRetailPrices,
  type AzureRetailItem,
} from "../azure-rates-adapter.ts";

/** Basic + Standard Event Hubs Throughput Unit — both match a bare "Throughput Unit" substring. */
const EH_TU_ITEMS: AzureRetailItem[] = [
  {
    meterName: "Standard Throughput Unit",
    retailPrice: 0.03,
    currencyCode: "USD",
    productName: "Event Hubs",
    skuName: "Standard",
    tierMinimumUnits: 0,
  },
  {
    meterName: "Basic Throughput Unit",
    retailPrice: 0.015,
    currencyCode: "USD",
    productName: "Event Hubs",
    skuName: "Basic",
    tierMinimumUnits: 0,
  },
];

/** Basic + Standard Event Hubs Ingress Events. */
const EH_INGRESS_ITEMS: AzureRetailItem[] = [
  {
    meterName: "Basic Ingress Events",
    retailPrice: 0.028,
    currencyCode: "USD",
    productName: "Event Hubs",
    skuName: "Basic",
    tierMinimumUnits: 0,
  },
  {
    meterName: "Standard Ingress Events",
    retailPrice: 0.028,
    currencyCode: "USD",
    productName: "Event Hubs",
    skuName: "Standard",
    tierMinimumUnits: 0,
  },
];

/** Blob Storage Hot LRS at 3 tiers + unrelated products sharing the same meterName. */
const BLOB_HOT_LRS_ITEMS: AzureRetailItem[] = [
  {
    meterName: "Hot LRS Data Stored",
    retailPrice: 0.019136,
    currencyCode: "USD",
    productName: "Blob Storage",
    skuName: "Hot LRS",
    tierMinimumUnits: 512_000,
  },
  {
    meterName: "Hot LRS Data Stored",
    retailPrice: 0.0287,
    currencyCode: "USD",
    productName: "Files v2",
    skuName: "Hot LRS",
    tierMinimumUnits: 0,
  },
  {
    meterName: "Hot LRS Data Stored",
    retailPrice: 0.0208,
    currencyCode: "USD",
    productName: "Blob Storage",
    skuName: "Hot LRS",
    tierMinimumUnits: 0,
  },
  {
    meterName: "Hot LRS Data Stored",
    retailPrice: 0.019968,
    currencyCode: "USD",
    productName: "Blob Storage",
    skuName: "Hot LRS",
    tierMinimumUnits: 51_200,
  },
];

/** Managed Disk / Files / Page Blob snapshot SKUs sharing "LRS Snapshots". */
const MANAGED_DISK_SNAPSHOT_ITEMS: AzureRetailItem[] = [
  {
    meterName: "Snapshots LRS Snapshots",
    retailPrice: 0.132,
    currencyCode: "USD",
    productName: "Standard SSD Managed Disks",
    tierMinimumUnits: 0,
  },
  {
    meterName: "Premium LRS Snapshots",
    retailPrice: 0.136,
    currencyCode: "USD",
    productName: "Premium Files",
    tierMinimumUnits: 0,
  },
  {
    meterName: "LRS Snapshots",
    retailPrice: 0.05,
    currencyCode: "USD",
    productName: "Standard HDD Managed Disks",
    tierMinimumUnits: 0,
  },
  {
    meterName: "LRS Snapshots",
    retailPrice: 0.132,
    currencyCode: "USD",
    productName: "Premium Page Blob",
    tierMinimumUnits: 0,
  },
  {
    meterName: "LRS Snapshots",
    retailPrice: 0.132,
    currencyCode: "USD",
    productName: "Premium SSD Managed Disks",
    tierMinimumUnits: 0,
  },
];

describe("azure-rates-adapter — currency must be stated, not assumed (REQ-23)", () => {
  it("skips an item that states no currencyCode instead of pricing it as USD", () => {
    const parsed = parseAzureRetailPrices({
      Items: [
        {
          meterName: "Standard Throughput Unit",
          retailPrice: 0.03,
          productName: "Event Hubs",
          tierMinimumUnits: 0,
          // currencyCode deliberately absent: every documented Retail Prices item
          // carries it, so its absence is a response we did not understand.
        },
      ],
    });
    expect(parsed.unitPrices["eh-standard-tu"]).toBeUndefined();
    expect(parsed.warnings.join(" ")).toMatch(/no currency stated/);
  });

  it("still prices an item that states USD", () => {
    const parsed = parseAzureRetailPrices({
      Items: [
        {
          meterName: "Standard Throughput Unit",
          retailPrice: 0.03,
          currencyCode: "USD",
          productName: "Event Hubs",
          tierMinimumUnits: 0,
        },
      ],
    });
    expect(parsed.unitPrices["eh-standard-tu"]).toBe(0.03);
  });

  it("still declines a stated non-USD currency, and says so differently", () => {
    const parsed = parseAzureRetailPrices({
      Items: [
        {
          meterName: "Standard Throughput Unit",
          retailPrice: 0.028,
          currencyCode: "EUR",
          productName: "Event Hubs",
          tierMinimumUnits: 0,
        },
      ],
    });
    expect(parsed.unitPrices["eh-standard-tu"]).toBeUndefined();
    expect(parsed.warnings.join(" ")).toMatch(/non-USD/);
    expect(parsed.warnings.join(" ")).not.toMatch(/no currency stated/);
  });
});

describe("azure-rates-adapter — SKU/tier disambiguation (EDGE regression)", () => {
  it("picks Standard (not Basic) Throughput Unit regardless of Items order", () => {
    for (const items of [EH_TU_ITEMS, [...EH_TU_ITEMS].reverse()]) {
      const parsed = parseAzureRetailPrices({ Items: items });
      expect(parsed.unitPrices["eh-standard-tu"]).toBe(0.03);
    }
  });

  it("picks Standard (not Basic) Ingress Events regardless of Items order", () => {
    for (const items of [EH_INGRESS_ITEMS, [...EH_INGRESS_ITEMS].reverse()]) {
      const parsed = parseAzureRetailPrices({ Items: items });
      expect(parsed.unitPrices["eh-standard-ingress-events"]).toBe(0.028);
    }
  });

  it("picks Blob Storage base-tier Hot LRS, not Files v2 or a higher tier, regardless of order", () => {
    for (const items of [
      BLOB_HOT_LRS_ITEMS,
      [...BLOB_HOT_LRS_ITEMS].reverse(),
    ]) {
      const parsed = parseAzureRetailPrices({ Items: items });
      expect(parsed.unitPrices["blob-hot-lrs-capacity"]).toBe(0.0208);
    }
  });

  it("picks Standard HDD Managed Disks snapshot rate, not SSD/Premium/Files variants", () => {
    for (const items of [
      MANAGED_DISK_SNAPSHOT_ITEMS,
      [...MANAGED_DISK_SNAPSHOT_ITEMS].reverse(),
    ]) {
      const parsed = parseAzureRetailPrices({ Items: items });
      expect(parsed.unitPrices["managed-disk-snapshot"]).toBe(0.05);
    }
  });

  it("falls back to meterName-only match when candidates carry no skuName/productName (mock compatibility)", () => {
    const parsed = parseAzureRetailPrices({
      Items: [
        { meterName: "Throughput Unit", retailPrice: 0.031, currencyCode: "USD" },
        { meterName: "Ingress Events", retailPrice: 0.029, currencyCode: "USD" },
      ],
    });
    expect(parsed.unitPrices["eh-standard-tu"]).toBe(0.031);
    expect(parsed.unitPrices["eh-standard-ingress-events"]).toBe(0.029);
  });

  it("all four meters resolve together from one combined, realistic Items list", () => {
    const parsed = parseAzureRetailPrices({
      Items: [
        ...EH_TU_ITEMS,
        ...EH_INGRESS_ITEMS,
        ...BLOB_HOT_LRS_ITEMS,
        ...MANAGED_DISK_SNAPSHOT_ITEMS,
      ],
    });
    expect(parsed.unitPrices).toEqual({
      "eh-standard-tu": 0.03,
      "eh-standard-ingress-events": 0.028,
      "blob-hot-lrs-capacity": 0.0208,
      "managed-disk-snapshot": 0.05,
    });
  });
});

describe("azure-rates-adapter — live query scope (EDGE regression)", () => {
  it("filter covers every hinted serviceName and meterName (was Event Hubs-only)", () => {
    const filter = buildAzureRetailFilter("eastus");
    expect(filter).toContain("armRegionName eq 'eastus'");
    for (const hint of Object.values(AZURE_METER_NAME_HINTS)) {
      expect(filter).toContain(`serviceName eq '${hint.serviceName}'`);
      expect(filter).toContain(`contains(meterName, '${hint.meterName}')`);
    }
    // The original bug: Storage-service meters (blob/managed-disk) were
    // structurally unreachable because the filter hardcoded Event Hubs only.
    expect(filter).toContain("serviceName eq 'Storage'");
  });
});
