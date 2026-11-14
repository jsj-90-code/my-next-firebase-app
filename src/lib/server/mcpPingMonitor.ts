import "server-only";

// 경쟁점 가동률 측정기 — 커넥터(/api/mcp) 도구의 몸통(2026-11-15 신설, 아티팩트 "경쟁점 가동률" 화면이 부른다).
//
// 원칙
// - 계산은 웹 화면과 같은 함수(summary.ts)를 그대로 쓴다. 판정·가동률이 화면마다 어긋나지 않게.
// - 읽기 3개(overview·store·area)는 IP를 내보내지 않는다 — 아티팩트 "결과 공유"로 커넥터 없는 팀원도 보게 되므로
//   IP대역·응답 IP·메모 속 IP는 빼거나 가린다. IP가 필요한 일(수정 칸·지금 확인)은 private/probe 도구로, 본인 커넥터일 때만.
// - 모두 짧게 끝난다: 저장소 요청 몇 번, 지금 확인은 25초에서 끊는다(1214f81 — 오래 붙잡는 요청 금지).
// - 측정 서버(agent.mjs)·저장 방식은 건드리지 않는다. 쓰는 칸은 웹 창구(/api/ping-monitor/db)와 같은 PING_KEYS만.

import { adminDb } from "@/lib/firebase-admin";
import { geocodeAddress, searchByCategory, searchByKeyword } from "@/lib/kakao";
import { DEMAND_POINT_TARGETS } from "@/lib/storeEval/demandPointTargets";
import { collectKakaoPcBangs, haversineM } from "@/lib/storeEval/quickEval/kakaoPcBangs";
import { judgePcBangName } from "@/lib/storeEval/quickEval/pcBangNameFilter";
import { findDuplicates, findExistingOverlaps, newAddressKeys, similarGroupName, type DuplicateHit } from "@/lib/pingMonitor/duplicate";
import { istore, usesInternalStore, type StoreWrite } from "@/lib/pingMonitor/internalStore";
import { MAX_IPS_PER_STORE, parseIpRanges } from "@/lib/pingMonitor/ipRange";
import { isKrHoliday } from "@/lib/pingMonitor/krHolidays";
import { formatSurveyMemo } from "@/lib/pingMonitor/memoFormat";
import { distanceM as straightDistanceM, PING_MAP_RADIUS_M } from "@/lib/pingMonitor/nearby";
import { probeIps } from "@/lib/pingMonitor/probe";
import { toPingStore } from "@/lib/pingMonitor/storeDoc";
import {
  byMeasuredThenDistance,
  capUtil,
  denominator,
  FLAT_MAX_RATIO,
  FULL_DAY_MIN_SAMPLES,
  fullDayRate,
  hasFullDay,
  hasNoIp,
  isFullDay,
  kstDaysAgo,
  lastFullDays,
  lastWeek,
  MEASURE_FAIL_MAX_UTIL,
  PING_DAILY,
  PING_STORES,
  RECENT_MIN_HOURS,
  rangeUtilization,
  recent24h,
  SAMPLE_INTERVAL_MINUTES,
  shortIps,
  statusShowsValues,
  storeStatus,
  thisWeek,
  type PingStore,
  type StoreStatus,
} from "@/lib/pingMonitor/summary";

// ---------- 공통 ----------

export class PingToolError extends Error {}

function requireInternal() {
  if (!usesInternalStore()) throw new PingToolError("측정기 사내 저장소가 꺼져 있어 커넥터로 읽을 수 없습니다.");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 400;
const r3 = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** 메모·확인 사유 속 IP(대역 포함)를 가린다 — 공유 읽기 결과에 IP가 새지 않게. */
export function maskIps(text: string): string {
  return text.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?:\s*[~\-–]\s*\d{1,3}(?:\.\d{1,3}){0,3})?/g, "(IP 가림)");
}

