import { describe, expect, it } from "vitest";
import { checkZoneDraft } from "./zoneDraftCheck";
import type { DeskLabelSet } from "./types";

// 1mm = 0.0001. 850×680 책상 가로 한 줄 n개
const row = (x0: number, y: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ x: x0 + i * 0.085, y, w: 0.085, h: 0.068 }));
const labels = (desks: ReturnType<typeof row>): DeskLabelSet => ({ desks, widths: desks.map(() => 850), mmX: 0.0001, mmY: 0.0001 });

describe("checkZoneDraft (10-29 FPS 최소 10석)", () => {
  const L = labels([...row(0.05, 0.1, 9), ...row(0.05, 0.4, 10)]);

  it("AI가 10석이라 한 FPS 줄이 실제 9석이면 fpsShort", () => {
    const c = checkZoneDraft([{ seats: 10, x: 0.04, y: 0.09, w: 0.78, h: 0.09, type: "fps" }], L);
    expect(c.actual).toEqual([9]);
    expect(c.mismatched).toEqual([1]);
    expect(c.fpsShort).toBe(true);
  });

  it("10석 줄을 고르면 통과, FPS가 없으면 검사 안 함", () => {
    expect(checkZoneDraft([{ seats: 10, x: 0.04, y: 0.39, w: 0.87, h: 0.09, type: "fps" }], L).fpsShort).toBe(false);
    expect(checkZoneDraft([{ seats: 9, x: 0.04, y: 0.09, w: 0.78, h: 0.09, type: "multi" }], L).fpsShort).toBe(false);
  });
});
