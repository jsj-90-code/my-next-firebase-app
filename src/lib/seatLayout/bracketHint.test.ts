// 브라켓 표시 페이지 힌트 테스트 (2026-09-14 신설).
//
// 이건 화면에 "이 페이지일 수 있어요"를 띄우는 근거라, 헛짚으면 잘못된 페이지를 고르게 만든다.
// 그래서 고정하는 건 "잘 찾는다"보다 **"애매하면 아무 말도 안 한다"** 쪽이다.

import { describe, expect, it } from "vitest";
import {
  BRACKET_HINT_MIN_RATIO,
  bracketColorRatio,
  isBracketLikeColor,
  pickLikelyBracketPage,
} from "./bracketHint";

/** RGBA 배열 만들기 — [색, 개수] 쌍을 늘어놓는다. */
const pixels = (...runs: [[number, number, number], number][]) => {
  const out: number[] = [];
  for (const [[r, g, b], n] of runs) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return new Uint8ClampedArray(out);
};

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [20, 20, 20];
/** 실제 도면의 브라켓 주황(g/r ≈ 0.34). 이 띠만 페이지를 가른다. */
const BRACKET_ORANGE: [number, number, number] = [220, 75, 40];
/** 도면 전체에 깔려 있는 주석·치수선 빨강. 세면 모든 페이지가 비슷해져서 일부러 뺀다. */
const ANNOTATION_RED: [number, number, number] = [255, 0, 0];
/** 살구/노랑 쪽 — 표지·범례에 흔하다. */
const AMBER: [number, number, number] = [255, 190, 60];

describe("브라켓 색 판정", () => {
  it("브라켓 주황은 잡는다", () => {
    expect(isBracketLikeColor(...BRACKET_ORANGE)).toBe(true);
  });

  // 2026-09-14 — 첫 판이 실패한 지점이다. 빨강까지 세니 실제 도면의 모든 페이지가 비슷해져
  // 아무 페이지도 못 짚었다(평택소사벌점 10장 전부 붉은 계열 0.68~4.34%, 1·2등 차이 1.14배).
  it("주석·치수선 빨강은 안 잡는다 — 모든 페이지에 있어서 변별이 안 된다", () => {
    expect(isBracketLikeColor(...ANNOTATION_RED)).toBe(false);
    expect(isBracketLikeColor(200, 40, 40)).toBe(false);
  });

  it("살구·노랑도 안 잡는다", () => {
    expect(isBracketLikeColor(...AMBER)).toBe(false);
    expect(isBracketLikeColor(230, 120, 40)).toBe(false);
  });

  it("도면의 흑백선과 종이 배경은 안 잡는다", () => {
    expect(isBracketLikeColor(...WHITE)).toBe(false);
    expect(isBracketLikeColor(...BLACK)).toBe(false);
    expect(isBracketLikeColor(128, 128, 128)).toBe(false);
  });

  it("파랑·초록은 안 잡는다 — 다른 존 색이 걸리면 안 된다", () => {
    expect(isBracketLikeColor(62, 107, 158)).toBe(false); // FC ONLINE존 파랑
    expect(isBracketLikeColor(92, 138, 90)).toBe(false); // 1인석 초록
  });

  it("아주 어두운 적갈색은 안 잡는다 — 글씨·그림자다", () => {
    expect(isBracketLikeColor(70, 20, 20)).toBe(false);
  });
});

