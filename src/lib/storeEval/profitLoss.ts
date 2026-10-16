// 신규 후보지 예상 손익(2026-10-16 사용자 지시: "점포평가할 때 손익 계산까지 함께").
// 예상월매출(V62·실험실·담당자 판단 — 매출DB와 같은 부가세 포함 결제총액)을 settings.vatDivisor로 나눈 기준(기본 1 =
// 부가세 포함 그대로, 사용자 10-16)에서 재경 운영수익 양식 순서대로 비용을 뺀다. 임대료·관리비는 후보지마다(다우 심사글), 나머지는
// settings.profitLoss 표준값(기존점 14곳 중앙, 근거는 settings.ts 주석).
import type { ProfitLossSettings } from "./types";

export type ProfitLossLine = { key: string; label: string; amount: number; basis: string };

export type ProfitLoss = {
  sales: number; // 예상월매출 ÷ vatDivisor
  pcSales: number;
  productSales: number;
  costOfSales: ProfitLossLine[]; // 매출원가
  fixedCosts: ProfitLossLine[]; // 고정비(임대료·관리비 포함)
  variableCosts: ProfitLossLine[];
  totalCost: number;
  netProfit: number;
  netMargin: number; // 순손익 ÷ 매출
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
    // 다우 임대료·관리비는 부가세 포함으로 가정한다(사용자 10-16 "포함이겠지" — 확인된 사실은 아님). 매출과 같은 기준으로 나눈다.
    { key: "rent", label: "임대료", amount: (input.monthlyRent ?? 0) / s.vatDivisor, basis: rentMissing ? "미입력 — 0으로 계산" : (s.vatDivisor === 1 ? "후보지 입력값(부가세 포함 가정)" : `후보지 입력값 ÷ ${s.vatDivisor} (부가세 포함 가정)`) },
    { key: "maintenance", label: "관리비", amount: (input.monthlyMaintenanceFee ?? 0) / s.vatDivisor, basis: input.monthlyMaintenanceFee == null ? "미입력 — 0으로 계산" : (s.vatDivisor === 1 ? "후보지 입력값(부가세 포함 가정)" : `후보지 입력값 ÷ ${s.vatDivisor} (부가세 포함 가정)`) },
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

// 2026-10-16 사용자: "견적금액이 기본 투자금 — 대수에 따라 다르니 검토해서 투자금 회수 넣어 봐". 견적서 공급가 구조(settings.ts 주석)로
// 대수만 받아 투자금을 내고, 월 순손익으로 회수기간을 낸다. 화면 기준이 부가세 포함(vatDivisor 1)이면 투자금도 ×1.1.
// 권리금은 돌려받지 못하는 돈이라 투자금에 더하고, 보증금은 돌려받는 돈이라 회수기간에서 뺀다(화면에 따로 적는다).
export type Investment = {
  pyeong: number;
  quoteSupply: number; // 견적서 공급가(부가세 별도)
  quote: number; // 화면 기준 금액(부가세 포함 기준이면 ×1.1)
  promo: number; // 선투자 프로모션 할인(부가세 포함)
  keyMoney: number;
  total: number; // quote + 권리금
  totalWithPromo: number;
};

export function computeInvestment(input: { pcCount: number; keyMoney: number | null | undefined; settings: ProfitLossSettings }): Investment {
  const s = input.settings;
  const pyeong = Math.round(input.pcCount * s.pyeongPerPc);
  const quoteSupply = s.investPerPc * input.pcCount + s.investPerPyeong * pyeong + s.investFixed;
  const quote = (quoteSupply * 1.1) / s.vatDivisor;
  const seats = input.pcCount - 1; // 카운터 1대 제외(견적서 C3)
  const promo = Math.max(0, s.promoBase + (seats - s.promoBaseSeats) * s.promoPerSeat) / s.vatDivisor;
  const keyMoney = input.keyMoney ?? 0;
  return { pyeong, quoteSupply, quote, promo, keyMoney, total: quote + keyMoney, totalWithPromo: quote - promo + keyMoney };
}

/** 회수기간(개월). 순손익이 0 이하면 회수 불가(null). */
export function paybackMonths(investment: number, monthlyNetProfit: number): number | null {
  return monthlyNetProfit > 0 ? investment / monthlyNetProfit : null;
}
