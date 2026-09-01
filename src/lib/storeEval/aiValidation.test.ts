import { describe, expect, it } from "vitest";
import { compareLocationScores, summarizeAccuracy, type StoreValidationResult } from "./aiValidation";

const GROUND = { locationScore: 5, preemptionScore: 2, visibilityScore: 3 };

describe("compareLocationScores", () => {
  it("점수가 정확히 같으면 diff=0, withinOne=true", () => {
    const rows = compareLocationScores(GROUND, GROUND);
    expect(rows.every((r) => r.diff === 0 && r.withinOne)).toBe(true);
  });

  it("±1 이내 차이는 withinOne=true", () => {
    const ai = { ...GROUND, locationScore: 4 };
    const rows = compareLocationScores(GROUND, ai);
    expect(rows.find((r) => r.field === "locationScore")!.withinOne).toBe(true);
  });

  it("2점 이상 차이는 withinOne=false", () => {
    const ai = { ...GROUND, preemptionScore: 4 };
    const rows = compareLocationScores(GROUND, ai);
    const row = rows.find((r) => r.field === "preemptionScore")!;
    expect(row.diff).toBe(2);
    expect(row.withinOne).toBe(false);
  });

  it("AI가 null(근거 못 찾음)이면 withinOne=false, diff도 null — 지어낸 값과 구분", () => {
    const ai = { ...GROUND, visibilityScore: null };
    const rows = compareLocationScores(GROUND, ai);
    const row = rows.find((r) => r.field === "visibilityScore")!;
    expect(row.ai).toBeNull();
    expect(row.diff).toBeNull();
    expect(row.withinOne).toBe(false);
  });
});

describe("summarizeAccuracy", () => {
  function result(storeCode: string, ai: Record<string, number | null>): StoreValidationResult {
    return {
      storeCode,
      storeName: storeCode,
      address: "addr",
      rows: compareLocationScores(GROUND, ai as typeof GROUND),
    };
  }

  it("빈 결과는 0/0으로 나눠도 안전하게 0을 반환한다", () => {
    const summary = summarizeAccuracy([]);
    expect(summary.totalPairs).toBe(0);
    expect(summary.withinOneRatio).toBe(0);
    expect(summary.perField.locationScore.ratio).toBe(0);
  });

  it("전체 매장×필드 쌍 중 within1 비율을 정확히 집계한다", () => {
    // 매장 1: 전부 정확히 맞음(3/3) / 매장 2: 1개만 2점 이상 차이(2/3)
    const results = [
      result("A", GROUND),
      result("B", { ...GROUND, preemptionScore: 5 }), // |2-5|=3, 벗어남
    ];
    const summary = summarizeAccuracy(results);
    expect(summary.storeCount).toBe(2);
    expect(summary.totalPairs).toBe(6);
    expect(summary.withinOneCount).toBe(5);
    expect(summary.withinOneRatio).toBeCloseTo(5 / 6);
    expect(summary.perField.preemptionScore.total).toBe(2);
    expect(summary.perField.preemptionScore.withinOne).toBe(1);
    expect(summary.perField.preemptionScore.ratio).toBeCloseTo(0.5);
    expect(summary.perField.locationScore.ratio).toBe(1);
  });
});
