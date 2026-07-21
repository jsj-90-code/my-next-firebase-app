// 아이센스 PC방 좌석배치도 작업 툴 - FHD 합성 이미지 렌더링
// 앱스크립트 v15 Index.html의 drawTable / drawFloorPlanCard / drawZoneOverlaysOnCard /
// renderDeskComposite / renderPcComposite 를 그대로 이식.

import {
  computeBasicPcQty,
  computeBezelTable,
  computeCompactLayout,
  computeDeskSummary,
  computeJangpadTable,
  computePcTotal,
  getContrastText,
  getZoneSizeEntries,
  tintColor,
} from "./calc";
import { COMPOSITE_H, COMPOSITE_W, PC_SPEC_FIELDS } from "./constants";
import type { DeskZone, PcSpecValues, PcZone } from "./types";

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
): number {
  const totalH = headerH + Math.max(1, rowsData.length) * rowH;

  c.fillStyle = "#8D7B68";
  c.fillRect(x, y, w, headerH);
  c.fillStyle = "#ffffff";
  c.font = "bold 13px sans-serif";
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
  c.font = "12.5px sans-serif";
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

export type FloorPlanGeo = { imgX: number; imgY: number; areaW: number; areaH: number };

export function drawFloorPlanCard(
  c: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cardY: number,
  cardH: number,
): FloorPlanGeo {
  const cardX = 950;
  const cardW = 955;
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

export function drawZoneOverlaysOnCard(
  c: CanvasRenderingContext2D,
  zones: (DeskZone | PcZone)[],
  geo: FloorPlanGeo,
) {
  zones.forEach((z) => {
    const zx = geo.imgX + z.x * geo.areaW;
    const zy = geo.imgY + z.y * geo.areaH;
    const zw = z.w * geo.areaW;
    const zh = z.h * geo.areaH;

    c.strokeStyle = z.color;
    c.lineWidth = 5;
    c.strokeRect(zx, zy, zw, zh);

    c.font = "bold 22px sans-serif";
    const textW = c.measureText(z.name).width;
    const tagW = textW + 18;
    const tagH = 28;
    const tagX = zx;
    const tagY = Math.max(0, zy - tagH - 4);
    c.fillStyle = z.color;
    c.fillRect(tagX, tagY, tagW, tagH);
    c.fillStyle = getContrastText(z.color);
    c.fillText(z.name, tagX + 9, tagY + 20);
  });
}

function fillBackground(c: CanvasRenderingContext2D) {
  c.fillStyle = "#FAF7F2";
  c.fillRect(0, 0, COMPOSITE_W, COMPOSITE_H);
}

export function renderDeskComposite(
  c: CanvasRenderingContext2D,
  img: HTMLImageElement,
  projectName: string,
  zones: DeskZone[],
) {
  fillBackground(c);

  const bezelData = computeBezelTable(zones);
  const summaryData = computeDeskSummary(zones);

  const bezelHeaderH = 26;
  const bezelRowH = 22;
  const bezelRowsMax = Math.max(bezelData.leftRows.length, bezelData.rightRows.length, 1);
  const bezelTableH = bezelHeaderH + bezelRowsMax * bezelRowH;

  const summaryHeaderH = 26;
  const summaryRowH = 22;
  const summaryRowsCount = Math.max(summaryData.length, 1);
  const summaryTableH = summaryHeaderH + summaryRowsCount * summaryRowH;

  const titleH = 26;
  const gapBetweenBlocks = 14;
  const cardBottomGap = 14;
  const cardY = 15;
  const bottomBlockH = titleH + bezelTableH + gapBetweenBlocks + titleH + summaryTableH;
  let cardH = 1060 - cardY - cardBottomGap - bottomBlockH;
  if (cardH < 260) cardH = 260;

  const geo = drawFloorPlanCard(c, img, cardY, cardH);
  drawZoneOverlaysOnCard(c, zones, geo);

  const bezelX = 950;
  const bezelW = 955;
  const bezelY = cardY + cardH + cardBottomGap;
  c.fillStyle = "#2A2520";
  c.font = "bold 20px sans-serif";
  c.fillText("[ 베젤 사이즈 ]", bezelX, bezelY + 20);

  const tableY = bezelY + 30;
  const gapMid = 10;
  const halfW = (bezelW - gapMid) / 2;
  const leftCols: TableCol[] = [
    { title: "TYPE", width: halfW * 0.36 },
    { title: "수량", width: halfW * 0.22 },
    { title: "비고", width: halfW * 0.42 },
  ];
  const leftRows = bezelData.leftRows.map((r) => [`좌베젤 ${r.value}mm`, `${r.qty} EA`, "-"]);
  const rightCols = leftCols;
  const rightRows = bezelData.rightRows.map((r) => [
    `우베젤 ${r.value}mm`,
    `${r.qty} EA`,
    r.ambiguous ? `${r.deskSize} 책상용` : "-",
  ]);
  drawTable(c, bezelX, tableY, halfW, bezelHeaderH, bezelRowH, leftCols, leftRows);
  drawTable(c, bezelX + halfW + gapMid, tableY, halfW, bezelHeaderH, bezelRowH, rightCols, rightRows);

  const summaryY = tableY + bezelTableH + gapBetweenBlocks;
  c.fillStyle = "#2A2520";
  c.font = "bold 20px sans-serif";
  c.fillText("[ 책상 발주 합계 ]", bezelX, summaryY + 20);
  const summaryTableY = summaryY + 30;
  const summaryCols: TableCol[] = [
    { title: "책상종류", width: bezelW * 0.16 },
    { title: "책상사이즈", width: bezelW * 0.14 },
    { title: "칸막이", width: bezelW * 0.2 },
    { title: "수량", width: bezelW * 0.12 },
    { title: "존종류", width: bezelW * 0.38 },
  ];
  const summaryRows = summaryData.map((s) => [s.desk, s.deskSize, s.partition, `${s.qty} EA`, s.types]);
  drawTable(c, bezelX, summaryTableY, bezelW, summaryHeaderH, summaryRowH, summaryCols, summaryRows);

  const panelAreaX = 20;
  const panelAreaY = 20;
  const panelAreaW = 900;
  const panelBottomLimit = 940;
  const gap = 14;
  const layout = computeCompactLayout(zones.length, panelBottomLimit - panelAreaY, 215, 44, 22, 17);
  const colW = (panelAreaW - (layout.cols - 1) * gap) / layout.cols;
  const specLabels = ["책상", "책상사이즈", "쿨러", "칸막이", "모니터암", "의자"];

  zones.forEach((z, idx) => {
    const col = idx % layout.cols;
    const row = Math.floor(idx / layout.cols);
    const px = panelAreaX + col * (colW + gap);
    const py = panelAreaY + row * layout.rowH;
    const pw = colW;
    const ph = layout.rowH - 10;
    const textColor = getContrastText(z.color);
    const bodyBg = tintColor(z.color, 0.93);
    const labelBg = tintColor(z.color, 0.72);

    c.fillStyle = bodyBg;
    c.fillRect(px, py, pw, ph);
    c.strokeStyle = z.color;
    c.lineWidth = 2;
    c.strokeRect(px, py, pw, ph);
    c.fillStyle = z.color;
    c.fillRect(px, py, pw, layout.headerH);
    c.fillStyle = textColor;
    c.font = `bold ${layout.headerFont}px sans-serif`;
    c.fillText(`[${z.name}- ${z.seats}석]`, px + 8, py + layout.headerH * 0.68);

    const sizeText = getZoneSizeEntries(z)
      .map((e) => `${e.deskSize} x${e.qty}`)
      .join(", ");
    const values = [z.desk || "", sizeText, z.cooler || "", z.partition || "", z.monitorArm || "", z.chair || ""];
    const lineH = (ph - layout.headerH) / specLabels.length;

    specLabels.forEach((label, li) => {
      const ly = py + layout.headerH + li * lineH;
      c.font = `bold ${layout.bodyFont}px sans-serif`;
      const labelW = c.measureText(label).width;
      c.fillStyle = labelBg;
      c.fillRect(px + 4, ly + 4, labelW + 10, lineH - 8);
      c.fillStyle = "#2A2520";
      c.fillText(label, px + 9, ly + lineH * 0.68);
      c.font = `${layout.bodyFont}px sans-serif`;
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
  c.font = "bold 46px sans-serif";
  c.fillText(`${projectName || "매장명"}_${totalSeats}석(카운터포함)`, panelAreaX, 1020);
}

export function renderPcComposite(
  c: CanvasRenderingContext2D,
  img: HTMLImageElement,
  projectName: string,
  deskZones: DeskZone[],
  pcZones: PcZone[],
  pcDefaults: PcSpecValues,
) {
  fillBackground(c);

  const jangpadRows = computeJangpadTable(deskZones);
  const jangpadHeaderH = 26;
  const jangpadRowH = 22;
  const jangpadTitleH = 26;
  const cardBottomGap = 14;
  const jangpadTableH = jangpadHeaderH + jangpadRows.length * jangpadRowH;
  const cardY = 15;
  let cardH = 1060 - cardY - cardBottomGap - jangpadTitleH - jangpadTableH;
  if (cardH < 260) cardH = 260;

  const geo = drawFloorPlanCard(c, img, cardY, cardH);
  drawZoneOverlaysOnCard(c, pcZones, geo);

  const jangpadY = cardY + cardH + cardBottomGap;
  c.fillStyle = "#2A2520";
  c.font = "bold 20px sans-serif";
  c.fillText("[ 장패드 수량 ]", 950, jangpadY + 20);
  const jangpadCols: TableCol[] = [
    { title: "TYPE", width: 955 * 0.4 },
    { title: "수량", width: 955 * 0.18 },
    { title: "비고", width: 955 * 0.42 },
  ];
  const jangpadTableRows = jangpadRows.map((r) => [r.name, `${r.total} EA`, `기준 ${r.qty} + 여분 2`]);
  drawTable(c, 950, jangpadY + 30, 955, jangpadHeaderH, jangpadRowH, jangpadCols, jangpadTableRows);

  const panelAreaX = 20;
  const panelAreaY = 20;
  const panelAreaW = 900;
  const basicQty = computeBasicPcQty(deskZones, pcZones);

  const DEFAULT_BOX_FIELDS = PC_SPEC_FIELDS.filter((f) => f.id !== "joypad");
  const defHeaderH = 30;
  const defLineH = 22;
  const defBoxH = defHeaderH + Math.ceil(DEFAULT_BOX_FIELDS.length / 2) * defLineH + 10;
  c.fillStyle = "#2A2520";
  c.fillRect(panelAreaX, panelAreaY, panelAreaW, defHeaderH);
  c.fillStyle = "#ffffff";
  c.font = "bold 17px sans-serif";
  c.fillText(
    `[ PC 기본사양 ] - ${basicQty}대 (카운터, 대체PC 포함)`,
    panelAreaX + 10,
    panelAreaY + defHeaderH * 0.7,
  );
  c.fillStyle = "#ffffff";
  c.fillRect(panelAreaX, panelAreaY + defHeaderH, panelAreaW, defBoxH - defHeaderH);
  c.strokeStyle = "#2A2520";
  c.lineWidth = 1.5;
  c.strokeRect(panelAreaX, panelAreaY, panelAreaW, defBoxH);
  c.font = "14px sans-serif";
  c.fillStyle = "#2A2520";
  const colW2 = panelAreaW / 2;
  DEFAULT_BOX_FIELDS.forEach((f, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const lx = panelAreaX + 12 + col * colW2;
    const ly = panelAreaY + defHeaderH + 8 + row * defLineH;
    c.font = "bold 14px sans-serif";
    c.fillText(f.label, lx, ly + 15);
    const labelW = c.measureText(f.label).width;
    c.font = "14px sans-serif";
    c.fillText(pcDefaults[f.id] || f.def, lx + labelW + 10, ly + 15);
  });

  const overrideZones = pcZones
    .map((z) => {
      const ov = z.pcOverrides || {};
      const lines = PC_SPEC_FIELDS.filter((f) => ov[f.id] != null).map((f) => ({
        label: f.label,
        value: ov[f.id] as string,
      }));
      return { zone: z, lines };
    })
    .filter((item) => item.lines.length > 0);

  const panelTop = panelAreaY + defBoxH + 16;
  const panelBottomLimit = 940;
  const maxLines = overrideZones.reduce((m, item) => Math.max(m, item.lines.length), 1);
  const idealHeaderH = 44;
  const LINE_H = 27;
  const idealRowH = idealHeaderH + maxLines * LINE_H + 10;
  const layout = computeCompactLayout(overrideZones.length, panelBottomLimit - panelTop, idealRowH, idealHeaderH, 22, 17);
  const lineShrink = layout.rowH / idealRowH;
  const colW = (panelAreaW - (layout.cols - 1) * 14) / layout.cols;

  overrideZones.forEach((item, idx) => {
    const z = item.zone;
    const col = idx % layout.cols;
    const row = Math.floor(idx / layout.cols);
    const px = panelAreaX + col * (colW + 14);
    const py = panelTop + row * layout.rowH;
    const pw = colW;
    const ph = layout.rowH - 10;
    const textColor = getContrastText(z.color);
    const bodyBg = tintColor(z.color, 0.93);
    const labelBg = tintColor(z.color, 0.72);

    c.fillStyle = bodyBg;
    c.fillRect(px, py, pw, ph);
    c.strokeStyle = z.color;
    c.lineWidth = 2;
    c.strokeRect(px, py, pw, ph);
    c.fillStyle = z.color;
    c.fillRect(px, py, pw, layout.headerH);
    c.fillStyle = textColor;
    c.font = `bold ${layout.headerFont}px sans-serif`;
    c.fillText(`[${z.name}- ${z.seats}대]`, px + 8, py + layout.headerH * 0.68);

    const lineH = LINE_H * lineShrink;
    item.lines.forEach((ln, li) => {
      const ly = py + layout.headerH + li * lineH;
      c.font = `bold ${layout.bodyFont}px sans-serif`;
      const labelW = c.measureText(ln.label).width;
      c.fillStyle = labelBg;
      c.fillRect(px + 4, ly + 4, labelW + 10, lineH - 8);
      c.fillStyle = "#2A2520";
      c.fillText(ln.label, px + 9, ly + lineH * 0.68);
      c.font = `${layout.bodyFont}px sans-serif`;
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

  const totalPc = computePcTotal(deskZones);
  c.fillStyle = "#2A2520";
  c.font = "bold 46px sans-serif";
  c.fillText(`${projectName || "매장명"}_PC ${totalPc}대(카운터,대체PC포함)`, panelAreaX, 1020);
}
