// 도면 PDF의 책상 치수 글씨("850*680")로 책상 위치를 알아내고, 채팅 존 초안 상자를 책상·의자 끝에 맞춘다. (2026-10-28)
//
// 채팅 AI는 도면 그림을 보고 상자 위치를 "가로 35%"처럼 어림해서, 유형·좌석 수는 맞아도 상자 모서리가 조금씩 삐뚤었다
// (사용자 「각안맞는게 거슬리긴해서」). 지시문을 더 다듬어도 그림 어림의 한계라, 위치는 PDF 안의 글씨 좌표로 바로잡는다.
// 시험 도면 3장(울산삼산·호구포·평택 책상집기 배치도)에서 확인한 사실:
// - 책상마다 치수 글씨가 하나씩, 책상 한가운데에 진짜 글자로 들어 있다(범례 수량과 개수가 맞음). 글씨 방향 = 책상 폭 방향.
// - 세로·뒤집힌·73° 기운 책상도 글씨의 방향 행렬로 그대로 잡힌다.
// - 도면 축척은 "1/100"이라 적혀 있어도 PDF 크기가 도면마다 달라 믿을 수 없다 → 같은 줄 옆 책상까지의 간격 ÷ 적힌 폭으로
//   1mm가 몇 단위인지 잰다(세 도면 모두 사분위가 같은 값으로 나옴).
// - 의자는 책상 끝에서 약 600mm까지 나온다(울산 확대 화면 실측 — 책상 깊이 680의 약 0.86배).
import type { PDFPageProxy } from "pdfjs-dist";
import { extractBracketMarks, markBracketDesks } from "./bracketLines";
import { cropWallLines, extractWallLines, unflattenWalls } from "./roomSplit";
import { DESK_SIZE_OPTIONS } from "./constants";
import type { DeskLabelSet, DeskSize, NormalizedRect, SizeBreakdownEntry, ZoneTypeKey } from "./types";

const DIM_RE = /^(\d{3,4})\*(\d{3,4})$/;
const CHAIR_MM = 600;
const STRAY_ATTACH_MM = 1500; // AI 좌석 수가 모자란 존에 붙일 바깥 책상 거리 한도
const STRAY_TOUCH_MM = 300; // 그냥 상자에 걸친 것으로 볼 거리
// 방은 상자를 책상이 아니라 방 벽 안쪽에 맞추므로(존 초안 지시문 3번) 건드리지 않는다.
const ROOM_TYPES: ReadonlySet<string> = new Set<ZoneTypeKey>([
  "one_room", "two", "three", "four_room", "team", "ceremony_team", "couple_room",
]);

const r4 = (v: number) => Math.round(v * 10000) / 10000;

type RawDesk = { cx: number; cy: number; ux: number; uy: number; wMm: number; dMm: number };

