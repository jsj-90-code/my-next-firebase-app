import { describe, expect, it } from "vitest";
import { competitorMeasurement, lastWeek, rangeUtilization, storeStatus, thisWeek, type PingStore } from "./summary";

// 2026-10-07 기준: 한국 시각 10-07 낮 → 최근 7일 = 09-30~10-06.
const NOW = new Date("2026-10-07T03:00:00Z");

function store(over: Partial<PingStore>): PingStore {
  return {
    id: "p1", name: "x", address: "", ipRanges: "1.2.3.1-10", ipCount: 10, pcCount: 10, memo: "", active: true,
    ownCode: "N001", ownName: null, competitorId: "c1", distanceM: null, isOwnStore: false, ipCheck: null, portSwitchDate: null, excludeFromStats: false,
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
  it("IP 확인 메모가 낡았어도 실측이 뜨면(화면 '측정 중') 평가에도 값을 넘긴다 — 2026-10-10", () => {
    const s = store({ ipCheck: "10-06 점검에서 대답 0대", days: { "2026-10-06": full(36) } });
    expect(storeStatus(s).label).toBe("측정 중");
    const m = competitorMeasurement([s], NOW);
    expect(m.state).toBe("short");
    expect(m.pingbotUtilization).toBe(15);
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
    expect(m.pingbotPeriod).toBe("측정기 2026-09-30~2026-10-06 일일평균 7일(평일 5·주말 2)"); // 10-03 토·10-04 일
  });
  it("덜 찬 날은 빼고 7일 미달 표시", () => {
    const m = competitorMeasurement([store({ days: { "2026-10-05": { a: 30, t: 70, n: 7 }, "2026-10-06": full(48) } })], NOW);
    expect(m.state).toBe("short");
    expect(m.fullDays).toBe(1);
    expect(m.pingbotUtilization).toBe(20);
  });
  it("20시간 잰 날(네 회차 빠짐)은 넣고 19시간은 뺀다 — 2026-10-09 사용자(22→20, 어제 3개 빠진 날 살리기)", () => {
    const m = competitorMeasurement([store({ days: { "2026-10-04": { a: 99, t: 210, n: 19 }, "2026-10-05": { a: 22, t: 220, n: 20 }, "2026-10-06": full(48) } })], NOW);
    expect(m.fullDays).toBe(2);
    expect(m.pingbotUtilization).toBe(15);
  });
  it("중복 등록이면 IP 있는 쪽", () => {
    const m = competitorMeasurement([store({ id: "a", ipRanges: "", ipCount: 0 }), store({ id: "b", days: { "2026-10-06": full(24) } })], NOW);
    expect(m.store?.id).toBe("b");
  });
});

describe("rangeUtilization — 꽉 찬 날인데 종일 0대는 측정 실패로 뺀다(2026-10-09)", () => {
  const today = "2026-10-09";
  it("종일 0대인 꽉 찬 날만 있으면 util=null(0%가 아니라 '-')", () => {
    const r = rangeUtilization({ "2026-10-06": { a: 0, t: 92, n: 24 } }, "2026-10-05", "2026-10-08", { today });
    expect(r.util).toBeNull();
    expect(r.days).toBe(0);
    expect(r.skipped).toBe(1);
  });
  it("1% 미만(노이즈 몇 개)인 꽉 찬 날도 측정 실패로 뺀다 — 레드포스 10-07 1/3360", () => {
    const r = rangeUtilization({ "2026-10-07": { a: 1, t: 3360, n: 24 } }, "2026-10-05", "2026-10-08", { today });
    expect(r.util).toBeNull();
  });
  it("값이 있는 꽉 찬 날은 그대로 평균, 종일 0대 날만 뺀다", () => {
    const r = rangeUtilization({ "2026-10-06": { a: 0, t: 100, n: 24 }, "2026-10-07": { a: 50, t: 100, n: 24 } }, "2026-10-05", "2026-10-08", { today });
    expect(r.util).toBeCloseTo(0.5, 6);
    expect(r.days).toBe(1);
  });
});

describe("lastWeek — 이번 주 바로 앞 월~일(2026-10-09)", () => {
  it.each([
    ["2026-10-09T03:00:00Z", "2026-09-28", "2026-10-04"], // 금 → 지난주 월~일
    ["2026-10-05T03:00:00Z", "2026-09-28", "2026-10-04"], // 이번주 월 → 지난주
    ["2026-10-12T03:00:00Z", "2026-10-05", "2026-10-11"], // 다음주 월 → 이번주가 지난주로
  ])("%s → %s~%s", (now, from, to) => {
    expect(lastWeek(new Date(now))).toEqual({ from, to });
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

describe("2026-10-10 정밀점검 — 평가로 넘어가는 값 지키기", () => {
  it("일주일 평균이 1% 남짓(반올림 1.0)이면 넘기지 않는다 — 점포평가가 1을 100%로 읽는다", () => {
    const m = competitorMeasurement([store({ days: { "2026-10-06": { a: 245, t: 24000, n: 24 } } })], NOW); // 1.02%
    expect(m.state).toBe("blocked");
    expect(m.pingbotUtilization).toBeNull();
  });
  it("1.1%부터는 넘긴다(1보다 커서 퍼센트로 읽힌다)", () => {
    const m = competitorMeasurement([store({ days: { "2026-10-06": { a: 264, t: 24000, n: 24 } } })], NOW); // 1.1%
    expect(m.pingbotUtilization).toBe(1.1);
  });
  it("과응답 판정에 포트 전환 전 0% 날이 섞여 희석되지 않는다", () => {
    const days: Record<string, { a: number; t: number; n: number }> = {};
    for (const d of ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]) days[d] = full(0);
    for (const d of ["2026-10-04", "2026-10-05", "2026-10-06"]) days[d] = full(216); // 90%
    const s = store({ portSwitchDate: "2026-10-03", days });
    expect(storeStatus(s).label).toBe("과응답 · IP 확인");
    expect(competitorMeasurement([s], NOW).state).toBe("blocked");
  });
  it("같은 경쟁점에 '계산 제외' 문서와 정상 문서가 있으면 정상 문서를 고른다", () => {
    const bad = store({ id: "bad", excludeFromStats: true, days: { "2026-10-04": full(30), "2026-10-05": full(30), "2026-10-06": full(30) } });
    const good = store({ id: "good", days: { "2026-10-06": full(48) } });
    const m = competitorMeasurement([bad, good], NOW);
    expect(m.store?.id).toBe("good");
    expect(m.state).toBe("short");
  });
});

describe("7일 미달 값에 며칠치·주말 수를 붙인다(2026-10-10 사용자)", () => {
  it("토·일 이틀치면 주말 2일로 표시", () => {
    const m = competitorMeasurement([store({ days: { "2026-10-03": full(48), "2026-10-04": full(60) } })], NOW); // 10-03 토·10-04 일
    expect(m.state).toBe("short");
    expect(m.weekendDays).toBe(2);
    expect(m.label).toBe("7일 미달(2일치 · 주말 2일)");
    expect(m.pingbotPeriod).toBe("측정기 2026-10-03~2026-10-04 일일평균 2일(평일 0·주말 2)");
  });
});
