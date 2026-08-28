// 점포평가 모델 설정값의 기본값(초기 시드)과 Firestore 입출력.
// 모든 숫자는 원본 "12_운영판정" 시트 O/P열에서 그대로 가져온 값이다 (docs/model-spec.md §4).
// 코드에 하드코딩된 이 값들은 "초기 시드"일 뿐이고, 실제 계산은 항상 ModelSettings 문서를 읽어서
// 수행해야 한다 — 운영설정 화면에서 관리자가 바꾸면 그 값이 우선한다.

import type { ModelSettings } from "./types";

export const MODEL_SETTINGS_DOC_ID = "current";

// 08_계산기준!C54:E65 "AA 월별기준" 표의 순수익 2,000만원 대당 열 그대로.
const AA_MONTHLY_TARGETS_2000 = [
  { month: 1, dailyRevenuePerPcTarget: 19811, daysInMonth: 31 },
  { month: 2, dailyRevenuePerPcTarget: 19377, daysInMonth: 28 },
  { month: 3, dailyRevenuePerPcTarget: 18071, daysInMonth: 31 },
  { month: 4, dailyRevenuePerPcTarget: 16171, daysInMonth: 30 },
  { month: 5, dailyRevenuePerPcTarget: 18871, daysInMonth: 31 },
  { month: 6, dailyRevenuePerPcTarget: 17871, daysInMonth: 30 },
  { month: 7, dailyRevenuePerPcTarget: 21171, daysInMonth: 31 },
  { month: 8, dailyRevenuePerPcTarget: 21971, daysInMonth: 31 },
  { month: 9, dailyRevenuePerPcTarget: 17671, daysInMonth: 30 },
  { month: 10, dailyRevenuePerPcTarget: 17971, daysInMonth: 31 },
  { month: 11, dailyRevenuePerPcTarget: 17071, daysInMonth: 30 },
  { month: 12, dailyRevenuePerPcTarget: 19271, daysInMonth: 31 },
];

// 2026-08-27: 사용자가 같은 표의 순수익 1,000만원 대당 열을 그대로 제공함(08_계산기준!C54:E65와
// 동일 구조, 실측치 — 지어낸 값 아님).
const AA_MONTHLY_TARGETS_1000 = [
  { month: 1, dailyRevenuePerPcTarget: 14124, daysInMonth: 31 },
  { month: 2, dailyRevenuePerPcTarget: 13534, daysInMonth: 28 },
  { month: 3, dailyRevenuePerPcTarget: 12434, daysInMonth: 31 },
  { month: 4, dailyRevenuePerPcTarget: 10484, daysInMonth: 30 },
  { month: 5, dailyRevenuePerPcTarget: 13234, daysInMonth: 31 },
  { month: 6, dailyRevenuePerPcTarget: 12234, daysInMonth: 30 },
  { month: 7, dailyRevenuePerPcTarget: 15534, daysInMonth: 31 },
  { month: 8, dailyRevenuePerPcTarget: 16334, daysInMonth: 31 },
  { month: 9, dailyRevenuePerPcTarget: 12034, daysInMonth: 30 },
  { month: 10, dailyRevenuePerPcTarget: 12334, daysInMonth: 31 },
  { month: 11, dailyRevenuePerPcTarget: 11734, daysInMonth: 30 },
  { month: 12, dailyRevenuePerPcTarget: 13634, daysInMonth: 31 },
];

// 1,500만원 대당표는 원본 시트에 없다(2,000만원/1,000만원 두 열만 실제로 존재) — 사용자 요청대로
// "중간값"을 두 실측표의 월별 산술평균으로 계산한다(새 계수를 지어내는 게 아니라 이미 확보한 두
// 실측값의 평균일 뿐). 두 표의 month/daysInMonth는 항상 같은 순서로 맞물려 있다는 전제.
const AA_MONTHLY_TARGETS_1500 = AA_MONTHLY_TARGETS_2000.map((high, i) => {
  const low = AA_MONTHLY_TARGETS_1000[i];
  return {
    month: high.month,
    dailyRevenuePerPcTarget: Math.round((high.dailyRevenuePerPcTarget + low.dailyRevenuePerPcTarget) / 2),
    daysInMonth: high.daysInMonth,
  };
});

