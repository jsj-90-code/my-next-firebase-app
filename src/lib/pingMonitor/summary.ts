// 경쟁점 가동률 측정기 — 저장 모양과 가동률 계산(화면·서버 공용, 2026-10-06 신설).
//
// 가동률 = 기간 안 (켜진 PC 수 합) ÷ (대수 합). 매 시간 한 번 잰 값을 그대로 더한다 —
// 대수를 나중에 고쳐도 지난 기록의 분모는 그때 값(t)으로 남아 과거 가동률이 흔들리지 않는다.

export const PING_STORES = "pingMonitorStores";
export const PING_DAILY = "pingMonitorDaily";

/** 측정 간격(분). GitHub Actions 알람(.github/workflows/ping-monitor.yml)과 맞춘다. */
export const SAMPLE_INTERVAL_MINUTES = 60;

/** 이만큼 재는 동안 한 대도 대답이 없으면 "측정 불가 의심"(PC가 대답을 막아 둔 매장). */
export const BLOCKED_SUSPECT_SAMPLES = 72;

export type DayTotals = { a: number; t: number; n: number };

export type PingStore = {
  id: string;
  name: string;
  address: string;
  ipRanges: string;
  ipCount: number;
  /** 실제 PC 대수. 비우면 IP 개수를 대수로 본다. */
  pcCount: number | null;
  memo: string;
  active: boolean;
  /** 우리 매장(기존점 가맹점코드 또는 후보지 코드 N0xx). 매장별로 묶어 볼 때 쓴다. */
  ownCode: string | null;
  ownName: string | null;
  /** 점포평가 경쟁점 문서(storeEvalCompetitors) id — 옛 핑봇 값과 나란히 보려고 잇는다. */
  competitorId: string | null;
  distanceM: number | null;
  createdAt: Date | null;
  createdBy: string | null;
  lastSample: {
    at: Date | null;
    date: string;
    hour: string;
    alive: number;
    total: number;
    aliveIps: string[];
  } | null;
  days: Record<string, DayTotals>;
};

export type PingDaily = {
  storeId: string;
  date: string;
  hours: Record<string, { a: number; t: number }>;
};

/** 한국 시각 기준 날짜(YYYY-MM-DD)와 시(HH). */
export function kstParts(date: Date): { date: string; hour: string } {
  const k = new Date(date.getTime() + 9 * 3600 * 1000);
  const iso = k.toISOString();
  return { date: iso.slice(0, 10), hour: iso.slice(11, 13) };
}

/** 오늘(한국 시각)에서 n일 전 날짜. n=0이면 오늘. */
export function kstDaysAgo(n: number, now = new Date()): string {
  return kstParts(new Date(now.getTime() - n * 86400 * 1000)).date;
}

export function denominator(store: Pick<PingStore, "pcCount" | "ipCount">): number {
  return store.pcCount && store.pcCount > 0 ? store.pcCount : store.ipCount;
}

export type RangeUtil = { util: number | null; samples: number; days: number };

/** from~to(포함) 날짜의 가동률. 기록이 없으면 util=null. */
export function rangeUtilization(days: Record<string, DayTotals>, from: string | null, to: string | null): RangeUtil {
  let a = 0;
  let t = 0;
  let n = 0;
  let d = 0;
  for (const [date, v] of Object.entries(days)) {
    if (from && date < from) continue;
    if (to && date > to) continue;
    a += v.a;
    t += v.t;
    n += v.n;
    d += 1;
  }
  return { util: t > 0 ? a / t : null, samples: n, days: d };
}

/** 여러 경쟁점을 합친 가동률(대수 가중) — 우리 매장 하나에 붙은 경쟁점 묶음의 "동네 경쟁점 가동률". */
export function groupUtilization(stores: PingStore[], from: string | null, to: string | null): number | null {
  let a = 0;
  let t = 0;
  for (const s of stores) {
    for (const [date, v] of Object.entries(s.days)) {
      if (from && date < from) continue;
      if (to && date > to) continue;
      a += v.a;
      t += v.t;
    }
  }
  return t > 0 ? a / t : null;
}

export type StoreStatus ={ label: string; tone: "ok" | "warn" | "danger" | "neutral" };

export function storeStatus(store: PingStore): StoreStatus {
  if (!store.active) return { label: "중지", tone: "neutral" };
  const all = rangeUtilization(store.days, null, null);
  if (all.samples === 0) return { label: "첫 측정 대기", tone: "neutral" };
  const aliveEver = Object.values(store.days).some((v) => v.a > 0);
  if (aliveEver) return { label: "측정 중", tone: "ok" };
  if (all.samples >= BLOCKED_SUSPECT_SAMPLES) return { label: "측정 불가 의심", tone: "danger" };
  return { label: "대답 없음(확인 중)", tone: "warn" };
}

/** 켜진 IP를 짧게 — 모두 같은 앞 세 자리면 끝자리만("10, 24번"), 아니면 전체 IP. */
export function shortIps(ips: string[]): string {
  if (ips.length === 0) return "";
  const prefixes = new Set(ips.map((ip) => ip.slice(0, ip.lastIndexOf("."))));
  return prefixes.size === 1 ? `${ips.map((ip) => ip.split(".").at(-1)).join(", ")}번` : ips.join(", ");
}

export function formatPct(v: number | null, digits = 1): string {
  return v == null ? "-" : `${(v * 100).toFixed(digits)}%`;
}
