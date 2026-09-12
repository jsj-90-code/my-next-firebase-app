// 기존점 분포 위치 계산 테스트 (2026-09-13 신설).
//
// 화면(PeerPositionNote)에 인라인으로 있던 계산을 뽑아낸 것이라, 뽑아낸 김에 경계 조건을
// 고정한다. 이 값은 평가자가 "5,800만원이 좋은 건가"를 판단하는 유일한 기준점이라 조용히
// 틀리면 판단을 그르친다.

import { describe, expect, it } from "vitest";
import { computePeerPosition, selectPeers, MIN_PEERS_FOR_RANK, SAME_SIZE_PC_TOLERANCE, type PeerStore } from "./peerPosition";

const store = (revenue: number | null, pcCount: number | null = 100, over: Partial<PeerStore> = {}): PeerStore => ({
  brandType: "블랙라벨",
  excludedFromModel: false,
  actualMonthlyRevenueAvg: revenue,
  pcCount,
  ...over,
});

/** 매출만 다른 기본 표본 n개 */
const sample = (revenues: number[], pcCounts?: number[]) =>
  revenues.map((r, i) => store(r, pcCounts ? pcCounts[i] : 100));

describe("비교군 선정", () => {
  it("블랙라벨·학습제외 아님·실제매출 있음만 고른다", () => {
    const stores = [
      store(5000),
      store(5000, 100, { brandType: "기타" }),
      store(5000, 100, { excludedFromModel: true }),
      store(null),
      store(0),
    ];
    expect(selectPeers(stores)).toHaveLength(1);
  });
});

describe("분포에서의 위치", () => {
  it("예측값이 가장 높으면 1위", () => {
    const p = computePeerPosition(sample([10, 20, 30, 40, 50]), 60, 100);
    expect(p?.rank).toBe(1);
    expect(p?.peerCount).toBe(5);
  });

  it("예측값이 가장 낮으면 꼴찌+1", () => {
    expect(computePeerPosition(sample([10, 20, 30, 40, 50]), 5, 100)?.rank).toBe(6);
  });

  it("중간이면 위에 있는 매장 수 + 1", () => {
    // 30보다 큰 게 2곳(40, 50) → 3위
    expect(computePeerPosition(sample([10, 20, 30, 40, 50]), 30, 100)?.rank).toBe(3);
  });

  it("동률은 위로 치지 않는다 (같은 값이면 그 매장보다 앞선다)", () => {
    // 정확히 40인 매장이 있어도 40보다 '큰' 건 50 하나 → 2위
    expect(computePeerPosition(sample([10, 20, 30, 40, 50]), 40, 100)?.rank).toBe(2);
  });
});

describe("중앙값", () => {
  it("홀수 표본은 가운데 값", () => {
    expect(computePeerPosition(sample([10, 20, 30, 40, 50]), 25, 100)?.median).toBe(30);
  });

  it("짝수 표본은 가운데 두 값의 평균 (예전엔 한쪽만 썼다)", () => {
    // 정렬 [10,20,30,40,50,60] → (30+40)/2 = 35
    expect(computePeerPosition(sample([10, 20, 30, 40, 50, 60]), 25, 100)?.median).toBe(35);
  });

  it("입력 순서가 뒤섞여 있어도 같은 값이 나온다", () => {
    const shuffled = computePeerPosition(sample([50, 10, 40, 20, 60, 30]), 25, 100);
    expect(shuffled?.median).toBe(35);
  });
});

describe("비슷한 규모 평균", () => {
  it(`대수 차이가 ${SAME_SIZE_PC_TOLERANCE}대 이내인 매장만 평균낸다`, () => {
    const stores = sample([100, 200, 300, 400, 500], [100, 110, 116, 85, 84]);
    // 100대 기준 ±15 → 100, 110, 116(16 차이라 제외), 85(15 차이라 포함), 84(제외)
    const p = computePeerPosition(stores, 250, 100);
    expect(p?.sameSizeCount).toBe(3); // 100, 110, 85
    expect(p?.sameSizeAvg).toBe((100 + 200 + 400) / 3);
  });

  it("경계값(정확히 15대 차이)은 포함한다", () => {
    const p = computePeerPosition(sample([100, 100, 100, 100, 500], [100, 100, 100, 100, 115]), 200, 100);
    expect(p?.sameSizeCount).toBe(5);
  });

  it("해당 규모가 없으면 null이고 개수는 0", () => {
    const p = computePeerPosition(sample([100, 200, 300, 400, 500], [200, 210, 220, 230, 240]), 250, 100);
    expect(p?.sameSizeAvg).toBeNull();
    expect(p?.sameSizeCount).toBe(0);
  });

  it("계획 대수를 모르면 규모 비교를 하지 않는다", () => {
    const p = computePeerPosition(sample([100, 200, 300, 400, 500]), 250, null);
    expect(p?.sameSizeAvg).toBeNull();
  });
});

describe("표시하지 않는 경우", () => {
  it("예측값이 없으면 null", () => {
    expect(computePeerPosition(sample([10, 20, 30, 40, 50]), null, 100)).toBeNull();
  });

  it(`비교군이 ${MIN_PEERS_FOR_RANK}곳 미만이면 null (순위가 정보가 아니다)`, () => {
    expect(computePeerPosition(sample([10, 20, 30, 40]), 25, 100)).toBeNull();
    expect(computePeerPosition(sample([10, 20, 30, 40, 50]), 25, 100)).not.toBeNull();
  });

  it("비교군이 전부 걸러지면 null", () => {
    expect(computePeerPosition([store(null), store(0), store(5000, 100, { brandType: "기타" })], 25, 100)).toBeNull();
  });
});
