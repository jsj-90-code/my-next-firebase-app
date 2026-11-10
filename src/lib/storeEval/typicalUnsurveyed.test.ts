import { describe, expect, it } from "vitest";
import {
  computeCompetitorAppliedPcCount,
  computeCompetitorOccupiedSeats,
  computeCompetitorScores,
  DEFAULT_UNSURVEYED_PC_COUNT,
  UNSURVEYED_TYPICAL_COMPETITOR_SCORE,
} from "./calc";
import { blankCompetitor } from "./blankCompetitor";
import { defaultModelSettings } from "./settings";
import type { Competitor } from "./types";

const comp = (over: Partial<Competitor>): Competitor => ({ ...blankCompetitor("N999"), name: "경쟁", ...over });
const settings = defaultModelSettings();

describe("보통경쟁력미조사 (2026-11-11)", () => {
  it("아무것도 안 적으면 4항목·종합이 전부 보통값이고 대수는 간략_기본대수", () => {
    const c = comp({ investigationStatus: "보통경쟁력미조사" });
    const s = computeCompetitorScores(c, settings);
    expect(s.spec).toBe(UNSURVEYED_TYPICAL_COMPETITOR_SCORE);
    expect(s.food).toBe(UNSURVEYED_TYPICAL_COMPETITOR_SCORE);
    expect(s.interior).toBe(UNSURVEYED_TYPICAL_COMPETITOR_SCORE);
    expect(s.location).toBe(UNSURVEYED_TYPICAL_COMPETITOR_SCORE);
    expect(s.total).toBeCloseTo(UNSURVEYED_TYPICAL_COMPETITOR_SCORE, 6);
    expect(computeCompetitorAppliedPcCount(c)).toBe(DEFAULT_UNSURVEYED_PC_COUNT);
  });

  it("노후저경쟁력미조사보다 세고(시설 1.0 안 씀), 실가동좌석엔 0을 더한다", () => {
    const low = computeCompetitorScores(comp({ investigationStatus: "노후저경쟁력미조사" }), settings).total!;
    const mid = computeCompetitorScores(comp({ investigationStatus: "보통경쟁력미조사" }), settings).total!;
    expect(mid).toBeGreaterThan(low);
    const occ = computeCompetitorOccupiedSeats([comp({ investigationStatus: "보통경쟁력미조사" })]);
    expect(occ.coverage.assumedLowThreat).toBe(1);
    expect(occ.coverage.missingData).toBe(0);
  });
});
