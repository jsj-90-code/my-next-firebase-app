import { describe, expect, it } from "vitest";
import { autoCropRect, countDesksByZone, countUncoveredDesks, cropDeskLabels, deskSizeOfWidth, snapZonesToDesks } from "./deskLabels";
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
    expect(r).toEqual({ rect: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 }, deskCount: null, snapped: false, desks: [] });
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

describe("countDesksByZone (10-29 책상 인식 채팅 대신)", () => {
  // 한 줄 4개: 850·850·910·1000
  const withWidths = (): DeskLabelSet => ({ ...set(row(0.1, 0.5)), widths: [850, 850, 910, 1000] });

  it("존 안 책상 글씨로 수량·사이즈를 센다", () => {
    const [c] = countDesksByZone(withWidths(), [{ x: 0.09, y: 0.44, w: 0.36, h: 0.14 }]);
    expect(c).toEqual({
      bagShelf: null,
      seats: 4,
      sizeBreakdown: [
        { deskSize: "850mm", qty: 2 },
        { deskSize: "910mm", qty: 1 },
        { deskSize: "1000mm", qty: 1 },
      ],
      unknown: 0,
    });
  });

  it("두 존에 걸친 책상은 더 작은 존 몫, 책상이 없는 존(카운터)은 null", () => {
    const big = { x: 0.09, y: 0.44, w: 0.36, h: 0.14 };
    const small = { x: 0.09, y: 0.44, w: 0.1, h: 0.14 }; // 첫 책상만
    const counter = { x: 0.8, y: 0.1, w: 0.05, h: 0.05 };
    const [b, s, k] = countDesksByZone(withWidths(), [big, small, counter]);
    expect(b?.seats).toBe(3);
    expect(s?.seats).toBe(1);
    expect(k).toBeNull();
  });

  it("폭 정보가 없는 옛 도면이면 모두 null(지금 값 유지)", () => {
    expect(countDesksByZone(set(row(0.1, 0.5)), [{ x: 0, y: 0, w: 1, h: 1 }])).toEqual([null]);
  });

  it("표준에서 30mm 넘게 벗어난 폭은 사이즈 미정으로 센다", () => {
    expect(deskSizeOfWidth(820)).toBe("820mm");
    expect(deskSizeOfWidth(940)).toBe("950mm");
    expect(deskSizeOfWidth(1200)).toBeNull();
    const [c] = countDesksByZone({ ...set(row(0.1, 0.5)), widths: [850, 850, 850, 1200] }, [{ x: 0, y: 0, w: 1, h: 1 }]);
    expect(c?.seats).toBe(4);
    expect(c?.unknown).toBe(1);
  });

  it("도면을 자를 때 폭도 같이 따라간다", () => {
    const labels: DeskLabelSet = withWidths();
    const cropped = cropDeskLabels(labels, { x: 0.18, y: 0.4, w: 0.5, h: 0.3 })!; // 첫 책상(가운데 x=0.1425) 빠짐
    expect(cropped.desks).toHaveLength(3);
    expect(cropped.widths).toEqual([850, 910, 1000]);
  });
});

describe("브라켓 (10-29 도면 주황 선)", () => {
  it("존마다 브라켓 달린 책상 수를 같이 센다", () => {
    const labels: DeskLabelSet = { ...set(row(0.1, 0.5)), widths: [850, 850, 850, 850], brackets: [true, true, false, false] };
    const [a, b] = countDesksByZone(labels, [{ x: 0.09, y: 0.44, w: 0.18, h: 0.14 }, { x: 0.27, y: 0.44, w: 0.18, h: 0.14 }]);
    expect(a?.bagShelf).toBe(2);
    expect(b?.bagShelf).toBe(0);
  });
  it("자를 때 브라켓 표시도 따라간다", () => {
    const labels: DeskLabelSet = { ...set(row(0.1, 0.5)), widths: [850, 850, 910, 1000], brackets: [true, false, true, false] };
    expect(cropDeskLabels(labels, { x: 0.18, y: 0.4, w: 0.5, h: 0.3 })!.brackets).toEqual([false, true, false]);
  });
});

describe("autoCropRect (10-29 도면 영역 자동 자르기)", () => {
  it("책상에서 이어진 벽까지 넓히고, 떨어진 선(제목 칸)과 쪽 테두리는 넘긴다", () => {
    const labels: DeskLabelSet = {
      ...set(row(0.3, 0.5)), // 책상 x 0.3~0.64, y 0.5~0.568
      walls: [
        0.25, 0.4, 0.7, 0.4, // 책상 위 1m 벽(닿음) → 위로 넓힘
        0.25, 0.4, 0.25, 0.65, // 왼쪽 벽(닿음) → 왼쪽으로 넓힘
        0.9, 0.1, 0.9, 0.4, // 오른쪽 멀리 떨어진 제목 칸 선 → 안 넓힘
        0, 0.98, 1, 0.98, // 쪽 테두리(아주 긴 선) → 안 넓힘
      ],
    };
    const r = autoCropRect(labels);
    expect(r.x).toBeCloseTo(0.25 - 0.03, 4); // 30cm 여백
    expect(r.y).toBeCloseTo(0.4 - 0.03, 4);
    expect(r.x + r.w).toBeCloseTo(0.7 + 0.03, 4);
    expect(r.y + r.h).toBeCloseTo(0.65 + 0.03, 4);
  });
});

describe("상자 밖 가까운 책상 붙이기 (10-29 호구포TEST)", () => {
  // 세로로 두 줄(위 줄 y=0.5, 아래 줄 y=0.568) — 아래 줄 가운데는 y≈0.602
  const two = (): DeskLabelSet => set([...row(0.1, 0.5), ...row(0.1, 0.568)]);

  it("AI 좌석 수가 상자 안 책상보다 많으면 바로 밖 줄을 모자란 만큼 붙인다", () => {
    // 상자 아래 끝 0.6 — 아래 줄 가운데(0.602)보다 조금 모자람
    const [r] = snapZonesToDesks([{ x: 0.09, y: 0.44, w: 0.36, h: 0.16, seats: 8 }], two());
    expect(r.deskCount).toBe(8);
    expect(r.rect.y + r.rect.h).toBeGreaterThan(0.6);
  });

  it("좌석 수를 모르면 30cm 넘게 떨어진 책상은 안 붙인다", () => {
    const [r] = snapZonesToDesks([{ x: 0.09, y: 0.44, w: 0.36, h: 0.13 }], two());
    expect(r.deskCount).toBe(4);
  });
});
