// 경쟁점 가동률 측정기 — 저장 모양과 가동률 계산(화면·서버 공용, 2026-10-06 신설).
//
// 가동률 = 다 찬 날들의 "하루 가동률"(그날 켜진 PC 수 합 ÷ 대수 합) 평균 — 일일평균(2026-10-07 사용자).
// 덜 찬 날(등록한 날 오후부터 잰 날 등)은 빼고, 진행 중인 오늘은 "오늘" 칸에만 따로 보인다.
// 대수를 나중에 고쳐도 지난 기록의 분모는 그때 값(t)으로 남아 과거 가동률이 흔들리지 않는다.

export const PING_STORES = "pingMonitorStores";
export const PING_DAILY = "pingMonitorDaily";

/** 측정 간격(분). vercel.json의 /api/ping-monitor/cron 예약(매시 5분)과 맞춘다. */
export const SAMPLE_INTERVAL_MINUTES = 60;

/** 이만큼 재는 동안 한 대도 대답이 없으면 "핑 차단 의심"(PC가 대답을 막아 둔 매장). */
export const BLOCKED_SUSPECT_SAMPLES = 72;

export type DayTotals = { a: number; t: number; n: number };

/**
 * 하루로 치는 최소 측정 횟수(1시간 간격이라 = 시간 수). 이만큼 잰 날만 가동률 평균에 넣는다 —
 * 등록한 날 오후 5시부터 잰 7시간은 낮 시간이 빠져 치우친다(2026-10-07 사용자 "그 데이터는 날려야", "일일평균으로").
 * 경위: 10-07 22 → 10-08 오전 24 → 10-08 오후 22 → 10-09 20(아래).
 * 근거(10-09 24회차 꽉 찬 날 120개 실측):
 *   - 무작위로 N개 빼기: 2개 중앙 0.44%p·3개 0.51%p·4개 0.63%p·6개 0.86%p — 흩어져 빠지면 영향 작다.
 *   - 연속 블록(몰림) 6개 빼기: 가장 나쁜 6시간 블록 중앙 4.02%p·최악 13.81%p — 18은 몰리면 위험.
 * 20으로 둔 이유(2026-10-09 사용자): 빠진 걸 4개로 묶으면 몰려도 피해가 작다(4개 무작위 0.63%p).
 *   서버 멈춤은 A1 이전으로 없어질 예정이라 앞으로 여러 개 빠지는 날은 드물다. 어제(3·4·19시 3개 빠짐)를 살리는 게 목적.
 * 18로 내리면 안 된다 — 신규 매장·몰림 때 치우친다(10-07 암사역 콤마, 위 실측).
 */
export const FULL_DAY_MIN_SAMPLES = 20;

/** 꽉 찬 날인데 하루 평균 가동률이 이 값 미만이면 측정 실패로 보고 이번주·이달 평균에서 뺀다(2026-10-09).
 *  정상 영업 PC방이 24시간 평균 1% 미만일 수 없다 — IP 틀림·핑/포트 차단으로 노이즈 몇 개만 잡힌 날. */
export const MEASURE_FAIL_MAX_UTIL = 0.01;

/** "최근 24시간" 값이 나오는 최소 시간대 칸 수 — 날짜 기준(FULL_DAY_MIN_SAMPLES)과 같은 관용(2026-10-08, 10-09 22→20). */
export const RECENT_MIN_HOURS = FULL_DAY_MIN_SAMPLES;

/** 그날 측정이 하루치로 충분한지(오늘 여부는 안 본다). */
export function coversFullDay(v: DayTotals): boolean {
  return v.n >= FULL_DAY_MIN_SAMPLES && v.t > 0;
}

/** 화면에 붙이는 "하루로 치는 날" 설명 — 상수에서 만든다(숫자를 글자로 박지 않기). */
export function fullDayRuleText(): string {
  return `24시간 중 ${FULL_DAY_MIN_SAMPLES}시간 이상 잰 날`;
}

/**
 * 최근 24시간 가동률 — 시간대 칸마다 마지막 측정(24시간 안)을 합친다(켜진 합 ÷ 대수 합).
 * 0시~24시 날짜를 기다리지 않아도 24개 시간대가 고르게 들어가 꽉 찬 하루와 같은 기준이 된다 —
 * 신규 후보지는 오후에 등록해도 다음 날 같은 시각이면 값이 나온다(사용자 2026-10-07 "하루치로 하려면 2일을 기다려야 하니").
 * 시간대 칸이 RECENT_MIN_HOURS(= FULL_DAY_MIN_SAMPLES, 2026-10-09 기준 20개) 이상 차면 값을 낸다 — 서버가 한두 회차 걸러도 안 비게.
 * 회차가 RECENT_MIN_HOURS를 못 채울 만큼 빠지면 그 시각부터 24시간 동안 "-"로 보인다.
 */
