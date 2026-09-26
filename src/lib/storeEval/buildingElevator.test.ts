// judgeElevator — 건축물대장 표제부 -> 경쟁점 엘리베이터 판정 (2026-09-26).
import { describe, expect, it } from "vitest";
import { judgeElevator } from "./buildingElevator";

describe("judgeElevator", () => {
  it("주건축물에 승강기가 있으면 있음", () => {
    expect(judgeElevator([{ mainAtchGbCdNm: "주건축물", grndFlrCnt: 5, rideUseElvtCnt: 1, emgenUseElvtCnt: 0 }], "중동 1").hasElevator).toBe(true);
  });

  it("대장이 0대여도 지상 6층 이상이면 있음(기록 누락 — 일산탄현 10층 0대)", () => {
    const r = judgeElevator([{ mainAtchGbCdNm: "주건축물", grndFlrCnt: 10, rideUseElvtCnt: 0, emgenUseElvtCnt: 0 }], "탄현동 1");
    expect(r.hasElevator).toBe(true);
    expect(r.basis).toContain("6층 이상");
  });

  it("5층 이하·0대는 없음이 아니라 판정 안 함(null) — 부속건축물은 보지 않는다", () => {
    const r = judgeElevator([
      { mainAtchGbCdNm: "주건축물", grndFlrCnt: 3, rideUseElvtCnt: 0 },
      { mainAtchGbCdNm: "부속건축물", grndFlrCnt: 1, rideUseElvtCnt: 1 },
    ], "산호동 6");
    expect(r.hasElevator).toBeNull();
    expect(judgeElevator([], "x").hasElevator).toBeNull();
  });
});
