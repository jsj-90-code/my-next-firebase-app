import { expect, it } from "vitest";
import { runUsageCohortValidation } from "./usageRevenue";
import { defaultModelSettings } from "./settings";
import type { ValidationStoreInput } from "./calc";
import type { ExistingStoreMonthlySales } from "./types";

it("exposes only components matching the validation actual total and its existing average window", () => {
  const store = { storeCode: "A", openedAt: "2026-01-01", actualRevenueAvg: 100, completedMonths: 2 } as ValidationStoreInput;
  const sales = [
    { storeCode: "A", yearMonth: "2026-02", pcSales: 999, productSales: 999 },
    { storeCode: "A", yearMonth: "2026-03", pcSales: 48, productSales: 52 },
  ] as ExistingStoreMonthlySales[];
  const run = (actualRevenueAvg: number) => runUsageCohortValidation([{ ...store, actualRevenueAvg }], sales, defaultModelSettings(), new Date("2026-09-01")).rows[0];
  expect(run(100).actualRevenueBreakdown).toEqual({ pcRevenueAvg: 48, productRevenueAvg: 52 });
  expect(run(500).actualRevenueBreakdown).toBeUndefined();
});
