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
    v61Fallback: {
      intercept: -79920.46038242977,
      hourlyRateCoef: 30.35495074620959,
      demandPerPcCoef: 390.05461852333895,
      competitivenessCoef: 158536.9275523547,
    },
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