describe("페이지별 비율", () => {
  it("투명 픽셀은 분자·분모 양쪽에서 뺀다", () => {
    // 투명 주황 1 + 불투명 주황 1 + 흰색 2 → 불투명 3개 중 1개
    const rgba = new Uint8ClampedArray([220, 75, 40, 0, 220, 75, 40, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
    expect(bracketColorRatio(rgba)).toBeCloseTo(1 / 3, 5);
  });

  it("빈 배열이면 0", () => {
    expect(bracketColorRatio(new Uint8ClampedArray([]))).toBe(0);
  });

  it("흑백 도면은 0이다", () => {
    expect(bracketColorRatio(pixels([WHITE, 900], [BLACK, 100]))).toBe(0);
  });

  it("빨간 주석만 가득한 페이지도 0이다", () => {
    expect(bracketColorRatio(pixels([WHITE, 900], [ANNOTATION_RED, 100]))).toBe(0);
  });

  it("실측값 언저리를 재현한다 — 브라켓 페이지는 기준을 넘는다", () => {
    // 광주첨단점 3페이지가 0.65%였다. 1000px 중 7px면 0.7%.
    const ratio = bracketColorRatio(pixels([WHITE, 993], [BRACKET_ORANGE, 7]));
    expect(ratio).toBeGreaterThan(BRACKET_HINT_MIN_RATIO);
  });

  it("브라켓 없는 페이지의 실측 최고치(0.34%)는 기준을 못 넘는다", () => {
    const ratio = bracketColorRatio(pixels([WHITE, 9966], [BRACKET_ORANGE, 34]));
    expect(ratio).toBeLessThan(BRACKET_HINT_MIN_RATIO);
  });
});

describe("어느 페이지를 짚을까", () => {
  it("표시가 뚜렷한 페이지를 짚는다", () => {
    expect(pickLikelyBracketPage([
      { pageNumber: 1, ratio: 0.0001 },
      { pageNumber: 2, ratio: 0 },
      { pageNumber: 3, ratio: 0.02 },
    ])).toBe(3);
  });

  // 실제 도면 2건의 실측값을 그대로 넣는다. 규칙을 손볼 때 이게 깨지면 현실에서 못 짚는다는 뜻이다.
  it("평택소사벌점 실측값에서 3페이지를 짚는다", () => {
    expect(pickLikelyBracketPage([
      { pageNumber: 1, ratio: 0.000753 }, { pageNumber: 2, ratio: 0.002696 },
      { pageNumber: 3, ratio: 0.016054 }, { pageNumber: 4, ratio: 0.000397 },
      { pageNumber: 5, ratio: 0.000397 }, { pageNumber: 6, ratio: 0.003386 },
      { pageNumber: 7, ratio: 0.002655 }, { pageNumber: 8, ratio: 0.000753 },
      { pageNumber: 9, ratio: 0.002383 }, { pageNumber: 10, ratio: 0.001317 },
    ])).toBe(3);
  });

  it("광주첨단점 실측값에서 3페이지를 짚는다 — 여유가 더 적은 쪽이다", () => {
    expect(pickLikelyBracketPage([
      { pageNumber: 1, ratio: 0.000502 }, { pageNumber: 2, ratio: 0.001463 },
      { pageNumber: 3, ratio: 0.006522 }, { pageNumber: 4, ratio: 0.000272 },
      { pageNumber: 5, ratio: 0.000460 }, { pageNumber: 6, ratio: 0.002216 },
      { pageNumber: 7, ratio: 0.001066 }, { pageNumber: 8, ratio: 0.001756 },
      { pageNumber: 9, ratio: 0.000982 }, { pageNumber: 10, ratio: 0.002174 },
      { pageNumber: 11, ratio: 0.001380 },
    ])).toBe(3);
  });

  it("페이지 번호에 매이지 않는다 — 1페이지여도 짚는다", () => {
    expect(pickLikelyBracketPage([
      { pageNumber: 1, ratio: 0.03 },
      { pageNumber: 2, ratio: 0.0001 },
    ])).toBe(1);
  });

  it("어디에도 표시가 없으면 아무 말도 안 한다", () => {
    expect(pickLikelyBracketPage([
      { pageNumber: 1, ratio: 0 },
      { pageNumber: 2, ratio: BRACKET_HINT_MIN_RATIO / 2 },
    ])).toBeNull();
  });

  it("두 페이지가 비슷하면 짚지 않는다 — 헛짚느니 침묵한다", () => {
    expect(pickLikelyBracketPage([
      { pageNumber: 2, ratio: 0.01 },
      { pageNumber: 3, ratio: 0.009 },
    ])).toBeNull();
  });

  it("페이지가 하나뿐이어도 기준을 넘으면 짚는다", () => {
    expect(pickLikelyBracketPage([{ pageNumber: 1, ratio: 0.02 }])).toBe(1);
  });

  it("빈 목록이면 null", () => {
    expect(pickLikelyBracketPage([])).toBeNull();
  });
});
