// 아이센스 PC방 좌석배치도 작업 툴 - 계산 로직
// 앱스크립트 v15 Index.html의 계산 함수들을 순수 함수로 이식.

import { BEZEL_MAP, getZoneTypeLabel } from "./constants";
import type { DeskZone, DeskSize, PcZone, SizeBreakdownEntry } from "./types";

export function getZoneSizeEntries(z: DeskZone): SizeBreakdownEntry[] {
  if (z.sizeBreakdown && z.sizeBreakdown.length) return z.sizeBreakdown;
  if (z.deskSize) return [{ deskSize: z.deskSize, qty: Number(z.seats) || 0 }];
  return [];
}

export function hasPartition(z: DeskZone): boolean {
  return !!(z.partition && z.partition !== "없음");
}

export type BezelRow = { value: number; deskSize: DeskSize; qty: number };
export type BezelTable = {
  leftRows: BezelRow[];
  rightRows: (BezelRow & { ambiguous: boolean })[];
};

export function computeBezelTable(zones: DeskZone[]): BezelTable {
  const leftMap = new Map<DeskSize, BezelRow>();
  const rightMap = new Map<string, BezelRow>();

  zones.forEach((z) => {
    const withP = hasPartition(z);
    getZoneSizeEntries(z).forEach((entry) => {
      const spec = BEZEL_MAP[entry.deskSize];
      if (!spec) return;
      const qty = Number(entry.qty) || 0;

      const left = leftMap.get(entry.deskSize);
      if (left) left.qty += qty;
      else leftMap.set(entry.deskSize, { value: spec.left, deskSize: entry.deskSize, qty });

      const rightVal = withP ? spec.rightWith : spec.rightWithout;
      const rKey = `${entry.deskSize}_${withP ? "w" : "n"}`;
      const right = rightMap.get(rKey);
      if (right) right.qty += qty;
      else rightMap.set(rKey, { value: rightVal, deskSize: entry.deskSize, qty });
    });
  });

  const leftRows = Array.from(leftMap.values()).sort((a, b) => a.value - b.value);

  const rightRowsRaw = Array.from(rightMap.values());
  const valueCounts = new Map<number, number>();
  rightRowsRaw.forEach((r) => valueCounts.set(r.value, (valueCounts.get(r.value) ?? 0) + 1));

  const rightRows = rightRowsRaw
    .map((r) => ({ ...r, ambiguous: (valueCounts.get(r.value) ?? 0) > 1 }))
    .sort((a, b) => a.value - b.value || a.deskSize.localeCompare(b.deskSize));

  return { leftRows, rightRows };
}

export type DeskSummaryRow = {
  desk: string;
  deskSize: string;
  partition: string;
  qty: number;
  types: string;
};

export function computeDeskSummary(zones: DeskZone[]): DeskSummaryRow[] {
  const map = new Map<
    string,
    { desk: string; deskSize: string; partition: string; qty: number; typeSet: Set<string> }
  >();

  zones.forEach((z) => {
    getZoneSizeEntries(z).forEach((entry) => {
      const key = `${z.desk || ""}|${entry.deskSize || ""}|${z.partition || ""}`;
      let item = map.get(key);
      if (!item) {
        item = {
          desk: z.desk || "",
          deskSize: entry.deskSize || "",
          partition: z.partition || "",
          qty: 0,
          typeSet: new Set<string>(),
        };
        map.set(key, item);
      }
      item.qty += Number(entry.qty) || 0;
      item.typeSet.add(getZoneTypeLabel(z.typeKey) ?? z.name);
    });
  });

  return Array.from(map.values())
    .map((item) => ({
      desk: item.desk,
      deskSize: item.deskSize,
      partition: item.partition,
      qty: item.qty,
      types: Array.from(item.typeSet).join(", "),
    }))
    .sort((a, b) => {
      const dCmp = a.desk.localeCompare(b.desk);
      if (dCmp !== 0) return dCmp;
      return (parseInt(a.deskSize) || 0) - (parseInt(b.deskSize) || 0);
    });
}

