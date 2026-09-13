// 기존점 분포 위치 계산 테스트 (2026-09-13 신설).
//
// 화면(PeerPositionNote)에 인라인으로 있던 계산을 뽑아낸 것이라, 뽑아낸 김에 경계 조건을
// 고정한다. 이 값은 평가자가 "5,800만원이 좋은 건가"를 판단하는 유일한 기준점이라 조용히
// 틀리면 판단을 그르친다.

import { describe, expect, it } from "vitest";
import { computePeerPosition, selectPeers, MIN_PEERS_FOR_RANK, type PeerStore } from "./peerPosition";

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

// 2026-09-13 — "비슷한 규모 N곳 평균"을 대당 비교로 교체했다. 규모별로 묶으면 기존점 대수가
// 76~168대로 몰려 있어 어떻게 잘라도 전체 평균과 ±1.3% 안이었다(정보가 없으면서 "규모를 맞춰
// 비교했다"는 인상만 줬다). 대당은 나누기로 규모를 정규화해 실제로 변별된다.
describe("대당 비교", () => {
  it("대당 = 예측값 ÷ 계획 대수", () => {
    const p = computePeerPosition(sample([100, 200, 300, 400, 500]), 600, 100);
    expect(p?.perPc?.own).toBe(6);
  });

  it("기존점 대당 중앙값은 각 매장을 자기 대수로 나눈 값의 중앙값이다", () => {
    // 매출 100/200/300/400/500, 대수 10/10/10/10/10 → 대당 10,20,30,40,50 → 중앙 30
    const p = computePeerPosition(sample([100, 200, 300, 400, 500], [10, 10, 10, 10, 10]), 250, 10);
    expect(p?.perPc?.median).toBe(30);
  });

  it("규모가 달라도 대당으로 정규화된다", () => {
    // 200대에서 400(대당 2) vs 50대에서 200(대당 4) — 총액은 전자가 크지만 대당은 후자가 크다
    const stores = sample([400, 200, 100, 100, 100], [200, 50, 100, 100, 100]);
    const p = computePeerPosition(stores, 300, 100); // 대당 3
    // 대당 3보다 큰 건 4(50대 매장) 하나 → 2위
    expect(p?.perPc?.rank).toBe(2);
  });

  it("총매출 순위와 대당 순위가 다를 수 있다 (그게 이 비교의 요점이다)", () => {
    const stores = sample([900, 100, 100, 100, 100], [300, 10, 10, 10, 10]);
    // 예측 200을 50대로 내면 대당 4 — 총액으로는 900 아래(2위)지만 대당으로는 10 아래(2위)
    const p = computePeerPosition(stores, 200, 50);
    expect(p?.rank).toBe(2); // 총액: 900만 위
    expect(p?.perPc?.own).toBe(4); // 200/50
    expect(p?.perPc?.median).toBe(10); // 기존점 대당 3,10,10,10,10 → 중앙 10
    expect(p?.perPc?.rank).toBe(5); // 대당 4보다 큰 게 10짜리 4곳
  });

  it("계획 대수를 모르면 대당 비교를 하지 않는다", () => {
    expect(computePeerPosition(sample([10, 20, 30, 40, 50]), 25, null)?.perPc).toBeNull();
    expect(computePeerPosition(sample([10, 20, 30, 40, 50]), 25, 0)?.perPc).toBeNull();
  });

  it("대수가 있는 기존점이 모자라면 대당 비교를 하지 않는다", () => {
    const stores = sample([10, 20, 30, 40, 50], [100, 100, null as unknown as number, null as unknown as number, null as unknown as number]);
    expect(computePeerPosition(stores, 25, 100)?.perPc).toBeNull();
    // 총매출 순위는 그대로 나온다 — 대당만 못 내는 것이다
    expect(computePeerPosition(stores, 25, 100)?.rank).toBe(4);
  });
});