/** 페이지에서 책상 치수 글씨를 모아 페이지 기준 0~1 좌표의 책상 사각형으로. 책상이 몇 개 안 되면 null. */
export async function extractDeskLabels(page: PDFPageProxy): Promise<DeskLabelSet | null> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const raws: RawDesk[] = [];
  for (const it of tc.items) {
    if (!("str" in it)) continue;
    const m = it.str.replace(/\s/g, "").match(DIM_RE);
    if (!m) continue;
    const wMm = +m[1];
    const dMm = +m[2];
    // 책상이 아닌 치수(기계·가구, 범례 쪽 큰 값)는 뺀다.
    if (wMm < 700 || wMm > 1300 || dMm < 500 || dMm > 900) continue;
    const [a, b, c, d, e, f] = it.transform as number[];
    const ul = Math.hypot(a, b);
    const vl = Math.hypot(c, d);
    if (!ul || !vl) continue;
    // 글씨 기준점(왼쪽 아래)에서 글씨 길이의 반, 글자 높이의 약 1/3만큼 옮기면 글씨 한가운데 = 책상 한가운데.
    const cx = e + (a / ul) * (it.width / 2) + (c / vl) * vl * 0.35;
    const cy = f + (b / ul) * (it.width / 2) + (d / vl) * vl * 0.35;
    const [px, py] = vp.convertToViewportPoint(cx, cy);
    const [qx, qy] = vp.convertToViewportPoint(cx + a / ul, cy + b / ul);
    const len = Math.hypot(qx - px, qy - py) || 1;
    raws.push({ cx: px, cy: py, ux: (qx - px) / len, uy: (qy - py) / len, wMm, dMm });
  }
  if (raws.length < 4) return null;

  // 1mm 길이: 글씨 방향(=책상 폭 방향)으로 가장 가까운 책상까지의 거리 ÷ 적힌 폭, 그 가운데값.
  const ratios: number[] = [];
  for (const r of raws) {
    let best = Infinity;
    for (const o of raws) {
      if (o === r) continue;
      const dx = o.cx - r.cx;
      const dy = o.cy - r.cy;
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && Math.abs(dx * r.ux + dy * r.uy) / dist > 0.95 && dist < best) best = dist;
    }
    if (best < Infinity) ratios.push(best / r.wMm);
  }
  if (ratios.length < 3) return null;
  ratios.sort((p, q) => p - q);
  const unitsPerMm = ratios[Math.floor(ratios.length / 2)];

  const desks: NormalizedRect[] = raws.map((r) => {
    const hw = (r.wMm * unitsPerMm) / 2;
    const hd = (r.dMm * unitsPerMm) / 2;
    // 기운 책상은 네 모서리를 감싸는 축 정렬 사각형으로(존 상자도 축 정렬이라).
    const ex = Math.abs(r.ux) * hw + Math.abs(r.uy) * hd;
    const ey = Math.abs(r.uy) * hw + Math.abs(r.ux) * hd;
    return {
      x: r4((r.cx - ex) / vp.width),
      y: r4((r.cy - ey) / vp.height),
      w: r4((2 * ex) / vp.width),
      h: r4((2 * ey) / vp.height),
    };
  });
  // 브라켓(10-29): 브라켓 도면이면 주황 선이 지나가는 책상을 바로 찾는다(bracketLines.ts). 주황 선이 없거나 못 읽으면 없음 → 채팅으로 센다.
  let brackets: boolean[] | null = null;
  try {
    const marks = await extractBracketMarks(page);
    brackets = markBracketDesks(
      raws.map((r) => ({ cx: r.cx, cy: r.cy, ux: r.ux, uy: r.uy, hw: (r.wMm * unitsPerMm) / 2, hd: (r.dMm * unitsPerMm) / 2 })),
      marks.segs,
      marks.dots,
    );
  } catch {
    brackets = null;
  }
  // 벽 선은 부가 정보 — 못 읽어도 책상 위치는 그대로 쓴다.
  let walls: number[] | undefined;
  try {
    walls = await extractWallLines(page, unitsPerMm);
  } catch {
    walls = undefined;
  }
  return {
    desks,
    widths: raws.map((r) => r.wMm),
    ...(brackets ? { brackets } : {}),
    mmX: unitsPerMm / vp.width,
    mmY: unitsPerMm / vp.height,
    ...(walls ? { walls } : {}),
  };
}

