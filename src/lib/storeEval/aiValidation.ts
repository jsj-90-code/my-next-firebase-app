// 4단계 — 기존 블랙라벨 매장 대상 AI 채점 정확도 검증. 이미 문을 연 매장은 오픈 전 사람이 직접
// 매긴 1~5점(storeEvalLocationEvaluations, "정답지")이 실제로 남아있으므로, 같은 주소로 AI를
// 돌려 사람 점수와 비교한다. 순수 함수만 담는다 — Firestore/Gemini 호출은 호출부(검증 러너
// API 라우트)에서 하고, 여기는 "비교"와 "집계"만 한다.
//
// 정답지가 있는 5개 필드(상권내위치/주요동선/선점경쟁/접근가시성/상권흡인력)만 비교 대상이다 —
// 특수수요유형 등 나머지 판단 필드는 정답이라 할 게 없어(원본 스프레드시트에도 채점기준표가
// 없음, docs/data-issues.md #2) 비교하지 않는다.

export const SCORE_FIELD_KEYS = [
  "locationScore",
  "flowScore",
  "preemptionScore",
  "visibilityScore",
  "attractionScore",
] as const;
export type ScoreFieldKey = (typeof SCORE_FIELD_KEYS)[number];

export const SCORE_FIELD_LABELS: Record<ScoreFieldKey, string> = {
  locationScore: "상권내위치점수",
  flowScore: "주요동선점수",
  preemptionScore: "선점경쟁점수",
  visibilityScore: "접근가시성점수",
  attractionScore: "상권흡인력점수",
};

export type ScoreComparisonRow = {
  field: ScoreFieldKey;
  ground: number;
  ai: number | null;
  diff: number | null; // |ground - ai|, AI가 null을 준 경우(근거 못 찾음) null
  withinOne: boolean; // diff가 null이면 false — "맞았다"고 볼 수 없다(지어낸 값과 구분해야 함)
};

export function compareLocationScores(
  ground: Record<ScoreFieldKey, number>,
  ai: Record<ScoreFieldKey, number | null>,
): ScoreComparisonRow[] {
  return SCORE_FIELD_KEYS.map((field) => {
    const g = ground[field];
    const a = ai[field];
    const diff = a == null ? null : Math.abs(g - a);
    return { field, ground: g, ai: a, diff, withinOne: diff != null && diff <= 1 };
  });
}

export type StoreValidationResult = {
  storeCode: string;
  storeName: string;
  address: string;
  rows: ScoreComparisonRow[];
};

export type FieldAccuracy = { total: number; withinOne: number; ratio: number };

export type AccuracySummary = {
  storeCount: number;
  totalPairs: number;
  withinOneCount: number;
  withinOneRatio: number; // 0~1, null-safe(totalPairs=0이면 0)
  perField: Record<ScoreFieldKey, FieldAccuracy>;
};

function ratio(withinOne: number, total: number): number {
  return total === 0 ? 0 : withinOne / total;
}

export function summarizeAccuracy(results: StoreValidationResult[]): AccuracySummary {
  const perField = Object.fromEntries(
    SCORE_FIELD_KEYS.map((k) => [k, { total: 0, withinOne: 0, ratio: 0 } satisfies FieldAccuracy]),
  ) as Record<ScoreFieldKey, FieldAccuracy>;

  let totalPairs = 0;
  let withinOneCount = 0;

  for (const result of results) {
    for (const row of result.rows) {
      totalPairs++;
      perField[row.field].total++;
      if (row.withinOne) {
        withinOneCount++;
        perField[row.field].withinOne++;
      }
    }
  }

  for (const field of SCORE_FIELD_KEYS) {
    perField[field].ratio = ratio(perField[field].withinOne, perField[field].total);
  }

  return {
    storeCount: results.length,
    totalPairs,
    withinOneCount,
    withinOneRatio: ratio(withinOneCount, totalPairs),
    perField,
  };
}
