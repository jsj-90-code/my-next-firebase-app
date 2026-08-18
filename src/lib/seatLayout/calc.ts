// 아이센스 PC방 좌석배치도 작업 툴 - 계산 로직
// 앱스크립트 v15 Index.html의 계산 함수들을 순수 함수로 이식.

import { BEZEL_MAP, getZoneTypeLabel, PC_SPEC_FIELDS } from "./constants";
import type { DeskZone, DeskSize, PcSpecFieldId, PcSpecValues, PcZone, SizeBreakdownEntry } from "./types";

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

// "없음"/"해당없음"은 실제로 주문할 필요가 없다는 뜻이라(예: 조이패드 미포함, 책상만
// 설치하는 존의 의자) PC 발주 합계 표에서는 제외한다.
const SKIP_ORDER_VALUES = new Set(["없음", "해당없음"]);

export type OrderSummaryRow = { field: string; value: string; qty: number };

// CPU/RAM/GPU/M·B/POWER/CPU쿨러는 한 세트로 묶어서 조립(업그레이드) 발주해야 하는 값이라
// (예: 이 중 하나라도 함께 올린 존은 그 조합 그대로 한 세트로 주문), 개별 항목 합계표에서는
// 빼고 computePcSetSummary로 따로 묶어서 보여준다. 나머지 부품(모니터/키보드/마우스/모니터암
// 등)은 현장에서 개별 설치되는 주변기기라 세트 구분 없이 그대로 항목별 합계면 충분하다.
const PC_SET_FIELD_IDS = new Set<PcSpecFieldId>(["cpu", "ram", "gpu", "mb", "power", "cpuCooler"]);

// 마우스 값은 "G304 & ROCCAT PURE SEL 유선 화이트"처럼 한 존(좌석)에 실제로 같이 들어가는
// 마우스 두 종류를 " & "/" + " 구분자로 이어붙여 저장한다(부속품이 아니라 둘 다 마우스 완제품).
// 좌석마다 두 종류가 각각 하나씩 들어가므로 각 제품을 좌석수만큼 따로 집계하면 된다 — 단,
// 커플존은 예외로 좌석 2개당 이 조합을 통째로 1세트만 지급하고(한쪽 좌석엔 G304, 다른 쪽엔
// 레이저오로치), 좌석마다 두 종류를 다 주는 게 아니라 좌석끼리 나눠 가지므로 좌석수를 반으로
// 나눠서 집계한다.
const MOUSE_SPLIT_RE = /\s*[&+]\s*/;

function splitMouseValue(value: string): string[] {
  return value
    .split(MOUSE_SPLIT_RE)
    .map((p) => p.trim())
    .filter(Boolean);
}

function computeMouseRows(pcZones: PcZone[], pcDefaults: PcSpecValues, def: string): OrderSummaryRow[] {
  const map = new Map<string, number>();
  pcZones.forEach((z) => {
    const seats = Number(z.seats) || 0;
    if (!seats) return;
    const value = z.pcOverrides?.mouse ?? pcDefaults.mouse ?? def;
    if (!value || SKIP_ORDER_VALUES.has(value)) return;
    const parts = splitMouseValue(value);
    if (!parts.length) return;
    const isCouple = z.typeKey === "couple_seat" || z.typeKey === "couple_room";
    const perProductQty = isCouple ? Math.round(seats / parts.length) : seats;
    parts.forEach((part) => {
      map.set(part, (map.get(part) ?? 0) + perProductQty);
    });
  });

  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([value, qty]) => ({ field: "마우스", value, qty }));
}

// 카운터 PC(1대)/대체 PC(1대)는 특정 존에 속하지 않아 좌석 데이터로 집계되지 않지만, 실제로는
// 케이스가 필요한 PC라 여기서 고정 수량으로 더한다 — 카운터는 일반 케이스, 대체 PC는 손님
// 좌석과 동일하게(전역 기본 케이스) 들어간다.
const COUNTER_PC_CASE = "일반 케이스";
const COUNTER_PC_CASE_QTY = 1;
const SPARE_PC_CASE_QTY = 1;

