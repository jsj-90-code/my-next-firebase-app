import type { ExistingStoreMonthlySales } from "./types";

export function salesBreakdown(row: Pick<ExistingStoreMonthlySales, "pcSales" | "productSales">) {
  const valid = (value: number | null): value is number => value != null && Number.isFinite(value) && value >= 0;
  const pc = valid(row.pcSales) ? row.pcSales : null;
  const product = valid(row.productSales) ? row.productSales : null;
  const total = pc != null && product != null ? pc + product : null;
  return { pc, product, total, productShare: total != null && total > 0 ? product! / total : null };
}

/** Use the same complete, elapsed months for both component averages. */
export function summarizeSales(rows: ExistingStoreMonthlySales[], currentMonth: string) {
  const complete = rows.filter(row => /^\d{4}-(0[1-9]|1[0-2])$/.test(row.yearMonth) && row.yearMonth < currentMonth)
    .map(salesBreakdown).filter(row => row.total != null);
  const pcTotal = complete.reduce((sum, row) => sum + row.pc!, 0);
  const productTotal = complete.reduce((sum, row) => sum + row.product!, 0);
  const total = pcTotal + productTotal;
  return {
    count: complete.length,
    pcAvg: complete.length ? pcTotal / complete.length : null,
    productAvg: complete.length ? productTotal / complete.length : null,
    totalAvg: complete.length ? total / complete.length : null,
    productShare: total > 0 ? productTotal / total : null,
  };
}
