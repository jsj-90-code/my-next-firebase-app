// 점포평가 모델 설정값의 기본값(초기 시드)과 Firestore 입출력.
// 모든 숫자는 원본 "12_운영판정" 시트 O/P열에서 그대로 가져온 값이다 (docs/model-spec.md §4).
// 코드에 하드코딩된 이 값들은 "초기 시드"일 뿐이고, 실제 계산은 항상 ModelSettings 문서를 읽어서
// 수행해야 한다 — 운영설정 화면에서 관리자가 바꾸면 그 값이 우선한다.

import type { ModelSettings } from "./types";

export const MODEL_SETTINGS_DOC_ID = "current";

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
    aaMonthlyTargets: [
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
    ],
    aaMaxPcCount: 100,
    marketCharacterThreshold: { downtown: 8, mixed: 4 },
    marketDemandEffectiveRate: { downtown: 0.53, mixed: 0.61, residential: 0.78 },
    marketGradePercentile: { SS: 0.1, S: 0.3, A: 0.6 },
    competitivenessWeights: { spec: 0.25, seat: 0.3, food: 0.2, interior: 0.15, location: 0.1 },
    specWeights: { vga: 0.7, monitor: 0.3 },
    locationCompositeWeights: { withinMarket: 0.3, flow: 0.3, preemption: 0.25, visibility: 0.15 },
    brandFilter: "블랙라벨",
    saturationThreshold: 7,
  };
}
