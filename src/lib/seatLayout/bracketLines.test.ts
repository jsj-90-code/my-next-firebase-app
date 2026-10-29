import { describe, expect, it } from "vitest";
import { clippedAlong, isBracketOrange, markBracketDesks, type DeskFrame } from "./bracketLines";

// 가로로 놓인 책상(폭 100, 깊이 80) 가운데 (100,100)
const desk: DeskFrame = { cx: 100, cy: 100, ux: 1, uy: 0, hw: 50, hd: 40 };

describe("bracketLines", () => {
  it("주황 #e64d19만 브라켓 색으로 본다(빨강·분홍 벽체 표시는 아님)", () => {
    expect(isBracketOrange("#e64d19")).toBe(true);
    expect(isBracketOrange("#ff0000")).toBe(false);
    expect(isBracketOrange("#ff007f")).toBe(false);
    expect(isBracketOrange("#000000")).toBe(false);
  });

  it("책상 폭 방향 선은 책상 안 길이만, 가로지르는 선·책상 밖 선은 0", () => {
    expect(clippedAlong(desk, [0, 120, 300, 120])).toBeCloseTo(100);
    expect(clippedAlong(desk, [100, 0, 100, 300])).toBe(0); // 깊이 방향(가로지름)
    expect(clippedAlong(desk, [0, 200, 300, 200])).toBe(0); // 책상 밖
  });

  it("기운 책상은 책상 방향으로 잰다", () => {
    const c = Math.SQRT1_2;
    const tilted: DeskFrame = { cx: 0, cy: 0, ux: c, uy: c, hw: 50, hd: 40 };
    expect(clippedAlong(tilted, [-100 * c, -100 * c, 100 * c, 100 * c])).toBeCloseTo(100);
  });

  it("폭의 절반 넘게 덮이면 브라켓 책상, 주황 선이 아예 없으면 null", () => {
    const other: DeskFrame = { ...desk, cx: 300 };
    expect(markBracketDesks([desk, other], [[0, 110, 160, 110]])).toEqual([true, false]);
    expect(markBracketDesks([desk], [])).toBeNull();
  });
});
