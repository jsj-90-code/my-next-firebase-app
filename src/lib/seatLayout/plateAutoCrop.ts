// 피난안내도(좌석번호표) 그림에서 평면도 부분만 자동으로 자른다. (2026-10-29)
//
// 사용자 「피난안내도도 이미지 업로드하면 자동 구역 지정」. 피난안내도는 그림(JPG)이라 도면 PDF처럼 글씨·선 데이터가 없다.
// 회사 양식이 같다(시험 3장 모두 2717×1890, 왼쪽 칸 = 제목·범례 상자·평면도·119 띠, 오른쪽 칸 = 대처요령 글).
// → 왼쪽 칸 안에서 흰 바탕이 아닌 점을 조금 부풀려 이어진 덩어리로 묶고, 가장 큰 덩어리(평면도)를 고른다.
// 범례 상자·119 띠·제목 글자는 평면도와 흰 틈으로 떨어져 있어 다른 덩어리가 된다.
// 실패(덩어리가 너무 작음)하면 null — 그때는 예전처럼 사람이 자른다.
import type { NormalizedRect } from "./types";

// 왼쪽 칸 범위(양식 기준 비율). 오른쪽 글 칸은 x≈0.59부터, 바깥 갈색 테두리는 x<0.05·y<0.08·y>0.92.
const WIN = { x0: 0.05, x1: 0.585, y0: 0.2, y1: 0.9 };
const LIGHT = 215; // 이보다 밝으면 흰 바탕
const GROW = 2; // 덩어리를 이을 때 부풀리는 칸 수(축소 그림 기준)

/**
 * gray: 축소한 그림의 밝기(0~255) 한 줄씩, width×height. 평면도 덩어리를 감싼 비율 상자(여백 1%) 또는 null.
 */
export function findPlateMapRect(gray: Uint8Array | Uint8ClampedArray, width: number, height: number): NormalizedRect | null {
  const gx0 = Math.floor(WIN.x0 * width), gx1 = Math.ceil(WIN.x1 * width);
  const gy0 = Math.floor(WIN.y0 * height), gy1 = Math.ceil(WIN.y1 * height);
  const w = gx1 - gx0, h = gy1 - gy0;
  // 1) 어두운 점 → 2) GROW칸 부풀리기
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dark[y * w + x] = gray[(y + gy0) * width + (x + gx0)] < LIGHT ? 1 : 0;
  const grown = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!dark[y * w + x]) continue;
      for (let dy = -GROW; dy <= GROW; dy++) {
        for (let dx = -GROW; dx <= GROW; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) grown[yy * w + xx] = 1;
        }
      }
    }
  }
  // 3) 이어진 덩어리마다 감싼 상자 — 가장 넓은 것
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  let best: { x0: number; y0: number; x1: number; y1: number; area: number } | null = null;
  for (let i = 0; i < w * h; i++) {
    if (!grown[i] || seen[i]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % w, y = (k - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const n of [k - 1, k + 1, k - w, k + w]) {
        if (n < 0 || n >= w * h || seen[n] || !grown[n]) continue;
        if ((n === k - 1 && x === 0) || (n === k + 1 && x === w - 1)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    const area = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (!best || area > best.area) best = { x0, y0, x1, y1, area };
  }
  if (!best) return null;
  const rect = {
    x: (best.x0 + gx0) / width, y: (best.y0 + gy0) / height,
    w: (best.x1 - best.x0 + 1) / width, h: (best.y1 - best.y0 + 1) / height,
  };
  // 평면도는 그림의 꽤 큰 부분 — 너무 작으면 양식이 다른 그림으로 보고 사람에게 맡긴다.
  if (rect.w < 0.12 || rect.h < 0.12) return null;
  const m = 0.01;
  const x = Math.max(0, rect.x - m), y = Math.max(0, rect.y - m);
  return { x, y, w: Math.min(1, rect.x + rect.w + m) - x, h: Math.min(1, rect.y + rect.h + m) - y };
}
