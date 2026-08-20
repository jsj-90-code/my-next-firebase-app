// 아이센스 PC방 좌석배치도 작업 툴 - FHD 합성 이미지 렌더링
// 앱스크립트 v15 Index.html의 drawTable / drawFloorPlanCard / drawZoneOverlaysOnCard /
// renderDeskComposite / renderPcComposite 를 그대로 이식.

import {
  baseZoneName,
  computeBasicPcQty,
  computeBezelTable,
  computeChairSummary,
  computeCompactLayout,
  computeDeskSummary,
  computeHeadsetHookTotals,
  computeJangpadTable,
  computeLegendGeometry,
  computePcOrderSummary,
  computePcSetSummary,
  computePcTotal,
  getContrastText,
  groupDeskZonesForCard,
  mergeZoneDisplayNames,
  normalizeFieldValue,
  resolveAdapterValue,
  splitMouseValue,
  tintColor,
} from "./calc";
import { COMPOSITE_H, COMPOSITE_W, PC_SPEC_FIELDS } from "./constants";
import type { DeskZone, PcSpecValues, PcZone, SeatNumberRangeEntry } from "./types";

type TableCol = { title: string; width: number };

export function drawTable(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  headerH: number,
  rowH: number,
  cols: TableCol[],
  rowsData: (string | number)[][],
  fontScale = 1,
): number {
  const totalH = headerH + Math.max(1, rowsData.length) * rowH;

  c.fillStyle = "#8D7B68";
  c.fillRect(x, y, w, headerH);
  c.fillStyle = "#ffffff";
  c.font = `bold ${Math.round(16 * fontScale)}px sans-serif`;
  let cx = x;
  cols.forEach((col) => {
    c.fillText(col.title, cx + 6, y + headerH * 0.68);
    cx += col.width;
  });

  c.strokeStyle = "#2A2520";
  c.lineWidth = 1.2;
  c.strokeRect(x, y, w, totalH);

  cx = x;
  cols.forEach((col, i) => {
    if (i > 0) {
      c.strokeStyle = "#D9D2C4";
      c.beginPath();
      c.moveTo(cx, y);
      c.lineTo(cx, y + totalH);
      c.stroke();
    }
    cx += col.width;
  });

  c.strokeStyle = "#2A2520";
  c.beginPath();
  c.moveTo(x, y + headerH);
  c.lineTo(x + w, y + headerH);
  c.stroke();

  const rows = rowsData.length ? rowsData : [["-", "-", "-"]];
  c.font = `${Math.round(15 * fontScale)}px sans-serif`;
  c.fillStyle = "#2A2520";
  rows.forEach((rowVals, ri) => {
    const ry = y + headerH + ri * rowH;
    if (ri > 0) {
      c.strokeStyle = "#EDE7DA";
      c.beginPath();
      c.moveTo(x, ry);
      c.lineTo(x + w, ry);
      c.stroke();
    }
    let cx2 = x;
    rowVals.forEach((val, ci) => {
      c.fillText(String(val), cx2 + 6, ry + rowH * 0.66);
      cx2 += cols[ci].width;
    });
  });

  return totalH;
}

// 표 칸 너비를 실제 들어갈 글자 길이에 맞춰 계산한다 (내용은 짧은데 칸이 캔버스 끝까지
// 늘어나 가로 여백만 커 보이는 문제를 막기 위함 — 고정 비율 대신 측정값을 쓴다).
function measureColWidths(
  c: CanvasRenderingContext2D,
  titles: string[],
  rowsData: (string | number)[][],
  minWidth = 60,
  padding = 30,
): number[] {
  return titles.map((title, ci) => {
    c.font = "bold 16px sans-serif";
    let max = c.measureText(title).width;
    c.font = "15px sans-serif";
    rowsData.forEach((row) => {
      const w = c.measureText(String(row[ci] ?? "")).width;
      if (w > max) max = w;
    });
    return Math.max(minWidth, Math.round(max + padding));
  });
}

export type FloorPlanGeo = { imgX: number; imgY: number; areaW: number; areaH: number };

export function drawFloorPlanCard(
  c: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cardY: number,
  cardH: number,
  cardX = 950,
  cardW = 955,
): FloorPlanGeo {
  c.fillStyle = "#ffffff";
  c.fillRect(cardX, cardY, cardW, cardH);
  c.strokeStyle = "#D9D2C4";
  c.lineWidth = 1.5;
  c.strokeRect(cardX, cardY, cardW, cardH);

  const pad = 15;
  const areaX = cardX + pad;
  const areaY = cardY + pad;
  const maxAreaW = cardW - 2 * pad;
  const maxAreaH = cardH - 2 * pad;
  const ratio = img.naturalWidth / img.naturalHeight;
  let areaW = maxAreaW;
  let areaH = areaW / ratio;
  if (areaH > maxAreaH) {
    areaH = maxAreaH;
    areaW = areaH * ratio;
  }
  const imgX = areaX + (maxAreaW - areaW) / 2;
  const imgY = areaY + (maxAreaH - areaH) / 2;
  c.drawImage(img, imgX, imgY, areaW, areaH);

  return { imgX, imgY, areaW, areaH };
}

