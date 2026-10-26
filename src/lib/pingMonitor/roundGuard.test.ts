import { describe, expect, it } from "vitest";
import { roundLooksBroken, shouldReplace, wantsExtraPorts, type PingTarget } from "./roundGuard";

const NOW = new Date("2026-10-10T13:05:00Z"); // KST 22시
const YESTERDAY = new Date(NOW.getTime() - 24 * 3600_000);
const targets = (n: number, prevA = 30): PingTarget[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `s${i}`, ips: ["1.1.1.1"], total: 100, recent: { "22": { a: prevA, at: YESTERDAY } } }));
const on = (ts: PingTarget[], f: (i: number) => number) => new Map(ts.map((t, i) => [t.id, f(i)]));

describe("roundLooksBroken — 측정 고장 회차 버리기(2026-10-10)", () => {
  it("평소 변동(어제의 0.8배)은 통과", () => {
    const ts = targets(50);
    expect(roundLooksBroken(ts, on(ts, () => 24), "22", NOW)).toBeNull();
  });
  it("10-08 22시처럼 다수가 0대면 버린다", () => {
    const ts = targets(50);
    expect(roundLooksBroken(ts, on(ts, (i) => (i < 20 ? 0 : 30)), "22", NOW)).toMatch(/0대/);
  });
  it("합계가 어제의 40% 미만이면 버린다", () => {
    const ts = targets(50);
    expect(roundLooksBroken(ts, on(ts, () => 10), "22", NOW)).toMatch(/40%/);
  });
  it("비교할 매장이 20곳 미만(신규·자료 부족)이면 판정 안 함", () => {
    const ts = targets(10);
    expect(roundLooksBroken(ts, on(ts, () => 0), "22", NOW)).toBeNull();
  });
  it("36시간 넘은 기록·직전 5대 미만 매장은 비교에서 뺀다", () => {
    const ts = targets(50).map((t) => ({ ...t, recent: { "22": { a: 30, at: new Date(NOW.getTime() - 40 * 3600_000) } } }));
    expect(roundLooksBroken(ts, on(ts, () => 0), "22", NOW)).toBeNull();
    const quiet = targets(50, 3);
    expect(roundLooksBroken(quiet, on(quiet, () => 0), "22", NOW)).toBeNull();
  });
});

describe("비교 기준은 1시간 전 기록 먼저(2026-10-26 일→월 14시 오판)", () => {
  const HOUR_AGO = new Date(NOW.getTime() - 60 * 60_000);
  const withPrev = (n: number, yesterdayA: number, prevA: number): PingTarget[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `s${i}`, name: `s${i}`, ips: ["1.1.1.1"], total: 100,
      recent: { "22": { a: yesterdayA, at: YESTERDAY }, "21": { a: prevA, at: HOUR_AGO } },
    }));
  it("어제(일요일)의 39%여도 1시간 전과 비슷하면 통과", () => {
    const ts = withPrev(50, 93, 30);
    expect(roundLooksBroken(ts, on(ts, () => 36), "22", NOW)).toBeNull();
  });
  it("1시간 전의 40% 미만이면 여전히 버린다", () => {
    const ts = withPrev(50, 30, 30);
    expect(roundLooksBroken(ts, on(ts, () => 10), "22", NOW)).toMatch(/40%/);
  });
  it("0시는 전날 23시 칸과 견준다", () => {
    const at0 = new Date("2026-10-10T15:05:00Z"); // KST 0시
    const ts: PingTarget[] = Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`, name: `s${i}`, ips: ["1.1.1.1"], total: 100,
      recent: { "00": { a: 90, at: new Date(at0.getTime() - 24 * 3600_000) }, "23": { a: 30, at: new Date(at0.getTime() - 3600_000) } },
    }));
    expect(roundLooksBroken(ts, on(ts, () => 28), "00", at0)).toBeNull();
  });
});

describe("shouldReplace — 서버 결과가 예비를 이긴다", () => {
  it("예비(tcp)·집 PC(home) 기록은 서버 결과로 바꾼다", () => {
    expect(shouldReplace("tcp", "icmp+tcp+timestamp")).toBe(true);
    expect(shouldReplace("home-icmp+tcp", "icmp+tcp+timestamp+1688")).toBe(true);
  });
  it("서버 기록은 안 바꾸고, 예비끼리도 안 바꾼다", () => {
    expect(shouldReplace("icmp+tcp+timestamp", "icmp+tcp+timestamp")).toBe(false);
    expect(shouldReplace("icmp+tcp+timestamp", "tcp")).toBe(false);
    expect(shouldReplace("tcp", "tcp")).toBe(false);
  });
});

describe("10-10 최종점검 보완", () => {
  it("예비(tcp)는 0대 비율을 안 보고 합계만 본다 — 핑 전용 매장이 0대여도 통과", () => {
    const ts = targets(50);
    expect(roundLooksBroken(ts, on(ts, (i) => (i < 12 ? 0 : 32)), "22", NOW, "tcp")).toBeNull();
    expect(roundLooksBroken(ts, on(ts, () => 9), "22", NOW, "tcp")).toMatch(/40%/);
  });
  it("늦게 재전송된 결과는 오늘 이 시에 예비가 쓴 값과 견준다", () => {
    const ts = targets(50).map((t) => ({ ...t, recent: { "22": { a: 30, at: new Date(NOW.getTime() + 47 * 60_000) } } }));
    // now(잰 시각)보다 예비 기록이 뒤 — age 음수도 비교에 넣는다
    expect(roundLooksBroken(ts, on(ts, () => 0), "22", NOW, "icmp+tcp+timestamp")).toMatch(/0대/);
  });
  it("계산 제외 매장은 비교에서 뺀다", () => {
    const ts = [...targets(30), ...targets(30).map((t) => ({ ...t, id: `x${t.id}`, excluded: true }))];
    expect(roundLooksBroken(ts, on(ts, (i) => (i >= 30 ? 0 : 30)), "22", NOW)).toBeNull();
  });
});

describe("wantsExtraPorts — 새 매장 측정 방식 자동 학습(2026-10-14)", () => {
  const day = (a: number) => Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h).padStart(2, "0"), { a }]));
  it("probe1688 매장은 늘", () => expect(wantsExtraPorts({ probe1688: true, recent: day(30) }, "10")).toBe("probe1688"));
  it("새 매장(24회차 전)은 전 방식", () => {
    expect(wantsExtraPorts({}, "10")).toBe("learning");
    expect(wantsExtraPorts({ recent: { "13": { a: 0 } } }, "14")).toBe("learning");
  });
  it("잘 잡히는 매장은 안 보냄", () => expect(wantsExtraPorts({ recent: day(30) }, "21")).toBeNull());
  it("늘 0대 매장은 21시에만 다시 두드림", () => {
    expect(wantsExtraPorts({ recent: day(0) }, "21")).toBe("silent-recheck");
    expect(wantsExtraPorts({ recent: day(0) }, "20")).toBeNull();
  });
});