export function recent24h(recent: Record<string, RecentSlot>, now = new Date()): { util: number | null; hours: number } {
  let a = 0, t = 0, hours = 0;
  for (const v of Object.values(recent)) {
    if (!v.at || now.getTime() - v.at.getTime() > 24 * 3600 * 1000 || !(v.t > 0)) continue;
    a += v.a;
    t += v.t;
    hours += 1;
  }
  return { util: hours >= RECENT_MIN_HOURS ? a / t : null, hours };
}

/** 하루 가동률 — 다 찬 날만, 아니면 null(날짜별 그래프용). */
export function fullDayRate(days: Record<string, DayTotals>, date: string, today = kstDaysAgo(0)): number | null {
  const v = days[date];
  return v && isFullDay(date, v, today) ? v.a / v.t : null;
}

/** 하루를 다 찬 날로 칠지 — 오늘(진행 중)은 아직 아니다. */
export function isFullDay(date: string, v: DayTotals, today: string): boolean {
  return date < today && coversFullDay(v);
}

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
  /** 점포평가 경쟁점 문서(storeEvalCompetitors) id — 등록 칸에서 골라 상호·대수·거리를 채울 때 잇는다. */
  competitorId: string | null;
  distanceM: number | null;
  /** 우리 매장 자체(경쟁점이 아님) — 2026-10-06 우리 매장 가동률도 같은 방식으로 재려고 추가. 스크립트만 쓴다. */
  isOwnStore: boolean;
  /** "IP 확인 필요" 사유(2026-10-06 점검). IP를 고쳐 저장하면 지워진다. 등록 범위 안에서 잰 결과만 근거로 쓴다. */
  ipCheck: string | null;
  /** 포트 전환 날(YYYY-MM-DD) — 이 날과 그 이전은 이번주·이달 평균에서 뺀다(전환 전 못 재서 0, 전환 날 섞임). 2026-10-09. */
  portSwitchDate: string | null;
  /** 사람이 "계산 제외"로 확정한 측정 오류 매장(IP 틀림·장비 과응답·몇 대만 평평하게 응답 등). 평균·수요계산 제외, 화면 "-"(2026-10-09). */
  excludeFromStats: boolean;
  createdAt: Date | null;
  createdBy: string | null;
  lastSample: {
    at: Date | null;
    date: string;
    hour: string;
    alive: number;
    total: number;
    aliveIps: string[];
    method?: string;
  } | null;
  days: Record<string, DayTotals>;
  /** 시간대(0~23시)별 가장 최근 측정 1개씩 — "최근 24시간" 계산용(2026-10-07). 서버가 매 회차 그 시 칸을 덮어쓴다. */
  recent: Record<string, RecentSlot>;
};

export type RecentSlot = { a: number; t: number; at: Date | null };

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

/**
 * 기간은 날짜(한국 시각 0~24시) 단위다(2026-10-07 사용자). "최근 n일"은 오늘을 빼고 어제까지 다 찬 n일 —
 * 진행 중인 오늘을 섞으면 아직 안 온 낮·저녁 시간이 빠져 값이 치우친다. 오늘은 따로 "진행 중"으로 보인다.
 */
export function lastFullDays(n: number, now = new Date()): { from: string; to: string } {
  return { from: kstDaysAgo(n, now), to: kstDaysAgo(1, now) };
}

/** 기간 칸 밑에 붙이는 날짜(2026-10-07 사용자) — "10/7" 또는 "9/30~10/6". */
export function dateRangeLabel(from: string, to: string): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return from === to ? md(from) : `${md(from)}~${md(to)}`;
}

/** 주 시작 요일(0=일, 1=월). 월~일 — 금·토·일 주말이 한 주에 같이 묶인다(2026-10-07 사용자 "최근 7일은 월~일로"). */
export const WEEK_START_DAY = 1;

/**
 * 이번 주(오늘이 속한 월~일). 값은 그 안의 다 찬 날만 일일평균한다 — 오늘·앞으로 올 날은 isFullDay에서 저절로 빠진다.
 * 그래서 월요일엔 "-", 화요일엔 1일치…로 늘어난다.
 */