// 존끼리 인접/근접한 건 상관없지만, 존 이름표(태그)끼리 겹치면 가독성이 떨어진다.
// 각 존 위에 기본 위치(존 좌상단 바로 위)로 이름표를 계산해둔 뒤, 이미 배치된 다른
// 이름표와 겹치는 태그는 그 아래로 밀어내는 방식으로 겹침을 해소한다.
function resolveTagOverlaps(
  tags: { x: number; y: number; w: number; h: number }[],
): { x: number; y: number; w: number; h: number }[] {
  const GAP = 3;
  const MAX_ITER = 100;
  const order = tags.map((_, i) => i).sort((a, b) => tags[a].y - tags[b].y || tags[a].x - tags[b].x);
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const resolved: { x: number; y: number; w: number; h: number }[] = new Array(tags.length);

  order.forEach((i) => {
    const tag = { ...tags[i] };
    let moved = true;
    let guard = 0;
    while (moved && guard < MAX_ITER) {
      moved = false;
      for (const p of placed) {
        const overlap = tag.x < p.x + p.w && tag.x + tag.w > p.x && tag.y < p.y + p.h && tag.y + tag.h > p.y;
        if (overlap) {
          tag.y = p.y + p.h + GAP;
          moved = true;
          break;
        }
      }
      guard++;
    }
    placed.push(tag);
    resolved[i] = tag;
  });

  return resolved;
}

export function drawZoneOverlaysOnCard(
  c: CanvasRenderingContext2D,
  zones: (DeskZone | PcZone)[],
  geo: FloorPlanGeo,
) {
  const rects = zones.map((z) => {
    const zx = geo.imgX + z.x * geo.areaW;
    const zy = geo.imgY + z.y * geo.areaH;
    const zw = z.w * geo.areaW;
    const zh = z.h * geo.areaH;

    c.strokeStyle = z.color;
    c.lineWidth = 5;
    c.strokeRect(zx, zy, zw, zh);

    return { z, zx, zy, zw, zh };
  });

  // 존이 많으면 이름표가 서로 겹치거나 도면이 번잡해 보여서, 기존 24px보다 작게 줄였다.
  c.font = "bold 16px sans-serif";
  const tagH = 22;
  const naiveTags = rects.map(({ zx, zy, z }) => {
    const textW = c.measureText(z.name).width;
    return { x: zx, y: Math.max(0, zy - tagH - 4), w: textW + 14, h: tagH };
  });
  const tags = resolveTagOverlaps(naiveTags);

  rects.forEach(({ z }, i) => {
    const tag = tags[i];
    c.fillStyle = z.color;
    c.fillRect(tag.x, tag.y, tag.w, tag.h);
    c.fillStyle = getContrastText(z.color);
    c.font = "bold 16px sans-serif";
    c.fillText(z.name, tag.x + 7, tag.y + 15.5);
  });
}

function fillBackground(c: CanvasRenderingContext2D) {
  c.fillStyle = "#FAF7F2";
  c.fillRect(0, 0, COMPOSITE_W, COMPOSITE_H);
}

// 존 카드의 사양 값(예: 사이즈가 2종류 이상 섞인 "책상사이즈")이 칸 폭보다 길어지면
// 옆 칸 카드에 그대로 덮여 잘려 보이던 문제를 막기 위해, 칸 폭에 맞을 때까지 글자 크기를 줄인다.
function fitValueFontSize(
  c: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  baseSize: number,
  minSize = 10,
  bold = false,
): number {
  if (!text || maxWidth <= 0) return baseSize;
  c.font = `${bold ? "bold " : ""}${baseSize}px sans-serif`;
  const baseWidth = c.measureText(text).width;
  if (baseWidth <= maxWidth) return baseSize;
  return Math.max(minSize, Math.floor((maxWidth / baseWidth) * baseSize));
}

