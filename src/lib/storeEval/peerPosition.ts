// 기존 가맹점 분포에서 후보지 예측값이 어디쯤인지 계산한다 (2026-09-13 신설).
//
// 원래 ResultTab의 PeerPositionNote 안에 인라인으로 있던 계산을 뽑아냈다. 화면 컴포넌트 안에
// 있으면 테스트할 방법이 없어서(이 저장소엔 컴포넌트 렌더 테스트 도구가 없다) 경계 조건이
// 맞는지 확인할 수가 없었다. 표시 결과는 그대로다.
//
// 뽑아내면서 중앙값 계산을 고쳤다 — 예전엔 짝수 표본에서 `sorted[floor(n/2)]` 한 개만 썼는데
// (38곳이면 20번째 값), "중앙값"이라고 적어 보여주는 자리라 짝수일 때는 가운데 두 값의 평균을
// 쓴다. 차이는 작지만 이름과 값이 어긋나지 않게 한다.

export type PeerStore = {
  brandType: string | null;
  excludedFromModel: boolean;
  actualMonthlyRevenueAvg: number | null;
  pcCount: number | null;
};

export type PeerPosition = {
  /** 비교 대상이 된 기존점 수 */
  peerCount: number;
  /** 예측값이 실제 매출 분포에서 몇 번째인지 (1 = 가장 높음) */
  rank: number;
  /** 기존점 실제 매출의 중앙값 */
  median: number;
  /**
   * PC 1대당으로 환산한 비교 (2026-09-13에 "비슷한 규모 평균"을 대신해 넣었다).
   * 계획 대수를 모르거나 대수가 있는 기존점이 없으면 null.
   */
  perPc: {
    /** 이 후보지의 대당 예상매출 */
    own: number;
    /** 기존점 대당 실제매출 중앙값 */
    median: number;
    /** 대당 기준 순위 */
    rank: number;
    /** 대당 비교에 쓰인 기존점 수(대수가 있는 곳만) */
    count: number;
  } | null;
};

/** 순위가 의미를 가지려면 최소 이만큼은 있어야 한다. 3~4곳에서 "N곳 중 2번째"는 정보가 아니다. */
export const MIN_PEERS_FOR_RANK = 5;

/**
 * 비교군은 **모형이 학습에 쓰는 기준과 같게** 맞춘다 — 블랙라벨·산식학습 제외 아님·실제매출 있음.
 * 기준이 다르면 화면에 함께 뜨는 "기존점 38곳 검증" 정확도 문구와 모수가 어긋나 혼란만 준다.
 */
export function selectPeers<T extends PeerStore>(stores: T[]): T[] {
  return stores.filter(
    (s) => s.brandType === "블랙라벨" && !s.excludedFromModel && s.actualMonthlyRevenueAvg != null && s.actualMonthlyRevenueAvg > 0,
  );
}

/**
 * 표본이 너무 적거나 예측값이 없으면 null — 화면은 그때 아무것도 그리지 않는다.
 * 순위는 "이 예측값보다 실제로 더 잘 버는 매장이 몇 곳인가 + 1"이다(동률은 위로 치지 않는다).
 */
export function computePeerPosition(stores: PeerStore[], forecast: number | null, expectedPcCount: number | null): PeerPosition | null {
  if (forecast == null) return null;
  const peers = selectPeers(stores);
  if (peers.length < MIN_PEERS_FOR_RANK) return null;

  const revenues = peers.map((s) => s.actualMonthlyRevenueAvg as number);
  const median = medianOf(revenues);

  // 대당 비교 — 규모를 나눠서 정규화한다. "비슷한 규모끼리 묶어 평균내기"보다 정직하고
  // 실제로 변별된다(2026-09-13 실측: 대당은 37.8만~87.9만으로 2.33배 폭, 규모별 묶음은
  // 어떻게 잘라도 전체 평균과 ±1.3% 안이라 정보가 없었다).
  const sized = peers.filter((s) => s.pcCount != null && (s.pcCount as number) > 0);
  const perPc =
    expectedPcCount != null && expectedPcCount > 0 && sized.length >= MIN_PEERS_FOR_RANK
      ? (() => {
          const own = forecast / expectedPcCount;
          const values = sized.map((s) => (s.actualMonthlyRevenueAvg as number) / (s.pcCount as number));
          return {
            own,
            median: medianOf(values),
            rank: values.filter((v) => v > own).length + 1,
            count: values.length,
          };
        })()
      : null;

  return {
    peerCount: peers.length,
    rank: revenues.filter((r) => r > forecast).length + 1,
    median,
    perPc,
  };
}

/** 짝수면 가운데 두 값의 평균. "중앙값"이라고 적어 보여주는 자리라 이름과 값을 맞춘다. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
