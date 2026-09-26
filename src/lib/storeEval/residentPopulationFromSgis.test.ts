// residentPatchFromSgis — SGIS 반경 통계 -> 후보지 폼 값 (2026-09-26 입력 자동화 2번).
import { describe, expect, it } from "vitest";
import { residentPatchFromSgis } from "./residentPopulationFromSgis";
import type { SgisRadiusStats } from "./quickEval/sgisRadiusPopulation";

const stats = (radiusM: number, over: Partial<SgisRadiusStats> = {}): SgisRadiusStats => ({
  radiusM, totalPopulation: 1000, malePopulation: 488, femalePopulation: 512,
  ageBands: [100, 100, 100, 100, 100, 100, 100, 150, 150],
  areaSizeM2: Math.PI * radiusM * radiusM, areaOffRatio: 0, ...over,
});

describe("residentPatchFromSgis", () => {
  it("필드 대응 — 500m 총인구 · 1km 총인구·면적(㎢)·남성비율(0~1)·연령 9구간 · 기준연도", () => {
    const { patch, warnings } = residentPatchFromSgis({ baseYear: "2024", byRadius: { 500: stats(500, { totalPopulation: 300 }), 1000: stats(1000) } });
    expect(patch.demographicsYear).toBe(2024);
    expect(patch.pop500m).toBe(300);
    expect(patch.pop1km).toBe(1000);
    expect(patch.area1kmKm2).toBeCloseTo(3.1416, 4);
    expect(patch.male1kmRatio).toBe(0.488); // 퍼센트(48.8)가 아니다
    expect(patch.age1km_0_9).toBe(100);
    expect(patch.age1km_80plus).toBe(150);
    expect(warnings).toEqual([]);
  });

  it("빈 값은 폼에 넣지 않고(기존 값 유지) 기록에 applied=false로 남긴다", () => {
    const { patch, records, warnings } = residentPatchFromSgis({ baseYear: "2024", byRadius: { 1000: stats(1000) } });
    expect("pop500m" in patch).toBe(false);
    expect(records.find((r) => r.fieldKey === "pop500m")?.applied).toBe(false);
    expect(warnings.some((w) => w.includes("500m"))).toBe(true);
  });

  it("반경이 잘렸거나(면적 5%↑) 연령 합이 총인구와 다르면 경고한다", () => {
    const { warnings } = residentPatchFromSgis({
      baseYear: "2024",
      byRadius: { 500: stats(500), 1000: stats(1000, { areaOffRatio: 0.12, ageBands: [100, 100, 100, 100, 100, 100, 100, 100, 100] }) },
    });
    expect(warnings.some((w) => w.includes("1000m 조회면적"))).toBe(true);
    expect(warnings.some((w) => w.includes("연령 9구간 합"))).toBe(true);
  });
});
