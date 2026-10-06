// 판정 흔들림 — 입지 점수(사람·AI가 1~5로 매기는 항목) 하나를 1점만 바꿔도 입점 기준선 판정이 뒤집히는지 본다.
//
// 2026-10-06 신설(사용자 "남은일 하셈"). 근거: docs/decision-audit-20260929.md §3 — 후보지 15곳 중 6곳이
// 선점·가시성 1점에 5,500만원 판정이 바뀌었다(1점에 400~670만원). 그런 자리는 "점수를 바꾸라"가 아니라
// **그 한 점의 현장 근거가 결론을 쥐고 있다**는 뜻이라, 어느 항목을 현장에서 확인해야 하는지 짚어 준다.
//
// ⚠️ 판정 구간을 새로 만들지 않는다(사용자가 "검토 필요" 구간을 금지, quick-eval/page.tsx). 가능/불가는 그대로 두고
//    확인할 항목만 알린다. 점수를 매출에 맞춰 고치라는 뜻이 아니다 — 문구에도 그렇게 적는다.
// ⚠️ 순수 함수다. 다시 계산하는 방법(revalue)은 부르는 쪽이 넘긴다(정밀=evaluateCandidate, 주소만=같은 함수).
import type { LocationEvaluation } from "./types";

export const SENSITIVITY_FIELDS = [
  { field: "locationScore", label: "상권위치·동선" },
  { field: "preemptionScore", label: "선점경쟁" },
  { field: "visibilityScore", label: "접근가시성" },
] as const;

export type SensitivityField = (typeof SENSITIVITY_FIELDS)[number]["field"];

export type VerdictFlip = {
  field: SensitivityField;
  label: string;
  from: number;
  to: number;
  /** 그 점수로 다시 계산한 값(원) */
  value: number;
};

export function findVerdictFlips(
  loc: LocationEvaluation | null,
  baseValue: number | null,
  threshold: number,
  revalue: (changed: LocationEvaluation) => number | null,
): VerdictFlip[] {
  if (!loc || baseValue == null) return [];
  const basePass = baseValue > threshold;
  const flips: VerdictFlip[] = [];
  for (const { field, label } of SENSITIVITY_FIELDS) {
    const from = loc[field];
    if (from == null) continue;
    for (const to of [from - 1, from + 1]) {
      if (to < 1 || to > 5) continue;
      const value = revalue({ ...loc, [field]: to } as LocationEvaluation);
      if (value != null && value > threshold !== basePass) flips.push({ field, label, from, to, value });
    }
  }
  return flips;
}

/** 사람 말 한 줄 — "선점경쟁 2→3이면 5,692만원(가능)" 식. */
export function describeVerdictFlips(flips: VerdictFlip[], threshold: number): string | null {
  if (flips.length === 0) return null;
  const parts = flips.map((f) => `${f.label} ${f.from}→${f.to}점이면 약 ${Math.round(f.value / 1e4).toLocaleString("ko-KR")}만원(${f.value > threshold ? "가능" : "불가"})`);
  return `입지 점수 1점에 판정이 바뀝니다: ${parts.join(", ")}. 점수를 매출에 맞춰 고치라는 뜻이 아니라, 이 항목의 현장 근거가 결론을 쥐고 있으니 현장에서 먼저 확인하세요.`;
}
