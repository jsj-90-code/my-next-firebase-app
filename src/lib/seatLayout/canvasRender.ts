// 아이센스 PC방 좌석배치도 작업 툴 - FHD 합성 이미지 렌더링
// 앱스크립트 v15 Index.html의 drawTable / drawFloorPlanCard / drawZoneOverlaysOnCard /
// renderDeskComposite / renderPcComposite 를 그대로 이식.

import {
  computeBasicPcQty,
  computeBezelTable,
  computeCompactLayout,
  computeDeskSummary,
  computeHeadsetHookTotals,
  computeJangpadTable,
  computePcTotal,
  getContrastText,
  getZoneSizeEntries,
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
): number {
  const totalH = headerH + Math.max(1, rowsData.length) * rowH;

  c.fillStyle = "#8D7B68";
  c.fillRect(x, y, w, headerH);
  c.fillStyle = "#ffffff";
  c.font = "bold 16px sans-serif";
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
  c.font = "15px sans-serif";
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

    c.font = "bold 24px sans-serif";
    const textW = c.measureText(z.name).width;
    const tagW = textW + 18;
    const tagH = 30;
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

  const geo = drawFloorPlanCard(c, img, cardY, cardH);
  drawZoneOverlaysOnCard(c, zones, geo);

  const panelAreaX = 20;
  const panelAreaY = 20;
  const panelAreaW = 900;
  const panelBottomLimit = 940;
  const gap = 14;
  const layout = computeCompactLayout(zones.length, panelBottomLimit - panelAreaY, 225, 48, 25, 19);
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
  c.font = "bold 48px sans-serif";
  c.fillText(`${projectName || "매장명"}_${totalSeats}석(카운터포함)`, panelAreaX, 1020);
}

