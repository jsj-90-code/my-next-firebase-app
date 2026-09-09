import { describe, expect, it } from "vitest";
import { salesBreakdown, summarizeSales } from "./salesBreakdown";
import type { ExistingStoreMonthlySales } from "./types";

const row = (yearMonth: string, pcSales: number | null, productSales: number | null): ExistingStoreMonthlySales => ({
  storeCode: "test", yearMonth, pcSales, productSales, productRatio: .99, utilizationRate: null, salesPerPcPerDay: null,
});

describe("sales breakdown", () => {
  it("computes share from amounts, not the differently defined stored ratio", () => {
    expect(salesBreakdown(row("2026-08", 48, 52))).toEqual({ pc: 48, product: 52, total: 100, productShare: .52 });
  });
  it("keeps missing and invalid values distinct from zero", () => {
    for (const missing of [null, NaN, Infinity, -1]) {
      expect(salesBreakdown(row("2026-08", missing, 52))).toEqual({ pc: null, product: 52, total: null, productShare: null });
    }
    expect(salesBreakdown(row("2026-08", 0, 0)).productShare).toBeNull();
    expect(salesBreakdown(row("2026-08", 0, 52)).productShare).toBe(1);
  });
  it("uses matched complete past months and weighted period share", () => {
    const summary = summarizeSales([
      row("2026-07", 90, 10), row("2026-08", 10, 30), row("2026-06", null, 100),
      row("2026-09", 1, 99), row("2026-10", 1, 99), row("bad", 1, 99),
    ], "2026-09");
    expect(summary).toEqual({ count: 2, pcAvg: 50, productAvg: 20, totalAvg: 70, productShare: 40 / 140 });
  });
  it("does not invent a summary without records", () => {
    expect(summarizeSales([], "2026-09")).toEqual({ count: 0, pcAvg: null, productAvg: null, totalAvg: null, productShare: null });
  });
});
