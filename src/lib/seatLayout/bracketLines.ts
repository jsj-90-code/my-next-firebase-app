// 브라켓 도면 PDF의 주황 선으로 "가방 선반 브라켓이 달린 책상"을 바로 찾는다. (2026-10-29)
//
// 사용자 「초안 받을 때 브라켓까지 세 줘」 — 채팅 AI가 잘린 그림을 보고 세던 것을 PDF 도형으로 바꿨다.
// 브라켓 도면(보통 3쪽)은 등 맞댄 책상 줄 위에 주황(#e64d19) 선을 긋고, 책상 경계마다 주황 점을 찍는다.
// 시험 도면 3장(울산삼산·평택소사벌·호구포)에서 확인한 사실:
// - 선은 책상 폭 방향으로 책상을 끝까지 지나간다 → 책상마다 "폭 방향 주황 선 길이 ÷ 책상 폭"이 0 아니면 3~4로 또렷이 갈린다
//   (선을 채운 사각형·여러 겹으로 그려서 1을 넘는다). 0.5를 기준으로 가른다.
// - 점은 곡선이라 세지 않는다. 도면 제목 옆 "브라켓 수량 90개"는 이 점(부품) 수라 책상 수와 다르다.
// - 평택 VIP처럼 기운 책상·기운 선이 있어 축 정렬이 아니라 책상 방향(글씨 방향)으로 잰다.
// 결과(브라켓 달린 책상 수): 울산 32 · 평택 71 · 호구포 49 — 도면 위에 초록으로 칠해 눈으로 맞춰 봄(평택 기운 VIP 2석 포함,
// 호구포 기둥 밑 850은 선을 짧게 쳤지만 양 끝 점이 있어 브라켓 — 사용자 확인).
// 운영 프로젝트에 저장돼 있던 값(35·59·62)은 예전 AI 어림이라 다르다.
import type { PDFPageProxy } from "pdfjs-dist";

// pdfjs OPS / DrawOPS 값(pdfjs-dist 6.x) — roomSplit.ts와 같은 이유로 정적 import하지 않는다.
const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_SET_STROKE_RGB = 58;
const OP_SET_FILL_RGB = 59;
const OP_CONSTRUCT_PATH = 91;
const STROKE_OPS = new Set([20, 21, 24, 25, 26, 27]); // stroke, closeStroke, fillStroke, eoFillStroke, closeFillStroke, closeEOFillStroke
const FILL_OPS = new Set([22, 23, 24, 25, 26, 27]); // fill, eoFill, + 위 채움·선 함께
const D_MOVE = 0;
const D_LINE = 1;
const D_CURVE = 2;
const D_QUAD = 3;
const D_CLOSE = 4;

const COVER_MIN = 0.5; // 책상 폭의 절반 넘게 주황 선이 지나가면 브라켓 책상
const PARALLEL_MIN = 0.9; // 책상 폭 방향과 이만큼 나란한 선만(점·해치·가로지르는 선 제외)

