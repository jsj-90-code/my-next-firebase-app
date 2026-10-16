import { describe, expect, it } from "vitest";
import { computeProfitLoss } from "./profitLoss";
import { defaultModelSettings } from "./settings";

const settings = defaultModelSettings().profitLoss;

describe("computeProfitLoss", () => {
  it("부가세 포함 예상매출을 공급가액으로 바꿔 양식 순서대로 뺀다", () => {
    const pl = computeProfitLoss({ revenue: 66_000_000, pcCount: 100, monthlyRent: 2_750_000, monthlyMaintenanceFee: 250_000, settings });
    expect(pl.sales).toBeCloseTo(60_000_000);
    expect(pl.productSales).toBeCloseTo(32_400_000);
    expect(pl.fixedCosts.find((l) => l.key === "labor")!.amount).toBeCloseTo(11_240_000); // 500만 + 6,000만 × 10.4%
    expect(pl.totalCost).toBeCloseTo(38_946_000);
    expect(pl.netProfit).toBeCloseTo(21_054_000);
    expect(pl.laborFloorApplied).toBe(false);
    expect(pl.rentMissing).toBe(false);
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