export function defaultModelSettings(): Omit<ModelSettings, "updatedAt" | "updatedBy"> {
  return {
    id: MODEL_SETTINGS_DOC_ID,
    modelVersion: "V62",
    inflowAdjustment: { 없음: 0, 보통: -0.03, 강함: -0.2 },
    lowerBoundFactor: 0.85,
    upperBoundFactor: 1.15,
    minTotalSample: 30,
    minStrongInflowSample: 5,
    targetMAE: 0.15,
    targetMedianAE: 0.1,
    target20pctRatio: 0.75,
    maxAvgBias: 0.05,
    target10pctRatio: 0.8,
    v61Fallback: {
      intercept: -79920.46038242977,
      hourlyRateCoef: 30.35495074620959,
      demandPerPcCoef: 390.05461852333895,
      competitivenessCoef: 158536.9275523547,
    },
    // 08_계산기준!VALIDATION 그대로 (릿지람다1·회귀가중치0.6·기준모형가중치0.4·최소학습표본12)
    v61Training: { ridgeLambda: 1, ridgeWeight: 0.6, baselineWeight: 0.4, minSampleCount: 12 },
    // 08_계산기준!B44:D49 "신규점 실측예측" 룩업표 — 사용자가 채팅으로 직접 확인해 준 값이며
    // reference/점포평가_최신본.xlsx!08_계산기준 행44~49와 정확히 일치함을 확인했다(2026-08-20).
    demandCaptureTable: [
      { gapLowerBound: -99, captureRate: 0.4, growthRate: 0 },
      { gapLowerBound: 0.8, captureRate: 0.5, growthRate: 0 },
      { gapLowerBound: 1.0, captureRate: 0.55, growthRate: 0.03 },
      { gapLowerBound: 1.3, captureRate: 0.6, growthRate: 0.05 },
      { gapLowerBound: 1.7, captureRate: 0.65, growthRate: 0.1 },
      { gapLowerBound: 2.2, captureRate: 0.7, growthRate: 0.12 },
    ],
    measuredForecastProductRatio: 0.5,
    measuredForecastMaxReviewUtilization: 0.5,
    // 08_계산기준!C54:E65 "AA 월별기준" 그대로 (순수익 2,000만원 대당 일매출목표·일수)
    aaMonthlyTargets: AA_MONTHLY_TARGETS_2000,
    aaMonthlyTargets1000: AA_MONTHLY_TARGETS_1000,
    aaMonthlyTargets1500: AA_MONTHLY_TARGETS_1500,
    aaMaxPcCount: 100,
    marketCharacterThreshold: { downtown: 8, mixed: 4 },
    marketDemandEffectiveRate: { downtown: 0.53, mixed: 0.61, residential: 0.78 },
    // 2026-08-27 (2차) — 상대평가(상위10/30/60%)를 절대평가로 바꿨다(사용자 확정). 값은 그
    // 상대평가가 실제로 쓰던 경계값(기존 40개 매장 상권수요 분포)을 반올림한 고정 금액이다.
    marketGradeAbsoluteThresholds: { SS: 12000, S: 7500, A: 4800 },
    // 2026-08-28 전면개편 — 기존 "사양25%+좌석30%+먹거리20%+인테리어15%+입지10%"에서
    // "하드웨어30%+인테리어·좌석·관리40%+먹거리20%+입지10%"로 재편(사용자 확정, types.ts
    // ModelSettings.competitivenessWeights 주석 참고).
    competitivenessWeights: { spec: 0.3, food: 0.2, interior: 0.4, location: 0.1 },
    // 2026-08-27 추가 — 먹거리를 브랜드 기준으로 매기기로 하며(사용자 확인) 임시로 잡은 초안값.
    // 쉐프앤클릭은 블랙라벨 자체 브랜드라 "자사 표준" 취급으로 5(상), 비바쿡·PC토랑은 흔히 쓰이는
    // 외부 브랜드라 4, 그 외 잘 안 알려진 브랜드는 3으로 뒀다 — 실측 근거는 없으니 설정 화면에서
    // 반드시 검토·조정할 것.
    foodBrandScores: { 쉐프앤클릭: 5, 비바쿡: 4, PC토랑: 4, 기타브랜드: 3 },
    // 2026-08-27 — CPU/RAM을 자동공식(세대·용량 환산)으로 분리 가중치를 줬더니 LOOCV 정확도가
    // 원본(11.6%)보다 나빠져 원복했었다. 2026-08-28 재도입 — 사용자가 하드웨어 내부비중을
    // GPU40%/모니터25%/CPU20%/RAM15%로 확정하고, scoreFromVga/scoreFromCpu의 앵커값 자체를
    // 블랙라벨 현재 표준(RTX5060·울트라5 225F=각 4점) 기준으로 재보정했다(calc.ts 주석 참고).
    // 정확도가 나빠지면 이 값을 {vga:0.7,monitor:0.3,ram:0,cpu:0}으로 되돌리면 된다.
    specWeights: { vga: 0.4, monitor: 0.25, ram: 0.15, cpu: 0.2 },
    // 2026-08-28 신규 — "인테리어·좌석·관리" 내부비중. 좌석·존구성이 PC방 선택의 1순위라는
    // 사용자 판단으로 50%가 가장 크고, 나머지는 최신성·디자인25%+청결·관리상태15%+
    // 냄새·조명·화장실·편의성10%.
    interiorWeights: { seatZone: 0.5, freshness: 0.25, cleanliness: 0.15, comfort: 0.1 },
    locationCompositeWeights: { withinMarket: 0.3, flow: 0.3, preemption: 0.25, visibility: 0.15 },
    brandFilter: "블랙라벨",
    saturationThreshold: 7,
  };
}