type Mat = [number, number, number, number, number, number];
const mul = (m: Mat, n: number[]): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** 브라켓 주황(#e64d19 계열). 빨강(#ff0000)·분홍(#ff007f, 벽체 표시)은 초록이 0이라 빠진다. */
export function isBracketOrange(hex: unknown): boolean {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r >= 200 && g >= 50 && g <= 140 && b <= 90;
}

/** 책상 하나(화면 좌표): 가운데, 폭 방향 단위벡터, 폭·깊이의 반. */
export type DeskFrame = { cx: number; cy: number; ux: number; uy: number; hw: number; hd: number };

/** 선분을 책상 좌표(u = 폭 방향, v = 깊이 방향)로 옮겨 책상 안에 든 폭 방향 구간 [lo, hi]. 나란하지 않거나 밖이면 null. */
export function clippedInterval(desk: DeskFrame, seg: [number, number, number, number]): [number, number] | null {
  const [x0, y0, x1, y1] = seg;
  const toU = (x: number, y: number) => (x - desk.cx) * desk.ux + (y - desk.cy) * desk.uy;
  const toV = (x: number, y: number) => -(x - desk.cx) * desk.uy + (y - desk.cy) * desk.ux;
  const u0 = toU(x0, y0), v0 = toV(x0, y0), u1 = toU(x1, y1), v1 = toV(x1, y1);
  const len = Math.hypot(u1 - u0, v1 - v0);
  if (!len || Math.abs(u1 - u0) / len < PARALLEL_MIN) return null;
  if (Math.abs((v0 + v1) / 2) > desk.hd) return null;
  const lo = Math.max(Math.min(u0, u1), -desk.hw);
  const hi = Math.min(Math.max(u0, u1), desk.hw);
  return hi > lo ? [lo, hi] : null;
}

/** 선분을 책상 좌표(u = 폭 방향, v = 깊이 방향)로 옮겨 책상 안에 든 폭 방향 길이. 나란하지 않으면 0. */
export function clippedAlong(desk: DeskFrame, seg: [number, number, number, number]): number {
  const [x0, y0, x1, y1] = seg;
  const toU = (x: number, y: number) => (x - desk.cx) * desk.ux + (y - desk.cy) * desk.uy;
  const toV = (x: number, y: number) => -(x - desk.cx) * desk.uy + (y - desk.cy) * desk.ux;
  const u0 = toU(x0, y0), v0 = toV(x0, y0), u1 = toU(x1, y1), v1 = toV(x1, y1);
  const len = Math.hypot(u1 - u0, v1 - v0);
  if (!len || Math.abs(u1 - u0) / len < PARALLEL_MIN) return 0;
  // 깊이 방향으로 책상 안인지(선이 거의 평행이라 가운데 v로 본다)
  const vm = (v0 + v1) / 2;
  if (Math.abs(vm) > desk.hd) return 0;
  const lo = Math.max(Math.min(u0, u1), -desk.hw);
  const hi = Math.min(Math.max(u0, u1), desk.hw);
  return Math.max(0, hi - lo);
}

/** 선분 목록으로 책상마다 브라켓 여부. 주황 선이 하나도 없으면 null(브라켓 도면이 아님 → 채팅으로 센다). */
export function markBracketDesks(
  desks: DeskFrame[],
  segs: [number, number, number, number][],
  dots: [number, number][] = [],
): boolean[] | null {
  if (!segs.length) return null;
  return desks.map((d) => {
    // 10-29 호구포TEST(사용자 「49개가 맞다 — 기둥 밑 850은 선을 좀 짧게 쳤다」): 선이 폭의 24%뿐이어도 책상 양 끝(폭 방향 ±반폭,
    // 반폭의 25% 안)에 주황 점(브라켓)이 둘 다 있으면 브라켓 책상. 한쪽 끝에만 점이 걸린 옆 존 책상(광주 프렌즈)은 아님.
    const endHit = (sign: number) =>
      dots.some(([x, y]) => {
        const u = (x - d.cx) * d.ux + (y - d.cy) * d.uy;
        const v = -(x - d.cx) * d.uy + (y - d.cy) * d.ux;
        return Math.abs(u - sign * d.hw) <= d.hw * 0.25 && Math.abs(v) <= d.hd;
      });
    if (endHit(-1) && endHit(1)) return true;
    const r = Math.hypot(d.hw, d.hd);
    // 10-29 광주첨단점TEST: 옆 VIP 브라켓 선 끝의 짧은 조각이 프렌즈 책상 가장자리에 걸렸는데, 같은 조각이 여러 겹(채운 사각형
    // 테두리 등)으로 그려져 길이를 더하면 폭의 절반을 넘었다 → 덮인 구간의 합집합 길이로 잰다(진짜 브라켓 책상은 폭 전체가 덮임).
    const parts: [number, number][] = [];
    for (const s of segs) {
      // 멀리 있는 선은 건너뛴다(선분 양 끝이 모두 한쪽 바깥)
      if (Math.max(s[0], s[2]) < d.cx - r || Math.min(s[0], s[2]) > d.cx + r) continue;
      if (Math.max(s[1], s[3]) < d.cy - r || Math.min(s[1], s[3]) > d.cy + r) continue;
      const iv = clippedInterval(d, s);
      if (iv) parts.push(iv);
    }
    parts.sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let end = -Infinity;
    for (const [lo, hi] of parts) {
      if (hi <= end) continue;
      covered += hi - Math.max(lo, end);
      end = hi;
    }
    return covered / (2 * d.hw) >= COVER_MIN;
  });
}

/** 페이지의 주황 직선 조각과 주황 점(곡선 도형의 가운데, 화면 좌표). */
export async function extractBracketMarks(
  page: PDFPageProxy,
): Promise<{ segs: [number, number, number, number][]; dots: [number, number][] }> {
  const dots: [number, number][] = [];
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList();
  const out: [number, number, number, number][] = [];
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  let stroke: unknown = "#000000";
  let fill: unknown = "#000000";
  const stack: [Mat, unknown, unknown][] = [];
  const toVp = (x: number, y: number) =>
    vp.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]);
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i];
    const args = ol.argsArray[i] as unknown[];
    if (fn === OP_SAVE) stack.push([ctm, stroke, fill]);
    else if (fn === OP_RESTORE) [ctm, stroke, fill] = stack.pop() ?? [ctm, stroke, fill];
    else if (fn === OP_TRANSFORM) ctm = mul(ctm, args as number[]);
    else if (fn === OP_SET_STROKE_RGB) stroke = args[0];
    else if (fn === OP_SET_FILL_RGB) fill = args[0];
    else if (fn === OP_CONSTRUCT_PATH) {
      const paint = args[0] as number;
      const orange = (STROKE_OPS.has(paint) && isBracketOrange(stroke)) || (FILL_OPS.has(paint) && isBracketOrange(fill));
      if (!orange) continue;
      const d = (args[1] as ArrayLike<number>[] | undefined)?.[0];
      if (!d) continue;
      const push = (ax: number, ay: number, bx: number, by: number) => {
        const [px, py] = toVp(ax, ay);
        const [qx, qy] = toVp(bx, by);
        out.push([px, py, qx, qy]);
      };
      let k = 0, cx = 0, cy = 0, sx = 0, sy = 0;
      // 곡선으로 그린 도형(주황 점)은 감싼 상자의 가운데를 점 하나로 모은다.
      let curved = false;
      const ptsX: number[] = [];
      const ptsY: number[] = [];
      const note = (x: number, y: number) => {
        const [px, py] = toVp(x, y);
        ptsX.push(px);
        ptsY.push(py);
      };
      while (k < d.length) {
        const op = d[k++];
        if (op === D_MOVE) { cx = d[k++]; cy = d[k++]; sx = cx; sy = cy; note(cx, cy); }
        else if (op === D_LINE) { const x = d[k++], y = d[k++]; push(cx, cy, x, y); cx = x; cy = y; note(cx, cy); }
        else if (op === D_CURVE) { curved = true; note(d[k], d[k + 1]); note(d[k + 2], d[k + 3]); k += 4; cx = d[k++]; cy = d[k++]; note(cx, cy); }
        else if (op === D_QUAD) { k += 2; cx = d[k++]; cy = d[k++]; }
        else if (op === D_CLOSE) { push(cx, cy, sx, sy); cx = sx; cy = sy; }
        else break;
      }
      // 점은 곡선으로도, 짧은 직선 여러 개(다각형)로도 그린다(호구포) — 곡선이 있거나, 작고(쪽 단위 4~40) 정사각형에 가까운 도형이면 점.
      if (ptsX.length) {
        const w = Math.max(...ptsX) - Math.min(...ptsX);
        const h = Math.max(...ptsY) - Math.min(...ptsY);
        const big = Math.max(w, h);
        const roundish = big >= 4 && big <= 40 && Math.abs(w - h) <= big * 0.3;
        if (curved || roundish) dots.push([(Math.min(...ptsX) + Math.max(...ptsX)) / 2, (Math.min(...ptsY) + Math.max(...ptsY)) / 2]);
      }
    }
  }
  return { segs: out, dots };
}
