import { describe, expect, it } from "vitest";
import { countUncoveredDesks, cropDeskLabels, snapZonesToDesks } from "./deskLabels";
import type { DeskLabelSet } from "./types";

// 1mm = 0.0001(가로·세로 같음) — 850×680 책상 = 0.085×0.068, 의자 600mm = 0.06.
const MM = 0.0001;
const desk = (x: number, y: number, w = 0.085, h = 0.068) => ({ x, y, w, h });
// 가로로 놓인 책상 4개 한 줄(의자는 위쪽), y=0.5~0.568.
const row = (x0: number, y: number) => [0, 1, 2, 3].map((i) => desk(x0 + i * 0.085, y));
const set = (desks: ReturnType<typeof desk>[]): DeskLabelSet => ({ desks, mmX: MM, mmY: MM });

describe("snapZonesToDesks", () => {
  it("삐뚤게 잡은 상자를 책상 끝 + 의자 쪽 600mm에 곧게 맞춘다", () => {
    const labels = set(row(0.1, 0.5));
    // AI: 위로 의자까지(조금 덜), 아래·좌우는 1~2% 어긋남.
    const [r] = snapZonesToDesks([{ x: 0.09, y: 0.445, w: 0.355, h: 0.13 }], labels);
    expect(r.snapped).toBe(true);
    expect(r.deskCount).toBe(4);
    expect(r.rect.x).toBeCloseTo(0.1, 4);
    expect(r.rect.x + r.rect.w).toBeCloseTo(0.44, 4);
    expect(r.rect.y).toBeCloseTo(0.44, 4); // 0.5 - 의자 0.06
    expect(r.rect.y + r.rect.h).toBeCloseTo(0.568, 4); // 아래는 책상 끝
  });

  it("줄 끝(책상 폭 방향)에는 의자를 더하지 않는다", () => {
    const labels = set(row(0.1, 0.5));
    const [r] = snapZonesToDesks([{ x: 0.07, y: 0.44, w: 0.4, h: 0.13 }], labels);
    expect(r.rect.x).toBeCloseTo(0.1, 4);
    expect(r.rect.x + r.rect.w).toBeCloseTo(0.44, 4);
  });

  it("방 유형은 건드리지 않는다", () => {
    const labels = set(row(0.1, 0.5));
    const z = { x: 0.05, y: 0.4, w: 0.45, h: 0.25, typeKey: "ceremony_team" };
    const [r] = snapZonesToDesks([z], labels);
    expect(r.snapped).toBe(false);
    expect(r.rect).toEqual({ x: 0.05, y: 0.4, w: 0.45, h: 0.25 });
  });

  it("벽까지 크게 잡은 변(의자 깊이 2.2배 넘게)은 그대로 둔다", () => {
    const labels = set(row(0.1, 0.5));
    const [r] = snapZonesToDesks([{ x: 0.1, y: 0.3, w: 0.34, h: 0.268 }], labels);
    expect(r.rect.y).toBeCloseTo(0.3, 4);
  });

  it("마주 보는 두 줄의 의자가 통로에서 겹치면 가운데에서 나눈다", () => {
    // 위 줄(의자 아래쪽) y=0.3~0.368, 아래 줄(의자 위쪽) y=0.45~0.518 — 통로 0.082 < 의자 둘 0.12.
    const labels = set([...row(0.1, 0.3), ...row(0.1, 0.45)]);
    const [a, b] = snapZonesToDesks(
      [
        { x: 0.1, y: 0.3, w: 0.34, h: 0.13 },
        { x: 0.1, y: 0.39, w: 0.34, h: 0.128 },
      ],
      labels,
    );
    expect(a.deskCount).toBe(4);
    expect(b.deskCount).toBe(4);
    expect(a.rect.y + a.rect.h).toBeCloseTo(0.409, 4);
    expect(b.rect.y).toBeCloseTo(0.409, 4);
  });

  it("등 맞댄 두 줄을 따로 잡으면 글씨로 그린 책상이 겹쳐도 맞댄 선에서 나눈다", () => {
    // 글씨가 맞댄 쪽에 붙어 있어 위 줄 책상이 0.51까지, 아래 줄 책상이 0.49부터로 겹친 경우 — 실제 맞댄 선 0.5.
    const labels = set([...row(0.1, 0.442), ...row(0.1, 0.49)]);
    const [a, b] = snapZonesToDesks(
      [
        { x: 0.1, y: 0.38, w: 0.34, h: 0.13, typeKey: "fps" },
        { x: 0.1, y: 0.495, w: 0.34, h: 0.13, typeKey: "multi" },
      ],
      labels,
    );
    expect(a.deskCount).toBe(4);
    expect(b.deskCount).toBe(4);
    expect(a.rect.y + a.rect.h).toBeCloseTo(0.5, 4);
    expect(b.rect.y).toBeCloseTo(0.5, 4);
  });

  it("책상 글씨가 없는 상자는 그대로 두고 좌석 수 비교도 하지 않는다", () => {
    const [r] = snapZonesToDesks([{ x: 0.7, y: 0.7, w: 0.1, h: 0.1 }], set(row(0.1, 0.5)));
    expect(r).toEqual({ rect: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 }, deskCount: null, snapped: false });
  });

  it("책상이 두 상자에 걸치면 작은 상자 몫", () => {
    const labels = set(row(0.1, 0.5));
    const res = snapZonesToDesks(
      [
        { x: 0.05, y: 0.4, w: 0.6, h: 0.3 },
        { x: 0.095, y: 0.44, w: 0.18, h: 0.13 },
      ],
      labels,
    );
    expect(res[1].deskCount).toBe(2);
    expect(res[0].deskCount).toBe(2);
  });
});

describe("cropDeskLabels", () => {
  it("자른 영역 기준 좌표로 바꾸고 바깥 글씨는 버린다", () => {
    const out = cropDeskLabels(set([desk(0.3, 0.3), desk(0.9, 0.9)]), { x: 0.2, y: 0.2, w: 0.5, h: 0.5 })!;
    expect(out.desks).toHaveLength(1);
    expect(out.desks[0].x).toBeCloseTo(0.2, 4);
    expect(out.desks[0].w).toBeCloseTo(0.17, 4);
    expect(out.mmX).toBeCloseTo(MM / 0.5, 8);
  });
});

describe("countUncoveredDesks", () => {
  it("존 상자에 가운데가 안 든 책상만 센다", () => {
    const labels = set(row(0.1, 0.5));
    expect(countUncoveredDesks(labels, [])).toBe(4);
    expect(countUncoveredDesks(labels, [{ x: 0.09, y: 0.44, w: 0.18, h: 0.14 }])).toBe(2);
    expect(countUncoveredDesks(labels, [{ x: 0.09, y: 0.44, w: 0.36, h: 0.14 }])).toBe(0);
  });
});
