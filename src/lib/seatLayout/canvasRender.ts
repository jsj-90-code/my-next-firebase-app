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
  computePeripheralsExclusionNote,
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

// 표 칸 안 줄바꿈("\n") 한 줄이 늘 때마다 행이 이만큼(기준 크기) 높아진다 — 본문 15px의 1.2배.
const TABLE_EXTRA_LINE_H = 18;
const cellLineCount = (row: (string | number)[]) => Math.max(1, ...row.map((v) => String(v).split("\n").length));
/** 기준 크기(fontScale 1)에서 행 높이 — 여러 줄 칸이 있으면 그만큼 높다. */
export function tableRowBaseH(row: (string | number)[], baseRowH: number): number {
  return baseRowH + (cellLineCount(row) - 1) * TABLE_EXTRA_LINE_H;
}

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
  // 2026-10-06 — 칸 안에 "\n"이 있으면 여러 줄로 그리고 그 행만 높인다(발주요약의 긴 제품명).
  const lineGap = TABLE_EXTRA_LINE_H * fontScale;
  const rowHeights = (rowsData.length ? rowsData : [["-"]]).map((r) => rowH + (cellLineCount(r) - 1) * lineGap);
  const totalH = headerH + rowHeights.reduce((sum, h) => sum + h, 0);

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
  let ry = y + headerH;
  rows.forEach((rowVals, ri) => {
    if (ri > 0) ry += rowHeights[ri - 1];
    if (ri > 0) {
      c.strokeStyle = "#EDE7DA";
      c.beginPath();
      c.moveTo(x, ry);
      c.lineTo(x + w, ry);
      c.stroke();
    }
    let cx2 = x;
    rowVals.forEach((val, ci) => {
      String(val)
        .split("\n")
        .forEach((line, li) => c.fillText(line, cx2 + 6, ry + rowH * 0.66 + li * lineGap));
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
      for (const line of String(row[ci] ?? "").split("\n")) {
        const w = c.measureText(line).width;
        if (w > max) max = w;
      }
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

// 책상사이즈 칸의 여러 줄 배치. 여러 줄일 때 사이즈 줄은 촘촘하게(글자 높이의 1.15배) 붙이고,
// 나머지 5칸은 예전 비율(글자 = 칸 높이의 0.72)을 지킨다.
const SIZE_LINE_GAP = 1.15;
const SIZE_MAX_LINES = 4;

// ", "로 이어진 목록(예: "850mm x10, 910mm x6")을 maxWidth에 맞게 앞에서부터 채워 줄을 나눈다.
// maxLines에 닿으면 남은 항목은 마지막 줄에 붙인다(넘치는 줄은 fitValueFontSize가 줄여서 맞춘다).
function packListLines(c: CanvasRenderingContext2D, parts: string[], maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const part of parts) {
    const last = lines.length - 1;
    const joined = last >= 0 ? `${lines[last]}, ${part}` : part;
    if (last >= 0 && (c.measureText(joined).width <= maxWidth || lines.length >= maxLines)) {
      lines[last] = joined;
    } else {
      lines.push(part);
    }
  }
  return lines;
}

// 2026-10-06 — 책상사이즈가 2종류 이상이면 한 줄에 다 넣느라 글자가 아주 작아졌다(사용자 지적).
// 원래 글자의 85% 이상으로 한 줄에 들어가면 그대로 한 줄(줄을 나누면 다른 칸도 조금 작아지므로).
// 아니면 2줄, 3줄 순으로 해보는데, **그 줄 수일 때의 글자 크기로** 몇 개씩 들어가는지 판단한다
// — 원래 크기로 판단하면 2줄이면 될 것도 3줄로 나뉘어 카드 전체가 쓸데없이 작아진다.
function layoutSizeRow(
  c: CanvasRenderingContext2D,
  text: string,
  label: string,
  cardW: number,
  baseFont: number,
  bodyH: number,
): { lines: string[]; font: number } {
  const parts = text.split(", ");
  const maxWidthAt = (font: number) => {
    c.font = `bold ${font}px sans-serif`;
    const labelW = c.measureText(label).width;
    c.font = `${font}px sans-serif`;
    return cardW - 22 - labelW;
  };
  const maxW = maxWidthAt(baseFont);
  if (parts.length < 2 || c.measureText(text).width * 0.85 <= maxW) return { lines: [text], font: baseFont };

  // k줄 기준 글자 크기에서 실제로 몇 줄이 나오는지 보고 k줄 이하면 채택한다. 글자가 작아진 덕에
  // k보다 적은 줄로 들어가도 그 크기는 그대로 둔다 — 더 큰 크기는 앞 단계에서 이미 안 들어갔다.
  let font = baseFont;
  for (let k = 2; k <= SIZE_MAX_LINES; k++) {
    font = Math.max(10, Math.min(baseFont, Math.floor((bodyH - 8) / (5 / 0.72 + SIZE_LINE_GAP * k))));
    const lines = packListLines(c, parts, maxWidthAt(font), Infinity);
    if (lines.length <= k) return { lines, font };
  }
  // 상한 줄 수로도 안 들어가면 상한까지만 나누고, 넘치는 줄은 fitValueFontSize가 줄인다.
  return { lines: packListLines(c, parts, maxWidthAt(font), SIZE_MAX_LINES), font };
}

// 2026-10-06 — PC 사양 값(마우스·파워·키보드 제품명)이 칸보다 길면 줄을 바꾼다. 마우스처럼
// " & "로 이어진 조합은 그 자리에서 먼저 자르고("A &" / "B"), 아니면 띄어쓰기에서 자른다.
// 한 줄에 들어가면 그대로 한 줄. 그래도 넘치는 줄은 그리는 쪽에서 fitValueFontSize로 줄인다.
function wrapTextToWidth(
  c: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines = 3,
): string[] {
  c.font = `${fontSize}px sans-serif`;
  if (!text || c.measureText(text).width <= maxWidth) return [text];
  const fits = (lines: string[]) => lines.every((l) => c.measureText(l).width <= maxWidth);
  const pack = (tokens: string[]) => {
    const lines: string[] = [];
    for (const token of tokens) {
      const last = lines.length - 1;
      const joined = last >= 0 ? `${lines[last]} ${token}` : token;
      if (last >= 0 && (c.measureText(joined).width <= maxWidth || lines.length >= maxLines)) {
        lines[last] = joined;
      } else {
        lines.push(token);
      }
    }
    return lines;
  };
  if (text.includes(" & ")) {
    const byAmp = pack(text.split(" & ").map((part, i, arr) => (i < arr.length - 1 ? `${part} &` : part)));
    if (fits(byAmp)) return byAmp;
  }
  // " & " 조각 하나가 그래도 길면(예: "로지텍 G PRO X SUPERLIGHT 2 화이트 무선 &") 띄어쓰기에서 자른다.
  return pack(text.split(" "));
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

    // 책상사이즈가 한 줄에 안 들어가면 줄을 나누고 그 칸만 높인다(layoutSizeRow 참고).
    // 한 줄일 땐 예전과 똑같이 6칸을 균등하게 나눈다.
    const bodyH = ph - layout.headerH;
    const { lines: sizeLines, font: bodyFont } = layoutSizeRow(c, g.sizeText, specLabels[1], pw, layout.bodyFont, bodyH);
    const values: string[][] = [[g.desk], sizeLines, [g.cooler], [g.partition], [g.monitorArm], [g.chair]];
    const k = sizeLines.length;
    const sizeRowH = k > 1 ? k * SIZE_LINE_GAP * bodyFont + 8 : bodyH / specLabels.length;
    const otherRowH = k > 1 ? (bodyH - sizeRowH) / (specLabels.length - 1) : bodyH / specLabels.length;

    let ly = py + layout.headerH;
    specLabels.forEach((label, li) => {
      const lines = values[li];
      const rowH = li === 1 ? sizeRowH : otherRowH;
      const labelBaseline = lines.length > 1 ? ly + rowH / 2 + bodyFont * 0.35 : ly + rowH * 0.68;
      c.font = `bold ${bodyFont}px sans-serif`;
      const labelW = c.measureText(label).width;
      c.fillStyle = labelBg;
      c.fillRect(px + 4, ly + 4, labelW + 10, rowH - 8);
      c.fillStyle = "#2A2520";
      c.fillText(label, px + 9, labelBaseline);
      const valueMaxW = pw - 22 - labelW;
      const lineGap = SIZE_LINE_GAP * bodyFont;
      const blockTop = ly + (rowH - lineGap * lines.length) / 2;
      lines.forEach((text, i) => {
        const valueFont = fitValueFontSize(c, text, valueMaxW, bodyFont);
        c.font = `${valueFont}px sans-serif`;
        const baseline = lines.length > 1 ? blockTop + lineGap * i + bodyFont * 0.92 : labelBaseline;
        c.fillText(text, px + 18 + labelW, baseline);
      });
      if (li < specLabels.length - 1) {
        c.strokeStyle = "#E5DFD3";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(px + 4, ly + rowH);
        c.lineTo(px + pw - 4, ly + rowH);
        c.stroke();
      }
      ly += rowH;
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

  const DEFAULT_BOX_FIELDS = PC_SPEC_FIELDS.filter((f) => f.id !== "joypad" && f.id !== "case");
  const defHeaderH = 34;
  const defLineH = 25;
  const DEF_FONT = 16;
  // 패널 폭은 존 카드 열 수에 따라 900 이상으로만 늘어나므로, 줄 바꿈은 최소 폭(900) 기준으로 잡는다.
  const defColW = 900 / 2;
  // 마우스는 " & "로 이어붙인 조합이라 부품 하나씩 정규화한 뒤 다시 이어붙여야 하고, 나머지는
  // 통짜 문자열을 그대로 정규화한다 — 저장된 값이 옛 문구여도 항상 최신 이름으로 보여준다.
  // 2026-10-06 — 긴 값(마우스)은 글자를 줄이는 대신 줄을 바꾸고, 그 행만 높인다.
  const defEntries = DEFAULT_BOX_FIELDS.map((f) => {
    const rawDefault = pcDefaults[f.id] || f.def;
    const value =
      f.id === "mouse" ? splitMouseValue(rawDefault).join(" & ") : normalizeFieldValue(f.id, rawDefault);
    c.font = `bold ${DEF_FONT}px sans-serif`;
    const labelW = c.measureText(f.label).width;
    const segs = wrapTextToWidth(c, value, defColW - (12 + labelW + 10) - 8, DEF_FONT, 2);
    return { label: f.label, labelW, segs };
  });
  const DEF_EXTRA_LINE_H = 20;
  const defRowH: number[] = [];
  for (let i = 0; i < defEntries.length; i += 2) {
    const k = Math.max(defEntries[i].segs.length, defEntries[i + 1]?.segs.length ?? 1);
    defRowH.push(defLineH + (k - 1) * DEF_EXTRA_LINE_H);
  }
  const defBoxH = defHeaderH + defRowH.reduce((s, h) => s + h, 0) + 10;
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

  // 2026-10-06 — 긴 값(마우스·파워 제품명)이 카드 밖으로 삐져나가고, 그 한 줄 때문에 모든 카드
  // 글자가 최소(60%)로 쪼그라들었다(아래 공간은 텅 비어 있는데도). 이제 긴 값은 칸 폭에서 줄을
  // 바꾸고 그 항목만 줄 수만큼 높인다 — 글자 크기는 세로 공간으로 정해지고, 긴 줄 하나가 끌어내리지 않는다.
  type WrappedLine = { label: string; segs: string[] };
  // scale 배율일 때의 실제 글자 크기로 줄을 바꾼다(그리는 쪽과 같은 반올림·같은 여백).
  function wrapItemsFor(colW: number, scale: number): WrappedLine[][] {
    const font = Math.max(10, Math.round(BASE_BODY_FONT * scale));
    return overrideZones.map((item) =>
      item.lines.map((ln) => {
        c.font = `bold ${font}px sans-serif`;
        const labelW = c.measureText(ln.label).width;
        return { label: ln.label, segs: wrapTextToWidth(c, ln.value, colW - 24 - labelW, font, 5) };
      }),
    );
  }
  function allSegsFit(wrapped: WrappedLine[][], colW: number, scale: number): boolean {
    const font = Math.max(10, Math.round(BASE_BODY_FONT * scale));
    return wrapped.every((lines) =>
      lines.every((ln) => {
        c.font = `bold ${font}px sans-serif`;
        const maxW = colW - 24 - c.measureText(ln.label).width;
        c.font = `${font}px sans-serif`;
        return ln.segs.every((seg) => c.measureText(seg).width <= maxW);
      }),
    );
  }
  const unitCount = (lines: WrappedLine[]) => lines.reduce((s, l) => s + l.segs.length, 0);

  function rowHeightsFor(cols: number, wrapped: WrappedLine[][]): number[] {
    const rows = Math.max(1, Math.ceil(overrideZones.length / cols));
    const heights: number[] = [];
    for (let r = 0; r < rows; r++) {
      let maxLinesInRow = 1;
      for (let col = 0; col < cols; col++) {
        const item = wrapped[r * cols + col];
        if (item) maxLinesInRow = Math.max(maxLinesInRow, unitCount(item));
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
  let best: { cols: number; panelAreaW: number; colW: number; scale: number; wrapped: WrappedLine[][] } | null =
    null;

  for (let cols = 3; cols <= 6; cols++) {
    const panelAreaW = panelAreaWForCols(cols);
    const colW = (panelAreaW - (cols - 1) * gap) / cols;
    if (colW < MIN_COL_W && cols > 3) break;

    // 2026-10-06 — 글자 크기를 큰 것부터(배율 1.0 = 본문 20px, 책상발주도면과 비슷한 크기) 내려가며,
    // 그 크기로 줄을 바꿨을 때 칸 폭과 세로 공간에 다 들어가는 첫 크기를 고른다. 예전엔 긴 값
    // 한 줄이 배율을 끌어내려 모든 카드가 최소(0.6)로 쪼그라들었다. 상한도 1.8 → 1.0으로 낮췄다
    // (존이 적을 때 36px까지 커지던 것 — 사용자: "책상발주도면 폰트 정도가 좋다").
    const availH = panelBottomLimitForCols(cols) - panelTop;
    let scale = 0.6;
    let wrapped = wrapItemsFor(colW, scale);
    for (let s = 1.0; s >= 0.6 - 1e-9; s -= 0.05) {
      const w = wrapItemsFor(colW, s);
      const totalNeededH = rowHeightsFor(cols, w).reduce((sum, h) => sum + h, 0) * s;
      if (totalNeededH <= availH && allSegsFit(w, colW, s)) {
        scale = s;
        wrapped = w;
        break;
      }
    }
    if (!best || scale > best.scale + 0.02) {
      best = { cols, panelAreaW, colW, scale, wrapped };
    }
    if (cols === 6 || colW < MIN_COL_W) break;
  }

  // overrideZones가 비어 있으면(전 존이 기본사양) 위 루프에서 best가 안 잡힐 수 있으니 안전망.
  const fallbackColW = (basePanelAreaW - 2 * gap) / 3;
  const chosen = best ?? {
    cols: 3,
    panelAreaW: basePanelAreaW,
    colW: fallbackColW,
    scale: 1,
    wrapped: wrapItemsFor(fallbackColW, 1),
  };
  const { cols, panelAreaW, colW, scale, wrapped } = chosen;
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
  c.fillStyle = "#2A2520";
  const colW2 = panelAreaW / 2;
  let defRowTop = panelAreaY + defHeaderH + 8;
  defEntries.forEach((e, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    if (i > 0 && col === 0) defRowTop += defRowH[row - 1];
    const lx = panelAreaX + 12 + col * colW2;
    c.font = `bold ${DEF_FONT}px sans-serif`;
    c.fillText(e.label, lx, defRowTop + 16);
    // 줄을 바꿔도 남는 긴 단어만 안전망으로 줄인다(예전엔 이걸로 마우스가 10px까지 작아졌다).
    const valueMaxW = colW2 - (12 + e.labelW + 10) - 8;
    e.segs.forEach((seg, si) => {
      const valueFont = fitValueFontSize(c, seg, valueMaxW, DEF_FONT, 12);
      c.font = `${valueFont}px sans-serif`;
      c.fillText(seg, lx + e.labelW + 10, defRowTop + 16 + si * DEF_EXTRA_LINE_H);
    });
  });

  const rowH = rowHeightsFor(cols, wrapped).map((h) => h * scale);
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
    // 여러 줄로 나뉜 항목은 그 줄 수만큼 칸을 높이고, 항목 이름은 칸 세로 가운데에 둔다.
    const lines = wrapped[idx];
    let ly = py + headerH;
    lines.forEach((ln, li) => {
      const k = ln.segs.length;
      const itemH = lineH * k;
      c.font = `bold ${bodyFont}px sans-serif`;
      const labelW = c.measureText(ln.label).width;
      c.fillStyle = labelBg;
      c.fillRect(px + 4, ly + 4, labelW + 10, itemH - 8);
      c.fillStyle = "#2A2520";
      c.fillText(ln.label, px + 9, ly + itemH / 2 + lineH * 0.18);
      const valueMaxW = pw - 24 - labelW;
      ln.segs.forEach((seg, si) => {
        // 안전망 — 끊을 자리가 없는 긴 단어만 여기서 줄어든다.
        const valueFont = fitValueFontSize(c, seg, valueMaxW, bodyFont);
        c.font = `${valueFont}px sans-serif`;
        c.fillText(seg, px + 18 + labelW, ly + lineH * si + lineH * 0.68);
      });
      if (li < lines.length - 1) {
        c.strokeStyle = "#E5DFD3";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(px + 4, ly + itemH);
        c.lineTo(px + pw - 4, ly + itemH);
        c.stroke();
      }
      ly += itemH;
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

  // 2026-10-06 — 표 7개를 세로 한 줄로만 쌓아서, 존이 많으면 글자가 최대 55%(약 8px)까지 줄었다
  // — 화면 오른쪽 절반은 비어 있는데도. 이제 표를 2~3단으로 나눠 빈 가로 공간을 쓰고, 글자는
  // 큰 크기(본문 24px, 배율 1.6 — 아래 plan 참고)부터 시작해 다 들어가는 가장 큰 크기를 고른다
  // (사용자: "발주요약 글자가 너무 작다, 책상도면 폰트 정도로").
  type SummaryTable = { titles: string[]; rows: (string | number)[][] };
  type SummarySection = { title: string; note?: string; tables: SummaryTable[] };

  const leftRows = bezelData.leftRows.map((r) => [`좌베젤 ${r.value}mm`, `${r.qty} EA`, "-"]);
  const rightRows = bezelData.rightRows.map((r) => [
    `우베젤 ${r.value}mm`,
    `${r.qty} EA`,
    r.ambiguous ? `${r.deskSize} 책상용` : "-",
  ]);
  const summaryRows = summaryData.map((s) => [s.desk, s.deskSize, s.partition, `${s.qty} EA`, s.types]);
  // [ PC 구성 ] — CPU/RAM/VGA/M·B/POWER/CPU쿨러는 한 존 안에서 같이 업그레이드되면 한 세트로
  // 묶어서 발주해야 하므로(부품별로 따로 시키면 어느 존 조합인지 알 수 없다), 조합별로 수량을
  // 묶어서 보여준다. 좌석 배정분 외에 카운터 PC(1대)/대체 PC(1대)도 전역 기본 사양으로 더해서
  // computePcTotal(좌석 합계+2)과 총수량이 맞도록 한다. 나머지 부품은 현장에서 개별 설치하는
  // 주변기기라 아래 [ 주변기기 ]에 그대로 항목별로 나열한다.
  const pcSetTableRows = pcSetRows.map((r) => [r.cpu, r.ram, r.gpu, r.mb, r.power, r.cpuCooler, `${r.qty} EA`]);
  // [ 주변기기 ] — 의자(책상 존 기준) + 모니터암/키보드/마우스/헤드셋/스피커/모니터/CASE 등
  // (PC 존 기준, 카운터 PC 1대분 포함) 사양별 실제 주문 수량.
  const pcOrderTableRows = pcOrderRows.map((r) => [r.field, r.value, `${r.qty} EA`, r.note ?? "-"]);
  const pcOrderHalf = Math.ceil(pcOrderTableRows.length / 2);
  const jangpadTableRows = jangpadRows.map((r) => [r.name, `${r.total} EA`, `기준 ${r.qty} + 여분 2`]);
  // 가방 선반 브라켓이 있는 좌석은 아이락스, 없는 좌석은 아이센스 헤드셋걸이.
  const headsetTableRows = [
    ["아이락스 헤드셋걸이", `${headsetTotals.irock} EA`, "가방 선반 있는 좌석"],
    ["아이센스 헤드셋걸이", `${headsetTotals.isense} EA`, "가방 선반 없는 좌석"],
  ];
  const typeQtyNote = ["TYPE", "수량", "비고"];
  const pcOrderTitles = ["항목", "제품", "수량", "비고"];

  // 주변기기 표는 좌/우 2단으로 나눌지 한 표로 둘지 둘 다 해보고 글자가 더 커지는 쪽을 쓴다
  // (단으로 배치하면 한 표로 길게 두는 게 나을 때가 있다).
  // 긴 칸(PC 구성의 부품명, 주변기기의 제품명)을 두 줄로 나눈 버전 — 표 폭이 줄어 옆 단에 자리가
  // 생긴다. "PC 구성" 표 하나가 가로를 다 먹어 글자가 17px에서 더 못 커지던 것(2026-10-06).
  const wrapCells = (rows: (string | number)[][], colIdx: number[], maxW: number) =>
    rows.map((row) =>
      row.map((v, ci) => (colIdx.includes(ci) ? wrapTextToWidth(c, String(v), maxW, 15, 2).join("\n") : v)),
    );
  // PC 구성은 조합이 1~3가지인 매장이 대부분이라, 가로·세로를 뒤집은 모양(행: 부품, 열: 구성)도
  // 후보로 둔다 — 7칸짜리 넓은 표 대신 좁고 긴 표가 되어 단 배치가 쉬워진다.
  const PC_SET_TITLES = ["CPU", "RAM", "VGA", "M/B", "POWER", "CPU쿨러", "수량"];
  const pcSetTransposed: SummaryTable = {
    titles: ["항목", ...pcSetTableRows.map((_, i) => `구성${i + 1}`)],
    rows: PC_SET_TITLES.map((label, fi) => [label, ...pcSetTableRows.map((r) => r[fi])]),
  };
  const buildSections = (splitPeripherals: boolean, wrapLong: boolean, transposePc: boolean): SummarySection[] => {
    const pcSetTable: SummaryTable = transposePc
      ? {
          titles: pcSetTransposed.titles,
          rows: wrapLong
            ? wrapCells(pcSetTransposed.rows, pcSetTransposed.titles.map((_, i) => i).slice(1), 200)
            : pcSetTransposed.rows,
        }
      : { titles: PC_SET_TITLES, rows: wrapLong ? wrapCells(pcSetTableRows, [0, 1, 2, 3, 4, 5], 170) : pcSetTableRows };
    const pcOrder = wrapLong ? wrapCells(pcOrderTableRows, [1], 200) : pcOrderTableRows;
    return [
    { title: "[ 베젤 사이즈 ]", tables: [{ titles: typeQtyNote, rows: leftRows }, { titles: typeQtyNote, rows: rightRows }] },
    { title: "[ 책상 발주 합계 ]", tables: [{ titles: ["책상종류", "책상사이즈", "칸막이", "수량", "존종류"], rows: summaryRows }] },
    {
      title: "[ PC 구성 (카운터PC+여분PC 포함) ]",
      tables: [pcSetTable],
    },
    {
      title: "[ 주변기기 ]",
      note: computePeripheralsExclusionNote(),
      tables: splitPeripherals
        ? [
            { titles: pcOrderTitles, rows: pcOrder.slice(0, pcOrderHalf) },
            { titles: pcOrderTitles, rows: pcOrder.slice(pcOrderHalf) },
          ]
        : [{ titles: pcOrderTitles, rows: pcOrder }],
    },
    { title: "[ 장패드 수량 ]", tables: [{ titles: typeQtyNote, rows: jangpadTableRows }] },
    { title: "[ 헤드셋걸이 개수 ]", tables: [{ titles: typeQtyNote, rows: headsetTableRows }] },
    // 좌석번호표 이미지에서 자동인식(또는 직접입력)한 존별 번호 범위. 없으면 표 자체를 생략한다.
    ...(hasSeatNumbers ? [{ title: "[ 좌석 번호 ]", tables: [{ titles: ["존명", "좌석번호", "좌석수"], rows: seatNumberRows }] }] : []),
    ];
  };

  const BASE_TITLE_H = 34;
  const BASE_HEADER_H = 32;
  const BASE_ROW_H = 26;
  const BASE_SECTION_GAP = 26;
  const TABLE_GAP = 24; // 한 섹션 안에서 나란히 놓는 표 사이
  const COLUMN_GAP = 48; // 단 사이
  const titleFontPx = (s: number) => Math.min(28, Math.round(24 * s));

  const mainTitleY = 46;
  const contentTop = mainTitleY + 24;
  const availH = COMPOSITE_H - contentTop - 20;
  const availW = COMPOSITE_W - marginX * 2;

  // 칸 너비는 기준 크기(본문 15px)로 재서 배율만큼 늘린다 — 글자 폭은 크기에 비례한다.
  const baseColWidths = new Map<SummaryTable, number[]>();
  const colWidthsOf = (t: SummaryTable) => {
    let w = baseColWidths.get(t);
    if (!w) {
      w = measureColWidths(c, t.titles, t.rows);
      baseColWidths.set(t, w);
    }
    return w;
  };
  const tableBaseH = (t: SummaryTable) =>
    BASE_HEADER_H + (t.rows.length ? t.rows.reduce((sum, r) => sum + tableRowBaseH(r, BASE_ROW_H), 0) : BASE_ROW_H);
  const sectionSize = (sec: SummarySection, s: number) => {
    const tablesW = sec.tables.reduce((sum, t) => sum + colWidthsOf(t).reduce((a2, b2) => a2 + b2, 0) * s, 0) +
      TABLE_GAP * s * (sec.tables.length - 1);
    c.font = `bold ${titleFontPx(s)}px sans-serif`;
    let titleW = c.measureText(sec.title).width;
    if (sec.note) {
      c.font = `${Math.round(15 * s)}px sans-serif`;
      titleW += 12 * s + c.measureText(sec.note).width;
    }
    return {
      w: Math.max(tablesW, titleW),
      h: BASE_TITLE_H * s + Math.max(...sec.tables.map(tableBaseH)) * s,
    };
  };
  // 섹션을 최대 MAX_COLUMNS단에 나눠 담는 모든 경우를 훑어 다 들어가는 배치를 찾는다(단 안에서는
  // 원래 순서 유지). 순서대로만 채우면 아주 넓은 표(PC 구성) 옆에 좁은 표가 남아 가로 폭을
  // 낭비했다 — 넓은 표끼리·좁은 표끼리 묶여야 글자가 커진다. 섹션이 7개라 4단이어도 수천 가지뿐이다.
  const MAX_COLUMNS = 4;
  const layoutAt = (sections: SummarySection[], s: number) => {
    const sizes = sections.map((sec) => sectionSize(sec, s));
    if (sizes.some((sz) => sz.h > availH)) return null;
    const assign: number[] = [];
    const colH: number[] = [];
    const colW: number[] = [];
    const totalW = () => colW.reduce((sum, w) => sum + w, 0) + COLUMN_GAP * (colW.length - 1);
    const dfs = (i: number): boolean => {
      if (i === sections.length) return true;
      // 새 단은 다음 번호로만 연다 — 단 순서만 다른 같은 배치를 두 번 보지 않는다.
      const maxCol = Math.min(colH.length, MAX_COLUMNS - 1);
      for (let k = 0; k <= maxCol; k++) {
        const isNew = k === colH.length;
        const prevH = isNew ? 0 : colH[k];
        const prevW = isNew ? 0 : colW[k];
        const newH = prevH + (isNew ? 0 : BASE_SECTION_GAP * s) + sizes[i].h;
        if (newH > availH) continue;
        if (isNew) {
          colH.push(newH);
          colW.push(sizes[i].w);
        } else {
          colH[k] = newH;
          colW[k] = Math.max(prevW, sizes[i].w);
        }
        assign[i] = k;
        if (totalW() <= availW && dfs(i + 1)) return true;
        if (isNew) {
          colH.pop();
          colW.pop();
        } else {
          colH[k] = prevH;
          colW[k] = prevW;
        }
      }
      return false;
    };
    if (!dfs(0)) return null;
    return colW.map((w, k) => ({ w, sections: sections.filter((_, i) => assign[i] === k) }));
  };

  // 상한 배율 1.6 = 본문 24px. 2026-10-06 1.3(19.5px)에서 올렸다(사용자: "발주요약 폰트 더 키웠으면").
  const variants: SummarySection[][] = [];
  for (const transposePc of pcSetTableRows.length <= 3 ? [false, true] : [false]) {
    for (const wrapLong of [false, true]) {
      for (const split of [true, false]) variants.push(buildSections(split, wrapLong, transposePc));
    }
  }
  let plan: { s: number; columns: { sections: SummarySection[]; w: number }[] } | null = null;
  for (let s = 1.6; s >= 0.5 - 1e-9 && !plan; s -= 0.05) {
    for (const sections of variants) {
      const columns = layoutAt(sections, s);
      if (columns) {
        plan = { s, columns };
        break;
      }
    }
  }
  // 그래도 안 들어가면(극단적으로 큰 매장) 최소 배율로 그냥 그린다 — 예전처럼 아래가 잘릴 수 있다.
  const s = plan?.s ?? 0.5;
  const columns = plan?.columns ?? [{ sections: buildSections(true, true, false), w: availW }];

  c.fillStyle = "#2A2520";
  c.font = "bold 34px sans-serif";
  c.fillText(`${projectName || "매장명"} - 발주 요약`, marginX, mainTitleY);

  let x = marginX;
  for (const col of columns) {
    let y = contentTop;
    col.sections.forEach((sec, si) => {
      if (si > 0) y += BASE_SECTION_GAP * s;
      c.fillStyle = "#2A2520";
      c.font = `bold ${titleFontPx(s)}px sans-serif`;
      c.fillText(sec.title, x, y + 24 * s);
      if (sec.note) {
        const titleW = c.measureText(sec.title).width;
        // 항상 밝은 배경에 인쇄되는 산출물이라 테마 토큰을 못 쓴다. 값은 --sl-ink-soft의
        // 밝은 모드 값과 맞춰둔다(옛 #8a8072는 흰 배경 대비 3.8:1로 본문 기준에 못 미쳤다).
        c.fillStyle = "#6b6459";
        c.font = `${Math.round(15 * s)}px sans-serif`;
        c.fillText(sec.note, x + titleW + 12 * s, y + 24 * s);
      }
      y += BASE_TITLE_H * s;
      let tx = x;
      let maxH = 0;
      sec.tables.forEach((t) => {
        const widths = colWidthsOf(t).map((w) => w * s);
        const tableW = widths.reduce((a2, b2) => a2 + b2, 0);
        const cols: TableCol[] = t.titles.map((title, i) => ({ title, width: widths[i] }));
        maxH = Math.max(maxH, drawTable(c, tx, y, tableW, BASE_HEADER_H * s, BASE_ROW_H * s, cols, t.rows, s));
        tx += tableW + TABLE_GAP * s;
      });
      y += maxH;
    });
    x += col.w + COLUMN_GAP;
  }
}
