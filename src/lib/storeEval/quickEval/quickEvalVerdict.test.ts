// quickEvalFinalEstimate — 주소만 초기평가 판정 값 고르기 (2026-09-27).
import { describe, expect, it } from "vitest";
import { QUICK_EVAL_LAB_GUARD, quickEvalFinalEstimate } from "./quickEvalVerdict";

describe("quickEvalFinalEstimate", () => {
  it("기본은 V62", () => {
    expect(quickEvalFinalEstimate(60_000_000, 50_000_000)).toMatchObject({ value: 60_000_000, source: "V62", reason: null });
  });
  it("실험실이 V62의 절반 아래면 실험실 — 시흥 신현역형(6,075만 vs 1,622만)", () => {
    const f = quickEvalFinalEstimate(60_750_000, 16_220_000);
    expect(f.source).toBe("실험실");
    expect(f.value).toBe(16_220_000);
    expect(QUICK_EVAL_LAB_GUARD.ratio).toBe(2);
  });
  it("절반 이상이면 V62 그대로(문경형 6,266만 vs 3,955만 = 1.58배)", () => {
    expect(quickEvalFinalEstimate(62_660_000, 39_550_000).source).toBe("V62");
  });
  it("검증 불가 구간이면 낮은 쪽 · V62가 없으면 실험실 · 둘 다 없으면 null", () => {
    const far = [{ field: "상권수요" as const, value: 300, min: 1128, max: 17429, side: "아래" as const, far: true }];
    expect(quickEvalFinalEstimate(40_000_000, 30_000_000, far).source).toBe("실험실");
    expect(quickEvalFinalEstimate(null, 5_000_000).source).toBe("실험실");
    expect(quickEvalFinalEstimate(null, null).value).toBeNull();
  });
  it("고립 상권(2km 안 PC방 0곳)이면 실험실 — 신현역형은 실험실이 V62의 절반을 넘어도 실험실(3,075만 vs 6,075만)", () => {
    expect(quickEvalFinalEstimate(60_750_000, 30_750_000, [], { isolated: true })).toMatchObject({ value: 30_750_000, source: "실험실" });
    expect(quickEvalFinalEstimate(60_750_000, 30_750_000).source).toBe("V62");
    expect(quickEvalFinalEstimate(60_000_000, null, [], { isolated: true }).source).toBe("V62");
  });
});
