import { describe, expect, it } from "vitest";
import { computeProfitLoss } from "./profitLoss";
import { defaultModelSettings } from "./settings";

const settings = defaultModelSettings().profitLoss;

describe("computeProfitLoss", () => {
  it("부가세 포함 금액 그대로(vatDivisor 1) 양식 순서대로 뺀다", () => {
    const pl = computeProfitLoss({ revenue: 66_000_000, pcCount: 100, monthlyRent: 2_750_000, monthlyMaintenanceFee: 250_000, settings });
    expect(pl.sales).toBe(66_000_000);
    expect(pl.productSales).toBeCloseTo(35_640_000);
    expect(pl.fixedCosts.find((l) => l.key === "labor")!.amount).toBeCloseTo(11_237_000); // 500만 + 6,600만 × 9.45%
    expect(pl.fixedCosts.find((l) => l.key === "rent")!.amount).toBe(2_750_000);
    expect(pl.totalCost).toBeCloseTo(41_958_600, -1);
    expect(pl.netProfit).toBeCloseTo(pl.sales - pl.totalCost);
    expect(pl.laborFloorApplied).toBe(false);
    expect(pl.rentMissing).toBe(false);
  });

  it("vatDivisor 1.1이면 매출·임대료를 공급가액으로 나눈다", () => {
    const pl = computeProfitLoss({ revenue: 66_000_000, pcCount: 100, monthlyRent: 2_750_000, monthlyMaintenanceFee: 0, settings: { ...settings, vatDivisor: 1.1 } });
    expect(pl.sales).toBeCloseTo(60_000_000);
    expect(pl.fixedCosts.find((l) => l.key === "rent")!.amount).toBeCloseTo(2_500_000);
  });

  it("매출이 낮으면 인건비는 하한으로 잡는다", () => {
    const pl = computeProfitLoss({ revenue: 11_000_000, pcCount: 80, monthlyRent: 2_000_000, monthlyMaintenanceFee: 0, settings });
    expect(pl.laborFloorApplied).toBe(true);
    expect(pl.fixedCosts.find((l) => l.key === "labor")!.amount).toBe(settings.laborFloor);
  });

  it("임대료가 비면 0으로 계산하고 표시한다", () => {
    const pl = computeProfitLoss({ revenue: 55_000_000, pcCount: 100, monthlyRent: null, monthlyMaintenanceFee: null, settings });
    expect(pl.rentMissing).toBe(true);
    expect(pl.fixedCosts.find((l) => l.key === "rent")!.amount).toBe(0);
  });
});
