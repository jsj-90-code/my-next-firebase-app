// 측정기 매장 문서 → PingStore 모양(2026-11-15 clientStore.ts에서 옮김 — 커넥터 도구(서버)도 같은 변환을 쓰려고).
// 화면(Firebase 직접·사내 저장소 창구)과 커넥터가 한 함수로 읽어야 상태 판정·가동률이 어긋나지 않는다.

import type { DayTotals, PingStore } from "./summary";

type Doc = Record<string, unknown>;

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v; // 사내 저장소 창구가 돌려준 값
  return v && typeof v === "object" && "toDate" in v ? (v as { toDate: () => Date }).toDate() : null;
}

export function toPingStore(id: string, d: Doc): PingStore {
  const ls = d.lastSample as Doc | null | undefined;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    id,
    name: String(d.name ?? ""),
    address: String(d.address ?? ""),
    ipRanges: String(d.ipRanges ?? ""),
    ipCount: Number(d.ipCount ?? 0),
    pcCount: typeof d.pcCount === "number" ? d.pcCount : null,
    memo: String(d.memo ?? ""),
    active: d.active !== false,
    ownCode: str(d.ownCode),
    ownName: str(d.ownName),
    competitorId: str(d.competitorId),
    distanceM: typeof d.distanceM === "number" ? d.distanceM : null,
    lat: typeof d.lat === "number" ? d.lat : null,
    lng: typeof d.lng === "number" ? d.lng : null,
    isOwnStore: d.isOwnStore === true,
    ipCheck: str(d.ipCheck),
    portSwitchDate: str(d.portSwitchDate),
    excludeFromStats: d.excludeFromStats === true,
    extraPortsOnly: d.probe1688 === true,
    createdAt: toDate(d.createdAt),
    createdBy: (d.createdBy as string | null | undefined) ?? null,
    lastSample: ls
      ? {
          at: toDate(ls.at),
          date: String(ls.date ?? ""),
          hour: String(ls.hour ?? ""),
          alive: Number(ls.alive ?? 0),
          total: Number(ls.total ?? 0),
          aliveIps: Array.isArray(ls.aliveIps) ? ls.aliveIps.map(String) : [],
          method: typeof ls.method === "string" ? ls.method : undefined,
        }
      : null,
    days: (d.days ?? {}) as Record<string, DayTotals>,
    recent: Object.fromEntries(
      Object.entries((d.recent ?? {}) as Record<string, { a?: number; t?: number; at?: unknown }>).map(([h, v]) => [
        h,
        { a: Number(v.a ?? 0), t: Number(v.t ?? 0), at: toDate(v.at) },
      ]),
    ),
  };
}