function daysBetween(from: string, to: string): number {
  return to < from ? 0 : Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
function dateList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const dow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

function checkRange(from: string, to: string) {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new PingToolError("날짜는 YYYY-MM-DD 모양이어야 합니다.");
  if (from > to) throw new PingToolError("시작 날짜가 끝 날짜보다 늦습니다.");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new PingToolError(`한 번에 ${MAX_RANGE_DAYS}일까지 볼 수 있습니다.`);
}

/** 웹 목록(page.tsx useRanges)과 같은 기간 — 오늘(진행 중)·지난주·이번주(월~어제)·지난달·이달(1일~어제). */
export function listRanges(now = new Date()) {
  const d30 = lastFullDays(30, now);
  const week = thisWeek(now);
  const prev = lastWeek(now);
  const today = kstDaysAgo(0, now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const prevMonthDays = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const pmS = String(pm).padStart(2, "0");
  return {
    today,
    yesterday: d30.to,
    lastWeek: { from: prev.from, to: prev.to, days: 7 },
    thisWeek: { from: week.from, to: week.to, daysSoFar: daysBetween(week.from, week.to < d30.to ? week.to : d30.to) },
    prevMonth: { from: `${py}-${pmS}-01`, to: `${py}-${pmS}-${String(prevMonthDays).padStart(2, "0")}`, days: prevMonthDays, label: `${pm}월` },
    thisMonth: { from: monthStart, to: d30.to, daysSoFar: daysBetween(monthStart, d30.to), label: `${m}월` },
    last30: { from: d30.from, to: d30.to, days: 30 },
  };
}

type Ranges = ReturnType<typeof listRanges>;
type Cell = { util: number | null; days: number; samples: number; avgOn: number | null } | null;

const isCustomOwnCode = (code: string) => code.startsWith("직접");
const isCandidateCode = (code: string) => /^N\d+$/.test(code) || code.startsWith("직접후보:");

function statusOut(st: StoreStatus) {
  return { label: st.label, tone: st.tone, kind: st.kind, hint: st.hint ?? null, showsValues: statusShowsValues(st) };
}

function cell(s: PingStore, from: string, to: string, opts: { inProgress?: boolean } = {}): Cell {
  const r = rangeUtilization(s.days, from, to, { includePartial: !!opts.inProgress, excludeUpTo: opts.inProgress ? null : s.portSwitchDate });
  const u = capUtil(r.util);
  return { util: r3(u), days: r.days, samples: r.samples, avgOn: u == null ? null : r1(u * denominator(s)) };
}

/** 목록 한 줄 — 웹 목록 표의 칸 전부(값을 보이면 안 되는 상태면 값은 null, 상태만). IP는 없다. */
function storeRow(s: PingStore, R: Ranges, now: Date) {
  const st = storeStatus(s, now);
  const shows = statusShowsValues(st) && !hasNoIp(s) && s.active;
  const ls = s.lastSample;
  const r24 = recent24h(s.recent, now);
  const sparkFrom = kstDaysAgo(14, now);
  return {
    id: s.id,
    name: s.name,
    address: s.address,
    ownCode: s.ownCode,
    ownName: s.ownName,
    isOwnStore: s.isOwnStore,
    active: s.active,
    distanceM: s.distanceM,
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    hasIp: !hasNoIp(s),
    ipCount: s.ipCount,
    seats: hasNoIp(s) ? s.pcCount : denominator(s),
    seatsFromIp: !hasNoIp(s) && !(s.pcCount && s.pcCount > 0),
    status: statusOut(st),
    ipCheck: s.ipCheck ? maskIps(s.ipCheck) : null,
    competitorId: s.competitorId,
    live: shows && ls ? { alive: ls.alive, total: ls.total, util: r3(capUtil(ls.total > 0 ? ls.alive / ls.total : null)), date: ls.date, hour: ls.hour, at: ls.at?.toISOString() ?? null } : null,
    lastSampleAt: ls?.at?.toISOString() ?? null,
    today: shows ? cell(s, R.today, R.today, { inProgress: true }) : null,
    recent24: shows ? { util: r3(capUtil(r24.util)), hours: r24.hours, superseded: hasFullDay(s.days, R.today) } : null,
    lastWeek: shows ? cell(s, R.lastWeek.from, R.lastWeek.to) : null,
    thisWeek: shows ? cell(s, R.thisWeek.from, R.thisWeek.to) : null,
    prevMonth: shows ? cell(s, R.prevMonth.from, R.prevMonth.to) : null,
    thisMonth: shows ? cell(s, R.thisMonth.from, R.thisMonth.to) : null,
    last30: shows ? cell(s, R.last30.from, R.last30.to) : null,
    // 최근 14일 하루 가동률(다 찬 날만, 100% 상한) — 목록의 작은 추세선용.
    spark: shows ? dateList(sparkFrom, R.yesterday).map((d) => r3(capUtil(fullDayRate(s.days, d, R.today)))) : null,
    firstDate: Object.keys(s.days).sort()[0] ?? null,
    portSwitchDate: s.portSwitchDate,
  };
}

async function allStores(): Promise<PingStore[]> {
  requireInternal();
  return (await istore.list(PING_STORES)).map((d) => toPingStore(d.id, d.data));
}

async function getStore(id: string): Promise<PingStore> {
  requireInternal();
  if (!id || id.includes("/")) throw new PingToolError("매장 id가 없습니다.");
  const d = await istore.get(PING_STORES, id);
  if (!d) throw new PingToolError("없는 매장입니다(지워졌을 수 있음).");
  return toPingStore(id, d);
}

type DailyRow = { date: string; hours: Record<string, { a: number; t: number }> };
async function dailyRows(storeId: string, from: string, to: string): Promise<DailyRow[]> {
  // 창구의 ID 범위는 [idFrom, idTo) — "<= 매장_to"를 맞추려고 끝에 \u0000(clientStore.listPingDaily와 같음).
  const docs = await istore.list(PING_DAILY, { idFrom: `${storeId}_${from}`, idTo: `${storeId}_${to}\u0000` });
  return docs.map(({ data }) => ({
    date: String(data.date ?? ""),
    hours: Object.fromEntries(
      Object.entries((data.hours ?? {}) as Record<string, { a?: number; t?: number }>).map(([h, v]) => [h, { a: Number(v.a ?? 0), t: Number(v.t ?? 0) }]),
    ),
  }));
}

/** 시간대(0~23시)별 켜진 합 ÷ 대수 합 + 잰 날 수 + 평균 켜진 대수. filter: 평일·주말(토·일 — 웹과 같은 기준). */
function hourProfile(rows: DailyRow[], filter: "all" | "weekday" | "weekend" = "all") {
  const a = Array(24).fill(0), t = Array(24).fill(0), n = Array(24).fill(0);
  for (const row of rows) {
    const w = dow(row.date);
    const weekend = w === 0 || w === 6;
    if (filter === "weekday" && weekend) continue;
    if (filter === "weekend" && !weekend) continue;
    for (const [h, v] of Object.entries(row.hours)) {
      const i = Number(h);
      if (i >= 0 && i < 24 && v.t > 0) {
        a[i] += v.a;
        t[i] += v.t;
        n[i] += 1;
      }
    }
  }
  return a.map((x, i) => ({ hour: i, util: t[i] > 0 ? r3(capUtil(x / t[i])) : null, days: n[i], avgOn: n[i] > 0 ? r1(x / n[i]) : null }));
}

function rules() {
  return {
    intervalMinutes: SAMPLE_INTERVAL_MINUTES,
    fullDayMinHours: FULL_DAY_MIN_SAMPLES,
    recentMinHours: RECENT_MIN_HOURS,
    measureFailMaxUtil: MEASURE_FAIL_MAX_UTIL,
    overResponseMinUtil: 0.6,
    flatMaxRatio: FLAT_MAX_RATIO,
    methodNote: "핑·80번 포트만(2026-11-03 품의 조건)",
  };
}

// ---------- 읽기(공유 가능, IP 없음) ----------

/** 목록 화면 전부: 매장 줄·묶음·겹침·빠진 회차·기간 정의. */
export async function pingOverview(now = new Date()) {
  const stores = await allStores();
  const R = listRanges(now);
  const active = stores.filter((s) => s.active);
  const nowKstHour = (now.getUTCHours() + 9) % 24;
  const fresh = new Set<number>();
  let lastRoundAt: Date | null = null;
  for (const s of stores) {
    for (const [h, v] of Object.entries(s.recent ?? {})) {
      if (v.at && now.getTime() - v.at.getTime() <= 24 * 3600 * 1000 && v.t > 0) fresh.add(Number(h));
    }
    const at = s.lastSample?.at;
    if (at && (!lastRoundAt || at > lastRoundAt)) lastRoundAt = at;
  }
  const missedHours: number[] = [];
  for (let h = 0; h < 24; h++) if (h !== nowKstHour && !fresh.has(h)) missedHours.push(h);
  const overlaps = findExistingOverlaps(active).map((o) => ({
    kind: o.kind,
    overlap: o.kind === "ip" ? o.overlap : null,
    a: { id: o.a.id, name: o.a.name, own: o.a.ownName ?? o.a.ownCode ?? null },
    b: { id: o.b.id, name: o.b.name, own: o.b.ownName ?? o.b.ownCode ?? null },
  }));
  const rows = active.sort(byMeasuredThenDistance).map((s) => storeRow(s, R, now));
  const groups = new Map<string, { code: string; name: string; kind: "existing" | "candidate"; custom: boolean }>();
  for (const s of active) {
    if (!s.ownCode || groups.has(s.ownCode)) continue;
    groups.set(s.ownCode, { code: s.ownCode, name: s.ownName ?? s.ownCode, kind: isCandidateCode(s.ownCode) ? "candidate" : "existing", custom: isCustomOwnCode(s.ownCode) });
  }
  return {
    asOf: now.toISOString(),
    lastRoundAt: lastRoundAt?.toISOString() ?? null,
    rules: rules(),
    ranges: R,
    missedHours,
    groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")),
    stores: rows,
    stopped: stores.filter((s) => !s.active).map((s) => ({ id: s.id, name: s.name, ownCode: s.ownCode, ownName: s.ownName })),
    overlaps,
  };
}

/** 매장 상세: 기간 가동률·날짜별·시간대별(전체·평일·주말)·날짜×시간 칸·메모(IP 가림). */
export async function pingStoreDetail(id: string, from?: string | null, to?: string | null, now = new Date()) {
  const s = await getStore(id);
  const today = kstDaysAgo(0, now);
  const wk = thisWeek(now);
  const f = from ?? wk.from;
  const t = to ?? wk.to;
  checkRange(f, t);
  const st = storeStatus(s, now);
  const shows = statusShowsValues(st) && !hasNoIp(s) && s.active;
  const inProgress = f === today && t === today;
  const range = rangeUtilization(s.days, f, t, { includePartial: inProgress, excludeUpTo: inProgress ? null : s.portSwitchDate });
  const r24 = recent24h(s.recent, now);
  const rows = await dailyRows(s.id, f, t);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const seats = denominator(s);
  const days = dateList(f, t).map((d) => {
    const v = s.days[d];
    const w = dow(d);
    return {
      date: d,
      weekday: w,
      holiday: isKrHoliday(d),
      samples: v?.n ?? 0,
      avgOn: v && v.n > 0 ? r1(v.a / v.n) : null,
      util: v && v.t > 0 ? r3(capUtil(v.a / v.t)) : null,
      rawUtil: v && v.t > 0 ? r3(v.a / v.t) : null,
      full: v ? isFullDay(d, v, today) : false,
      excluded: !!(v && s.portSwitchDate && d <= s.portSwitchDate),
      measureFail: !!(v && isFullDay(d, v, today) && v.a / v.t < MEASURE_FAIL_MAX_UTIL),
      hours: (() => {
        const r = byDate.get(d);
        if (!r) return null;
        return Array.from({ length: 24 }, (_, h) => {
          const x = r.hours[String(h)];
          return x && x.t > 0 ? r3(capUtil(x.a / x.t)) : null;
        });
      })(),
    };
  });
  const memo = formatSurveyMemo(s.memo);
  return {
    asOf: now.toISOString(),
    rules: rules(),
    store: {
      id: s.id,
      name: s.name,
      address: s.address,
      ownCode: s.ownCode,
      ownName: s.ownName,
      isOwnStore: s.isOwnStore,
      active: s.active,
      distanceM: s.distanceM,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
      hasIp: !hasNoIp(s),
      ipCount: s.ipCount,
      seats,
      seatsFromIp: !(s.pcCount && s.pcCount > 0),
      status: statusOut(st),
      ipCheck: s.ipCheck && st.tone !== "ok" ? maskIps(s.ipCheck) : null,
      memo: memo ? maskIps(memo) : "",
      memoHasIp: memo !== maskIps(memo),
      lastSample: s.lastSample
        ? { date: s.lastSample.date, hour: s.lastSample.hour, alive: s.lastSample.alive, total: s.lastSample.total, method: s.lastSample.method ?? null, at: s.lastSample.at?.toISOString() ?? null }
        : null,
      firstDate: Object.keys(s.days).sort()[0] ?? null,
      recordDays: Object.keys(s.days).length,
      portSwitchDate: s.portSwitchDate,
      excludeFromStats: s.excludeFromStats,
      competitorId: s.competitorId,
    },
    period: {
      from: f,
      to: t,
      inProgress,
      util: shows ? r3(capUtil(range.util)) : null,
      fullDays: range.days,
      skipped: range.skipped,
      samples: range.samples,
      avgOn: shows && range.util != null ? r1(capUtil(range.util)! * seats) : null,
    },
    recent24: { util: shows ? r3(capUtil(r24.util)) : null, hours: r24.hours },
    days,
    hourly: { all: hourProfile(rows, "all"), weekday: hourProfile(rows, "weekday"), weekend: hourProfile(rows, "weekend") },
  };
}

/** 상권 비교: 우리 매장 + 경쟁점 표·날짜별 선·시간대별 선. */
export async function pingArea(ownCode: string, from?: string | null, to?: string | null, now = new Date()) {
  requireInternal();
  if (!ownCode) throw new PingToolError("우리 매장 코드가 없습니다.");
  const stores = (await istore.list(PING_STORES, { where: [["ownCode", "==", ownCode]] })).map((d) => toPingStore(d.id, d.data)).filter((s) => s.active);
  const R = listRanges(now);
  const today = R.today;
  const wk = thisWeek(now);
  const f = from ?? wk.from;
  const t = to ?? wk.to;
  checkRange(f, t);
  const own = stores.find((s) => s.isOwnStore) ?? null;
  const rivals = stores.filter((s) => !s.isOwnStore).sort(byMeasuredThenDistance);
  const showsValues = (s: PingStore) => !hasNoIp(s) && s.active && statusShowsValues(storeStatus(s, now));
  const measured = rivals.filter(showsValues);
  const plotted = [own, ...measured].filter((s): s is PingStore => !!s);
  // 시간대별: 기간 시작 ~ 오늘(진행 중 포함) — 웹 비교 화면과 같다. 매장마다 저장소 한 번(병렬).
  const hourTo = t > today ? t : today;
  const dailyById = Object.fromEntries(await Promise.all(plotted.map(async (s) => [s.id, await dailyRows(s.id, f, hourTo)] as const)));
  const dates = dateList(f, t);
  const ownInfo = await ownLocation(ownCode);
  return {
    asOf: now.toISOString(),
    rules: rules(),
    ranges: R,
    ownCode,
    ownName: stores[0]?.ownName ?? ownInfo?.name ?? ownCode,
    kind: isCandidateCode(ownCode) ? "candidate" : "existing",
    custom: isCustomOwnCode(ownCode),
    ownLocation: ownInfo ? { lat: ownInfo.lat, lng: ownInfo.lng, address: ownInfo.address } : null,
    // 우리 매장 IP 등록(점포평가 기존점이고 아직 우리 매장 줄이 없을 때만)
    canRegisterOwn: !own && !isCandidateCode(ownCode) && !isCustomOwnCode(ownCode) && !!ownInfo?.existing,
    period: { from: f, to: t, hourlyTo: hourTo },
    own: own ? storeRow(own, R, now) : null,
    rivals: rivals.map((s) => ({ ...storeRow(s, R, now), plotted: showsValues(s) })),
    dates,
    daily: Object.fromEntries(plotted.map((s) => [s.id, dates.map((d) => r3(capUtil(fullDayRate(s.days, d, today))))])),
    hourly: Object.fromEntries(plotted.map((s) => [s.id, hourProfile(dailyById[s.id] ?? [])])),
  };
}

// ---------- 우리 매장·점포평가 자료(Firebase admin) ----------

type OwnOption = { code: string; name: string; kind: "기존점" | "후보지"; custom?: boolean; lat: number | null; lng: number | null; address: string | null };

async function ownLocation(code: string): Promise<{ name: string; lat: number | null; lng: number | null; address: string | null; existing: boolean } | null> {
  if (!adminDb || isCustomOwnCode(code)) return null;
  const col = isCandidateCode(code) ? "storeEvalCandidates" : "storeEvalExistingStores";
  const snap = await adminDb.collection(col).doc(code).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  return {
    name: String(d.storeName ?? d.name ?? code),
    lat: typeof d.lat === "number" ? d.lat : null,
    lng: typeof d.lng === "number" ? d.lng : null,
    address: typeof d.address === "string" ? d.address : null,
    existing: col === "storeEvalExistingStores",
  };
}

/** 우리 매장 고르기 목록 — clientStore.listOwnStoreOptions와 같은 규칙(서버판). 직접 입력 묶음은 소속 경쟁점 좌표 평균. */
async function ownOptions(stores: PingStore[]): Promise<OwnOption[]> {
  if (!adminDb) throw new PingToolError("서버 설정이 없습니다.");
  const [ex, ca] = await Promise.all([adminDb.collection("storeEvalExistingStores").get(), adminDb.collection("storeEvalCandidates").get()]);
  const existing = ex.docs.map((d) => d.data());
  const existingNames = new Set(existing.map((s) => String(s.storeName ?? "").replace(/\s/g, "")));
  const custom = new Map<string, { name: string; lat: number; lng: number; n: number }>();
  for (const s of stores) {
    if (!s.ownCode || !isCustomOwnCode(s.ownCode)) continue;
    const c = custom.get(s.ownCode) ?? { name: s.ownName || s.ownCode, lat: 0, lng: 0, n: 0 };
    if (s.lat != null && s.lng != null) {
      c.lat += s.lat;
      c.lng += s.lng;
      c.n += 1;
    }
    custom.set(s.ownCode, c);
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return [
    ...[...custom]
      .map(([code, c]) => ({ code, name: c.name, kind: code.startsWith("직접후보:") ? ("후보지" as const) : ("기존점" as const), custom: true, lat: c.n ? c.lat / c.n : null, lng: c.n ? c.lng / c.n : null, address: null }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    ...existing
      .map((s) => ({ code: String(s.storeCode ?? ""), name: String(s.storeName ?? ""), kind: "기존점" as const, lat: num(s.lat), lng: num(s.lng), address: typeof s.address === "string" ? s.address : null }))
      .filter((o) => o.code)
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    ...ca.docs
      .map((d) => d.data())
      .filter((c) => c.reviewStatus !== "종료" && !existingNames.has(String(c.name ?? "").replace(/\s/g, "")))
      .map((c) => ({ code: String(c.code ?? ""), name: String(c.name ?? ""), kind: "후보지" as const, lat: num(c.lat), lng: num(c.lng), address: typeof c.address === "string" ? c.address : null }))
      .filter((o) => o.code)
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
  ];
}

async function competitorOptions(ownCode: string) {
  if (!adminDb || !ownCode || isCustomOwnCode(ownCode)) return [];
  const snap = await adminDb.collection("storeEvalCompetitors").where("candidateCode", "==", ownCode).get();
  return snap.docs
    .map((d) => d.data())
    .map((c) => ({
      id: String(c.id ?? ""),
      name: String(c.name ?? ""),
      address: typeof c.address === "string" ? c.address : "",
      distanceM: typeof c.distanceM === "number" ? c.distanceM : null,
      pcCount: (typeof c.totalPcCount === "number" ? c.totalPcCount : null) ?? (typeof c.appliedPcCount === "number" ? c.appliedPcCount : null),
    }))
    .filter((c) => c.id)
    .sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
}

/** 등록 칸 고르기 자료 — 우리 매장 목록(+좌표), 고른 매장의 점포평가 경쟁점. IP 없음. */
export async function pingFormOptions(ownCode?: string | null) {
  const stores = await allStores();
  const [owns, comps] = await Promise.all([ownOptions(stores), ownCode ? competitorOptions(ownCode) : Promise.resolve([])]);
  return { ownOptions: owns, competitorOptions: comps, sameAreaM: SAME_AREA_M, nearAreaM: NEAR_AREA_M };
}

// ---------- IP를 다루는 도구(본인 커넥터 전용 — 결과 공유에 넣지 않는다) ----------

/** 수정 칸 채우기 — IP대역·원래 메모·최근 응답 IP·복사용 메모(기본정보 머리말 포함, 웹 MemoBlock과 같음). */
export async function pingStorePrivate(id: string) {
  const s = await getStore(id);
  const body = formatSurveyMemo(s.memo);
  const header = [`- 매장명 : ${[s.name, s.address].filter(Boolean).join(" , ")}`, s.ipRanges, `- 전체 대수 : ${denominator(s)}대`].filter(Boolean).join("\n");
  return {
    id: s.id,
    name: s.name,
    address: s.address,
    ipRanges: s.ipRanges,
    ipCount: s.ipCount,
    pcCount: s.pcCount,
    memo: s.memo,
    memoCopy: body ? (/매장명/.test(body) ? body : `${header}\n\n${body}`) : header,
    active: s.active,
    ownCode: s.ownCode,
    ownName: s.ownName,
    competitorId: s.competitorId,
    distanceM: s.distanceM,
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    isOwnStore: s.isOwnStore,
    ipCheck: s.ipCheck,
    lastAliveIps: s.lastSample?.aliveIps.length ? shortIps(s.lastSample.aliveIps) : "",
  };
}

const SAME_AREA_M = 500; // StoreForm과 같음(2026-10-24 사용자)
const NEAR_AREA_M = 1000;

export type SaveInput = {
  id?: string | null;
  name: string;
  address?: string | null;
  ipRanges: string;
  pcCount?: number | null;
  memo?: string | null;
  active?: boolean | null;
  ownCode?: string | null;
  customKind?: "기존점" | "후보지" | null;
  customName?: string | null;
  competitorId?: string | null;
  lat?: number | null;
  lng?: number | null;
  confirmOtherFloor?: boolean | null;
  confirmOtherArea?: boolean | null;
  dryRun?: boolean | null;
};

function hitOut(h: DuplicateHit<PingStore>) {
  const base = { kind: h.kind, id: h.store.id, name: h.store.name, own: h.store.ownName ?? h.store.ownCode ?? null, address: h.store.address, active: h.store.active, isOwnStore: !!h.store.isOwnStore, ipBlank: h.store.ipCount === 0 };
  return h.kind === "ip" ? { ...base, overlap: h.overlap, sample: h.sample } : base;
}

/** 등록·수정 — StoreForm의 검사(IP 형식·겹침·같은 건물 층 확인·500m 같은 상권·위치 필수)를 서버에서 그대로 하고, dryRun이면 검사만. */
export async function pingSaveStore(input: SaveInput, email: string | null) {
  requireInternal();
  const isNew = !input.id;
  const prev = input.id ? await getStore(input.id) : null;
  if (prev?.isOwnStore && input.ownCode && input.ownCode !== prev.ownCode) throw new PingToolError("우리 매장 등록은 다른 매장으로 옮길 수 없습니다.");
  const name = String(input.name ?? "").trim();
  const address = String(input.address ?? "").trim();
  const ipRanges = String(input.ipRanges ?? "").trim();
  const parsed = parseIpRanges(ipRanges);
  const pcCount = input.pcCount == null ? null : Number(input.pcCount);
  const pcInvalid = pcCount != null && !(Number.isInteger(pcCount) && pcCount > 0);
  const customName = String(input.customName ?? "").replace(/\s+/g, " ").trim();
  const customKind = input.customKind ?? null;
  const ownCode = customKind ? (customName ? (customKind === "후보지" ? "직접후보:" : "직접기존:") + customName : "") : String(input.ownCode ?? "").trim();

  const stores = await allStores();
  const owns = await ownOptions(stores);
  // 위치: 지도·주변 목록에서 고른 좌표가 오면 그걸, 아니면 주소로 찾는다(주소를 안 바꿨으면 원래 좌표).
  let compLoc: { lat: number; lng: number } | null = input.lat != null && input.lng != null ? { lat: Number(input.lat), lng: Number(input.lng) } : null;
  let geo: { roadAddress: string | null; jibunAddress: string | null } | null = null;
  let geoFound: boolean | null = null;
  const addressChanged = address !== (prev?.address ?? "").trim();
  if (address) {
    const g = await geocodeAddress(address).catch(() => null);
    geoFound = !!g;
    if (g) geo = { roadAddress: g.roadAddress, jibunAddress: g.jibunAddress };
    if (!compLoc && g && (isNew || addressChanged || prev?.lat == null)) compLoc = { lat: g.lat, lng: g.lng };
  }
  if (!compLoc && prev && prev.lat != null && prev.lng != null && !addressChanged) compLoc = { lat: prev.lat, lng: prev.lng };

  // 중복 — 우리 매장 등록은 주소 칸이 비어 있어 점포평가 주소로 채워 비교(StoreForm과 같음).
  const ownAddr = new Map(owns.filter((o) => o.address?.trim()).map((o) => [o.code, o.address!.trim()]));
  const compareStores = stores.map((s) => (s.isOwnStore && !s.address.trim() && s.ownCode && ownAddr.has(s.ownCode) ? { ...s, address: ownAddr.get(s.ownCode)! } : s));
  const hits = findDuplicates({ ipRanges: parsed.errors.length ? "" : ipRanges, keys: newAddressKeys(address, geo) }, compareStores, input.id ?? null);
  const ipChanged = ipRanges.replace(/\s/g, "") !== (prev?.ipRanges ?? "").replace(/\s/g, "");
  const blocking = hits.filter(
    (h) => h.store.active && ((h.kind === "ip" && (isNew || ipChanged)) || ((h.kind === "address" || (h.kind === "floorUnknown" && h.store.isOwnStore)) && (isNew || addressChanged))),
  );
  const floorConfirm = hits.filter((h) => !blocking.includes(h) && h.store.active && h.kind === "floorUnknown" && (isNew || addressChanged));
  const notice = hits.filter((h) => !blocking.includes(h) && !floorConfirm.includes(h));
  const needsFloorConfirm = floorConfirm.length > 0 && !input.confirmOtherFloor;

  // 상권 — 가까운 우리 매장 묶음(좌표 없는 묶음은 주소로 찾는다, 최대 40곳 — StoreForm과 같음).
  const locOf = new Map<string, { lat: number; lng: number }>();
  for (const o of owns) if (o.lat != null && o.lng != null) locOf.set(o.code, { lat: o.lat, lng: o.lng });
  let nearGroups: { code: string; name: string; kind: string; custom: boolean; distanceM: number }[] = [];
  if (compLoc && (customKind || !ownCode)) {
    const memberAddr = new Map<string, string>();
    for (const s of stores) if (s.ownCode && s.address.trim() && !memberAddr.has(s.ownCode)) memberAddr.set(s.ownCode, s.address.trim());
    const want = owns
      .filter((o) => !locOf.has(o.code))
      .map((o) => ({ code: o.code, address: (o.address ?? "").trim() || memberAddr.get(o.code) || "" }))
      .filter((w) => w.address)
      .slice(0, 40);
    const found = await Promise.all(want.map(async (w) => [w.code, await geocodeAddress(w.address).catch(() => null)] as const));
    for (const [code, g] of found) if (g) locOf.set(code, { lat: g.lat, lng: g.lng });
    nearGroups = owns
      .flatMap((o) => {
        const at = locOf.get(o.code);
        return at ? [{ code: o.code, name: o.name, kind: o.kind, custom: !!o.custom, distanceM: straightDistanceM(compLoc!, at) }] : [];
      })
      .filter((x) => x.distanceM <= NEAR_AREA_M)
      .sort((a, b) => a.distanceM - b.distanceM);
  }
  const sameArea = nearGroups.filter((g) => g.distanceM <= SAME_AREA_M);
  const similarGroups = customKind && customName ? owns.filter((o) => similarGroupName(o.name, customName)).map((o) => ({ code: o.code, name: o.name, kind: o.kind, custom: !!o.custom })) : [];
  const needsAreaConfirm = isNew && !!customKind && !!customName && sameArea.length > 0 && !input.confirmOtherArea;
  const needsLocation = isNew && !compLoc;

  const ownOpt = ownCode ? owns.find((o) => o.code === ownCode) ?? null : null;
  const ownLoc = ownOpt && !customKind ? locOf.get(ownOpt.code) ?? null : null;
  const autoDistance = ownLoc && compLoc ? straightDistanceM(ownLoc, compLoc) : null;

  const problems: string[] = [];
  if (!name) problems.push("상호를 적어 주세요.");
  if (customKind && !customName) problems.push("우리 매장(직접 입력) 이름을 적어 주세요.");
  if (parsed.errors.length) problems.push(...parsed.errors);
  if (parsed.ips.length === 0 && !parsed.errors.length) problems.push("IP대역을 적어 주세요.");
  if (parsed.ips.length > MAX_IPS_PER_STORE) problems.push(`IP가 너무 많습니다(${parsed.ips.length}개, 최대 ${MAX_IPS_PER_STORE}개).`);
  if (pcInvalid) problems.push("PC 대수는 1 이상의 정수로 넣어 주세요.");
  if (blocking.length) problems.push("이미 측정기에 있는 매장과 겹쳐 저장할 수 없습니다.");
  if (needsFloorConfirm) problems.push("같은 건물에 이미 등록된 매장이 있습니다 — 다른 층(다른 매장)이 맞는지 확인해 주세요.");
  if (needsAreaConfirm) problems.push(`${SAME_AREA_M}m 안에 이미 상권 묶음이 있습니다 — 같은 상권이면 그 묶음을 고르고, 다른 상권이 맞으면 확인을 눌러 주세요.`);
  if (needsLocation) problems.push(geoFound === false ? "적은 주소로 위치를 못 찾았습니다 — 주소를 더 자세히 적거나 주변 PC방 목록에서 고르세요." : "매장 위치가 필요합니다 — 주소를 적거나 주변 PC방 목록에서 고르세요.");

  const check = {
    ipCount: parsed.ips.length,
    ipErrors: parsed.errors,
    location: compLoc,
    geoFound,
    distanceM: autoDistance ?? prev?.distanceM ?? null,
    distanceAuto: autoDistance != null,
    blocking: blocking.map(hitOut),
    floorConfirm: floorConfirm.map(hitOut),
    notice: notice.map(hitOut),
    needsFloorConfirm,
    needsAreaConfirm,
    needsLocation,
    nearGroups: nearGroups.slice(0, 8),
    similarGroups: similarGroups.slice(0, 8),
    problems,
  };
  if (input.dryRun || problems.length) return { saved: false, id: input.id ?? null, check };

  const ownName = customKind ? customName || null : ownOpt?.name ?? (ownCode && ownCode === prev?.ownCode ? prev?.ownName ?? null : null);
  const data: Record<string, unknown> = {
    name,
    address,
    ipRanges,
    ipCount: parsed.ips.length,
    pcCount,
    memo: String(input.memo ?? "").trim(),
    active: input.active ?? prev?.active ?? true,
    ownCode: ownCode || null,
    ownName,
    competitorId: !customKind && ownCode && !isCustomOwnCode(ownCode) && input.competitorId ? input.competitorId : null,
    distanceM: autoDistance ?? prev?.distanceM ?? null,
    lat: compLoc?.lat ?? null,
    lng: compLoc?.lng ?? null,
    updatedAt: { __now: true },
    updatedBy: email,
  };
  if (prev?.isOwnStore) {
    // 우리 매장 줄은 묶음·거리를 바꾸지 않는다(웹 보안 규칙: isOwnStore는 서버만).
    data.ownCode = prev.ownCode;
    data.ownName = prev.ownName;
    data.competitorId = null;
    data.distanceM = 0;
  }
  if (isNew) {
    const id = await istore.add(PING_STORES, { ...data, createdAt: { __now: true }, createdBy: email });
    return { saved: true, id, check };
  }
  if (ipChanged) data.ipCheck = null; // IP를 고쳐 저장하면 "IP 확인 필요" 표시를 지운다(웹과 같음)
  await istore.commit([{ op: "update", c: PING_STORES, id: input.id!, data }]);
  return { saved: true, id: input.id!, check };
}

/** 지금 확인 — 80번만 한 번 두드리고 끊는다. 기록 안 남김. 25초에서 끊는다(그 안에 끝나는 게 정상: IP 1,024개 ≈ 12초). */
export async function pingProbe(ipRanges: string) {
  const parsed = parseIpRanges(String(ipRanges ?? ""));
  if (parsed.errors.length || parsed.ips.length === 0) throw new PingToolError(parsed.errors[0] ?? "IP대역을 입력해 주세요.");
  if (parsed.ips.length > MAX_IPS_PER_STORE) throw new PingToolError(`IP가 너무 많습니다(${parsed.ips.length}개).`);
  const started = Date.now();
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 25_000));
  const alive = await Promise.race([probeIps(parsed.ips), timeout]);
  if (!alive) throw new PingToolError("25초 안에 끝나지 않아 멈췄습니다 — 잠시 뒤 다시 눌러 주세요.");
  const aliveIps = parsed.ips.filter((ip) => alive.has(ip));
  return { at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 100) / 10, total: parsed.ips.length, alive: aliveIps.length, aliveIps: shortIps(aliveIps), method: "TCP 80번만(기록 안 함)" };
}

/** 삭제 — /api/ping-monitor/delete(사내 저장소 쪽)와 같다: 우리 매장 줄은 못 지움, 지운 정보는 pingMonitorDeleted에 남김. */
export async function pingDeleteStore(id: string, confirmName: string, email: string | null) {
  requireInternal();
  const data = await istore.get(PING_STORES, id);
  if (!data) throw new PingToolError("이미 없는 매장입니다.");
  if (data.isOwnStore === true) throw new PingToolError("우리 매장 등록은 지울 수 없습니다.");
  if (String(confirmName ?? "").trim() !== String(data.name ?? "").trim()) throw new PingToolError("확인용 매장 이름이 맞지 않습니다.");
  const daily = await istore.list(PING_DAILY, { idFrom: `${id}_`, idTo: `${id}_￿` });
  const info = { ...data };
  delete info.days;
  delete info.lastSample;
  const writes: StoreWrite[] = [
    { op: "set", c: "pingMonitorDeleted", id, data: { ...info, dailyCount: daily.length, deletedAt: { __now: true }, deletedBy: email } },
    ...daily.map((x) => ({ op: "delete" as const, c: PING_DAILY, id: x.id })),
    { op: "delete", c: PING_STORES, id },
  ];
  await istore.commit(writes);
  return { deleted: id, name: String(data.name ?? ""), dailyDeleted: daily.length };
}

/** 우리 매장 IP 등록 — /api/ping-monitor/own-register(사내 저장소 쪽)와 같다. */
export async function pingOwnRegister(ownCode: string, ipRanges: string, email: string | null) {
  requireInternal();
  if (!adminDb) throw new PingToolError("서버 설정이 없습니다.");
  const code = String(ownCode ?? "").trim();
  const ranges = String(ipRanges ?? "").trim();
  if (!code || code.includes("/")) throw new PingToolError("매장 코드가 없습니다.");
  const parsed = parseIpRanges(ranges);
  if (parsed.errors.length) throw new PingToolError(parsed.errors.join(" "));
  if (parsed.ips.length === 0) throw new PingToolError("IP대역을 적어 주세요.");
  if (parsed.ips.length > MAX_IPS_PER_STORE) throw new PingToolError(`IP가 너무 많습니다(${parsed.ips.length}개).`);
  const snap = await adminDb.collection("storeEvalExistingStores").doc(code).get();
  if (!snap.exists) throw new PingToolError("점포평가 기존점만 우리 매장 IP를 넣을 수 있습니다(후보지는 개점 후 기존점 전환 뒤에).");
  const store = snap.data() ?? {};
  const all = (await istore.list(PING_STORES)).map((d) => ({ id: d.id, ...d.data }) as Record<string, unknown> & { id: string });
  if (all.some((d) => d.ownCode === code && d.isOwnStore === true)) throw new PingToolError("이미 우리 매장 등록이 있습니다 — 우리 매장 줄의 정보 수정에서 고쳐 주세요.");
  const mine = new Set(parsed.ips);
  const clash = all
    .filter((d) => d.active !== false && String(d.ipRanges ?? "").trim())
    .filter((d) => parseIpRanges(String(d.ipRanges)).ips.some((ip) => mine.has(ip)))
    .map((d) => String(d.name ?? d.id));
  if (clash.length) throw new PingToolError(`다른 등록과 IP가 겹칩니다: ${clash.join(", ")}`);
  const storeName = String(store.storeName ?? code);
  const count = parsed.ips.length;
  const webPcCount = typeof store.pcCount === "number" ? store.pcCount : null;
  const today = kstDaysAgo(0);
  const id = await istore.add(PING_STORES, {
    name: `${storeName} (우리 매장)`,
    address: "",
    lat: typeof store.lat === "number" ? store.lat : null,
    lng: typeof store.lng === "number" ? store.lng : null,
    ownCode: code,
    ownName: storeName,
    isOwnStore: true,
    active: true,
    competitorId: null,
    distanceM: 0,
    ipRanges: ranges,
    ipCount: count,
    pcCount: count,
    memo: `우리 매장 · 화면 등록 ${today} ${ranges} 손님 PC 대역 ${count}대${webPcCount != null && webPcCount !== count ? `(웹 대수 ${webPcCount})` : ""}`,
    createdAt: { __now: true },
    createdBy: email,
    updatedAt: { __now: true },
    updatedBy: email,
  });
  return { id, ipCount: count, webPcCount, pcCountDiffers: webPcCount != null && webPcCount !== count };
}

/** 직접 입력 묶음 → 점포평가 매장으로 통째로 옮김 — clientStore.transferCustomOwn과 같다(문서 id 그대로라 기록이 이어짐). */
export async function pingTransferOwn(fromCode: string, toCode: string, email: string | null) {
  requireInternal();
  if (!isCustomOwnCode(fromCode)) throw new PingToolError("직접 입력한 매장만 옮길 수 있습니다.");
  if (!toCode || isCustomOwnCode(toCode)) throw new PingToolError("점포평가에 등록된 매장을 골라 주세요.");
  const to = await ownLocation(toCode);
  if (!to) throw new PingToolError("점포평가에서 그 매장을 찾지 못했습니다.");
  const byOwn = async (code: string) => (await istore.list(PING_STORES, { where: [["ownCode", "==", code]] })).map((d) => toPingStore(d.id, d.data));
  const [rows, competitors, already] = await Promise.all([byOwn(fromCode), competitorOptions(toCode), byOwn(toCode)]);
  const key = (s: string) => s.replace(/\s/g, "").toLowerCase();
  const taken = new Set(already.map((s) => s.competitorId).filter(Boolean));
  const linked: string[] = [];
  const writes: StoreWrite[] = rows.map((s) => {
    const same = competitors.filter((c) => key(c.name) === key(s.name));
    const link = !s.competitorId && same.length === 1 && !taken.has(same[0].id) ? same[0] : null;
    if (link) {
      taken.add(link.id);
      linked.push(s.name);
    }
    return {
      op: "update" as const,
      c: PING_STORES,
      id: s.id,
      data: {
        ownCode: toCode,
        ownName: to.name,
        ...(link ? { competitorId: link.id, ...(s.distanceM == null && link.distanceM != null ? { distanceM: link.distanceM } : {}) } : {}),
        updatedAt: { __now: true },
        updatedBy: email,
      },
    };
  });
  await istore.commit(writes);
  return { moved: rows.length, linked, toName: to.name };
}

/** 주변 1km PC방(카카오, 이름 거름) + 수요거점(선택) + 이미 측정기에 있는 매장 표시. 좌표 또는 주소로. */
export async function pingNearby(input: { lat?: number | null; lng?: number | null; address?: string | null; demand?: boolean | null }) {
  let center: { lat: number; lng: number } | null = input.lat != null && input.lng != null ? { lat: Number(input.lat), lng: Number(input.lng) } : null;
  let geocoded: { roadAddress: string | null; jibunAddress: string | null } | null = null;
  if (!center && input.address?.trim()) {
    const g = await geocodeAddress(input.address.trim()).catch(() => null);
    if (!g) throw new PingToolError("주소로 위치를 못 찾았습니다.");
    center = { lat: g.lat, lng: g.lng };
    geocoded = { roadAddress: g.roadAddress, jibunAddress: g.jibunAddress };
  }
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) throw new PingToolError("기준 좌표나 주소가 필요합니다.");
  const origin = center;
  const [pc, stores] = await Promise.all([collectKakaoPcBangs(origin, PING_MAP_RADIUS_M), usesInternalStore() ? allStores() : Promise.resolve([] as PingStore[])]);
  const registered = stores.filter((s) => s.active && s.lat != null && s.lng != null);
  const near = (p: { lat: number; lng: number }) => registered.find((s) => haversineM(p, { lat: s.lat!, lng: s.lng! }) <= 40);
  const pcBangs = pc.places
    .filter((p) => judgePcBangName(p).counted)
    .map((p) => {
      const hit = near(p);
      return { id: p.id, name: p.name, address: p.address ?? "", lat: p.lat, lng: p.lng, distanceM: Math.round(p.distanceM ?? haversineM(origin, p)), registered: hit ? { id: hit.id, name: hit.name, own: hit.ownName ?? null } : null };
    })
    .sort((a, b) => a.distanceM - b.distanceM);
  let demandPoints: { id: string; name: string; category: string; lat: number; lng: number; distanceM: number }[] | undefined;
  if (input.demand) {
    const seen = new Set<string>();
    demandPoints = [];
    for (const t of DEMAND_POINT_TARGETS) {
      const radius = Math.min(t.radiusM, PING_MAP_RADIUS_M);
      const places = t.kind === "category" ? await searchByCategory(origin.lat, origin.lng, t.code, radius) : await searchByKeyword(origin.lat, origin.lng, t.keyword, radius);
      for (const p of places) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        demandPoints.push({ id: p.id, name: p.name, category: t.category, lat: p.lat, lng: p.lng, distanceM: Math.round(p.distanceM ?? haversineM(origin, p)) });
      }
    }
  }
  const registeredNear = registered
    .map((s) => ({ s, d: haversineM(origin, { lat: s.lat!, lng: s.lng! }) }))
    .filter((x) => x.d <= PING_MAP_RADIUS_M)
    .map(({ s, d }) => ({ id: s.id, name: s.name, own: s.ownName ?? null, isOwnStore: s.isOwnStore, lat: s.lat!, lng: s.lng!, distanceM: Math.round(d), status: storeStatus(s).label }));
  return { center: origin, geocoded, radiusM: PING_MAP_RADIUS_M, pcBangs, registered: registeredNear, demandPoints: demandPoints ?? null };
}