// 책상 발주 도면: 표(베젤/합계)는 renderOrderSummaryImage로 분리되었으므로,
// 그만큼 비는 공간을 도면 카드 높이를 늘려서 채운다.
export function renderDeskFloorplanImage(
  c: CanvasRenderingContext2D,
  img: HTMLImageElement,
  projectName: string,
  zones: DeskZone[],
) {
  fillBackground(c);

  const cardBottomGap = 14;
  const cardY = 15;
  const cardH = 1060 - cardY - cardBottomGap;

  // 좌측 사양표는 "FPS존A"/"FPS존B"처럼 이름 끝 알파벳만 다르고 사양이 완전히 같은 존을 한
  // 카드로 합쳐서 보여준다(좌석수만 합산). 도면 위 존 박스(drawZoneOverlaysOnCard)는 실제
  // 구역이 그대로 남아있어야 하므로 항상 원본 zones로 그린다.
  const cardGroups = groupDeskZonesForCard(zones);

  const geometry = computeLegendGeometry(cardGroups.length);
  const geo = drawFloorPlanCard(c, img, cardY, cardH, geometry.cardX, geometry.cardW);
  drawZoneOverlaysOnCard(c, zones, geo);

  const panelAreaX = 20;
  const panelAreaY = 20;
  const panelAreaW = geometry.panelAreaW;
  const panelBottomLimit = geometry.panelBottomLimit;
  const gap = 14;
  const layout = computeCompactLayout(
    cardGroups.length,
    panelBottomLimit - panelAreaY,
    225,
    48,
    25,
    19,
    geometry.cols,
  );
  const colW = (panelAreaW - (layout.cols - 1) * gap) / layout.cols;
  const specLabels = ["책상", "책상사이즈", "쿨러", "칸막이", "모니터암", "의자"];

  cardGroups.forEach((g, idx) => {
    const col = idx % layout.cols;
    const row = Math.floor(idx / layout.cols);
    const px = panelAreaX + col * (colW + gap);
    const py = panelAreaY + row * layout.rowH;
    const pw = colW;
    const ph = layout.rowH - 10;
    const textColor = getContrastText(g.color);
    const bodyBg = tintColor(g.color, 0.93);
    const labelBg = tintColor(g.color, 0.72);

    c.fillStyle = bodyBg;
    c.fillRect(px, py, pw, ph);
    c.strokeStyle = g.color;
    c.lineWidth = 2;
    c.strokeRect(px, py, pw, ph);
    c.fillStyle = g.color;
    c.fillRect(px, py, pw, layout.headerH);
    c.fillStyle = textColor;
    const deskHeaderText = `[${g.name}- ${g.seats}석]`;
    const deskHeaderFont = fitValueFontSize(c, deskHeaderText, pw - 16, layout.headerFont, 11, true);
    c.font = `bold ${deskHeaderFont}px sans-serif`;
    c.fillText(deskHeaderText, px + 8, py + layout.headerH * 0.68);

    const values = [g.desk, g.sizeText, g.cooler, g.partition, g.monitorArm, g.chair];
    const lineH = (ph - layout.headerH) / specLabels.length;

    specLabels.forEach((label, li) => {
      const ly = py + layout.headerH + li * lineH;
      c.font = `bold ${layout.bodyFont}px sans-serif`;
      const labelW = c.measureText(label).width;
      c.fillStyle = labelBg;
      c.fillRect(px + 4, ly + 4, labelW + 10, lineH - 8);
      c.fillStyle = "#2A2520";
      c.fillText(label, px + 9, ly + lineH * 0.68);
      const valueMaxW = pw - 22 - labelW;
      const valueFont = fitValueFontSize(c, values[li], valueMaxW, layout.bodyFont);
      c.font = `${valueFont}px sans-serif`;
      c.fillText(values[li], px + 18 + labelW, ly + lineH * 0.68);
      if (li < specLabels.length - 1) {
        c.strokeStyle = "#E5DFD3";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(px + 4, ly + lineH);
        c.lineTo(px + pw - 4, ly + lineH);
        c.stroke();
      }
    });
  });

  const totalSeats = zones.reduce((s, z) => s + (Number(z.seats) || 0), 0) + 1;
  c.fillStyle = "#2A2520";
  c.font = "bold 48px sans-serif";
  c.fillText(`${projectName || "매장명"}_${totalSeats}석(카운터포함)`, panelAreaX, 1020);
}

