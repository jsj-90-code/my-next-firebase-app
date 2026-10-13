// 후보지 "최종예상월매출" 한 값 고르기 (2026-10-13 신설) — 후보지 목록·결과 탭 큰 카드·엑셀이 같은 규칙을 쓴다.
//
// 우선순위: 담당자 판단 월매출 → "어느 산식을 쓸까"가 고른 주 값(dualEstimate.primaryValue, 실험실 또는 V62) → V62.
//   - 사용자 2026-10-13: "최종평가월매출에 내가 최종으로 평가한 값이 나와야" → 판단값 우선.
//   - 같은 날: "실험실 산식은 없네? 적용한 거 웹에 최종예상매출" → 판단값이 없으면 추천 산식 값.
// 표시만 고른다 — calc.ts/evaluate.ts는 judgedRevenue를 읽지 않고(judgedRevenueIsolation.test.ts),
// v62Final도 그대로 V62 값이다(적중률·개점 후 비교는 v62Final 기준).
import type { CandidateInput, EvaluationResult } from "./types";

export type FinalRevenueSource = "담당자" | "실험실" | "V62";

export function pickFinalRevenue(
  candidate: Pick<CandidateInput, "judgedRevenue"> | null | undefined,
  result: Pick<EvaluationResult, "v62Final" | "dualEstimate"> | null | undefined,
): { value: number | null; source: FinalRevenueSource | null } {
  if (candidate?.judgedRevenue != null) return { value: candidate.judgedRevenue, source: "담당자" };
  const dual = result?.dualEstimate;
  if (dual?.primaryValue != null) return { value: dual.primaryValue, source: dual.primary };
  if (result?.v62Final != null) return { value: result.v62Final, source: "V62" };
  return { value: null, source: null };
}