export type JangpadRow = { name: string; qty: number; total: number };

// 장패드 수량 계산 (책상사이즈/존유형 기준, 여분 +2 항상 포함)
export function computeJangpadTable(deskZones: DeskZone[]): JangpadRow[] {
  let m800B = 0;
  let m800R = 0;
  let m830B = 0;
  let m890B = 0;

  deskZones.forEach((z) => {
    const isCouple = z.typeKey === "couple_seat" || z.typeKey === "couple_room";
    getZoneSizeEntries(z).forEach((entry) => {
      const qty = Number(entry.qty) || 0;
      if (entry.deskSize === "820mm") {
        if (isCouple) m800R += qty;
        else m800B += qty;
      } else if (entry.deskSize === "850mm") {
        m830B += qty;
      } else if (["910mm", "950mm", "1000mm"].includes(entry.deskSize)) {
        m890B += qty;
      }
    });
  });

  const rows: JangpadRow[] = [
    { name: "IS-M800_B(신규)", qty: m800B, total: 0 },
    { name: "IS-M800_R(커플)", qty: m800R, total: 0 },
    { name: "IS-M830_B(신규)", qty: m830B, total: 0 },
    { name: "IS-M890_B(신규)", qty: m890B, total: 0 },
    { name: "아이센스 장패드(카운터)", qty: 1, total: 0 },
  ];
  rows.forEach((r) => (r.total = r.qty + 2)); // 여분 +2
  return rows;
}

export function computeDeskSeatsSum(zones: DeskZone[]): number {
  return zones.reduce((s, z) => s + (Number(z.seats) || 0), 0);
}

export type HeadsetHookTotals = { irock: number; isense: number };

// 가방 선반 브라켓이 있는 좌석 = 아이락스 헤드셋걸이, 나머지 좌석 = 아이센스 헤드셋걸이.
// "책상만 설치" 존은 PC/헤드셋 모두 없는 존이라 집계에서 제외한다.
export function computeHeadsetHookTotals(zones: DeskZone[]): HeadsetHookTotals {
  const eligible = zones.filter((z) => z.typeKey !== "desk_only");
  const irock = eligible.reduce((s, z) => s + Math.min(Number(z.bagShelfCount) || 0, Number(z.seats) || 0), 0);
  const isense = Math.max(0, computeDeskSeatsSum(eligible) - irock);
  return { irock, isense };
}

// 총 PC수 = PC 존에 실제로 등록된 대수 합계 + 2 (카운터 1대 + 대체PC 1대).
// 책상 좌석수를 그대로 쓰지 않는 이유: 책상은 있지만 PC는 없는 존(예: 라운지 책상)이 있을 수
// 있어서, PC 탭에서 그 존을 0대로 두거나 아예 빼면 총 수량에도 그대로 반영되어야 하기 때문.
export function computePcTotal(pcZones: PcZone[]): number {
  return pcZones.reduce((s, z) => s + (Number(z.seats) || 0), 0) + 2;
}

export function computeOverriddenPcSeatsSum(pcZones: PcZone[]): number {
  return pcZones
    .filter((z) => z.pcOverrides && Object.keys(z.pcOverrides).length > 0)
    .reduce((s, z) => s + (Number(z.seats) || 0), 0);
}

export function computeBasicPcQty(pcZones: PcZone[]): number {
  return computePcTotal(pcZones) - computeOverriddenPcSeatsSum(pcZones);
}

export function tintColor(hex: string, amt: number): string {
  const clean = (hex || "#888888").replace("#", "");
  const r = parseInt(clean.substr(0, 2), 16);
  const g = parseInt(clean.substr(2, 2), 16);
  const b = parseInt(clean.substr(4, 2), 16);
  const nr = Math.round(r + (255 - r) * amt);
  const ng = Math.round(g + (255 - g) * amt);
  const nb = Math.round(b + (255 - b) * amt);
  const h = (v: number) => v.toString(16).padStart(2, "0");
  return `#${h(nr)}${h(ng)}${h(nb)}`;
}