export function thisWeek(now = new Date()): { from: string; to: string } {
  const today = kstDaysAgo(0, now);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const back = (dow - WEEK_START_DAY + 7) % 7;
  return { from: kstDaysAgo(back, now), to: kstDaysAgo(back - 6, now) };
}

/** 지난주(이번 주 바로 앞 월~일) — 이번 주에서 7일 뒤로(2026-10-09 사용자 요청, 이번주 왼쪽 열). */
export function lastWeek(now = new Date()): { from: string; to: string } {
  const today = kstDaysAgo(0, now);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const back = (dow - WEEK_START_DAY + 7) % 7;
  return { from: kstDaysAgo(back + 7, now), to: kstDaysAgo(back + 1, now) };
}

export function denominator(store: Pick<PingStore, "pcCount" | "ipCount">): number {
  return store.pcCount && store.pcCount > 0 ? store.pcCount : store.ipCount;
}

/** days = 평균에 넣은 다 찬 날 수, skipped = 기록은 있으나 덜 차서 뺀 날 수, samples = 넣은 날들의 측정 횟수. */
export type RangeUtil = { util: number | null; samples: number; days: number; skipped: number };

/**
 * from~to(포함) 날짜의 가동률 — 다 찬 날마다 하루 가동률을 구해 평균(일일평균). 다 찬 날이 없으면 util=null.
 * includePartial: "오늘(진행 중)" 칸처럼 덜 찬 날도 그대로 합칠 때(켜진 합 ÷ 대수 합).
 */
export function rangeUtilization(
  days: Record<string, DayTotals>,
  from: string | null,
  to: string | null,
  { includePartial = false, today = kstDaysAgo(0), excludeUpTo = null }: { includePartial?: boolean; today?: string; excludeUpTo?: string | null } = {},
): RangeUtil {
  let a = 0, t = 0, n = 0, d = 0, skipped = 0, sumDaily = 0;
  for (const [date, v] of Object.entries(days)) {
    if (from && date < from) continue;
    if (to && date > to) continue;
    // 포트 전환 날과 그 이전은 뺀다 — 전환 전엔 못 재서 0, 전환 날은 앞뒤가 섞여 낮게 깔린다(2026-10-09 사용자).
    if (excludeUpTo && date <= excludeUpTo) { skipped += 1; continue; }
    if (includePartial) {
      a += v.a;
      t += v.t;
      n += v.n;
      d += 1;
    } else if (isFullDay(date, v, today)) {
      // 꽉 찬 날인데 하루 평균 가동률이 MEASURE_FAIL_MAX_UTIL(1%) 미만이면 측정 실패로 본다 — 정상 영업 PC방이
      // 22시간+ 내내 거의 0대일 수 없다(IP 틀림·핑/포트 차단으로 노이즈 몇 개만 잡힘: 레드포스 10-07 1/3360, 뉴블랙 4/3096).
      // 평균에서 빼서 0%가 아니라 "-"로 보이게 한다(2026-10-09 사용자: "측정 안 된 날은 0이 아니라 빼라").
      if (v.a / v.t < MEASURE_FAIL_MAX_UTIL) { skipped += 1; continue; }
      sumDaily += v.a / v.t;
      n += v.n;
      d += 1;
    } else {
      skipped += 1;
    }
  }
  const util = includePartial ? (t > 0 ? a / t : null) : d > 0 ? sumDaily / d : null;
  return { util, samples: n, days: d, skipped };
}

/** 점포평가 경쟁점 하나에 대한 측정기 "최근 7일" 요약 — 후보지 경쟁점 탭에서 핑봇 칸에 넣을 값(2026-10-07 신설). */
export type CompetitorMeasurement = {
  /** none = 측정기에 등록 안 됨, noIp = IP 미등록, stopped = 측정 중지, blocked = 핑 차단 의심·IP대역 재확인,
   *  waiting = 아직 다 찬 날 없음, short = 7일 미달, ok = 7일 다 참. */
  state: "none" | "noIp" | "stopped" | "blocked" | "waiting" | "short" | "ok";
  label: string;
  store: PingStore | null;
  util: number | null;
  /** 평균에 넣은 다 찬 날 수 / 창 길이(7). */
  fullDays: number;
  windowDays: number;
  /** 실제로 평균에 들어간 첫날~끝날(다 찬 날 기준). 없으면 null. */
  from: string | null;
  to: string | null;
  /** 핑봇_가동률 칸에 넣을 값(퍼센트, 소수 첫째 자리) — util이 없으면 null. */
  pingbotUtilization: number | null;
  /** 핑봇_조회기간 칸에 넣을 문구. */
  pingbotPeriod: string | null;
};

