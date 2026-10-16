// 신규 후보지 예상 손익(2026-10-16 사용자 지시: "점포평가할 때 손익 계산까지 함께").
// 예상월매출(V62·실험실·담당자 판단 — 매출DB와 같은 부가세 포함 결제총액)을 공급가액으로 바꾼 뒤
// 재경 운영수익 양식 순서대로 비용을 뺀다. 임대료·관리비는 후보지마다(다우 심사글), 나머지는
// settings.profitLoss 표준값(기존점 14곳 중앙, 근거는 settings.ts 주석).
import type { ProfitLossSettings } from "./types";

export type ProfitLossLine = { key: string; label: string; amount: number; basis: string };

export type ProfitLoss = {
  sales: number; // 공급가액 매출
  pcSales: number;
  productSales: number;
  costOfSales: ProfitLossLine[]; // 매출원가
  fixedCosts: ProfitLossLine[]; // 고정비(임대료·관리비 포함)
  variableCosts: ProfitLossLine[];
  totalCost: number;
  netProfit: number;
  netMargin: number; // 순손익 ÷ 공급가액 매출
  laborFloorApplied: boolean;
  rentMissing: boolean; // 임대료 칸이 비어 0으로 계산함
};

const pct = (r: number) => `${(r * 100).toFixed(1).replace(/\.0$/, "")}%`;
const manwon = (won: number) => `${Math.round(won / 10_000).toLocaleString("ko-KR")}만원`;

export function computeProfitLoss(input: {
  revenue: number; // 예상월매출(부가세 포함)
  pcCount: number;
  monthlyRent: number | null | undefined;
  monthlyMaintenanceFee: number | null | undefined;
  settings: ProfitLossSettings;
}): ProfitLoss {
  const s = input.settings;
  const sales = input.revenue / s.vatDivisor;
  const productSales = sales * s.productSalesShare;
  const pcSales = sales - productSales;

  const costOfSales: ProfitLossLine[] = [
    { key: "paidGame", label: "유료게임비", amount: sales * s.paidGameRate, basis: `매출의 ${pct(s.paidGameRate)}` },
    { key: "food", label: "식자재 매입", amount: productSales * s.foodCostRate, basis: `상품매출의 ${pct(s.foodCostRate)}` },
  ];

  const laborByRate = s.laborBase + sales * s.laborRate;
  const laborFloorApplied = laborByRate < s.laborFloor;
  const rentMissing = input.monthlyRent == null;
  const fixedCosts: ProfitLossLine[] = [
    { key: "labor", label: "인건비", amount: Math.max(laborByRate, s.laborFloor),
      basis: `기본 ${manwon(s.laborBase)} + 매출의 ${pct(s.laborRate)}, 하한 ${manwon(s.laborFloor)}` },
    // 다우 임대료·관리비는 부가세 포함으로 가정한다(사용자 10-16 "포함이겠지" — 확인된 사실은 아님). 공급가액으로 맞춰 뺀다.
    { key: "rent", label: "임대료", amount: (input.monthlyRent ?? 0) / s.vatDivisor, basis: rentMissing ? "미입력 — 0으로 계산" : `후보지 입력값 ÷ ${s.vatDivisor} (부가세 포함 가정)` },
    { key: "maintenance", label: "관리비", amount: (input.monthlyMaintenanceFee ?? 0) / s.vatDivisor, basis: input.monthlyMaintenanceFee == null ? "미입력 — 0으로 계산" : `후보지 입력값 ÷ ${s.vatDivisor} (부가세 포함 가정)` },
    { key: "utilities", label: "수도광열비", amount: input.pcCount * s.utilitiesPerPc, basis: `PC ${input.pcCount}대 × ${(s.utilitiesPerPc / 10_000).toFixed(1)}만원` },
    { key: "telecom", label: "통신·노하드·OTT", amount: s.telecom, basis: "표준값" },
    { key: "fixedFees", label: "고정 수수료(무인기·보험 등)", amount: s.fixedFees, basis: "표준값" },
    { key: "supplies", label: "소모품", amount: s.supplies, basis: "표준값" },
  ];

  const variableCosts: ProfitLossLine[] = [
    { key: "royalty", label: "로열티", amount: sales * s.royaltyRate, basis: `매출의 ${pct(s.royaltyRate)}` },
    { key: "cardFee", label: "카드수수료", amount: sales * s.cardFeeRate, basis: `매출의 ${pct(s.cardFeeRate)}` },
  ];

  const totalCost = [...costOfSales, ...fixedCosts, ...variableCosts].reduce((sum, l) => sum + l.amount, 0);
  const netProfit = sales - totalCost;
  return {
    sales, pcSales, productSales, costOfSales, fixedCosts, variableCosts, totalCost, netProfit,
    netMargin: sales > 0 ? netProfit / sales : 0,
    laborFloorApplied, rentMissing,
  };
}
