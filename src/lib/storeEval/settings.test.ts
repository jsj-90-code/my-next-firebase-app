import { describe, expect, it } from "vitest";
import { mergeModelSettings } from "./settings";

describe("mergeModelSettings", () => {
  it("옛 Firestore 문서의 일부 v61Training 값과 새 기본 필드를 깊게 병합한다", () => {
    const merged = mergeModelSettings({
      v61Training: { ridgeLambda: 3, ridgeWeight: 0.7, baselineWeight: 0.3 } as never,
      updatedAt: 123,
      updatedBy: "tester",
    });
    expect(merged.v61Training.ridgeLambda).toBe(3);
    expect(merged.v61Training.ridgeWeight).toBe(0.7);
    expect(merged.v61Training.minSampleCount).toBe(12);
    expect(merged.v61Training.minMarketDemandCoef).toBe(0.03);
    expect(merged.v61Training.minCompetitivenessGapCoef).toBe(0.06);
    expect(merged.v61Training.minBackingDemandCoef).toBe(0.05);
    expect(merged.updatedAt).toBe(123);
  });

  it("설정 배열은 인덱스 병합하지 않고 저장값 전체로 교체한다", () => {
    const demandCaptureTable = [{ gapLowerBound: -99, captureRate: 0.25, growthRate: 0 }];
    expect(mergeModelSettings({ demandCaptureTable }).demandCaptureTable).toEqual(demandCaptureTable);
  });
});