export const COMPETITOR_MEASURE_DAYS = 7;

/**
 * 같은 경쟁점에 측정기 문서가 여럿이면(중복 등록) IP가 있고 측정 중이며 다 찬 날이 많은 쪽을 고른다.
 * 가동률은 어제까지 다 찬 7일(lastFullDays) + rangeUtilization(일일평균)이다. 측정기 화면의 "이번 주(월~일)" 칸과는 기간이 다르다 —
 * 평가에 넣는 숫자라 요일 7개가 다 들어가야 해서 일부러 그대로 둔다(2026-10-07 측정기 화면만 월~일로 바꿈).
 */
export function competitorMeasurement(stores: PingStore[], now = new Date()): CompetitorMeasurement {
  const windowDays = COMPETITOR_MEASURE_DAYS;
  const { from, to } = lastFullDays(windowDays, now);
  const today = kstDaysAgo(0, now);
  const base = { util: null, fullDays: 0, windowDays, from: null, to: null, pingbotUtilization: null, pingbotPeriod: null };
  const candidates = stores.filter((s) => !s.isOwnStore);
  if (candidates.length === 0) return { ...base, state: "none", label: "측정기 미등록(측정 안 함)", store: null };
  const ranked = candidates
    .map((s) => ({ s, r: rangeUtilization(s.days, from, to, { today, excludeUpTo: s.portSwitchDate }) }))
    .sort((x, y) => Number(hasNoIp(x.s)) - Number(hasNoIp(y.s)) || Number(y.s.active) - Number(x.s.active) || Number(Boolean(x.s.ipCheck)) - Number(Boolean(y.s.ipCheck)) || y.r.days - x.r.days);
  const { s, r } = ranked[0];
  if (s.excludeFromStats) return { ...base, state: "blocked", label: "계산 제외(IP 확인 필요)", store: s };
  if (hasNoIp(s)) return { ...base, state: "noIp", label: "IP 미등록", store: s };
  if (!s.active) return { ...base, state: "stopped", label: "측정 중지", store: s };
  // 응답이 한 번이라도 있었다고 해서 IP 확인 경고가 해소된 것은 아니다.
  // 레드포스처럼 하루 0~1대만 응답한 값이 정상 가동률로 점포평가에 들어가지 않게 한다.
  if (s.ipCheck) return { ...base, state: "blocked", label: storeStatus(s).label, store: s };
  const status = storeStatus(s);
  if (status.tone === "danger" || status.label.startsWith("IP·핑차단") || status.label.startsWith("과응답")) return { ...base, state: "blocked", label: status.label, store: s };
  // 평균에 실제로 들어간 날과 같은 조건(꽉 찬 날 + 측정실패 1% 미만 제외 + 포트 전환 날 이후)이라야
  // first~last 기간·일수가 r.days/r.util과 안 어긋난다(2026-10-09).
  const used = Object.entries(s.days)
    .filter(([date, v]) => date >= from && date <= to && isFullDay(date, v, today)
      && v.a / v.t >= MEASURE_FAIL_MAX_UTIL
      && !(s.portSwitchDate && date <= s.portSwitchDate))
    .map(([date]) => date)
    .sort();
  if (r.util == null || used.length === 0) return { ...base, state: "waiting", label: "다 찬 날 없음(첫 하루 대기)", store: s };
  const first = used[0];
  const last = used[used.length - 1];
  const short = r.days < windowDays;
  return {
    state: short ? "short" : "ok",
    label: short ? `7일 미달(${r.days}일치)` : "측정 중",
    store: s,
    util: r.util,
    fullDays: r.days,
    windowDays,
    from: first,
    to: last,
    pingbotUtilization: Math.round(r.util * 1000) / 10,
    pingbotPeriod: `측정기 ${first}~${last} 일일평균 ${r.days}일`,
  };
}

export type StoreStatus ={ label: string; tone: "ok" | "warn" | "danger" | "neutral" };

/** IP를 아직 모르는 경쟁점 — 점포평가 경쟁점을 빈칸으로 넣어 둔 것(2026-10-06 사용자 "빈곳은 빈곳으로 냅두고"). */
export function hasNoIp(store: Pick<PingStore, "ipCount" | "ipRanges">): boolean {
  return store.ipCount === 0 || store.ipRanges.trim() === "";
}