export function getContrastText(hex: string): string {
  const clean = (hex || "#888888").replace("#", "");
  const r = parseInt(clean.substr(0, 2), 16);
  const g = parseInt(clean.substr(2, 2), 16);
  const b = parseInt(clean.substr(4, 2), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#000000" : "#ffffff";
}

export type CompactLayout = {
  cols: number;
  rows: number;
  rowH: number;
  headerH: number;
  headerFont: number;
  bodyFont: number;
};

// 존 12개(기존 3열x4행 기준)를 넘어가는 순간부터 압축이 심해지던 문제를 완화하기 위한 기준값.
// 이 개수를 넘으면 컬럼 수를 늘리고, 범례 영역도 넓혀서(computeLegendGeometry) 글자 축소 폭을 줄인다.
export const ZONE_LEGEND_OVERFLOW_THRESHOLD = 12;

export type LegendGeometry = {
  cols: number;
  panelAreaW: number;
  panelBottomLimit: number;
  cardX: number;
  cardW: number;
};

// 존 카드(사양표) 개수에 따라 컬럼 수와 범례 가로/세로 사용 가능 영역을 정하고, 그만큼을
// 우측 도면 카드 폭에서 덜어온다 — "12개 넘으면 도면/표 크기를 둘 다 줄여서 한 슬라이드에 담는다".
export function computeLegendGeometry(count: number): LegendGeometry {
  const basePanelAreaW = 900;
  const basePanelBottomLimit = 940;
  const baseCardX = 950;
  const baseCardW = 955;

  if (count <= ZONE_LEGEND_OVERFLOW_THRESHOLD) {
    return {
      cols: 3,
      panelAreaW: basePanelAreaW,
      panelBottomLimit: basePanelBottomLimit,
      cardX: baseCardX,
      cardW: baseCardW,
    };
  }

  const excess = count - ZONE_LEGEND_OVERFLOW_THRESHOLD;
  const cols = count <= 20 ? 4 : 5;
  const extraW = Math.min(220, excess * 18);
  const extraH = Math.min(100, excess * 8);
  const panelAreaW = basePanelAreaW + extraW;
  const panelBottomLimit = basePanelBottomLimit + extraH;
  const gapBetween = 30;
  const cardX = 20 + panelAreaW + gapBetween;
  const cardW = baseCardX + baseCardW - cardX;

  return { cols, panelAreaW, panelBottomLimit, cardX, cardW };
}

// 존 개수가 많아져도 카드가 화면 밖으로 넘치지 않도록 자동으로 축소
export function computeCompactLayout(
  count: number,
  availH: number,
  idealRowH: number,
  idealHeaderH: number,
  idealHeaderFont: number,
  idealBodyFont: number,
  cols: number,
): CompactLayout {
  const rows = Math.max(1, Math.ceil(count / cols));
  const neededH = rows * idealRowH;
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  if (neededH <= availH) {
    return {
      cols,
      rows,
      rowH: idealRowH,
      headerH: idealHeaderH,
      headerFont: idealHeaderFont,
      bodyFont: idealBodyFont,
    };
  }

  const shrink = availH / neededH;
  return {
    cols,
    rows,
    rowH: idealRowH * shrink,
    headerH: clamp(idealHeaderH * shrink, 20, idealHeaderH),
    headerFont: clamp(idealHeaderFont * shrink, 10, idealHeaderFont),
    bodyFont: clamp(idealBodyFont * shrink, 8, idealBodyFont),
  };
}

export function nextSuffix(n: number): string {
  return n < 26 ? String.fromCharCode(65 + n) : `A${n - 25}`;
}
