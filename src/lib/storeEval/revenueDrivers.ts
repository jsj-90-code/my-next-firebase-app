// "왜 이 매출인가" 요인별 기여도를 화면에 쓸 형태로 정리한다 (2026-09-13 신설).
//
// 원래 ResultTab의 RevenueDriverBreakdown 안에 인라인으로 있던 계산을 뽑아냈다. 화면 안에
// 있으면 테스트할 수단이 없어서(렌더 테스트 도구가 없다) 변환이 맞는지 확인할 방법이 없었다.
// 표시 결과는 그대로다.
//
// 예측식이 log(대당 이용시간) = 코호트평균 + Σ(표준화값 × 계수) 꼴이라 항 하나가 곧 "그 요인이
// 평균 대비 몇 배로 만들었는가"다. exp(기여분) - 1 이 "+12.4%"처럼 읽히는 값이 된다.
// 계산은 usageRevenue.ts가 예측 과정에서 이미 하고 있고 여기서는 표시용으로 바꾸기만 한다.

export type UsageDrivers = { labels: string[]; contributions: number[] };

export type DriverRow = {
  label: string;
  /** 코호트 평균 대비 배수에서 1을 뺀 값. 0.124 = +12.4% */
  pct: number;
};

export type DriverSummary = {
  rows: DriverRow[];
  /** 막대 길이를 비율로 그릴 때 쓸 기준(가장 큰 |pct|). 항상 0보다 크다. */
  maxAbs: number;
  /** 모든 항을 곱했을 때의 총 효과. 개별 항을 더한 값과 일치하지 않는 게 정상이다(곱셈 모형). */
  totalPct: number;
};

/**
 * 영향이 사실상 없는 항을 걸러내는 기준. "0.0%"짜리 줄이 늘어서면 핵심이 묻힌다.
 * 실데이터에서 배후수요 더미 같은 항이 ±1.7% 근처로 나오므로 이 값이면 살아남는다.
 */
export const DRIVER_MIN_ABS_PCT = 0.005;

/**
 * 표시할 게 없으면 null — 화면은 그때 접이식 자체를 그리지 않는다.
 *
 * 라벨과 기여도 개수가 다르면 **아무것도 그리지 않는다.** 짝이 어긋난 채로 표시하면
 * "경쟁력 우위 +12%"라고 적어놓고 실제로는 요금 항인 사고가 난다(2026-09-03에 실제로 라벨
 * 배열이 몇 달간 어긋나 있었다). 조용히 잘라 맞추지 않고 통째로 숨기는 쪽을 택한다.
 */
export function summarizeDrivers(drivers: UsageDrivers | null | undefined): DriverSummary | null {
  if (!drivers) return null;
  const { labels, contributions } = drivers;
  if (labels.length === 0 || labels.length !== contributions.length) return null;
  if (!contributions.every((v) => Number.isFinite(v))) return null;

  const rows = labels
    .map((label, i) => ({ label, pct: Math.exp(contributions[i]) - 1 }))
    .filter((r) => Math.abs(r.pct) >= DRIVER_MIN_ABS_PCT)
    // 영향이 큰 순. 올린 요인과 내린 요인을 섞어 크기순으로 놓는다 — 평가자가 먼저 봐야 할 건
    // 부호가 아니라 크기다.
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  if (rows.length === 0) return null;

  return {
    rows,
    maxAbs: Math.max(...rows.map((r) => Math.abs(r.pct))),
    // 걸러낸 항까지 전부 포함해서 곱한다 — 화면에 안 보이는 작은 항도 예측에는 들어갔다.
    totalPct: Math.exp(contributions.reduce((sum, v) => sum + v, 0)) - 1,
  };
}