export function storeStatus(store: PingStore): StoreStatus {
  // 사람이 "계산 제외"로 확정한 매장 — 측정값이 어떻든(과응답·몇 대만 응답 등 IP 오류) 평균·수요계산에서 빼고 화면은 "-"(2026-10-09).
  // 실측 우선 규칙(스컬스피시)보다 앞선다 — 보보스3·치즈 처럼 24시간 평평한 몇 대 응답은 노이즈라 실측으로 안 친다.
  if (store.excludeFromStats) return { label: "계산 제외(IP 확인 필요)", tone: "danger" };
  if (hasNoIp(store)) return { label: "IP 미등록", tone: "warn" };
  if (!store.active) return { label: "중지", tone: "neutral" };
  // 실측이 1% 이상이면 꼬리표보다 실측 우선 — 데이터가 뜨는 매장은 꼬리표(확인 전 등) 있어도 무조건 보인다(2026-10-08 스컬스피시).
  // 스침(일일평균 1% 미만)은 측정으로 안 친다(카사 3번 스침 → 0.N%).
  const maxDayUtil = Math.max(0, ...Object.values(store.days).map((v) => (v.t > 0 ? v.a / v.t : 0)));
  if (maxDayUtil >= 0.01) {
    const full = Object.values(store.days).filter(coversFullDay);
    const dailyAvg = full.length ? full.reduce((a, v) => a + v.a / v.t, 0) / full.length : null;
    if (dailyAvg != null && dailyAvg > 0.6) return { label: "과응답 · IP 확인", tone: "warn" };
    return { label: "측정 중", tone: "ok" };
  }
  // 실측이 거의 없는 경우: 사람이 남긴 꼬리표가 있으면 평가에 값을 안 쓴다(간헐적 응답도 못 믿음).
  if (store.ipCheck) {
    if (/확인 전/.test(store.ipCheck)) return { label: "IP 확인 전", tone: "warn" };
    return { label: "IP·핑차단 확인", tone: "warn" };
  }
  const all = rangeUtilization(store.days, null, null, { includePartial: true });
  if (all.samples === 0) return { label: "첫 측정 대기", tone: "neutral" };
  // IP는 넣었는데 응답이 0 — IP가 틀렸는지 핑이 막혔는지는 자료로 구분 못 한다(한 문구로).
  if (all.samples >= BLOCKED_SUSPECT_SAMPLES) return { label: "IP·핑차단 확인", tone: "danger" };
  return { label: "IP·핑차단 확인", tone: "warn" };
}

/** 켜진 IP를 짧게 — 모두 같은 앞 세 자리면 끝자리만("10, 24번"), 아니면 전체 IP. */
export function shortIps(ips: string[]): string {
  if (ips.length === 0) return "";
  const prefixes = new Set(ips.map((ip) => ip.slice(0, ip.lastIndexOf("."))));
  return prefixes.size === 1 ? `${ips.map((ip) => ip.split(".").at(-1)).join(", ")}번` : ips.join(", ");
}

/** 오늘(진행 중)처럼 덜 찬 하루에 "15시간치"처럼 붙일 꼬리말. 다 찼으면 빈 문자열. */
export function partialNote(samples: number, days: number): string {
  if (samples === 0) return "";
  return samples < days * (24 * 60) / SAMPLE_INTERVAL_MINUTES ? `${samples}시간치` : "";
}

/** n일 칸에 다 찬 날이 모자라면 "3일치"처럼 붙일 꼬리말(다 찬 날이 없으면 값이 "-"라 빈 문자열). */
export function fullDaysNote(fullDays: number, days: number): string {
  return fullDays > 0 && fullDays < days ? `${fullDays}일치` : "";
}

/** 화면 표시용 가동률 상한 — 100% 초과(켜진 IP > 대수)는 공유기·장비 과응답이라 100%로 막는다(2026-10-09 보보스1 103%).
 *  과응답 상태 표시(storeStatus "과응답 · IP 확인")는 그대로라 사용자는 이상을 안다. 평가값은 이미 과응답 매장을 제외. */
export function capUtil(v: number | null): number | null {
  return v == null ? null : Math.min(v, 1);
}

export function formatPct(v: number | null, digits = 1): string {
  return v == null ? "-" : `${(v * 100).toFixed(digits)}%`;
}
