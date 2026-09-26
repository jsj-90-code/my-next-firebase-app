// 주소만 초기평가 — 판정에 쓰는 **최종 예상매출**을 V62·실험실 두 값에서 고른다 (2026-09-27, 사용자 "결론만 중요").
//
// 쓰임: 점포팀이 주소 하나로 입점 가능/불가를 받는다(QUICK_EVAL_ENTRY_THRESHOLD_WON 초과면 가능). 산식 이야기는 화면에서 접는다.
//
// 규칙 (근거 docs/releases/2026-09-26-address-only-dual.md 끝 절):
//   1. 기본은 V62(주소만 화면 설정) — 주소만 조건 기존점 40곳 되짚기 MAPE 13.6%, 실험실 31.9%.
//   2. **실험실이 V62의 1/labGuardRatio 아래면 실험실 값**으로 판정한다.
//      V62 매출의 40%는 "대당 중앙값 × 대수"라 수요를 안 본다(09-23 진단). 인구로 쌓은 수요(실험실)가 그 절반도 안 되면
//      V62가 그 바닥값에 기대는 자리다 — 시흥 신현역(사용자 사례): 120대·1,500원이면 V62 6,075만(가능) vs 실험실 1,622만.
//      기존점 40곳 중 이 조건에 걸리는 곳 0곳(판정 변화 0) · 1/1.5로 내리면 문경시청(실측 6,470만)이 불가로 틀린다.
//   3. V62 학습 범위를 크게 벗어나면(dualEstimate 검증 불가) 두 값 중 낮은 쪽 — 후보지 화면과 같은 원칙.
//   4. V62를 못 내면 실험실, 둘 다 없으면 null(화면은 "판정 불가 — 자료 수집 실패").
// ⚠️ 특정 주소 예외를 두지 않는다. 사람이 지적하지 않은 주소에도 같은 규칙이 돈다.
import type { RangeFlag } from "../dualEstimate";

export const QUICK_EVAL_LAB_GUARD = {
  /** 실험실 < V62 ÷ 이 값이면 실험실로 판정 */
  ratio: 2,
  measuredAt: "2026-09-27",
  /** 기존점 40곳(주소만 재현) 중 걸린 곳 — 0이어야 "되는 자리 판정 변화 없음" */
  existingAffected: 0,
  testFile: "src/lib/storeEval/_addressOnlyDual.test.ts",
} as const;

export type QuickEvalFinal = {
  value: number | null;
  source: "V62" | "실험실" | null;
  /** 실험실로 바꿨거나 낮은 쪽을 고른 이유(사람 말). V62 그대로면 null */
  reason: string | null;
};

export function quickEvalFinalEstimate(v62: number | null, lab: number | null, flags: RangeFlag[] = []): QuickEvalFinal {
  if (v62 == null) {
    return lab == null
      ? { value: null, source: null, reason: null }
      : { value: lab, source: "실험실", reason: "V62가 값을 내지 못해 인구 기반 추정(실험실)으로 판정했습니다." };
  }
  if (lab != null && lab < v62 / QUICK_EVAL_LAB_GUARD.ratio) {
    return {
      value: lab, source: "실험실",
      reason: `주변 인구로 본 수요가 매출 추정의 절반에도 못 미칩니다(인구 기반 ${Math.round(lab / 1e4).toLocaleString("ko-KR")}만 vs 기본 추정 ${Math.round(v62 / 1e4).toLocaleString("ko-KR")}만). 사람 수 대비 매출이 과하게 잡힌 자리라 낮은 값으로 판정했습니다.`,
    };
  }
  if (lab != null && flags.some((f) => f.far) && lab < v62) {
    return { value: lab, source: "실험실", reason: "기존 가맹점에 없던 상권 규모라 두 추정 중 낮은 값으로 판정했습니다." };
  }
  return { value: v62, source: "V62", reason: null };
}
