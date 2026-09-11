// 후보지 목록·대시보드가 보여주는 V62 예상매출은 `storeEvalResults`에 **저장된 값**이다.
// 이 값은 후보지 결과 탭을 열 때만 다시 계산돼 저장된다. 그래서 경쟁점이나 운영설정이 바뀐 뒤
// 그 탭을 안 열면 옛 숫자가 계속 사실처럼 떠 있는다.
//
// 2026-09-11에 실제로 그랬다 — N009 평택소사벌점이 커플존 정정 전 값(67,033,241원)으로
// 떠 있었고 실제로는 67,441,612원이었다. 화면에 아무 표시가 없어 알 방법이 없었다.
//
// **학습표본(기존점 월매출)은 여기서 보지 않는다.** 매일 크론으로 바뀌므로 그것까지 넣으면
// 매일 아침 모든 후보지가 "재계산 필요"가 되어 배지가 의미를 잃는다. 그 영향은 보통 아주
// 작으므로(0.1% 미만) 안내 문구로만 말한다. 여기서 보는 건 **그 후보지 자신의 입력**과
// **운영설정**이다 — 둘 다 사람이 바꾸는 것이고, 바뀌면 예측이 눈에 띄게 움직인다.

export type FreshnessInput = {
  /** 저장된 결과의 계산 시각. 결과가 없으면 null. */
  calculatedAt: number | null | undefined;
  /** 이 후보지의 입력값이 마지막으로 바뀐 시각. */
  candidateUpdatedAt: number | null | undefined;
  /** 이 후보지에 딸린 경쟁점들의 updatedAt. */
  competitorUpdatedAts: (number | null | undefined)[];
  /** 이 후보지의 입지동선평가 updatedAt. */
  locationEvaluationUpdatedAt: number | null | undefined;
  /** 운영설정 문서의 updatedAt. 바뀌면 모든 후보지가 영향을 받는다. */
  settingsUpdatedAt: number | null | undefined;
};

export type Freshness =
  | { state: "결과없음" }
  | { state: "최신" }
  | { state: "재계산필요"; reasons: string[]; newestInputAt: number };

const at = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

export function resultFreshness(input: FreshnessInput): Freshness {
  const calculatedAt = at(input.calculatedAt);
  if (calculatedAt == null) return { state: "결과없음" };

  const competitorNewest = input.competitorUpdatedAts
    .map(at)
    .filter((v): v is number => v != null)
    .reduce<number | null>((max, v) => (max == null || v > max ? v : max), null);

  const candidates: { label: string; at: number | null }[] = [
    { label: "후보지 입력", at: at(input.candidateUpdatedAt) },
    { label: "경쟁점", at: competitorNewest },
    { label: "입지동선평가", at: at(input.locationEvaluationUpdatedAt) },
    { label: "운영설정", at: at(input.settingsUpdatedAt) },
  ];

  const newer = candidates.filter((c) => c.at != null && c.at > calculatedAt) as { label: string; at: number }[];
  if (newer.length === 0) return { state: "최신" };

  return {
    state: "재계산필요",
    reasons: newer.map((c) => c.label),
    newestInputAt: Math.max(...newer.map((c) => c.at)),
  };
}

/** 배지 옆에 띄울 설명. 왜 뜨는지와 어떻게 없애는지를 한 문장으로 말한다. */
export function freshnessHint(f: Freshness): string | null {
  if (f.state === "결과없음") return "아직 계산된 결과가 없습니다. 결과 탭을 한 번 열면 계산됩니다.";
  if (f.state === "최신") return null;
  return `${f.reasons.join("·")}이(가) 마지막 계산 이후에 바뀌었습니다. 결과 탭을 한 번 열면 다시 계산됩니다.`;
}
