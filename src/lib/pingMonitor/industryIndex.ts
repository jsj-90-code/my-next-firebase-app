// PC방 업계 가동률 지수 — 측정 중인 경쟁점 전체를 묶은 하루 단위 지수(2026-10-07 신설).
// 쓰임: 우리 매장 매출이 빠졌을 때 업계 전체가 빠진 건지 우리만 빠진 건지 가르기.
//
// 연쇄 지수: 날마다 "전날과 그날 둘 다 다 찬 매장"끼리만 비교해 전날 대비 변화율을 구하고, 첫날=100부터 곱해 잇는다.
// 매장이 날마다 새로 등록돼도 새 매장은 이틀째부터 비교에 들어가므로, 들어온 날 지수가 튀지 않는다.
// 하루로 치는 기준은 summary.ts의 isFullDay(22시간 이상 잰 지난 날) 그대로 — 새 기준을 만들지 않는다.

import { hasNoIp, isFullDay, kstDaysAgo, type PingStore } from "./summary";

/** 비교에 쓴 매장이 이보다 적은 날은 지수를 잇지 않고 건너뛴다(다음 날을 마지막으로 값이 있던 날과 비교). */
export const INDEX_MIN_MATCHED = 5;

/**
 * 지수에 넣는 매장 — 우리 매장 자체, IP 확인 필요, IP 미등록, 한 번도 대답한 적 없는 곳(측정 불가 의심·확인 중)은 뺀다.
 * 측정을 멈춘 매장도 멈추기 전 기록은 그대로 쓴다(그날 그 매장 값은 그때 잰 그대로라서).
 */
export function isIndexEligible(s: PingStore): boolean {
  if (s.isOwnStore || s.ipCheck || hasNoIp(s)) return false;
  return Object.values(s.days).some((v) => v.a > 0);
}

/** 토·일을 주말로 친다(공휴일은 아직 평일로 친다). */
export function isWeekend(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

export type IndexPoint = {
  date: string;
  weekend: boolean;
  /** 첫날=100인 연쇄 지수. 비교할 매장이 모자란 날은 null. */
  index: number | null;
  /** 비교한 날(보통 전날) 대비 변화율(0.05 = +5%). 첫날·건너뛴 날은 null. */
  change: number | null;
  /** 비교한 날 — 보통 전날, 앞에 건너뛴 날이 있으면 그보다 앞. */
  comparedWith: string | null;
  /** 이 날과 비교한 날 둘 다 다 찬 매장 수(첫날은 그날 다 찬 매장 수). */
  matched: number;
  /** 비교에 쓴 매장들의 그날 실제 가동률(대수 가중) — 지수와 같이 보는 수준값. */
  level: number | null;
};

export type IndustryIndex = {
  points: IndexPoint[];
  /** 지수에 넣을 수 있는 매장 수(빼는 조건을 거친 뒤). */
  eligible: number;
  /** 빼낸 매장 수 — 사유별. */
  excluded: { own: number; ipCheck: number; noIp: number; neverAlive: number };
};

type DayValue = { u: number; w: number };

/**
 * 매장마다 그날 가동률(켜진 합 ÷ 대수 합)을 구하고, 전날 대수(t/n = 그날 쓴 분모)로 무게를 준다 —
 * 대수 가중이라 큰 매장이 더 반영되고, 대수를 나중에 고쳐도(분모가 바뀌어도) 매장 안의 변화율만 들어가 튀지 않는다.
 */
export function industryIndex(stores: PingStore[], today = kstDaysAgo(0)): IndustryIndex {
  const excluded = { own: 0, ipCheck: 0, noIp: 0, neverAlive: 0 };
  const perStore: Map<string, DayValue>[] = [];
  const allDates = new Set<string>();
  for (const s of stores) {
    if (s.isOwnStore) excluded.own += 1;
    else if (s.ipCheck) excluded.ipCheck += 1;
    else if (hasNoIp(s)) excluded.noIp += 1;
    else if (!isIndexEligible(s)) excluded.neverAlive += 1;
    if (!isIndexEligible(s)) continue;
    const m = new Map<string, DayValue>();
    for (const [date, v] of Object.entries(s.days)) {
      if (!isFullDay(date, v, today)) continue;
      m.set(date, { u: v.a / v.t, w: v.n > 0 ? v.t / v.n : v.t });
      allDates.add(date);
    }
    perStore.push(m);
  }

  const points: IndexPoint[] = [];
  let prev: { date: string; index: number } | null = null;
  for (const date of [...allDates].sort()) {
    const weekend = isWeekend(date);
    if (!prev) {
      const first = perStore.map((m) => m.get(date)).filter((v): v is DayValue => !!v);
      const enough = first.length >= INDEX_MIN_MATCHED;
      points.push({ date, weekend, index: enough ? 100 : null, change: null, comparedWith: null, matched: first.length, level: enough ? weighted(first.map((v) => [v.w, v.u])) : null });
      if (enough) prev = { date, index: 100 };
      continue;
    }
    let num = 0, den = 0, matched = 0;
    const levelParts: [number, number][] = [];
    for (const m of perStore) {
      const cur = m.get(date);
      const before = m.get(prev.date);
      if (!cur || !before) continue;
      num += before.w * cur.u;
      den += before.w * before.u;
      levelParts.push([cur.w, cur.u]);
      matched += 1;
    }
    if (matched < INDEX_MIN_MATCHED || den <= 0) {
      points.push({ date, weekend, index: null, change: null, comparedWith: prev.date, matched, level: null });
      continue;
    }
    const ratio = num / den;
    const index = prev.index * ratio;
    points.push({ date, weekend, index, change: ratio - 1, comparedWith: prev.date, matched, level: weighted(levelParts) });
    prev = { date, index };
  }
  return { points, eligible: perStore.length, excluded };
}

function weighted(parts: [number, number][]): number | null {
  let sw = 0, su = 0;
  for (const [w, u] of parts) {
    sw += w;
    su += w * u;
  }
  return sw > 0 ? su / sw : null;
}

/** 평일/주말 평균 지수 — from~to(포함)에서 값이 있는 날만. */
export function dayTypeAverages(points: IndexPoint[], from: string, to: string): { weekday: number | null; weekdayDays: number; weekend: number | null; weekendDays: number } {
  let wd = 0, wdN = 0, we = 0, weN = 0;
  for (const p of points) {
    if (p.index == null || p.date < from || p.date > to) continue;
    if (p.weekend) {
      we += p.index;
      weN += 1;
    } else {
      wd += p.index;
      wdN += 1;
    }
  }
  return { weekday: wdN ? wd / wdN : null, weekdayDays: wdN, weekend: weN ? we / weN : null, weekendDays: weN };
}
