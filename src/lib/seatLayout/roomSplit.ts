// 도면 PDF의 벽·칸막이 선으로 "등 맞댄 두 줄 중 한 줄이 벽으로 막힌 방"을 찾아 떼어낸다. (2026-10-28)
//
// 삼산점TEST: 화장실 옆 4석 줄은 벽·문으로 둘러싸인 4인룸인데, 반대쪽 일반 줄과 등을 맞대 있어 채팅 AI가 두 번 다
// 8석 섬 하나(멀티존)로 잡았다(지시문 9번 점검을 넣어도 같음 — 얇은 칸막이 선을 그림으로는 못 가려낸다).
// 사용자 「반나절걸려서 할수있으면」 하자고 함. PDF 선을 보면 차이가 또렷하다(울산 배치도 실측):
// - 방인 줄: 의자 쪽이 벽(위 벽)으로 막히고, 줄 양 끝도 그 벽까지 이어진 긴 선(유리벽·화장실 벽)으로 막혀 있다.
// - 일반 섬: 양 끝 칸막이가 책상 깊이까지만 있고 의자 쪽은 트여 있다.
// 그래서 줄마다 "의자 쪽 벽 + 양 끝 벽"이 모두 있을 때만 방으로 본다. 애매하면 나누지 않는다(사람이 고친다).
import type { PDFPageProxy } from "pdfjs-dist";
import type { DeskLabelSet, NormalizedRect, ZoneTypeKey } from "./types";

// pdfjs OPS / DrawOPS 값(pdfjs-dist 6.x). 이 파일은 서버 렌더 때도 불려서 pdfjs를 정적으로 import하지 않는다(pdfRender.ts 주석).
const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_CONSTRUCT_PATH = 91;
const D_MOVE = 0;
const D_LINE = 1;
const D_CURVE = 2;
const D_QUAD = 3;
const D_CLOSE = 4;

const WALL_MIN_MM = 1200; // 이보다 짧은 선(책상·의자 테두리, 해치)은 벽 후보에서 뺀다
const SNAP_MM = 100; // 같은 선으로 볼 거리
const WALL_MIN_GAP_MM = 450; // 의자 쪽 벽까지 최소 거리(의자가 들어갈 자리)
const WALL_MAX_GAP_MM = 2500; // 이보다 멀면 방이 아니라 통로
const r4 = (v: number) => Math.round(v * 10000) / 10000;

type Mat = [number, number, number, number, number, number];
const mul = (m: Mat, n: number[]): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** 페이지의 긴 수평·수직선(벽·칸막이 후보)을 페이지 기준 0~1 좌표 [x0,y0,x1,y1]로. */
export async function extractWallLines(page: PDFPageProxy, unitsPerMm: number): Promise<number[][]> {
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList();
  const minLen = WALL_MIN_MM * unitsPerMm;
  const out = new Map<string, number[]>();
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  const stack: Mat[] = [];
  const toVp = (x: number, y: number) =>
    vp.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]);
  const push = (ax: number, ay: number, bx: number, by: number) => {
    const [px, py] = toVp(ax, ay);
    const [qx, qy] = toVp(bx, by);
    const dx = Math.abs(qx - px);
    const dy = Math.abs(qy - py);
    const len = Math.hypot(dx, dy);
    if (len < minLen || Math.min(dx, dy) > len * 0.02) return; // 짧거나 기운 선
    const seg = [px / vp.width, py / vp.height, qx / vp.width, qy / vp.height].map(r4);
    out.set(seg.join(","), seg);
  };
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i];
    const args = ol.argsArray[i];
    if (fn === OP_SAVE) stack.push(ctm);
    else if (fn === OP_RESTORE) ctm = stack.pop() ?? ctm;
    else if (fn === OP_TRANSFORM) ctm = mul(ctm, args as number[]);
    else if (fn === OP_CONSTRUCT_PATH) {
      const data = (args as unknown[])[1] as ArrayLike<number>[] | undefined;
      const d = data?.[0];
      if (!d) continue;
      let k = 0, cx = 0, cy = 0, sx = 0, sy = 0;
      while (k < d.length) {
        const op = d[k++];
        if (op === D_MOVE) { cx = d[k++]; cy = d[k++]; sx = cx; sy = cy; }
        else if (op === D_LINE) { const x = d[k++], y = d[k++]; push(cx, cy, x, y); cx = x; cy = y; }
        else if (op === D_CURVE) { k += 4; cx = d[k++]; cy = d[k++]; }
        else if (op === D_QUAD) { k += 2; cx = d[k++]; cy = d[k++]; }
        else if (op === D_CLOSE) { push(cx, cy, sx, sy); cx = sx; cy = sy; }
        else break;
      }
    }
  }
  return [...out.values()];
}

