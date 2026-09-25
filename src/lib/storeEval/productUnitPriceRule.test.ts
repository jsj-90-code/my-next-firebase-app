// 상품몫 규칙(직전 18개월 개점 매장의 실측 중앙) — 규칙 자체의 산수와, 코드 상수가 규칙값에서 벗어났는지 보는 파수꾼 (2026-09-25).
// 스냅샷이 있으면 상수 vs 규칙값 3% 관문을 돌린다. 빨강이면 "상수를 옮길 때"라는 뜻이지 버그가 아니다 — labInput PRODUCT_UNIT_PRICE_RULE 주석.

import { describe, expect, it } from "vitest";
import { PRODUCT_UNIT_PRICE_RULE, productUnitPriceByRule, productUnitPriceOfStore } from "./labInput";
import { DEFAULT_TEXTBOOK_PARAMS } from "./textbookModel";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";

type Sale = { storeCode: string; yearMonth: string; pcSales?: number | null; productSales?: number | null; utilizationRate?: number | null };
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
/** 개점 다음 달부터 n달, 시간당 상품단가 unit원이 되도록 매출을 만든다(PC 100대 · 가동률 0.3). */
function fakeStore(code: string, openedAt: string, unit: number, months: number, firstMonthUnit = unit): { store: { storeCode: string; storeName: string; openedAt: string; pcCount: number }; sales: Sale[] } {
  const [y, m] = openedAt.split("-").map(Number);
  const sales: Sale[] = [];
  for (let i = 1; i <= months; i++) {
    const idx = y * 12 + (m - 1) + i; const yy = Math.floor(idx / 12), mm = (idx % 12) + 1;
    const hours = 100 * 720 * 0.3;
    sales.push({ storeCode: code, yearMonth: ym(yy, mm), pcSales: hours * 1300, productSales: hours * (i === 1 ? firstMonthUnit : unit), utilizationRate: 0.3 });
  }
  return { store: { storeCode: code, storeName: code, openedAt, pcCount: 100 }, sales };
}

describe("상품몫 규칙 — 산수", () => {
  it("매장 단가는 2~12개월차 Σ÷Σ이고 첫 달은 뺀다", () => {
    const a = fakeStore("A", "2025-01-10", 1500, 6, 9999);
    const r = productUnitPriceOfStore(a.sales, a.store);
    expect(r?.months).toBe(5);
    expect(r?.unit).toBeCloseTo(1500, 6);
  });
  it("2개월차 이후가 없으면 1개월차라도 쓴다", () => {
    const a = fakeStore("A", "2026-07-10", 1500, 1, 1800);
    expect(productUnitPriceOfStore(a.sales, a.store)?.unit).toBeCloseTo(1800, 6);
  });
  it("직전 18개월 개점 매장의 중앙을 내고, 기준 시점은 자료의 마지막 달이다", () => {
    const stores = [
      fakeStore("old1", "2023-03-01", 1200, 12), fakeStore("old2", "2023-09-01", 1250, 12), fakeStore("old3", "2024-06-01", 1400, 12),
      ...Array.from({ length: 9 }, (_, i) => fakeStore(`new${i}`, ym(2025, 4 + Math.floor(i / 2)), 1600 + i * 25, 6)), // 2025-04~2025-08 개점 9곳
    ];
    const sales = stores.flatMap((s) => s.sales);
    const r = productUnitPriceByRule(sales, stores.map((s) => s.store));
    expect(r.asOf).toBe(ym(2026, 2)); // 마지막 자료 달: 2025-08 개점 + 6달
    expect(r.windowMonths).toBe(18); // 9곳 ≥ minStores 8 → 안 넓힘
    expect(r.stores.map((s) => s.storeCode).every((c) => c.startsWith("new"))).toBe(true);
    expect(r.value).toBe(1700); // 1600,1625,…,1800의 중앙
  });
  it("표본이 minStores 미만이면 6개월씩 넓힌다", () => {
    const stores = [fakeStore("a", "2024-01-01", 1300, 12), fakeStore("b", "2024-02-01", 1350, 12), fakeStore("c", "2025-06-01", 1700, 6)];
    const r = productUnitPriceByRule(stores.flatMap((s) => s.sales), stores.map((s) => s.store), { ...PRODUCT_UNIT_PRICE_RULE, minStores: 3 });
    expect(r.windowMonths).toBeGreaterThan(18);
    expect(r.stores.length).toBe(3);
    expect(r.value).toBe(1350);
  });
  it("모델 제외 매장은 세지 않는다", () => {
    const a = fakeStore("a", "2025-06-01", 1500, 6), b = fakeStore("b", "2025-07-01", 9000, 6);
    const r = productUnitPriceByRule([...a.sales, ...b.sales], [a.store, { ...b.store, excludedFromModel: true }], { ...PRODUCT_UNIT_PRICE_RULE, minStores: 1 });
    expect(r.value).toBe(1500);
  });
});

const describeIfSnapshot = hasValidationSnapshot() ? describe : describe.skip;
describeIfSnapshot("상품몫 상수 파수꾼 — 코드 상수 vs 지금 자료의 규칙값", () => {
  it("DEFAULT_TEXTBOOK_PARAMS.productUnitPrice가 규칙값의 3% 안에 있다 (빨강 = 상수를 옮길 때)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = loadValidationSnapshot<any>();
    const r = productUnitPriceByRule(snap.sales ?? [], snap.existingStores ?? []);
    const c = DEFAULT_TEXTBOOK_PARAMS.productUnitPrice;
    console.log(`[상품몫 규칙] 기준 ${r.asOf} · 직전 ${r.windowMonths}개월 개점 ${r.stores.length}곳 중앙 ${Math.round(r.value ?? NaN)}원 vs 코드 상수 ${c}원 (${(((c / (r.value ?? NaN)) - 1) * 100).toFixed(1)}%)`);
    console.log(`  ${r.stores.map((s) => `${s.storeName} ${s.openedAt.slice(0, 7)} ${Math.round(s.unit)}(${s.months}달)`).join(" · ")}`);
    expect(r.value).not.toBeNull();
    expect(r.stores.length).toBeGreaterThanOrEqual(PRODUCT_UNIT_PRICE_RULE.minStores);
    expect(Math.abs(c / (r.value as number) - 1)).toBeLessThanOrEqual(0.03);
  });
});
