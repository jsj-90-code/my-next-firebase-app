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

// 총 PC수 = 책상 탭 좌석 합계 + 2 (카운터 1대 + 대체PC 1대)
export function computePcTotal(deskZones: DeskZone[]): number {
  return computeDeskSeatsSum(deskZones) + 2;
}

export function computeOverriddenPcSeatsSum(pcZones: PcZone[]): number {
  return pcZones
    .filter((z) => z.pcOverrides && Object.keys(z.pcOverrides).length > 0)
    .reduce((s, z) => s + (Number(z.seats) || 0), 0);
}

export function computeBasicPcQty(deskZones: DeskZone[], pcZones: PcZone[]): number {
  return computePcTotal(deskZones) - computeOverriddenPcSeatsSum(pcZones);
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

// 존 개수가 많아져도 카드가 화면 밖으로 넘치지 않도록 자동으로 축소
export function computeCompactLayout(
  count: number,
  availH: number,
  idealRowH: number,
  idealHeaderH: number,
  idealHeaderFont: number,
  idealBodyFont: number,
): CompactLayout {
  const cols = 3;
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
