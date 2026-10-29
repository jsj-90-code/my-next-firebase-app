// 피난안내도(좌석번호표) 위에 도면의 존 구역을 겹쳐 그리기 위한 좌표 변환. (2026-10-29)
//
// 사용자 「피난안내도에 도면 구역 똑같이 넣어서 이미지 한 장으로」. 존 위치는 도면 기준(0~1)이고 피난안내도는 크기·잘린 범위가
// 다른 별개 그림이라 바로 못 겹친다. 채팅이 좌석번호를 매칭하면서 존마다 피난안내도 위 대략의 상자(plateRect)를 같이 내고,
// 여기서 존 전체로 "도면 → 피난안내도" 아핀 변환(확대·이동·회전·기울임 6개 값) 하나를 최소제곱으로 맞춘다.
// 존 하나의 어림이 틀려도 전체로 맞추므로 상자가 흐트러지지 않고, 많이 어긋난 존은 한 번 빼고 다시 맞춘다.
import type { NormalizedRect } from "./types";

/** [a, b, c, d, e, f]: x' = a·x + b·y + c, y' = d·x + e·y + f (둘 다 0~1 비율 좌표) */
export type Affine = [number, number, number, number, number, number];

const corners = (r: NormalizedRect): [number, number][] => [
  [r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h],
];

export function applyAffine(t: Affine, x: number, y: number): [number, number] {
  return [t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]];
}

/** 도면 위 상자 → 피난안내도 위 네 꼭짓점 */
export function mapRect(t: Affine, r: NormalizedRect): [number, number][] {
  return corners(r).map(([x, y]) => applyAffine(t, x, y));
}

/** 3×3 연립방정식(가우스 소거). 풀 수 없으면 null. */
function solve3(m: number[][], v: number[]): number[] | null {
  const a = m.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

function fitOnce(pairs: { src: NormalizedRect; dst: NormalizedRect }[]): Affine | null {
  const pts = pairs.flatMap((p) => corners(p.src).map((s, i) => [s, corners(p.dst)[i]] as const));
  // 정규방정식: [x y 1]ᵀ[x y 1] · [a b c] = [x y 1]ᵀ x'
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const vx = [0, 0, 0];
  const vy = [0, 0, 0];
  for (const [[x, y], [x2, y2]] of pts) {
    const row = [x, y, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += row[i] * row[j];
      vx[i] += row[i] * x2;
      vy[i] += row[i] * y2;
    }
  }
  const px = solve3(m, vx);
  const py = solve3(m, vy);
  return px && py ? [px[0], px[1], px[2], py[0], py[1], py[2]] : null;
}

/** 존 가운데가 변환 뒤 피난안내도 상자 가운데에서 얼마나 떨어지는가(0~1 비율) */
function centerError(t: Affine, p: { src: NormalizedRect; dst: NormalizedRect }): number {
  const [x, y] = applyAffine(t, p.src.x + p.src.w / 2, p.src.y + p.src.h / 2);
  return Math.hypot(x - (p.dst.x + p.dst.w / 2), y - (p.dst.y + p.dst.h / 2));
}

/**
 * 존 3개 이상으로 변환을 맞춘다. 가운데 오차가 중앙값의 2.5배(최소 3%)를 넘는 존은 빼고 한 번 더 맞춘다(남는 존이 3개 이상일 때).
 * 존이 3개 미만이거나 한 줄로만 놓여 풀 수 없으면 null.
 */
export function fitPlateTransform(
  pairs: { src: NormalizedRect; dst: NormalizedRect }[],
): { transform: Affine; used: number; dropped: number } | null {
  if (pairs.length < 3) return null;
  const first = fitOnce(pairs);
  if (!first) return null;
  const errs = pairs.map((p) => centerError(first, p));
  const median = [...errs].sort((a, b) => a - b)[Math.floor(errs.length / 2)];
  const limit = Math.max(0.03, median * 2.5);
  const kept = pairs.filter((_, i) => errs[i] <= limit);
  if (kept.length === pairs.length || kept.length < 3) return { transform: first, used: pairs.length, dropped: 0 };
  const second = fitOnce(kept);
  return second
    ? { transform: second, used: kept.length, dropped: pairs.length - kept.length }
    : { transform: first, used: pairs.length, dropped: 0 };
}
