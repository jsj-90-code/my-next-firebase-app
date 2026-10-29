import { describe, expect, it } from "vitest";
import { findPlateMapRect } from "./plateAutoCrop";

// 200×140 흰 바탕에 회사 양식처럼: 범례 상자(가는 테두리), 평면도(큰 덩어리), 119 띠, 오른쪽 글 칸
function plate(): Uint8Array {
  const W = 200, H = 140;
  const g = new Uint8Array(W * H).fill(255);
  const box = (x0: number, y0: number, x1: number, y1: number, fill = false) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (fill || y === y0 || y === y1 || x === x0 || x === x1) g[y * W + x] = 60;
    }
  };
  box(20, 30, 100, 40); // 범례 상자
  box(30, 50, 90, 100); // 평면도 바깥 벽
  box(40, 60, 60, 70, true); // 평면도 안 좌석
  box(20, 110, 60, 118, true); // 119 띠
  box(125, 20, 190, 120, true); // 오른쪽 글 칸(창 밖)
  return g;
}

describe("findPlateMapRect (10-29 피난안내도 자동 자르기)", () => {
  it("왼쪽 칸에서 가장 큰 덩어리(평면도)만 고른다", () => {
    const r = findPlateMapRect(plate(), 200, 140)!;
    // 평면도 x 30~90, y 50~100 (+ 부풀린 2칸, 여백 1%)
    expect(r.x).toBeGreaterThan(0.12);
    expect(r.x).toBeLessThan(0.15);
    expect(r.y).toBeGreaterThan(0.33);
    expect(r.y + r.h).toBeLessThan(0.76);
    expect(r.x + r.w).toBeLessThan(0.48);
  });

  it("평면도가 너무 작으면 null(사람이 자른다)", () => {
    const g = new Uint8Array(200 * 140).fill(255);
    g[70 * 200 + 50] = 0;
    expect(findPlateMapRect(g, 200, 140)).toBeNull();
  });
});