// PC 발주 도면: 장패드 수량 표는 renderOrderSummaryImage로 분리되었으므로,
// 그만큼 비는 공간을 도면 카드 높이를 늘려서 채운다.
export function renderPcFloorplanImage(
  c: CanvasRenderingContext2D,
  img: HTMLImageElement,
  projectName: string,
  pcZones: PcZone[],
  pcDefaults: PcSpecValues,
) {
  fillBackground(c);

  const cardBottomGap = 14;
  const cardY = 15;
  const cardH = 1060 - cardY - cardBottomGap;

  // "LOL존A/LOL존B/LOL존C"처럼 뒤에 알파벳만 다르고 이름이 같은 계열의 존은 카드도 서로
  // 붙어서 나오도록, 뒤에 붙은 알파벳 한 글자를 뗀 "기본 이름" 기준으로 정렬해 묶는다. 그리고
  // 그중에서도 override 값이 완전히 같은 존(예: 사양 차이 없이 구역만 나눠둔 "FPS존A"/"FPS존B")은
  // 좌석수만 합쳐서 카드 한 장으로 합친다 — 사양이 하나라도 다르면 합치지 않고 그대로 각각 보여준다.
  const overrideCardsByKey = new Map<
    string,
    { names: string[]; seats: number; color: string; lines: { label: string; value: string }[] }
  >();
  const overrideCardOrder: string[] = [];
  pcZones.forEach((z) => {
    const ov = z.pcOverrides || {};
    // 옛날 문구 그대로 저장된 override는 정식 이름으로 바꿔서 보여주고, 정규화 후 값이 기본값과
    // 똑같아지면(예: FPS 충전기가 예전엔 "무선충전기(2포트 이상)"였다가 지금은 기본값과 같은
    // "무선충전기") 더 이상 "다른 사양"이 아니므로 카드에서 뺀다. CPU/RAM/GPU/M·B/POWER/CPU쿨러도
    // [ PC 구성 ] 표에 조합별로 따로 집계되긴 하지만, 실제로 업그레이드된 존은 도면 카드에서도
    // 바로 보여야 하므로 다른 항목과 동일하게 취급한다(기본값과 같을 때만 중복 표시를 막는다).
    const lines = PC_SPEC_FIELDS.filter((f) => ov[f.id] != null)
      .map((f) => {
        const value = normalizeFieldValue(f.id, ov[f.id] as string);
        const defaultValue = normalizeFieldValue(f.id, pcDefaults[f.id] ?? f.def);
        return { label: f.label, value, redundant: value === defaultValue };
      })
      .filter((ln) => !ln.redundant)
      .map(({ label, value }) => ({ label, value }));

    // 어답터 항목이 생기기 전에 저장된 존은 override가 없지만, 실제로 적용되는 값(레이저
    // 블랙샤크 V2 하이퍼스피드 헤드셋을 쓰면 3구 어답터)이 기본값과 다르면 카드에도 보여준다.
    if (ov.adapter == null) {
      const adapterDef = PC_SPEC_FIELDS.find((f) => f.id === "adapter")?.def ?? "";
      const adapterValue = resolveAdapterValue(z, pcDefaults, adapterDef);
      const adapterDefaultValue = normalizeFieldValue("adapter", pcDefaults.adapter ?? adapterDef);
      if (adapterValue !== adapterDefaultValue) {
        lines.push({ label: "어답터", value: adapterValue });
      }
    }

    if (!lines.length) return;
    const linesKey = lines.map((l) => `${l.label}=${l.value}`).join("|");
    const key = `${baseZoneName(z.name)}::${linesKey}`;
    let g = overrideCardsByKey.get(key);
    if (!g) {
      g = { names: [], seats: 0, color: z.color, lines };
      overrideCardsByKey.set(key, g);
      overrideCardOrder.push(key);
    }
    g.names.push(z.name);
    g.seats += Number(z.seats) || 0;
  });

  const overrideZones = overrideCardOrder
    .map((key) => {
      const g = overrideCardsByKey.get(key)!;
      return { name: mergeZoneDisplayNames(g.names), seats: g.seats, color: g.color, lines: g.lines };
    })
    .sort((a, b) => {
      const baseCmp = baseZoneName(a.name).localeCompare(baseZoneName(b.name));
      return baseCmp !== 0 ? baseCmp : a.name.localeCompare(b.name);
    });

  const panelAreaX = 20;
  const panelAreaY = 20;
  const basicQty = computeBasicPcQty(pcZones);
  // 존 이름을 그대로 따오지 않고 고정 문구로 둔다 — 멀티존A/멀티존B처럼 존 이름 뒤에 알파벳이
  // 붙어도 이 박스 제목에는 항상 "멀티존"만 표시한다.
  const defaultSpecLabel = "(멀티존)";

  const DEFAULT_BOX_FIELDS = PC_SPEC_FIELDS.filter((f) => f.id !== "joypad");
  const defHeaderH = 34;
  const defLineH = 25;
  const defBoxH = defHeaderH + Math.ceil(DEFAULT_BOX_FIELDS.length / 2) * defLineH + 10;
  const panelTop = panelAreaY + defBoxH + 16;
  const gap = 14;

  // 존별 사양 카드는 같은 행(row)에 있는 카드끼리는 높이를 맞춰서 가로로 나란히 정렬되게 하고
  // (스크린샷처럼 보기 편하도록), 줄이 적어 남는 자리는 그 카드 안에서 그냥 공백으로 남긴다.
  // 행마다 필요한 높이는 그 행에서 제일 줄이 많은 카드 기준으로만 잡아서, 행끼리는 서로 다른
  // 높이를 가질 수 있다(예: 1줄짜리 존만 있는 행은 낮고, 6줄짜리 존이 있는 행은 높게).
  const BASE_HEADER_FONT = 25;
  const BASE_BODY_FONT = 20;
  const BASE_LINE_H = 30;
  const BASE_HEADER_H = 46;
  const MIN_COL_W = 250;
  const basePanelAreaW = 900;
  const baseCardX = 950;
  const baseCardW = 955;
  const gapBetween = 30;

  function rowHeightsFor(cols: number): number[] {
    const rows = Math.max(1, Math.ceil(overrideZones.length / cols));
    const heights: number[] = [];
    for (let r = 0; r < rows; r++) {
      let maxLinesInRow = 1;
      for (let col = 0; col < cols; col++) {
        const item = overrideZones[r * cols + col];
        if (item) maxLinesInRow = Math.max(maxLinesInRow, item.lines.length);
      }
      heights.push(BASE_HEADER_H + maxLinesInRow * BASE_LINE_H + 10);
    }
    return heights;
  }

  function panelAreaWForCols(cols: number): number {
    if (cols <= 3) return basePanelAreaW;
    const extraW = (cols - 3) * 150;
    const maxPanelAreaW = baseCardX + baseCardW - gapBetween - panelAreaX - 480;
    return Math.min(basePanelAreaW + extraW, maxPanelAreaW);
  }

  // 존이 많아 세로 공간이 모자라면, 도면 폭을 더 덜어오는 것 외에 패널 아래 한계선도 살짝
  // 늘린다 — 다만 하단 제목 문구(y=1020)와 겹치지 않도록 940~1000 사이로만 늘어난다.
  function panelBottomLimitForCols(cols: number): number {
    const basePanelBottomLimit = 940;
    if (cols <= 3) return basePanelBottomLimit;
    const extraH = Math.min(60, (cols - 3) * 20);
    return basePanelBottomLimit + extraH;
  }

  // 세로로 넘치면 폰트를 계속 줄이는 대신, 먼저 컬럼 수를 늘려(도면 폭을 좀 덜어와서) 컬럼당
  // 카드 수를 줄여본다 — 컬럼 수별로 나오는 최종 배율(scale)이 가장 큰(=가장 읽기 좋은) 쪽을 고른다.
  let best: { cols: number; panelAreaW: number; colW: number; scale: number } | null = null;

  for (let cols = 3; cols <= 6; cols++) {
    const panelAreaW = panelAreaWForCols(cols);
    const colW = (panelAreaW - (cols - 1) * gap) / cols;
    if (colW < MIN_COL_W && cols > 3) break;

    const rowHeights = rowHeightsFor(cols);
    const totalNeededH = rowHeights.reduce((s, h) => s + h, 0);
    const availH = panelBottomLimitForCols(cols) - panelTop;
    const heightScale = availH / totalNeededH;

    c.font = `bold ${BASE_BODY_FONT}px sans-serif`;
    let widthScale = Infinity;
    overrideZones.forEach((item) => {
      item.lines.forEach((ln) => {
        c.font = `bold ${BASE_BODY_FONT}px sans-serif`;
        const labelW = c.measureText(ln.label).width;
        c.font = `${BASE_BODY_FONT}px sans-serif`;
        const valueW = c.measureText(ln.value).width;
        const needed = 18 + labelW + 10 + valueW + 6;
        if (needed > 0) widthScale = Math.min(widthScale, colW / needed);
      });
    });
    if (widthScale === Infinity) widthScale = 1;

    const scale = Math.max(0.6, Math.min(1.8, Math.min(heightScale, widthScale)));
    if (!best || scale > best.scale + 0.02) {
      best = { cols, panelAreaW, colW, scale };
    }
    if (cols === 6 || colW < MIN_COL_W) break;
  }

  // overrideZones가 비어 있으면(전 존이 기본사양) 위 루프에서 best가 안 잡힐 수 있으니 안전망.
  const chosen = best ?? { cols: 3, panelAreaW: basePanelAreaW, colW: (basePanelAreaW - 2 * gap) / 3, scale: 1 };
  const { cols, panelAreaW, colW, scale } = chosen;
  const cardX = panelAreaX + panelAreaW + gapBetween;
  const cardW = baseCardX + baseCardW - cardX;

  const geo = drawFloorPlanCard(c, img, cardY, cardH, cardX, cardW);
  drawZoneOverlaysOnCard(c, pcZones, geo);

  c.fillStyle = "#2A2520";
  c.fillRect(panelAreaX, panelAreaY, panelAreaW, defHeaderH);
  c.fillStyle = "#ffffff";
  c.font = "bold 19px sans-serif";
  c.fillText(
    `[ PC 기본사양${defaultSpecLabel} ] - ${basicQty}대 (카운터, 대체PC 포함)`,
    panelAreaX + 10,
    panelAreaY + defHeaderH * 0.7,
  );
  c.fillStyle = "#ffffff";
  c.fillRect(panelAreaX, panelAreaY + defHeaderH, panelAreaW, defBoxH - defHeaderH);
  c.strokeStyle = "#2A2520";
  c.lineWidth = 1.5;
  c.strokeRect(panelAreaX, panelAreaY, panelAreaW, defBoxH);
  c.font = "16px sans-serif";
  c.fillStyle = "#2A2520";
  const colW2 = panelAreaW / 2;
  DEFAULT_BOX_FIELDS.forEach((f, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const lx = panelAreaX + 12 + col * colW2;
    const ly = panelAreaY + defHeaderH + 8 + row * defLineH;
    c.font = "bold 16px sans-serif";
    c.fillText(f.label, lx, ly + 16);
    const labelW = c.measureText(f.label).width;
    const rawDefault = pcDefaults[f.id] || f.def;
    // 마우스는 " & "로 이어붙인 조합이라 부품 하나씩 정규화한 뒤 다시 이어붙여야 하고, 나머지는
    // 통짜 문자열을 그대로 정규화한다 — 저장된 값이 옛 문구여도 항상 최신 이름으로 보여준다.
    const displayDefault =
      f.id === "mouse" ? splitMouseValue(rawDefault).join(" & ") : normalizeFieldValue(f.id, rawDefault);
    // 마우스처럼 정식 제품명이 길어지면 칸 폭을 넘어 다음 칸에 잘려 보이던 문제가 있어,
    // 칸에 맞을 때까지 글자 크기를 줄인다.
    const valueMaxW = colW2 - (12 + labelW + 10) - 8;
    const valueFont = fitValueFontSize(c, displayDefault, valueMaxW, 16, 10);
    c.font = `${valueFont}px sans-serif`;
    c.fillText(displayDefault, lx + labelW + 10, ly + 16);
  });

  const rowH = rowHeightsFor(cols).map((h) => h * scale);
  const rowY: number[] = [];
  {
    let acc = panelTop;
    rowH.forEach((h) => {
      rowY.push(acc);
      acc += h;
    });
  }
  const headerH = BASE_HEADER_H * scale;
  const headerFont = Math.max(10, Math.round(BASE_HEADER_FONT * scale));
  const bodyFont = Math.max(10, Math.round(BASE_BODY_FONT * scale));
  const lineH = BASE_LINE_H * scale;

  overrideZones.forEach((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const px = panelAreaX + col * (colW + gap);
    const py = rowY[row];
    const pw = colW;
    const ph = rowH[row] - 10 * scale;
    const textColor = getContrastText(item.color);
    const bodyBg = tintColor(item.color, 0.93);
    const labelBg = tintColor(item.color, 0.72);

    c.fillStyle = bodyBg;
    c.fillRect(px, py, pw, ph);
    c.strokeStyle = item.color;
    c.lineWidth = 2;
    c.strokeRect(px, py, pw, ph);
    c.fillStyle = item.color;
    c.fillRect(px, py, pw, headerH);
    c.fillStyle = textColor;
    const pcHeaderText = `[${item.name}- ${item.seats}대]`;
    const pcHeaderFont = fitValueFontSize(c, pcHeaderText, pw - 16, headerFont, 11, true);
    c.font = `bold ${pcHeaderFont}px sans-serif`;
    c.fillText(pcHeaderText, px + 8, py + headerH * 0.68);

    // 줄 높이는 카드 자기 줄 수로 나누지 않고 패널 전체와 같은 고정값을 쓴다 — 그래서 같은 행
    // 안에서 줄이 적은 카드는 나머지 칸을 억지로 채우지 않고 그냥 아래쪽에 공백으로 남는다.
    item.lines.forEach((ln, li) => {
      const ly = py + headerH + li * lineH;
      c.font = `bold ${bodyFont}px sans-serif`;
      const labelW = c.measureText(ln.label).width;
      c.fillStyle = labelBg;
      c.fillRect(px + 4, ly + 4, labelW + 10, lineH - 8);
      c.fillStyle = "#2A2520";
      c.fillText(ln.label, px + 9, ly + lineH * 0.68);
      c.font = `${bodyFont}px sans-serif`;
      c.fillText(ln.value, px + 18 + labelW, ly + lineH * 0.68);
      if (li < item.lines.length - 1) {
        c.strokeStyle = "#E5DFD3";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(px + 4, ly + lineH);
        c.lineTo(px + pw - 4, ly + lineH);
        c.stroke();
      }
    });
  });

  const totalPc = computePcTotal(pcZones);
  c.fillStyle = "#2A2520";
  c.font = "bold 48px sans-serif";
  c.fillText(`${projectName || "매장명"}_PC ${totalPc}대(카운터,대체PC포함)`, panelAreaX, 1020);
}

