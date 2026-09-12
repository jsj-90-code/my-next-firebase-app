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
  /** 비슷한 규모 기존점의 실제 매출 평균. 해당 매장이 없으면 null */
  sameSizeAvg: number | null;
  /** 위 평균에 쓰인 매장 수 */
  sameSizeCount: number;
};

/**
 * 비슷한 규모로 볼 PC대수 차이(대). 이보다 크게 차이나면 매출 차이의 상당 부분이 규모 차이다.
 *
 * ⚠️ 2026-09-13 실측 — **현재 표본에서는 이 값을 어떻게 잡아도 정보량이 거의 없다.** 기존점 38곳의
 * 대수가 76~168대(중앙 99, 사분위 94~109)로 좁게 몰려 있어서, 100대 기준 ±5대(16곳)든 ±30대
 * (37곳)든 그 평균이 전체 평균과 **±1.3% 안에서** 같다. 즉 화면의 "비슷한 규모 N곳 평균"은
 * 사실상 전체 평균이면서 "규모를 맞춰 비교했다"는 인상만 준다.
 * 어떻게 할지는 사용자 판단 사안으로 docs/backlog.md D-4에 남겼다(뺄지, 대당 매출 비교로 바꿀지).
 */
export const SAME_SIZE_PC_TOLERANCE = 15;

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

  const revenues = peers.map((s) => s.actualMonthlyRevenueAvg as number).sort((a, b) => a - b);
  const mid = Math.floor(revenues.length / 2);
  const median = revenues.length % 2 === 0 ? (revenues[mid - 1] + revenues[mid]) / 2 : revenues[mid];

  const sameSize = expectedPcCount == null
    ? []
    : peers.filter((s) => s.pcCount != null && Math.abs((s.pcCount as number) - expectedPcCount) <= SAME_SIZE_PC_TOLERANCE);

  return {
    peerCount: peers.length,
    rank: revenues.filter((r) => r > forecast).length + 1,
    median,
    sameSizeAvg: sameSize.length > 0
      ? sameSize.reduce((sum, s) => sum + (s.actualMonthlyRevenueAvg as number), 0) / sameSize.length
      : null,
    sameSizeCount: sameSize.length,
  };
}
