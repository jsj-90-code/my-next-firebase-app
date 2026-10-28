import { describe, expect, it } from "vitest";
import { cropWallLines, findWalledRoom } from "./roomSplit";
import type { DeskLabelSet } from "./types";

// 1mm = 0.0001 — 850×680 책상 = 0.085×0.068, 의자 600mm = 0.06.
const MM = 0.0001;
const desk = (x: number, y: number) => ({ x, y, w: 0.085, h: 0.068 });
const row = (y: number) => [0, 1, 2, 3].map((i) => desk(0.1 + i * 0.085, y));
// 위 줄(y 0.30~0.368, 의자 위쪽) + 아래 줄(0.368~0.436, 의자 아래쪽) 등 맞댄 섬. 맞댄 칸막이 선 y=0.368.
const desks = [...row(0.3), ...row(0.368)];
const seam = [0.09, 0.368, 0.45, 0.368];
const rect = { x: 0.1, y: 0.24, w: 0.34, h: 0.256 };
const all = desks.map((_, i) => i);

describe("findWalledRoom", () => {
  it("위 줄 의자 쪽이 위 벽 + 양 끝 벽으로 막혔으면 4인룸 + 아래 줄로 나눈다", () => {
    const labels: DeskLabelSet = {
      desks, mmX: MM, mmY: MM,
      walls: [seam, [0.09, 0.21, 0.45, 0.21], [0.095, 0.21, 0.095, 0.368], [0.445, 0.21, 0.445, 0.368]],
    };
    const r = findWalledRoom(all, rect, labels, "multi")!;
    expect(r.roomType).toBe("four_room");
    expect(r.roomDesks.sort()).toEqual([0, 1, 2, 3]);
    expect(r.otherDesks).toHaveLength(4);
    expect(r.roomRect.x).toBeCloseTo(0.095, 4);
    expect(r.roomRect.x + r.roomRect.w).toBeCloseTo(0.445, 4);
    expect(r.roomRect.y).toBeCloseTo(0.21, 4);
    expect(r.roomRect.y + r.roomRect.h).toBeCloseTo(0.368, 4);
    expect(r.otherRect.y).toBeCloseTo(0.368, 4);
    expect(r.otherRect.y + r.otherRect.h).toBeCloseTo(0.496, 4);
  });

  it("양 끝 칸막이가 책상 깊이까지만 있으면(일반 섬) 나누지 않는다", () => {
    const labels: DeskLabelSet = {
      desks, mmX: MM, mmY: MM,
      walls: [seam, [0.09, 0.21, 0.45, 0.21], [0.095, 0.29, 0.095, 0.446], [0.445, 0.29, 0.445, 0.446]],
    };
    expect(findWalledRoom(all, rect, labels, "multi")).toBeNull();
  });

  it("VIP 같은 모양 유형과 벽 선 없는 도면은 건드리지 않는다", () => {
    const walls = [seam, [0.09, 0.21, 0.45, 0.21], [0.095, 0.21, 0.095, 0.368], [0.445, 0.21, 0.445, 0.368]];
    expect(findWalledRoom(all, rect, { desks, mmX: MM, mmY: MM, walls }, "vip")).toBeNull();
    expect(findWalledRoom(all, rect, { desks, mmX: MM, mmY: MM }, "multi")).toBeNull();
  });
});

describe("cropWallLines", () => {
  it("자른 영역 기준으로 바꾸고 밖의 선은 버린다", () => {
    const out = cropWallLines([[0.3, 0.3, 0.6, 0.3], [0.9, 0.9, 0.95, 0.9]], { x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    expect(out).toEqual([[0.2, 0.2, 0.8, 0.2]]);
  });
});
