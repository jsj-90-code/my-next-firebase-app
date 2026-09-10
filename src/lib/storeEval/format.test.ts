import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./format";

describe("formatDate", () => {
  // 2026-09-11 08:23 KST = 2026-09-10 23:23 UTC. toISOString().slice(0,10)을 쓰면
  // 방금 저장한 값이 "2026-09-10"으로 하루 전에 저장된 것처럼 보인다(실제로 겪은 문제).
  it("한국시간 오전 이른 시각에도 그날 날짜를 보여준다", () => {
    const earlyMorningKst = new Date("2026-09-11T08:23:00+09:00").getTime();
    expect(formatDate(earlyMorningKst)).toBe(localYmd(earlyMorningKst));
    if (kstOffsetMinutes() === 540) expect(formatDate(earlyMorningKst)).toBe("2026-09-11");
  });

  it("자정 직후와 자정 직전이 같은 날로 묶이지 않는다", () => {
    const justAfterMidnight = new Date("2026-09-11T00:01:00+09:00").getTime();
    const justBeforeMidnight = new Date("2026-09-10T23:59:00+09:00").getTime();
    expect(formatDate(justAfterMidnight)).not.toBe(formatDate(justBeforeMidnight));
  });

  it("YYYY-MM-DD 형식으로 0을 채운다", () => {
    const january = new Date(2026, 0, 5, 12, 0, 0).getTime();
    expect(formatDate(january)).toBe("2026-01-05");
  });

  it("값이 없거나 잘못되면 '-'를 돌려준다", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate(undefined)).toBe("-");
    expect(formatDate(0)).toBe("-");
    expect(formatDate(Number.NaN)).toBe("-");
  });
});

describe("formatDateTime", () => {
  it("값이 없으면 '-'를 돌려준다", () => {
    expect(formatDateTime(null)).toBe("-");
    expect(formatDateTime(0)).toBe("-");
  });
});

/** 실행 환경의 시간대로 계산한 YYYY-MM-DD — 어느 시간대에서 돌려도 통과하게 한다. */
function localYmd(value: number): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function kstOffsetMinutes(): number {
  return -new Date("2026-09-11T00:00:00Z").getTimezoneOffset();
}
