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
const ORANGE: [number, number, number] = [230, 120, 40];
const RED: [number, number, number] = [200, 40, 40];

describe("브라켓 색 판정", () => {
  it("주황·빨강은 잡는다", () => {
    expect(isBracketLikeColor(...ORANGE)).toBe(true);
    expect(isBracketLikeColor(...RED)).toBe(true);
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
  it("투명 픽셀은 세지 않는다", () => {
    const rgba = new Uint8ClampedArray([230, 120, 40, 0, 230, 120, 40, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
    expect(bracketColorRatio(rgba)).toBeCloseTo(0.25, 5);
  });

  it("빈 배열이면 0", () => {
    expect(bracketColorRatio(new Uint8ClampedArray([]))).toBe(0);
  });

  it("흑백 도면은 0에 가깝다", () => {
    expect(bracketColorRatio(pixels([WHITE, 900], [BLACK, 100]))).toBe(0);
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
