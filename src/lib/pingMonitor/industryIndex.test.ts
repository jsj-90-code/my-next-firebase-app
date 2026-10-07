import { describe, expect, it } from "vitest";
import { dayTypeAverages, industryIndex, isWeekend } from "./industryIndex";
import type { PingStore } from "./summary";

// 24번 잰 하루 — 대수 pcs, 가동률 u.
const day = (pcs: number, u: number, n = 24) => ({ a: Math.round(pcs * u * n), t: pcs * n, n });

function store(id: string, days: PingStore["days"], extra: Partial<PingStore> = {}): PingStore {
  return {
    id, name: id, address: "", ipRanges: "1.1.1.1~50", ipCount: 50, pcCount: null, memo: "", active: true,
    ownCode: null, ownName: null, competitorId: null, distanceM: null, isOwnStore: false, ipCheck: null,
    createdAt: null, createdBy: null, lastSample: null, days, recent: {}, ...extra,
  };
}

const TODAY = "2026-10-20";
const five = (days: (i: number) => PingStore["days"]) => Array.from({ length: 5 }, (_, i) => store(`s${i}`, days(i)));

describe("industryIndex", () => {
  it("모든 매장이 10% 오르면 지수도 110", () => {
    const r = industryIndex(five(() => ({ "2026-10-12": day(50, 0.2), "2026-10-13": day(50, 0.22) })), TODAY);
    expect(r.points.map((p) => p.index)).toEqual([100, expect.closeTo(110, 5)]);
  });

  it("새로 들어온 매장(가동률이 아주 높아도)은 들어온 날 지수를 움직이지 않는다", () => {
    const base = five(() => ({ "2026-10-12": day(50, 0.2), "2026-10-13": day(50, 0.2), "2026-10-14": day(50, 0.2) }));
    const newcomer = store("new", { "2026-10-13": day(200, 0.9), "2026-10-14": day(200, 0.9) });
    const r = industryIndex([...base, newcomer], TODAY);
    expect(r.points.map((p) => p.index)).toEqual([100, 100, 100]);
    expect(r.points.map((p) => p.matched)).toEqual([5, 5, 6]);
  });

  it("대수를 고쳐 분모가 바뀌어도 매장 안 가동률 변화만 들어간다", () => {
    const stores = five(() => ({ "2026-10-12": day(50, 0.2), "2026-10-13": day(30, 0.2) }));
    expect(industryIndex(stores, TODAY).points[1].index).toBeCloseTo(100, 5);
  });

  it("우리 매장·IP 확인 필요·IP 미등록·대답 없는 곳은 뺀다", () => {
    const d = { "2026-10-12": day(50, 0.2), "2026-10-13": day(50, 0.2) };
    const zero = { "2026-10-12": day(50, 0), "2026-10-13": day(50, 0) };
    const r = industryIndex([
      ...five(() => d),
      store("own", d, { isOwnStore: true }),
      store("chk", d, { ipCheck: "대답 1대" }),
      store("noip", d, { ipRanges: "", ipCount: 0 }),
      store("dead", zero),
    ], TODAY);
    expect(r.eligible).toBe(5);
    expect(r.excluded).toEqual({ own: 1, ipCheck: 1, noIp: 1, neverAlive: 1 });
  });

  it("덜 찬 날·오늘은 건너뛰고 그다음 날을 마지막으로 값이 있던 날과 비교한다", () => {
    const r = industryIndex(five(() => ({
      "2026-10-12": day(50, 0.2),
      "2026-10-13": day(50, 0.5, 10), // 10시간치 — 하루로 안 친다
      "2026-10-14": day(50, 0.3),
      [TODAY]: day(50, 0.9),
    })), TODAY);
    expect(r.points.map((p) => p.date)).toEqual(["2026-10-12", "2026-10-14"]);
    expect(r.points[1].comparedWith).toBe("2026-10-12");
    expect(r.points[1].index).toBeCloseTo(150, 5);
  });

  it("비교할 매장이 5곳 미만인 날은 지수를 잇지 않는다", () => {
    const stores = five((i): PingStore["days"] => (i < 4 ? { "2026-10-12": day(50, 0.2) } : { "2026-10-12": day(50, 0.2), "2026-10-13": day(50, 0.4) }));
    const r = industryIndex(stores, TODAY);
    expect(r.points[1]).toMatchObject({ index: null, matched: 1 });
  });
});

describe("평일·주말", () => {
  it("토·일만 주말", () => {
    expect(["2026-10-10", "2026-10-11", "2026-10-12"].map(isWeekend)).toEqual([true, true, false]);
  });
  it("평균은 기간 안 값 있는 날만", () => {
    const r = industryIndex(five(() => ({ "2026-10-09": day(50, 0.2), "2026-10-10": day(50, 0.3), "2026-10-11": day(50, 0.3), "2026-10-12": day(50, 0.2) })), TODAY);
    const avg = dayTypeAverages(r.points, "2026-10-09", "2026-10-12");
    expect(avg).toMatchObject({ weekdayDays: 2, weekendDays: 2 });
    expect(avg.weekday).toBeCloseTo(100, 5);
    expect(avg.weekend).toBeCloseTo(150, 5);
  });
});
