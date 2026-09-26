// floatingPatchFromSbiz — 소상공인365 반경 유동인구 -> 후보지 폼 값 (2026-09-26 입력 자동화 3번).
import { describe, expect, it } from "vitest";
import { floatingPatchFromSbiz } from "./floatingPopulationFromSbiz";
import type { SbizFloatingResult } from "./quickEval/sbizFloating";

const res = (radiusM: number, avg: number, scale = 1): SbizFloatingResult => ({
  radiusM, avg, scale, months: [], monthly: [], admiCd: "0", admiNm: "",
  scaled: { total: avg, male: Math.round(avg * 0.5), female: Math.round(avg * 0.5), age10s: 10, age20s: 20, age30s: 30, age40s: 40, age50s: 50, age60plus: 60 },
});

describe("floatingPatchFromSbiz", () => {
  it("필드 대응 — 300/400/500m는 평균·남·연령 6구간, 1km는 총량만", () => {
    const { patch, warnings } = floatingPatchFromSbiz({ 300: res(300, 1000), 400: res(400, 1500), 500: res(500, 2000), 1000: res(1000, 6000) });
    expect(patch.floating500Avg).toBe(2000);
    expect(patch.floating500Male).toBe(1000);
    expect(patch.floating400_20s).toBe(20);
    expect(patch.floating300_60plus).toBe(60);
    expect(patch.floating1000Avg).toBe(6000);
    expect("floating1000Male" in patch).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("실패한 반경은 폼에 넣지 않고(기존 값 유지) 이유와 함께 경고한다", () => {
    const { patch, records, warnings } = floatingPatchFromSbiz({ 500: res(500, 2000) }, { 400: "HTTP 500" });
    expect("floating400Avg" in patch).toBe(false);
    expect(records.find((r) => r.fieldKey === "floating400Avg")?.applied).toBe(false);
    expect(warnings.some((w) => w.includes("400m") && w.includes("HTTP 500"))).toBe(true);
    expect(warnings.some((w) => w.includes("1km"))).toBe(true);
  });

  it("최근월이 튀었거나(배율 0.85~1.15 밖) 넓은 반경이 더 적으면 경고한다", () => {
    const { warnings } = floatingPatchFromSbiz({ 300: res(300, 1000, 1.3), 400: res(400, 900), 500: res(500, 2000), 1000: res(1000, 6000) });
    expect(warnings.some((w) => w.includes("300m") && w.includes("배율 1.30"))).toBe(true);
    expect(warnings.some((w) => w.includes("400m 유동인구") && w.includes("300m"))).toBe(true);
  });
});
