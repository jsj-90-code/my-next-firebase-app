import type { ExistingStoreMonthlySales } from "./types";

export function evaluationMonths(openedAt: string | null): string[] {
  const match = openedAt?.match(/^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/);
  if (!match) return [];
  const start = Number(match[1]) * 12 + Number(match[2]) - 1;
  return Array.from({ length: 12 }, (_, index) => {
    const month = start + index + 1;
    return `${Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, "0")}`;
  });
}

export function evaluationSalesIds(stores: { storeCode: string; openedAt: string | null }[]) {
  return [...new Set(stores.flatMap(store => evaluationMonths(store.openedAt).map(month => `${store.storeCode}_${month}`)))];
}

export function filterEvaluationSales(sales: ExistingStoreMonthlySales[], openedAt: string | null) {
  const months = new Set(evaluationMonths(openedAt));
  return sales.filter(row => months.has(row.yearMonth));
}