// 발주 요약: 책상 발주 도면의 베젤 사이즈/책상 발주 합계 표 + PC 발주 도면의 장패드 수량 표를
// 도면 없이 표만 모아서 한 장으로 만든다 (책상/PC 도면 이미지에서 표를 빼낸 대신 별도 이미지로 제공).
export function renderOrderSummaryImage(
  c: CanvasRenderingContext2D,
  projectName: string,
  zones: DeskZone[],
  seatNumberRanges: SeatNumberRangeEntry[] = [],
  pcZones: PcZone[] = [],
  pcDefaults: PcSpecValues = {},
) {
  fillBackground(c);

  const marginX = 44;

  const bezelData = computeBezelTable(zones);
  const summaryData = computeDeskSummary(zones);
  const pcSetRows = computePcSetSummary(pcZones, pcDefaults);
  const pcOrderRows = [...computeChairSummary(zones), ...computePcOrderSummary(pcZones, pcDefaults)];
  const jangpadRows = computeJangpadTable(zones);
  const headsetTotals = computeHeadsetHookTotals(zones);
  const hasSeatNumbers = seatNumberRanges.length > 0;
  // 좌석번호는 기본적으로 책상 존 기준이지만, PC 발주 도면에서만 사양 차이로 존을 더 쪼갠
  // 경우(예: "FPS존A"/"FPS존B") 그 PC 전용 존도 함께 나열한다.
  const seatNumberZoneNames: string[] = [];
  const seenSeatNumberZoneNames = new Set<string>();
  [...zones, ...pcZones].forEach((z) => {
    if (!seenSeatNumberZoneNames.has(z.name)) {
      seenSeatNumberZoneNames.add(z.name);
      seatNumberZoneNames.push(z.name);
    }
  });
  const seatNumberRows = hasSeatNumbers
    ? seatNumberZoneNames
        .map((name) => {
          const entry = seatNumberRanges.find((r) => r.zoneName === name && r.ranges);
          if (!entry) return null;
          const seats = zones.find((z) => z.name === name)?.seats ?? pcZones.find((z) => z.name === name)?.seats ?? 0;
          return [name, entry.ranges, `${seats}석`];
        })
        .filter((row): row is [string, string, string] => Boolean(row))
    : [];

  const baseMainTitleH = 40;
  const baseTitleH = 30;
  const baseHeaderH = 32;
  const baseRowH = 26;
  const baseSectionGap = 30;
  const baseTitleFontPx = 26;

  const topOffset = 20;
  const bottomMargin = 20;

  // 존이 많으면(특히 좌석 번호 표까지 더해지면) 다섯 표를 다 그렸을 때 FHD 캔버스 높이(1080)를
  // 넘어서 아래쪽이 잘리는 문제가 있었다 — 그려보기 전에 필요한 전체 높이를 먼저 계산해서,
  // 넘칠 때만 표/여백/글자 크기를 비례해서 줄인다(computeCompactLayout과 같은 발상).
  const tableH = (rows: number, headerH: number, rowH: number) => headerH + Math.max(1, rows) * rowH;
  const sectionsCount = hasSeatNumbers ? 7 : 6;
  const bezelH0 = Math.max(
    tableH(bezelData.leftRows.length, baseHeaderH, baseRowH),
    tableH(bezelData.rightRows.length, baseHeaderH, baseRowH),
  );
  const summaryH0 = tableH(summaryData.length, baseHeaderH, baseRowH);
  const pcSetH0 = tableH(pcSetRows.length, baseHeaderH, baseRowH);
  const pcOrderHalf0 = Math.ceil(pcOrderRows.length / 2);
  const pcOrderH0 = Math.max(
    tableH(pcOrderHalf0, baseHeaderH, baseRowH),
    tableH(pcOrderRows.length - pcOrderHalf0, baseHeaderH, baseRowH),
  );
  const jangpadH0 = tableH(jangpadRows.length, baseHeaderH, baseRowH);
  const headsetH0 = tableH(2, baseHeaderH, baseRowH);
  const seatNumberH0 = hasSeatNumbers ? tableH(seatNumberRows.length, baseHeaderH, baseRowH) : 0;
  const tablesTotalH0 = bezelH0 + summaryH0 + pcSetH0 + pcOrderH0 + jangpadH0 + headsetH0 + seatNumberH0;
  const contentNeeded0 = tablesTotalH0 + baseTitleH * sectionsCount + baseSectionGap * (sectionsCount - 1);

  const headerAreaH = topOffset + 26 + (baseMainTitleH - 6);
  const available = COMPOSITE_H - headerAreaH - bottomMargin;
  const shrink = contentNeeded0 > available ? Math.max(0.55, available / contentNeeded0) : 1;

  const titleH = baseTitleH * shrink;
  const headerH = baseHeaderH * shrink;
  const rowH = baseRowH * shrink;
  const sectionGap = baseSectionGap * shrink;
  const titleFont = `bold ${Math.max(14, Math.round(baseTitleFontPx * shrink))}px sans-serif`;

  let y = topOffset + 26;

  c.fillStyle = "#2A2520";
  c.font = "bold 34px sans-serif";
  c.fillText(`${projectName || "매장명"} - 발주 요약`, marginX, y);
  y += baseMainTitleH - 6;

  function drawSectionTitle(text: string) {
    c.fillStyle = "#2A2520";
    c.font = titleFont;
    c.fillText(text, marginX, y + 22 * shrink);
    y += titleH;
  }

  // [ 베젤 사이즈 ]
  drawSectionTitle("[ 베젤 사이즈 ]");
  const gapMid = 24;
  const leftRows = bezelData.leftRows.map((r) => [`좌베젤 ${r.value}mm`, `${r.qty} EA`, "-"]);
  const rightRows = bezelData.rightRows.map((r) => [
    `우베젤 ${r.value}mm`,
    `${r.qty} EA`,
    r.ambiguous ? `${r.deskSize} 책상용` : "-",
  ]);
  const bezelTitles = ["TYPE", "수량", "비고"];
  const bezelColW = measureColWidths(c, bezelTitles, [...leftRows, ...rightRows]);
  const bezelCols: TableCol[] = bezelTitles.map((title, i) => ({ title, width: bezelColW[i] }));
  const bezelW = bezelColW.reduce((s, w) => s + w, 0);
  const bezelH = Math.max(
    drawTable(c, marginX, y, bezelW, headerH, rowH, bezelCols, leftRows, shrink),
    drawTable(c, marginX + bezelW + gapMid, y, bezelW, headerH, rowH, bezelCols, rightRows, shrink),
  );
  y += bezelH + sectionGap;

  // [ 책상 발주 합계 ]
  drawSectionTitle("[ 책상 발주 합계 ]");
  const summaryRows = summaryData.map((s) => [s.desk, s.deskSize, s.partition, `${s.qty} EA`, s.types]);
  const summaryTitles = ["책상종류", "책상사이즈", "칸막이", "수량", "존종류"];
  const summaryColW = measureColWidths(c, summaryTitles, summaryRows);
  const summaryCols: TableCol[] = summaryTitles.map((title, i) => ({ title, width: summaryColW[i] }));
  y +=
    drawTable(c, marginX, y, summaryColW.reduce((s, w) => s + w, 0), headerH, rowH, summaryCols, summaryRows, shrink) +
    sectionGap;

  // [ PC 구성 ] — CPU/RAM/VGA/M·B/POWER/CPU쿨러는 한 존 안에서 같이 업그레이드되면 한 세트로
  // 묶어서 발주해야 하므로(부품별로 따로 시키면 어느 존 조합인지 알 수 없다), 조합별로 수량을
  // 묶어서 보여준다. 좌석 배정분 외에 카운터 PC(1대)/대체 PC(1대)도 전역 기본 사양으로 더해서
  // computePcTotal(좌석 합계+2)과 총수량이 맞도록 한다. 나머지 부품은 현장에서 개별 설치하는
  // 주변기기라 아래 [ 주변기기 ]에 그대로 항목별로 나열한다.
  drawSectionTitle("[ PC 구성 (카운터PC+여분PC 포함) ]");
  const pcSetTableRows = pcSetRows.map((r) => [
    r.cpu,
    r.ram,
    r.gpu,
    r.mb,
    r.power,
    r.cpuCooler,
    `${r.qty} EA`,
  ]);
  const pcSetTitles = ["CPU", "RAM", "VGA", "M/B", "POWER", "CPU쿨러", "수량"];
  const pcSetColW = measureColWidths(c, pcSetTitles, pcSetTableRows);
  const pcSetCols: TableCol[] = pcSetTitles.map((title, i) => ({ title, width: pcSetColW[i] }));
  y +=
    drawTable(
      c,
      marginX,
      y,
      pcSetColW.reduce((s, w) => s + w, 0),
      headerH,
      rowH,
      pcSetCols,
      pcSetTableRows,
      shrink,
    ) + sectionGap;

  // [ 주변기기 ] — 의자(책상 존 기준) + 모니터암/키보드/마우스/헤드셋/스피커/모니터/CASE 등
  // (PC 존 기준, 카운터 PC 1대분 포함) 사양별 실제 주문 수량. 표가 길어질 수 있어 베젤 사이즈
  // 표처럼 좌/우 2단으로 나눠 그린다.
  drawSectionTitle("[ 주변기기 ]");
  const pcOrderTableRows = pcOrderRows.map((r) => [r.field, r.value, `${r.qty} EA`, r.note ?? "-"]);
  const pcOrderTitles = ["항목", "제품", "수량", "비고"];
  const pcOrderHalf = Math.ceil(pcOrderTableRows.length / 2);
  const pcOrderLeftRows = pcOrderTableRows.slice(0, pcOrderHalf);
  const pcOrderRightRows = pcOrderTableRows.slice(pcOrderHalf);
  const pcOrderColW = measureColWidths(c, pcOrderTitles, pcOrderTableRows);
  const pcOrderCols: TableCol[] = pcOrderTitles.map((title, i) => ({ title, width: pcOrderColW[i] }));
  const pcOrderW = pcOrderColW.reduce((s, w) => s + w, 0);
  y +=
    Math.max(
      drawTable(c, marginX, y, pcOrderW, headerH, rowH, pcOrderCols, pcOrderLeftRows, shrink),
      drawTable(c, marginX + pcOrderW + gapMid, y, pcOrderW, headerH, rowH, pcOrderCols, pcOrderRightRows, shrink),
    ) + sectionGap;

  // [ 장패드 수량 ]
  drawSectionTitle("[ 장패드 수량 ]");
  const jangpadTableRows = jangpadRows.map((r) => [r.name, `${r.total} EA`, `기준 ${r.qty} + 여분 2`]);
  const jangpadTitles = ["TYPE", "수량", "비고"];
  const jangpadColW = measureColWidths(c, jangpadTitles, jangpadTableRows);
  const jangpadCols: TableCol[] = jangpadTitles.map((title, i) => ({ title, width: jangpadColW[i] }));
  y +=
    drawTable(
      c,
      marginX,
      y,
      jangpadColW.reduce((s, w) => s + w, 0),
      headerH,
      rowH,
      jangpadCols,
      jangpadTableRows,
      shrink,
    ) + sectionGap;

  // [ 헤드셋걸이 개수 ] — 가방 선반 브라켓이 있는 좌석은 아이락스, 없는 좌석은 아이센스 헤드셋걸이.
  drawSectionTitle("[ 헤드셋걸이 개수 ]");
  const headsetTableRows = [
    ["아이락스 헤드셋걸이", `${headsetTotals.irock} EA`, "가방 선반 있는 좌석"],
    ["아이센스 헤드셋걸이", `${headsetTotals.isense} EA`, "가방 선반 없는 좌석"],
  ];
  const headsetTitles = ["TYPE", "수량", "비고"];
  const headsetColW = measureColWidths(c, headsetTitles, headsetTableRows);
  const headsetCols: TableCol[] = headsetTitles.map((title, i) => ({ title, width: headsetColW[i] }));
  y +=
    drawTable(
      c,
      marginX,
      y,
      headsetColW.reduce((s, w) => s + w, 0),
      headerH,
      rowH,
      headsetCols,
      headsetTableRows,
      shrink,
    ) + sectionGap;

  // [ 좌석 번호 ] — 좌석번호표 이미지에서 자동인식(또는 직접입력)한 존별 번호 범위. 없으면(아직
  // 좌석번호표를 안 올렸으면) 표 자체를 생략한다.
  if (hasSeatNumbers) {
    drawSectionTitle("[ 좌석 번호 ]");
    const seatNumberTitles = ["존명", "좌석번호", "좌석수"];
    const seatNumberColW = measureColWidths(c, seatNumberTitles, seatNumberRows);
    const seatNumberCols: TableCol[] = seatNumberTitles.map((title, i) => ({
      title,
      width: seatNumberColW[i],
    }));
    drawTable(
      c,
      marginX,
      y,
      seatNumberColW.reduce((s, w) => s + w, 0),
      headerH,
      rowH,
      seatNumberCols,
      seatNumberRows,
      shrink,
    );
  }
}
