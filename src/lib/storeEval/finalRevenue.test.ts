import { describe, expect, it } from "vitest";
import { pickFinalRevenue } from "./finalRevenue";
import type { DualEstimate } from "./dualEstimate";

const dual = (primary: "V62" | "실험실", v62: number, lab: number) =>
  ({ primary, primaryValue: primary === "V62" ? v62 : lab, v62, lab } as unknown as DualEstimate);

describe("pickFinalRevenue", () => {
  it("담당자 판단값이 있으면 그 값", () => {
    expect(pickFinalRevenue({ judgedRevenue: 45_000_000 }, { v62Final: 68_830_000, dualEstimate: dual("실험실", 68_830_000, 38_020_000) }))
      .toEqual({ value: 45_000_000, source: "담당자" });
  });
  it("판단값이 없으면 추천 산식 값 — 실험실 추천이면 실험실", () => {
    expect(pickFinalRevenue({ judgedRevenue: null }, { v62Final: 68_830_000, dualEstimate: dual("실험실", 68_830_000, 38_020_000) }))
      .toEqual({ value: 38_020_000, source: "실험실" });
  });
  it("V62 추천이면 V62", () => {
    expect(pickFinalRevenue({ judgedRevenue: null }, { v62Final: 64_170_000, dualEstimate: dual("V62", 64_170_000, 71_870_000) }))
      .toEqual({ value: 64_170_000, source: "V62" });
  });
  it("옛 결과(dualEstimate 없음)는 V62, 결과 없으면 빈 값", () => {
    expect(pickFinalRevenue(null, { v62Final: 50_000_000, dualEstimate: null })).toEqual({ value: 50_000_000, source: "V62" });
    expect(pickFinalRevenue(null, undefined)).toEqual({ value: null, source: null });
  });
});
