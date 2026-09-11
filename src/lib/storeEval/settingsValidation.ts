// 운영설정 저장을 막는 검증. 화면(settings/page.tsx)에서 쓰지만 순수함수라 여기 둔다 —
// 모델 계수를 직접 바꾸는 값들이라 테스트 없이 두면 안 된다.
//
// 2026-08-25에 "저장을 막는 실제 검증"으로 도입했고(그전엔 가중치 합 경고만 보여주고 저장은
// 그냥 됐다), 2026-09-11에 비율 칸 전반으로 넓히면서 이 파일로 분리했다.

import type { ModelSettings } from "./types";

export function sumWarning(sum: number, label: string): string | null {
  if (Math.abs(sum - 1) < 0.001) return null;
  return `${label} 가중치 합이 100%(1.0)가 아닙니다. 현재 합: ${(sum * 100).toFixed(1)}%`;
}

/**
 * 저장을 막아야 하는 문제들. 빈 배열이면 저장해도 된다.
 *
 * 화면의 숫자 입력에는 min/max가 없다(46칸 전부). 그래서 0~1 비율 칸에 0.55 대신 55를
 * 넣는 식의 오타가 그대로 저장될 수 있고, 그러면 예측이 조용히 망가지거나
 * (유효수요율 10배) 아예 안 나온다(가동률 상한이 1을 넘으면 predictUsageRevenue가 null).
 * "실수로 보고 막는다"는 기존 기준을 비율 칸 전반에 적용한다.
 */
export function modelSettingsValidationErrors(f: ModelSettings): string[] {
  const errors: string[] = [];

  const sums: [number, string][] = [
    [f.specWeights.vga + f.specWeights.monitor + f.specWeights.ram + f.specWeights.cpu, "하드웨어(GPU/모니터/RAM/CPU)"],
    [f.facilityWeights.zoneComposition + f.facilityWeights.interior + f.facilityWeights.management, "시설(존구성/인테리어/관리)"],
    [
      f.competitivenessWeights.spec + f.competitivenessWeights.food +
        f.competitivenessWeights.interior + f.competitivenessWeights.location,
      "경쟁력",
    ],
    [
      f.locationCompositeWeights.marketPositionFlow + f.locationCompositeWeights.preemption +
        f.locationCompositeWeights.visibility,
      "입지동선종합점수",
    ],
  ];
  for (const [sum, label] of sums) {
    const w = sumWarning(sum, label);
    if (w) errors.push(w);
  }

  // 외부유입 보정률은 "덜 준다(0%)~아예 없다고 보고 크게 깎는다(-100%)" 사이의 할인율이다.
  for (const [label, v] of Object.entries(f.inflowAdjustment)) {
    if (v > 0 || v < -1) {
      errors.push(`외부유입 보정률 - ${label}은(는) 0~-100%(-1~0) 범위여야 합니다. 현재: ${(v * 100).toFixed(1)}%`);
    }
  }

  const ratio = (label: string, v: number, { allowZero = true } = {}) => {
    if (!Number.isFinite(v)) errors.push(`${label}은(는) 숫자여야 합니다.`);
    else if (v > 1 || v < 0 || (!allowZero && v === 0)) {
      errors.push(`${label}은(는) 0~100%(0~1) 범위여야 합니다. 현재: ${v}`);
    }
  };
  ratio("기본 상품매출비율", f.measuredForecastProductRatio);
  ratio("데이터 재검토 가동률 기준", f.measuredForecastMaxReviewUtilization);
  ratio("물리적 가동률 상한", f.v62MaxUtilizationRate, { allowZero: false });
  for (const [k, v] of Object.entries(f.marketDemandEffectiveRate)) {
    ratio(`상권 유효수요율 - ${k}`, v, { allowZero: false });
  }

  // 보수/상한 계수는 V62에 곱하는 배율이다. 뒤집히면 "보수"가 "상한"보다 커진다.
  if (f.lowerBoundFactor > f.upperBoundFactor) {
    errors.push(`하한 계수(${f.lowerBoundFactor})가 상한 계수(${f.upperBoundFactor})보다 큽니다.`);
  }
  for (const [label, v] of [["하한 계수", f.lowerBoundFactor], ["상한 계수", f.upperBoundFactor]] as const) {
    if (!(v > 0)) errors.push(`${label}은(는) 0보다 커야 합니다. 현재: ${v}`);
  }

  // 상권성격 경계는 유동/주거 비율이라 번화가가 혼합보다 커야 한다. 뒤집히면 분류가 무너진다.
  if (f.marketCharacterThreshold.downtown <= f.marketCharacterThreshold.mixed) {
    errors.push(
      `상권성격 경계가 뒤집혔습니다 — 번화가(${f.marketCharacterThreshold.downtown})가 ` +
        `혼합(${f.marketCharacterThreshold.mixed})보다 커야 합니다.`,
    );
  }

  return errors;
}