function computeCaseRows(pcZones: PcZone[], pcDefaults: PcSpecValues, def: string): OrderSummaryRow[] {
  const map = new Map<string, number>();
  const add = (value: string, qty: number) => {
    if (!value || SKIP_ORDER_VALUES.has(value)) return;
    map.set(value, (map.get(value) ?? 0) + qty);
  };
  pcZones.forEach((z) => {
    const qty = Number(z.seats) || 0;
    if (!qty) return;
    add(z.pcOverrides?.case ?? pcDefaults.case ?? def, qty);
  });
  add(pcDefaults.case ?? def, SPARE_PC_CASE_QTY);
  add(COUNTER_PC_CASE, COUNTER_PC_CASE_QTY);
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([value, qty]) => ({ field: "CASE", value, qty }));
}

// PC 발주 사양(모니터암/키보드/마우스/CASE 등) 값별 수량 합계. 존별 개별 지정값이 있으면 그
// 값을, 없으면 전역 PC 기본사양을 쓴다 — PC 발주 도면/좌석번호표에서 실제로 적용되는 값과
// 동일한 우선순위다.
export function computePcOrderSummary(pcZones: PcZone[], pcDefaults: PcSpecValues): OrderSummaryRow[] {
  const rows: OrderSummaryRow[] = [];
  PC_SPEC_FIELDS.forEach((f) => {
    if (PC_SET_FIELD_IDS.has(f.id)) return;
    if (f.id === "mouse") {
      rows.push(...computeMouseRows(pcZones, pcDefaults, f.def));
      return;
    }
    if (f.id === "case") {
      rows.push(...computeCaseRows(pcZones, pcDefaults, f.def));
      return;
    }
    const map = new Map<string, number>();
    pcZones.forEach((z) => {
      const qty = Number(z.seats) || 0;
      if (!qty) return;
      const value = z.pcOverrides?.[f.id] ?? pcDefaults[f.id] ?? f.def;
      if (!value || SKIP_ORDER_VALUES.has(value)) return;
      map.set(value, (map.get(value) ?? 0) + qty);
    });
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([value, qty]) => rows.push({ field: f.label, value, qty }));
  });
  return rows;
}

export type PcSetRow = {
  cpu: string;
  ram: string;
  gpu: string;
  mb: string;
  power: string;
  cpuCooler: string;
  qty: number;
};

// 한 존에서 CPU/RAM/GPU/M·B/POWER/CPU쿨러 중 하나라도 기본사양과 다르게(업그레이드) 지정되면,
// 그 조합 전체를 한 세트로 묶어서 수량을 합산한다. 조립 PC는 부품을 따로따로 시킬 수 없고 한
// 세트로 발주해야 하기 때문에, 이 항목들을 개별로 쪼개서 세면 "CPU 10개 + GPU 10개"처럼
// 보여도 실제로는 서로 다른 존의 조합이 섞여 몇 세트를 시켜야 하는지 알 수 없다.
export function computePcSetSummary(pcZones: PcZone[], pcDefaults: PcSpecValues): PcSetRow[] {
  const spec = (z: PcZone, id: PcSpecFieldId): string => {
    const def = PC_SPEC_FIELDS.find((f) => f.id === id)?.def ?? "";
    return z.pcOverrides?.[id] ?? pcDefaults[id] ?? def;
  };

  const map = new Map<string, PcSetRow>();
  pcZones.forEach((z) => {
    const qty = Number(z.seats) || 0;
    if (!qty) return;
    const cpu = spec(z, "cpu");
    const ram = spec(z, "ram");
    const gpu = spec(z, "gpu");
    const mb = spec(z, "mb");
    const power = spec(z, "power");
    const cpuCooler = spec(z, "cpuCooler");
    const key = `${cpu}|${ram}|${gpu}|${mb}|${power}|${cpuCooler}`;
    const existing = map.get(key);
    if (existing) existing.qty += qty;
    else map.set(key, { cpu, ram, gpu, mb, power, cpuCooler, qty });
  });

  return Array.from(map.values()).sort((a, b) => b.qty - a.qty);
}

// 의자는 PC 탭이 아니라 책상 탭 사양이라 책상 존 기준으로 따로 합산한다.
export function computeChairSummary(zones: DeskZone[]): OrderSummaryRow[] {
  const map = new Map<string, number>();
  zones.forEach((z) => {
    const qty = Number(z.seats) || 0;
    if (!qty) return;
    const value = z.chair || "";
    if (!value || SKIP_ORDER_VALUES.has(value)) return;
    map.set(value, (map.get(value) ?? 0) + qty);
  });
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([value, qty]) => ({ field: "의자", value, qty }));
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
