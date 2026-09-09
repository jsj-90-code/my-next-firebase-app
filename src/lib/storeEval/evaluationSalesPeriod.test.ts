import { expect, it } from "vitest";
import { evaluationMonths, evaluationSalesIds, filterEvaluationSales } from "./evaluationSalesPeriod";
import type { ExistingStoreMonthlySales } from "./types";

it("excludes opening month and includes exactly the next 12 calendar months across years", () => {
  expect(evaluationMonths("2023-07-07")).toEqual(["2023-08", "2023-09", "2023-10", "2023-11", "2023-12", "2024-01", "2024-02", "2024-03", "2024-04", "2024-05", "2024-06", "2024-07"]);
  expect(evaluationMonths("2025-12-31")[0]).toBe("2026-01");
  expect(evaluationMonths("2025-12-31")[11]).toBe("2026-12");
});
it("does not fall back to full history when opening date is missing or invalid", () => {
  for (const value of [null, "", "2026-13-01", "unknown"]) expect(evaluationMonths(value)).toEqual([]);
  expect(evaluationSalesIds([{ storeCode: "A", openedAt: null }])).toEqual([]);
});
it("creates only canonical evaluation document IDs, deduplicating stores", () => {
  const store = { storeCode: "A", openedAt: "2023-07-07" };
  const ids = evaluationSalesIds([store, store]);
  expect(ids).toHaveLength(12);
  expect(ids[0]).toBe("A_2023-08");
  expect(ids[11]).toBe("A_2024-07");
});
it("discards opening month and month 13 while keeping months 1 and 12", () => {
  const sales = ["2023-07", "2023-08", "2024-07", "2024-08"].map(yearMonth => ({ yearMonth })) as ExistingStoreMonthlySales[];
  expect(filterEvaluationSales(sales, "2023-07-07").map(row => row.yearMonth)).toEqual(["2023-08", "2024-07"]);
});
