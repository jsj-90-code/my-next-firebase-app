import { describe, expect, it } from "vitest";
import { empiricalFeaturesFor, toV61TrainingStore, type ValidationStoreInput } from "./calc";
import { defaultModelSettings } from "./settings";
import type { ExistingStoreMonthlySales } from "./types";
import { attachRevenueParts, buildRevenuePartsByStore, fitUsageRevenueModel, predictUsageRevenue, runUsageCohortValidation } from "./usageRevenue";

const asOf = new Date("2026-09-08T00:00:00Z");
const settings = defaultModelSettings();
settings.v61Training = { ...settings.v61Training, modelVariant: "visibility-inflow", ridgeWeight: 1, baselineWeight: 0 };
const stores: ValidationStoreInput[] = Array.from({ length: 16 }, (_, i) => ({
  storeCode: `S${i}`, storeName: `Store ${i}`, brand: "블랙라벨", openedAt: "2026-01-01", completedMonths: 2,
  franchiseStatus: "정상", isPostOpenIssue: false, postOpenIssueReason: null,
  pcCount: 100 + i, hourlyRate: 1000 + i * 30, ownDemand: 1000, marketDemand: 4000 + i * 50,
  competitorIp: 300, competitivenessScore: 3 + i / 20, competitivenessGap: 1,
  actualRevenueAvg: 40000000 + i * 1000000, visibilityScore: i % 5 + 1,
  inflowRestriction: "강함", hasLocationEvaluation: true,
}));
const sale = (storeCode: string, yearMonth: string, pcSales: number | null, productSales: number | null): ExistingStoreMonthlySales => ({
  storeCode, yearMonth, pcSales, productSales, productRatio: null, utilizationRate: null, salesPerPcPerDay: null,
});
const sales = stores.flatMap(store => ["2026-02", "2026-03"].map(month =>
  sale(store.storeCode, month, store.actualRevenueAvg! * .6, store.actualRevenueAvg! * .4)));

describe("tariff revenue model", () => {
  it("uses completed months and the same stabilized target period, rejecting incomplete components", () => {
    const rows = [sale("S0", "2026-01", 999, 999), sale("S0", "2026-02", 50, 50),
      sale("S0", "2026-03", 70, 30), sale("S0", "2026-09", 999, 999), sale("S0", "2026-13", 999, 999)];
    expect(buildRevenuePartsByStore(stores, rows, asOf).get("S0")).toEqual({ pcRevenueAvg: 70, productRevenueAvg: 30 });
    expect(buildRevenuePartsByStore(stores, [...rows, sale("S0", "2026-04", 40, null)], asOf).has("S0")).toBe(false);
    const parts = buildRevenuePartsByStore(stores, sales, asOf);
    expect(attachRevenueParts(stores.map(store => toV61TrainingStore(store, settings)), parts)).toHaveLength(16);
    expect(attachRevenueParts([{ ...toV61TrainingStore(stores[0], settings), hourlyRate: 0 }], parts)).toHaveLength(0);
    expect(attachRevenueParts([{ ...toV61TrainingStore(stores[0], settings), actualMonthlyRevenueAvg: 1 }], parts)).toHaveLength(0);
  });

  it("changing only tariff scales PC revenue, preserves food and occupied hours, including at capacity", () => {
    const training = attachRevenueParts(stores.map(store => toV61TrainingStore(store, settings)), buildRevenuePartsByStore(stores, sales, asOf));
    const model = fitUsageRevenueModel(training, settings)!;
    expect(model).not.toBeNull();
    for (const cap of [.55, .01]) {
      const config = { ...settings, v62MaxUtilizationRate: cap };
      const features = empiricalFeaturesFor(training[0]);
      const high = predictUsageRevenue(model, features, 100, 1500, config, .8, 100)!;
      const low = predictUsageRevenue(model, [Math.log(1000), ...features.slice(1)], 100, 1000, config, .8, 100)!;
      expect(high).not.toBeNull();
      expect(low.pcHours).toBe(high.pcHours);
      expect(low.productRevenue).toBe(high.productRevenue);
      expect(Math.abs(low.pcRevenue - high.pcRevenue * 2 / 3)).toBeLessThanOrEqual(1);
      expect(low.monthlyRevenue).toBe(low.pcRevenue + low.productRevenue);
      expect(low.monthlyRevenue).toBeLessThan(high.monthlyRevenue);
      if (cap === .01) expect(low.pcHours).toBe(720);
    }
    expect(predictUsageRevenue(model, empiricalFeaturesFor(training[0]), 0, 1000, settings)).toBeNull();
    expect(predictUsageRevenue(model, empiricalFeaturesFor(training[0]), 100, Infinity, settings)).toBeNull();
  });

  it("validation excludes the target from both components and uses the shared predictor", () => {
    const rows = runUsageCohortValidation(stores, sales, settings, asOf).rows;
    const training = attachRevenueParts(stores.slice(1).map(store => toV61TrainingStore(store, settings)), buildRevenuePartsByStore(stores, sales, asOf));
    const model = fitUsageRevenueModel(training, settings)!;
    const expected = predictUsageRevenue(model, empiricalFeaturesFor(toV61TrainingStore(stores[0], settings)), 100, 1000, settings, .8)!;
    expect(rows[0].revenueBreakdown).toEqual(expected);
    expect(rows[0].v62PredictedRevenueAvg).toBe(expected.monthlyRevenue);
    const changedStores = stores.map((store, i) => i === 0 ? { ...store, actualRevenueAvg: store.actualRevenueAvg! * 3 } : store);
    const changedSales = sales.map(row => row.storeCode === "S0" ? { ...row, pcSales: row.pcSales! * 3, productSales: row.productSales! * 3 } : row);
    expect(runUsageCohortValidation(changedStores, changedSales, settings, asOf).rows[0].revenueBreakdown).toEqual(expected);
  });

  it("never replaces a failed split prediction with the legacy total-revenue model", () => {
    const rows = runUsageCohortValidation(stores, [], settings, asOf).rows;
    expect(rows.every(row => row.v62PredictedRevenueAvg === null && !row.includedInCoreAccuracy)).toBe(true);
  });

  it("carries nonzero overflow through validation for both held-out and external targets", () => {
    const config = { ...settings, v62MaxUtilizationRate: .01 };
    const external = { ...stores[0], storeCode: "external", isPostOpenIssue: true };
    const targets = [...stores, external].map(store => ({ ...store, extraPcHours: 500 }));
    const actual = runUsageCohortValidation(targets, sales, config, asOf).rows;
    const withoutOverflow = runUsageCohortValidation([...stores, external], sales, config, asOf).rows;
    for (const code of ["S0", "external"]) {
      const row = actual.find(row => row.storeCode === code)!;
      const before = withoutOverflow.find(row => row.storeCode === code)!.revenueBreakdown!;
      const result = row.revenueBreakdown!;
      expect(result).toBeDefined();
      expect(result.uncappedPcHours - before.uncappedPcHours).toBeCloseTo(500, 8);
      expect(result.capacityCapped).toBe(true);
      expect(result.pcHours).toBe(720);
      expect(result.pcRevenue).toBe(before.pcRevenue);
      expect(result.productRevenue).toBeGreaterThan(before.productRevenue);
      expect(result.overflowRevenue).toBeGreaterThan(500 * row.hourlyRate!);
      expect(row.v62PredictedRevenueAvg).toBe(result.pcRevenue + result.productRevenue);
      expect(row.includedInCoreAccuracy).toBe(code === "S0");
      expect(result.sampleCount).toBe(code === "S0" ? 15 : 16);
    }
  });
});
