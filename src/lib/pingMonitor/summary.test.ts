import { describe, expect, it } from "vitest";
import { competitorMeasurement, storeStatus, thisWeek, type PingStore } from "./summary";

// 2026-10-07 기준: 한국 시각 10-07 낮 → 최근 7일 = 09-30~10-06.
const NOW = new Date("2026-10-07T03:00:00Z");

function store(over: Partial<PingStore>): PingStore {
  return {
    id: "p1", name: "x", address: "", ipRanges: "1.2.3.1-10", ipCount: 10, pcCount: 10, memo: "", active: true,
    ownCode: "N001", ownName: null, competitorId: "c1", distanceM: null, isOwnStore: false, ipCheck: null,
    createdAt: null, createdBy: null, lastSample: null, days: {}, recent: {}, ...over,
  };
}
const full = (a: number) => ({ a, t: 240, n: 24 });

describe("competitorMeasurement", () => {
  it("간헐적 1대 응답이 있어도 IP 확인 중이면 평가에 값을 넘기지 않는다", () => {
    const s = store({ ipCheck: "등록 범위 응답 확인 필요", days: { "2026-10-06": full(1) } });
    expect(storeStatus(s).tone).toBe("warn");
    const m = competitorMeasurement([s], NOW);
    expect(m.state).toBe("blocked");
    expect(m.util).toBeNull();
    expect(m.pingbotUtilization).toBeNull();
    expect(m.pingbotPeriod).toBeNull();
  });
  it("중복 중 확인 경고 없는 측정을 우선한다", () => {
    const flagged = store({ id: "flagged", ipCheck: "확인 필요", days: { "2026-10-05": full(1), "2026-10-06": full(1) } });
    const verified = store({ id: "verified", days: { "2026-10-06": full(36) } });
    expect(competitorMeasurement([flagged, verified], NOW).store?.id).toBe("verified");
  });
  it("측정기 문서가 없으면 미등록", () => {
    expect(competitorMeasurement([], NOW).state).toBe("none");
  });
  it("IP 없으면 IP 미등록", () => {
    expect(competitorMeasurement([store({ ipRanges: "", ipCount: 0 })], NOW).state).toBe("noIp");
  });
  it("7일 다 차면 일일평균과 기간 문구", () => {
    const days: PingStore["days"] = {};
    for (const d of ["09-30", "10-01", "10-02", "10-03", "10-04", "10-05", "10-06"]) days[`2026-${d}`] = full(36);
    days["2026-10-07"] = full(200); // 오늘(진행 중)은 빠진다
    const m = competitorMeasurement([store({ days })], NOW);
    expect(m.state).toBe("ok");
    expect(m.pingbotUtilization).toBe(15);
    expect(m.pingbotPeriod).toBe("측정기 2026-09-30~2026-10-06 일일평균 7일");
  });
  it("덜 찬 날은 빼고 7일 미달 표시", () => {
    const m = competitorMeasurement([store({ days: { "2026-10-05": { a: 30, t: 70, n: 7 }, "2026-10-06": full(48) } })], NOW);
    expect(m.state).toBe("short");
    expect(m.fullDays).toBe(1);
    expect(m.pingbotUtilization).toBe(20);
  });
  it("중복 등록이면 IP 있는 쪽", () => {
    const m = competitorMeasurement([store({ id: "a", ipRanges: "", ipCount: 0 }), store({ id: "b", days: { "2026-10-06": full(24) } })], NOW);
    expect(m.store?.id).toBe("b");
  });
});

describe("thisWeek — 오늘이 속한 월~일(2026-10-07 사용자)", () => {
  it.each([
    ["2026-10-05T03:00:00Z", "2026-10-05", "2026-10-11"], // 월
    ["2026-10-07T03:00:00Z", "2026-10-05", "2026-10-11"], // 수
    ["2026-10-11T14:00:00Z", "2026-10-05", "2026-10-11"], // 일 23시(한국)
    ["2026-10-11T15:30:00Z", "2026-10-12", "2026-10-18"], // 다음 월 0시 반(한국)
  ])("%s → %s~%s", (now, from, to) => {
    expect(thisWeek(new Date(now))).toEqual({ from, to });
  });
});