/** 페이지 기준 좌표 → 자른 도면 기준 좌표. 자른 바깥(범례·제목 칸)의 글씨는 버린다. */
export function cropDeskLabels(set: DeskLabelSet, crop: NormalizedRect): DeskLabelSet | null {
  const keep = set.desks.map((d) => {
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h / 2;
    return cx >= crop.x && cx <= crop.x + crop.w && cy >= crop.y && cy <= crop.y + crop.h;
  });
  const widths = set.widths?.filter((_, i) => keep[i]);
  const brackets = set.brackets?.filter((_, i) => keep[i]);
  const desks = set.desks
    .filter((_, i) => keep[i])
    .map((d) => ({
      x: r4((d.x - crop.x) / crop.w),
      y: r4((d.y - crop.y) / crop.h),
      w: r4(d.w / crop.w),
      h: r4(d.h / crop.h),
    }));
  if (!desks.length) return null;
  const walls = set.walls ? cropWallLines(set.walls, crop) : undefined;
  return {
    desks,
    ...(widths ? { widths } : {}),
    ...(brackets ? { brackets } : {}),
    mmX: set.mmX / crop.w,
    mmY: set.mmY / crop.h,
    ...(walls ? { walls } : {}),
  };
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const toBox = (r: NormalizedRect): Box => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
const toRect = (b: Box): NormalizedRect => ({ x: r4(b.x0), y: r4(b.y0), w: r4(b.x1 - b.x0), h: r4(b.y1 - b.y0) });
const center = (b: Box) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;

export type SnapResult = {
  rect: NormalizedRect;
  /** 상자 안 책상 글씨 수(도면 기준 좌석 수). 방이거나 글씨가 없으면 null. */
  deskCount: number | null;
  snapped: boolean;
  /** 이 상자 몫 책상(labels.desks 번호) — 방 나누기(roomSplit.ts)가 쓴다 */
  desks: number[];
};

/**
 * 존 상자를 그 안 책상들의 바깥 끝에 맞춘다.
 * - 책상 = 가운데가 AI 상자 안에 든 치수 글씨.
 * - 변마다: AI 상자가 책상보다 의자 깊이 2.2배 넘게 나가 있으면 벽·다른 것까지 잡은 것으로 보고 그대로 둔다.
 *   책상 앞뒤 변에서 의자 깊이의 0.35배 넘게 나가 있으면 그쪽에 의자가 있는 것 → 책상 끝 + 의자 600mm. 아니면 책상 끝
 *   (줄 끝 변은 늘 책상 끝).
 * - 늘린 상자가 다른 존 책상을 먹으면 그 책상 앞까지 줄이고, 존끼리 겹치면 두 존 책상 사이 가운데에서 나눈다.
 */
export function snapZonesToDesks(
  zones: (NormalizedRect & { typeKey?: string | null; seats?: number })[],
  labels: DeskLabelSet,
): SnapResult[] {
  const chairX = CHAIR_MM * labels.mmX;
  const chairY = CHAIR_MM * labels.mmY;
  const deskBoxes = labels.desks.map(toBox);
  const owner = new Array<number>(deskBoxes.length).fill(-1);

  // 책상 하나가 AI 상자 둘에 걸치면 더 작은 상자 몫(큰 상자가 옆 존을 덮어쓴 경우가 많다).
  const isRoom = zones.map((z) => !!z.typeKey && ROOM_TYPES.has(z.typeKey));
  deskBoxes.forEach((d, di) => {
    let bestArea = Infinity;
    zones.forEach((z, zi) => {
      if (!isRoom[zi] && inside(center(d), toBox(z)) && z.w * z.h < bestArea) {
        bestArea = z.w * z.h;
        owner[di] = zi;
      }
    });
  });

  // 10-29 호구포TEST: AI가 좌석 수는 맞게 셌는데(멀티존C 4·FC존 8) 상자 아래 끝이 마지막 줄 책상 가운데보다 0.05% 모자라
  // 책상 3개가 어느 존에도 안 들었다. 상자 밖 가까운 책상(방 안 책상 제외)을 이렇게 붙인다:
  //  1) AI 좌석 수보다 상자 안 책상이 적은 존 — 1.5m 안의 가장 가까운 책상부터 모자란 만큼
  //  2) 그래도 남은 책상 — 30cm 안이면 가장 가까운 존
  const gapMm = (c: { x: number; y: number }, b: Box) =>
    Math.hypot(Math.max(b.x0 - c.x, 0, c.x - b.x1) / labels.mmX, Math.max(b.y0 - c.y, 0, c.y - b.y1) / labels.mmY);
  const inRoom = deskBoxes.map((d) => zones.some((z, zi) => isRoom[zi] && inside(center(d), toBox(z))));
  const free = () => deskBoxes.flatMap((d, di) => (owner[di] < 0 && !inRoom[di] ? [di] : []));
  zones.forEach((z, zi) => {
    if (isRoom[zi] || !z.seats) return;
    let short = z.seats - owner.filter((o) => o === zi).length;
    if (short <= 0) return;
    const near = free()
      .map((di) => ({ di, gap: gapMm(center(deskBoxes[di]), toBox(z)) }))
      .filter((n) => n.gap <= STRAY_ATTACH_MM)
      .sort((a, b) => a.gap - b.gap);
    for (const n of near) {
      if (short-- <= 0) break;
      owner[n.di] = zi;
    }
  });
  free().forEach((di) => {
    let best = -1;
    let bestGap = STRAY_TOUCH_MM;
    zones.forEach((z, zi) => {
      if (isRoom[zi]) return;
      const gap = gapMm(center(deskBoxes[di]), toBox(z));
      if (gap <= bestGap) {
        bestGap = gap;
        best = zi;
      }
    });
    if (best >= 0) owner[di] = best;
  });

  const work = zones.map((z, zi) => {
    const ai = toBox(z);
    const mine = owner.flatMap((o, di) => (o === zi ? [di] : []));
    if (isRoom[zi]) return { ai, box: ai, ext: null as Box | null, mine };
    if (!mine.length) return { ai, box: ai, ext: null, mine };
    const ext: Box = {
      x0: Math.min(...mine.map((i) => deskBoxes[i].x0)),
      y0: Math.min(...mine.map((i) => deskBoxes[i].y0)),
      x1: Math.max(...mine.map((i) => deskBoxes[i].x1)),
      y1: Math.max(...mine.map((i) => deskBoxes[i].y1)),
    };
    // 의자는 책상 앞뒤(깊이 방향)에만 있다 — 가로로 놓인 책상(폭이 가로)이면 위아래, 세로면 좌우. 줄 끝에는 의자를 더하지 않는다.
    // 가로·세로가 섞인 존(ㄱ자)은 양쪽 다 허용한다.
    const horiz = mine.filter((i) => labels.desks[i].w / labels.mmX >= labels.desks[i].h / labels.mmY).length;
    const chairOnY = horiz > 0;
    const chairOnX = horiz < mine.length;
    const side = (over: number, chair: number, allowChair: boolean, keep: number, desk: number, withChair: number) =>
      over > chair * 2.2 ? keep : allowChair && over > chair * 0.35 ? withChair : desk;
    const box: Box = {
      x0: side(ext.x0 - ai.x0, chairX, chairOnX, ai.x0, ext.x0, ext.x0 - chairX),
      y0: side(ext.y0 - ai.y0, chairY, chairOnY, ai.y0, ext.y0, ext.y0 - chairY),
      x1: side(ai.x1 - ext.x1, chairX, chairOnX, ai.x1, ext.x1, ext.x1 + chairX),
      y1: side(ai.y1 - ext.y1, chairY, chairOnY, ai.y1, ext.y1, ext.y1 + chairY),
    };
    return { ai, box, ext, mine };
  });

  // 늘린 상자가 남의 책상을 먹으면 그 책상 앞(내 책상 끝과의 가운데)까지 줄인다.
  work.forEach((w, zi) => {
    if (!w.ext) return;
    const ext = w.ext;
    deskBoxes.forEach((d, di) => {
      if (owner[di] === zi || !inside(center(d), w.box)) return;
      const c = center(d);
      if (c.x < ext.x0) w.box.x0 = Math.max(w.box.x0, (d.x1 + ext.x0) / 2);
      else if (c.x > ext.x1) w.box.x1 = Math.min(w.box.x1, (d.x0 + ext.x1) / 2);
      else if (c.y < ext.y0) w.box.y0 = Math.max(w.box.y0, (d.y1 + ext.y0) / 2);
      else if (c.y > ext.y1) w.box.y1 = Math.min(w.box.y1, (d.y0 + ext.y1) / 2);
    });
  });

  // 존끼리 겹치면 두 존 책상 사이 가운데에서 나눈다 — 마주 보는 줄의 의자가 통로에서 만날 때, 그리고 등 맞댄 두 줄을
  // 따로 잡았을 때(10-28 호구포TEST FPS존A·멀티존A). 등 맞댄 줄은 치수 글씨가 책상 한가운데가 아니라 맞댄 쪽에 붙어 있어
  // 글씨로 그린 책상 상자가 서로 겹친다 → 겹친 책상 범위의 가운데 = 실제 맞댄 선에서 나눈다.
  // 나누는 방향은 상자가 덜 겹친 쪽(위아래로 붙은 줄이면 세로로 조금, 가로로 길게 겹친다 → 위아래로 나눔).
  for (let i = 0; i < work.length; i++) {
    for (let j = i + 1; j < work.length; j++) {
      const a = work[i];
      const b = work[j];
      if (!a.ext || !b.ext) continue;
      const ox = Math.min(a.box.x1, b.box.x1) - Math.max(a.box.x0, b.box.x0);
      const oy = Math.min(a.box.y1, b.box.y1) - Math.max(a.box.y0, b.box.y0);
      if (ox <= 0 || oy <= 0) continue;
      if (oy <= ox) {
        const [top, bottom] = center(a.ext).y <= center(b.ext).y ? [a, b] : [b, a];
        const mid = (top.ext!.y1 + bottom.ext!.y0) / 2;
        top.box.y1 = Math.min(top.box.y1, mid);
        bottom.box.y0 = Math.max(bottom.box.y0, mid);
      } else {
        const [left, right] = center(a.ext).x <= center(b.ext).x ? [a, b] : [b, a];
        const mid = (left.ext!.x1 + right.ext!.x0) / 2;
        left.box.x1 = Math.min(left.box.x1, mid);
        right.box.x0 = Math.max(right.box.x0, mid);
      }
    }
  }

  return work.map((w) => {
    if (!w.ext) return { rect: toRect(w.ai), deskCount: null, snapped: false, desks: [] };
    const b = w.box;
    const clamped: Box = { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(1, b.x1), y1: Math.min(1, b.y1) };
    return { rect: toRect(clamped), deskCount: w.mine.length, snapped: true, desks: w.mine };
  });
}

/** 어느 존 상자에도 가운데가 들어가지 않은 책상 수. 존을 지우거나 덜 그렸을 때 작업 순서를 "존 초안"으로 되돌리는 데 쓴다. */
export function countUncoveredDesks(labels: DeskLabelSet, zones: NormalizedRect[]): number {
  const boxes = zones.map(toBox);
  return labels.desks.filter((d) => {
    const c = center(toBox(d));
    return !boxes.some((b) => inside(c, b));
  }).length;
}

/** 글씨 폭(mm) → 표준 책상 사이즈. 표준에서 30mm 넘게 벗어나면 null(사람이 확인). */
export function deskSizeOfWidth(mm: number): DeskSize | null {
  let best: DeskSize | null = null;
  let bestDiff = Infinity;
  for (const s of DESK_SIZE_OPTIONS) {
    const diff = Math.abs(parseInt(s, 10) - mm);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return bestDiff <= 30 ? best : null;
}

/** bagShelf = 브라켓 달린 책상 수. 도면에 브라켓 표시 정보가 없으면 null(지금 값 유지). */
export type ZoneDeskCount = { seats: number; sizeBreakdown: SizeBreakdownEntry[]; unknown: number; bagShelf: number | null };

/**
 * 존마다 그 안 책상 글씨를 세어 수량·사이즈를 낸다(10-29 — 채팅 "책상 인식" 단계를 없앴다. 글씨 수는 세 도면 모두 범례 수량과 같음).
 * 책상 = 가운데가 존 상자 안에 든 글씨. 두 존에 걸치면 더 작은 존 몫(snapZonesToDesks와 같은 규칙, 방도 포함).
 * 폭 정보가 없는 옛 도면이면 null — 그땐 지금 값을 그대로 둔다. 책상이 하나도 안 든 존(카운터 등)도 null.
 */
export function countDesksByZone(labels: DeskLabelSet, zones: NormalizedRect[]): (ZoneDeskCount | null)[] {
  const widths = labels.widths;
  if (!widths || widths.length !== labels.desks.length) return zones.map(() => null);
  const boxes = zones.map(toBox);
  const perZone = zones.map(() => [] as number[]);
  const bracketsPerZone = zones.map(() => 0);
  const brackets = labels.brackets?.length === labels.desks.length ? labels.brackets : null;
  labels.desks.forEach((d, di) => {
    const c = center(toBox(d));
    let best = -1;
    let bestArea = Infinity;
    boxes.forEach((b, zi) => {
      const area = zones[zi].w * zones[zi].h;
      if (inside(c, b) && area < bestArea) {
        bestArea = area;
        best = zi;
      }
    });
    if (best >= 0) {
      perZone[best].push(widths[di]);
      if (brackets?.[di]) bracketsPerZone[best] += 1;
    }
  });
  return perZone.map((ws, zi) => {
    if (!ws.length) return null;
    const qty = new Map<DeskSize, number>();
    let unknown = 0;
    for (const w of ws) {
      const size = deskSizeOfWidth(w);
      if (size) qty.set(size, (qty.get(size) ?? 0) + 1);
      else unknown += 1;
    }
    const sizeBreakdown = DESK_SIZE_OPTIONS.filter((s) => qty.has(s)).map((s) => ({ deskSize: s, qty: qty.get(s)! }));
    return { seats: ws.length, sizeBreakdown, unknown, bagShelf: brackets ? bracketsPerZone[zi] : null };
  });
}

/**
 * 도면 영역 자동 자르기(10-29 사용자 「PDF 고르면 사용자가 구역 지정 안 하고 자동으로」). 페이지 기준 0~1.
 * 책상 글씨를 감싼 상자에서 시작해, 그 상자 1.5m 안에 닿는 벽 선을 따라 건물 바깥 벽까지 넓힌다(몇 번 되풀이).
 * 쪽 테두리처럼 쪽 절반 넘게 긴 선은 건물이 아니라 넘긴다 — 제목 칸·범례 표는 건물 벽과 떨어져 있어 안 잡힌다.
 * 시험 도면 3장 3쪽에서 건물 전체가 들어가고 제목 칸·범례는 빠지는 것을 그림으로 확인. 끝에 30cm 여백.
 */
export function autoCropRect(labels: DeskLabelSet): NormalizedRect {
  let x0 = Math.min(...labels.desks.map((d) => d.x));
  let y0 = Math.min(...labels.desks.map((d) => d.y));
  let x1 = Math.max(...labels.desks.map((d) => d.x + d.w));
  let y1 = Math.max(...labels.desks.map((d) => d.y + d.h));
  const gx = 1500 * labels.mmX;
  const gy = 1500 * labels.mmY;
  const walls = unflattenWalls(labels.walls ?? []);
  for (let round = 0; round < 6; round++) {
    let grew = false;
    for (const [a, b, c, e] of walls) {
      const wx0 = Math.min(a, c), wx1 = Math.max(a, c), wy0 = Math.min(b, e), wy1 = Math.max(b, e);
      if (wx1 - wx0 > 0.6 || wy1 - wy0 > 0.6) continue;
      if (wx1 < x0 - gx || wx0 > x1 + gx || wy1 < y0 - gy || wy0 > y1 + gy) continue;
      if (wx0 < x0 || wy0 < y0 || wx1 > x1 || wy1 > y1) {
        x0 = Math.min(x0, wx0); y0 = Math.min(y0, wy0); x1 = Math.max(x1, wx1); y1 = Math.max(y1, wy1);
        grew = true;
      }
    }
    if (!grew) break;
  }
  const mx = 300 * labels.mmX;
  const my = 300 * labels.mmY;
  const rx0 = Math.max(0, x0 - mx), ry0 = Math.max(0, y0 - my);
  return { x: r4(rx0), y: r4(ry0), w: r4(Math.min(1, x1 + mx) - rx0), h: r4(Math.min(1, y1 + my) - ry0) };
}

// 10-29 광주 사용자: 프렌즈·VIP → 커플석 → 「같은 존이면 기준에 맞는 모든 존을 합쳐」 → 「룸도 합칠 수 있으면 합쳐」(10-27 「팀룸 따로따로」를
// 바꿈). 같은 유형이면 방까지 모든 유형. 채팅은 여전히 방마다 상자를 내고(벽 맞춤·방 나누기는 방 단위가 정확) 웹이 넣을 때 합친다.
const canMergeType = (t: string) => t.length > 0;
// 10-30 울산삼산점TEST 사용자: 세로로 긴 팀룸 + 가로로 긴 팀룸이 아래 끝만 맞아 ㄴ자인데, 감싸는 네모로 합쳐 빈 귀퉁이까지 존이 됐다
// (빈 공간 = 두 방 넓이의 약 49%). 존은 네모만 되므로 빈 공간이 크면 따로 둔다. 광주 프렌즈 B·C·1인석·커플석은 나란해서 약 0%.
// 20%면 같은 길이 두 줄이 길이의 20%까지 어긋나도 합친다.
const MERGE_MAX_EMPTY = 0.2;

/**
 * 같은 공간에서 통로를 사이에 두고 나란히 붙은 같은 유형 존(방 포함 모든 유형)을 한 존으로 합친다(10-29 광주첨단점TEST 사용자 「프렌즈존 B·C가
 * 한 구역이 보기 좋다」). 조건: 같은 유형, 마주 보는 방향 범위가 짧은 쪽의 70% 이상 겹침, 사이 틈 1.5m 이하, 합친 상자가 다른 존과
 * 겹치거나 다른 존 책상(가운데)을 먹지 않음, 합친 상자의 빈 공간(두 상자와 그 사이 통로를 뺀 나머지)이 두 상자 넓이 합의
 * MERGE_MAX_EMPTY 이하. 합친 결과의 i번째 = 남는 존 번호 목록(앞 존이 이름·사양을 가진다).
 */
export function mergeFacingZones(
  zones: (NormalizedRect & { typeKey: string })[],
  labels: DeskLabelSet | null,
): number[][] {
  const groups: { idx: number[]; box: NormalizedRect; type: string }[] = zones.map((z, i) => ({ idx: [i], box: { x: z.x, y: z.y, w: z.w, h: z.h }, type: z.typeKey }));
  const mmX = labels?.mmX ?? 0.0001;
  const mmY = labels?.mmY ?? 0.0001;
  const ov = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  // 맞닿은 이웃 상자(맞춘 상자끼리 0.1% 겹침)는 겹침으로 보지 않는다 — 30cm 넘게 파고들어야 겹침.
  const overlaps = (a: NormalizedRect, b: NormalizedRect) =>
    ov(a.x, a.x + a.w, b.x, b.x + b.w) > 300 * mmX && ov(a.y, a.y + a.h, b.y, b.y + b.h) > 300 * mmY;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i++) {
      for (let j = i + 1; j < groups.length && !merged; j++) {
        const A = groups[i], B = groups[j];
        if (A.type !== B.type || !canMergeType(A.type)) continue;
        const a = A.box, b = B.box;
        const yOv = ov(a.y, a.y + a.h, b.y, b.y + b.h) / Math.min(a.h, b.h);
        const xOv = ov(a.x, a.x + a.w, b.x, b.x + b.w) / Math.min(a.w, b.w);
        const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)) / mmX;
        const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)) / mmY;
        const facing = (yOv >= 0.7 && gapX <= 1500) || (xOv >= 0.7 && gapY <= 1500);
        if (!facing) continue;
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        const u = { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
        // 사이 통로 띠(틈 × 마주 보는 길이)는 빈 공간으로 치지 않는다.
        const aisle = yOv >= 0.7 && gapX <= 1500
          ? gapX * mmX * ov(a.y, a.y + a.h, b.y, b.y + b.h)
          : gapY * mmY * ov(a.x, a.x + a.w, b.x, b.x + b.w);
        const partsArea = a.w * a.h + b.w * b.h;
        if (u.w * u.h - partsArea - aisle > MERGE_MAX_EMPTY * partsArea) continue;
        const others = groups.filter((_, k) => k !== i && k !== j);
        if (others.some((o) => overlaps(u, o.box))) continue;
        const inside = (c: { x: number; y: number }, r: NormalizedRect) => c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h;
        const steals = (labels?.desks ?? []).some((d) => {
          const c = { x: d.x + d.w / 2, y: d.y + d.h / 2 };
          return inside(c, u) && !inside(c, a) && !inside(c, b);
        });
        if (steals) continue;
        groups[i] = { idx: [...A.idx, ...B.idx], box: u, type: A.type };
        groups.splice(j, 1);
        merged = true;
      }
    }
  }
  return groups.map((g) => g.idx);
}