/** 페이지 기준 벽 선 → 자른 도면 기준. 자른 영역과 겹치지 않는 선은 버린다. */
export function cropWallLines(walls: number[][], crop: NormalizedRect): number[][] {
  return walls
    .filter(([x0, y0, x1, y1]) =>
      Math.max(x0, x1) >= crop.x && Math.min(x0, x1) <= crop.x + crop.w &&
      Math.max(y0, y1) >= crop.y && Math.min(y0, y1) <= crop.y + crop.h)
    .map(([x0, y0, x1, y1]) =>
      [(x0 - crop.x) / crop.w, (y0 - crop.y) / crop.h, (x1 - crop.x) / crop.w, (y1 - crop.y) / crop.h].map(r4));
}

// ---- 판정은 mm 좌표에서 한다(가로·세로 비율이 다른 0~1 좌표로는 거리를 못 잰다). "along" = 줄 방향, "across" = 줄에 수직.
type Line = { c: number; s0: number; s1: number }; // c = 고정 좌표, [s0,s1] = 뻗은 구간
type Row = { idx: number[]; a0: number; a1: number; c0: number; c1: number };

/** 선들 가운데 고정 좌표가 at±SNAP인 것들이 [lo,hi]를 얼마나 덮는지(0~1). */
function coverage(lines: Line[], at: number, lo: number, hi: number): number {
  const parts = lines
    .filter((l) => Math.abs(l.c - at) <= SNAP_MM && l.s1 > lo && l.s0 < hi)
    .map((l) => [Math.max(lo, l.s0), Math.min(hi, l.s1)])
    .sort((p, q) => p[0] - q[0]);
  let covered = 0, end = lo;
  for (const [s, e] of parts) {
    if (e <= end) continue;
    covered += e - Math.max(s, end);
    end = e;
  }
  return hi > lo ? covered / (hi - lo) : 0;
}

/** 범위 안에서 [lo,hi]를 minCov 넘게 덮는 선 가운데 near에 가장 가까운 것의 고정 좌표. 벽 두께의 안쪽 면을 잡으려고
 * 가장 가까운 선을 고른다(10-28 울산: 가장 많이 덮는 선을 고르니 화장실 벽 너머 안쪽 선을 잡음). */
function nearestCover(lines: Line[], cMin: number, cMax: number, lo: number, hi: number, near: number, minCov: number): number | null {
  let best: number | null = null;
  for (const l of lines) {
    if (l.c < cMin || l.c > cMax) continue;
    if (best !== null && Math.abs(l.c - near) >= Math.abs(best - near)) continue;
    if (coverage(lines, l.c, lo, hi) >= minCov) best = l.c;
  }
  return best;
}

export type RoomSplit = {
  roomDesks: number[];
  otherDesks: number[];
  /** 방 벽 안쪽(자른 도면 기준 0~1) */
  roomRect: NormalizedRect;
  /** 등 맞댄 선부터 반대쪽 줄 바깥까지 — 원래 상자의 반대쪽 끝을 그대로 쓴다 */
  otherRect: NormalizedRect;
  roomType: ZoneTypeKey;
};

const roomTypeFor = (n: number): ZoneTypeKey =>
  n <= 1 ? "one_room" : n === 2 ? "two" : n === 3 ? "three" : n === 4 ? "four_room" : "ceremony_team";

/**
 * 존(책상 deskIdx, 맞춘 상자 rect)이 등 맞댄 두 줄이고 그중 한 줄만 의자 쪽·양 끝이 벽으로 막혀 있으면 방으로 떼어낸다.
 * 아니면 null — 한 줄짜리, 세 줄 이상, 가로·세로 섞임, 양쪽 다 막힘(판단 불가)은 그대로 둔다.
 */