// PC 발주 도면: 장패드 수량 표는 renderOrderSummaryImage로 분리되었으므로,
// 그만큼 비는 공간을 도면 카드 높이를 늘려서 채운다.
export function renderPcFloorplanImage(
  c: CanvasRenderingContext2D,
  img: HTMLImageElement,
  projectName: string,
  deskZones: DeskZone[],
  pcZones: PcZone[],
  pcDefaults: PcSpecValues,
) {
  fillBackground(c);

  const cardBottomGap = 14;
  const cardY = 15;
  const cardH = 1060 - cardY - cardBottomGap;

  const geo = drawFloorPlanCard(c, img, cardY, cardH);
  drawZoneOverlaysOnCard(c, pcZones, geo);

  const panelAreaX = 20;
  const panelAreaY = 20;
  const panelAreaW = 900;
  const basicQty = computeBasicPcQty(deskZones, pcZones);

  const DEFAULT_BOX_FIELDS = PC_SPEC_FIELDS.filter((f) => f.id !== "joypad");
  const defHeaderH = 34;
  const defLineH = 25;
  const defBoxH = defHeaderH + Math.ceil(DEFAULT_BOX_FIELDS.length / 2) * defLineH + 10;
  c.fillStyle = "#2A2520";
  c.fillRect(panelAreaX, panelAreaY, panelAreaW, defHeaderH);
  c.fillStyle = "#ffffff";
  c.font = "bold 19px sans-serif";
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
    c.font = "16px sans-serif";
    c.fillText(pcDefaults[f.id] || f.def, lx + labelW + 10, ly + 16);
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
  const idealHeaderH = 48;
  const LINE_H = 29;
  const idealRowH = idealHeaderH + maxLines * LINE_H + 10;
  const layout = computeCompactLayout(overrideZones.length, panelBottomLimit - panelTop, idealRowH, idealHeaderH, 25, 19);
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
) {
  fillBackground(c);

  const marginX = 44;

  const bezelData = computeBezelTable(zones);
  const summaryData = computeDeskSummary(zones);
  const jangpadRows = computeJangpadTable(zones);

  const mainTitleH = 40;
  const titleFont = "bold 26px sans-serif";
  const titleH = 30;
  const headerH = 32;
  const rowH = 26;
  const sectionGap = 30;

  const topOffset = 20;

  let y = topOffset + 26;

  c.fillStyle = "#2A2520";
  c.font = "bold 34px sans-serif";
  c.fillText(`${projectName || "매장명"} - 발주 요약`, marginX, y);
  y += mainTitleH - 6;

  function drawSectionTitle(text: string) {
    c.fillStyle = "#2A2520";
    c.font = titleFont;
    c.fillText(text, marginX, y + 22);
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
    drawTable(c, marginX, y, bezelW, headerH, rowH, bezelCols, leftRows),
    drawTable(c, marginX + bezelW + gapMid, y, bezelW, headerH, rowH, bezelCols, rightRows),
  );
  y += bezelH + sectionGap;

  // [ 책상 발주 합계 ]
  drawSectionTitle("[ 책상 발주 합계 ]");
  const summaryRows = summaryData.map((s) => [s.desk, s.deskSize, s.partition, `${s.qty} EA`, s.types]);
  const summaryTitles = ["책상종류", "책상사이즈", "칸막이", "수량", "존종류"];
  const summaryColW = measureColWidths(c, summaryTitles, summaryRows);
  const summaryCols: TableCol[] = summaryTitles.map((title, i) => ({ title, width: summaryColW[i] }));
  y += drawTable(c, marginX, y, summaryColW.reduce((s, w) => s + w, 0), headerH, rowH, summaryCols, summaryRows) + sectionGap;

  // [ 장패드 수량 ]
  drawSectionTitle("[ 장패드 수량 ]");
  const jangpadTableRows = jangpadRows.map((r) => [r.name, `${r.total} EA`, `기준 ${r.qty} + 여분 2`]);
  const jangpadTitles = ["TYPE", "수량", "비고"];
  const jangpadColW = measureColWidths(c, jangpadTitles, jangpadTableRows);
  const jangpadCols: TableCol[] = jangpadTitles.map((title, i) => ({ title, width: jangpadColW[i] }));
  y +=
    drawTable(c, marginX, y, jangpadColW.reduce((s, w) => s + w, 0), headerH, rowH, jangpadCols, jangpadTableRows) +
    sectionGap;

  // [ 헤드셋걸이 개수 ] — 가방 선반 브라켓이 있는 좌석은 아이락스, 없는 좌석은 아이센스 헤드셋걸이.
  drawSectionTitle("[ 헤드셋걸이 개수 ]");
  const headsetTotals = computeHeadsetHookTotals(zones);
  const headsetTableRows = [
    ["아이락스 헤드셋걸이", `${headsetTotals.irock} EA`, "가방 선반 있는 좌석"],
    ["아이센스 헤드셋걸이", `${headsetTotals.isense} EA`, "가방 선반 없는 좌석"],
  ];
  const headsetTitles = ["TYPE", "수량", "비고"];
  const headsetColW = measureColWidths(c, headsetTitles, headsetTableRows);
  const headsetCols: TableCol[] = headsetTitles.map((title, i) => ({ title, width: headsetColW[i] }));
  y +=
    drawTable(c, marginX, y, headsetColW.reduce((s, w) => s + w, 0), headerH, rowH, headsetCols, headsetTableRows) +
    sectionGap;

  // [ 좌석 번호 ] — 좌석번호표 이미지에서 자동인식(또는 직접입력)한 존별 번호 범위. 없으면(아직
  // 좌석번호표를 안 올렸으면) 표 자체를 생략한다.
  if (seatNumberRanges.length) {
    drawSectionTitle("[ 좌석 번호 ]");
    const seatNumberRows = zones
      .map((z) => seatNumberRanges.find((r) => r.zoneName === z.name && r.ranges) && z)
      .filter((z): z is DeskZone => Boolean(z))
      .map((z) => {
        const entry = seatNumberRanges.find((r) => r.zoneName === z.name)!;
        return [z.name, entry.ranges, `${z.seats}석`];
      });
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
    );
  }
}