export function findWalledRoom(
  deskIdx: number[], rect: NormalizedRect, labels: DeskLabelSet, typeKey?: string | null,
): RoomSplit | null {
  const walls = labels.walls;
  if (!walls?.length || deskIdx.length < 3) return null;
  // 모양으로 정한 유형(VIP·커플·1인석·프렌즈)은 칸막이가 벽처럼 보여도 방이 아니다 — 일반 줄·섬(하드웨어 존·유형 없음)만 본다.
  if (typeKey && !["fps", "fc", "lol", "multi", "etc"].includes(typeKey)) return null;
  const { mmX, mmY } = labels;
  const box = (i: number) => {
    const d = labels.desks[i];
    return { x0: d.x / mmX, y0: d.y / mmY, x1: (d.x + d.w) / mmX, y1: (d.y + d.h) / mmY };
  };
  const boxes = deskIdx.map(box);
  const horiz = boxes.map((b) => b.x1 - b.x0 >= b.y1 - b.y0);
  if (horiz.some((h) => h !== horiz[0])) return null;
  const alongX = horiz[0]; // 가로 책상이 줄지어 있으면 줄 방향 = x
  const A = (b: { x0: number; y0: number; x1: number; y1: number }) => (alongX ? [b.x0, b.x1] : [b.y0, b.y1]);
  const C = (b: { x0: number; y0: number; x1: number; y1: number }) => (alongX ? [b.y0, b.y1] : [b.x0, b.x1]);

  // 줄 나누기: 수직 방향 가운데 좌표로 정렬, 책상 깊이 절반 넘게 벌어지면 다른 줄.
  const order = deskIdx.map((di, k) => ({ di, b: boxes[k] })).sort((p, q) => {
    const [pc0, pc1] = C(p.b);
    const [qc0, qc1] = C(q.b);
    return pc0 + pc1 - (qc0 + qc1);
  });
  const rows: Row[] = [];
  for (const { di, b } of order) {
    const [a0, a1] = A(b);
    const [c0, c1] = C(b);
    const last = rows[rows.length - 1];
    if (last && (c0 + c1) / 2 - (last.c0 + last.c1) / 2 < ((c1 - c0) * 0.5)) {
      last.idx.push(di);
      last.a0 = Math.min(last.a0, a0); last.a1 = Math.max(last.a1, a1);
      last.c0 = Math.min(last.c0, c0); last.c1 = Math.max(last.c1, c1);
    } else rows.push({ idx: [di], a0, a1, c0, c1 });
  }
  if (rows.length !== 2) return null;
  const [r1, r2] = rows;
  if (r2.c0 - r1.c1 > 400) return null; // 사이에 통로 — 등 맞댄 줄이 아님
  const seam = (r1.c1 + r2.c0) / 2;

  // 벽 선을 mm 좌표 Line으로: parallel = 줄과 나란한 선, perp = 줄에 수직인 선.
  const parallel: Line[] = [];
  const perp: Line[] = [];
  for (const [x0, y0, x1, y1] of walls) {
    const X0 = x0 / mmX, Y0 = y0 / mmY, X1 = x1 / mmX, Y1 = y1 / mmY;
    const isHoriz = Math.abs(Y1 - Y0) < Math.abs(X1 - X0);
    const line: Line = isHoriz
      ? { c: (Y0 + Y1) / 2, s0: Math.min(X0, X1), s1: Math.max(X0, X1) }
      : { c: (X0 + X1) / 2, s0: Math.min(Y0, Y1), s1: Math.max(Y0, Y1) };
    (isHoriz === alongX ? parallel : perp).push(line);
  }

  // 줄 하나가 막혔나: 의자 쪽(seam 반대) 450~2500mm에 줄 길이 60% 넘게 덮는 벽 + 양 끝에 그 벽까지 70% 넘게 덮는 선.
  const enclosed = (row: Row, dir: 1 | -1) => {
    const outer = dir < 0 ? row.c0 : row.c1;
    const cands = parallel
      .filter((l) => (l.c - outer) * dir >= WALL_MIN_GAP_MM && (l.c - outer) * dir <= WALL_MAX_GAP_MM)
      .sort((p, q) => (p.c - outer) * dir - (q.c - outer) * dir);
    const wall = cands.find((l) => coverage(parallel, l.c, row.a0, row.a1) >= 0.6);
    if (!wall) return null;
    const lo = Math.min(outer, wall.c);
    const hi = Math.max(outer, wall.c);
    const left = nearestCover(perp, row.a0 - 600, row.a0 + 150, lo, hi, row.a0, 0.7);
    const right = nearestCover(perp, row.a1 - 150, row.a1 + 600, lo, hi, row.a1, 0.7);
    if (left === null || right === null) return null;
    return { wallC: wall.c, a0: left, a1: right };
  };
  const e1 = enclosed(r1, -1);
  const e2 = enclosed(r2, 1);
  if (!!e1 === !!e2) return null; // 둘 다 트였으면 섬, 둘 다 막혔으면 판단 불가

  const room = e1 ? r1 : r2;
  const other = e1 ? r2 : r1;
  // 1석짜리는 방으로 떼지 않는다(10-28 평택: 창가 VIP 1000mm 한 쌍을 1인룸으로 잘못 뗌 — VIP 칸막이·창 벽이 막힌 것처럼 보임).
  if (room.idx.length < 2) return null;
  const enc = (e1 ?? e2)!;
  const toRect = (a0: number, a1: number, c0: number, c1: number): NormalizedRect => {
    const [x0, x1, y0, y1] = alongX ? [a0, a1, c0, c1] : [c0, c1, a0, a1];
    return { x: r4(x0 * mmX), y: r4(y0 * mmY), w: r4((x1 - x0) * mmX), h: r4((y1 - y0) * mmY) };
  };
  const roomRect = toRect(enc.a0, enc.a1, Math.min(seam, enc.wallC), Math.max(seam, enc.wallC));
  // 반대쪽 줄: 원래(맞춘) 상자의 그쪽 끝까지, 줄 방향은 그 줄 책상 끝.
  const rc0 = alongX ? rect.y / mmY : rect.x / mmX;
  const rc1 = alongX ? (rect.y + rect.h) / mmY : (rect.x + rect.w) / mmX;
  const otherRect = e1 ? toRect(other.a0, other.a1, seam, rc1) : toRect(other.a0, other.a1, rc0, seam);
  return { roomDesks: room.idx, otherDesks: other.idx, roomRect, otherRect, roomType: roomTypeFor(room.idx.length) };
}
