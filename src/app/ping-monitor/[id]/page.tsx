"use client";

// 경쟁점 가동률 상세 — 기간 선택 · 날짜별 · 시간대별(전체/평일/주말) · 날짜별 표 · 수정. 2026-10-06 신설.

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { PingMapSection } from "../PingMap";
import { getPingStore, listPingDaily, updatePingStore } from "@/lib/pingMonitor/clientStore";
import { formatSurveyMemo } from "@/lib/pingMonitor/memoFormat";
import {
  FULL_DAY_MIN_SAMPLES,
  MEASURE_FAIL_MAX_UTIL,
  RECENT_MIN_HOURS,
  dateRangeLabel,
  denominator,
  capUtil,
  formatPct,
  isFullDay,
  kstDaysAgo,
  kstParts,
  lastFullDays,
  thisWeek,
  partialNote,
  rangeUtilization,
  recent24h,
  shortIps,
  storeStatus,
  type DayTotals,
  type PingDaily,
  type PingStore,
} from "@/lib/pingMonitor/summary";
import { BarChart, type Bar } from "../BarChart";
import { CsvButton, InfoTip, KpiRow, KpiTile, downloadCsv, ppDelta } from "../Kpi";
import { StoreForm } from "../StoreForm";

// 기간은 날짜(0~24시) 단위 — 오늘은 진행 중, n일은 오늘을 빼고 어제까지 다 찬 n일(2026-10-07 사용자). 전체만 오늘까지.
// "최근 4주"(어제까지 다 찬 28일)는 2026-11-15 아티팩트에서 옮김 — 요일이 4번씩 고르게 들어간다.
const PRESETS = [
  { key: "today", label: "오늘(진행 중)", days: 0 },
  { key: "1", label: "어제", days: 1 },
  { key: "7", label: "이번 주(월~일)", days: 7 },
  { key: "28", label: "최근 4주", days: 28 },
  { key: "30", label: "최근 30일", days: 30 },
  { key: "90", label: "최근 90일", days: 90 },
  { key: "all", label: "전체", days: null },
] as const;
const TONE: Record<string, string> = { ok: "app-badge-ok", warn: "app-badge-warn", danger: "app-badge-danger", neutral: "app-badge-neutral" };
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 지난 기간(2026-11-15 아티팩트 prevRange) — 이번 주는 7일 앞 월~일, 나머지는 바로 앞 같은 길이. */
function prevRange(preset: string, from: string, to: string): { from: string; to: string } {
  if (preset === "7") return { from: addDays(from, -7), to: addDays(to, -7) };
  const n = dateRange(from, to).length;
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

/** 그날이 평균에서 빠지는 까닭 — rangeUtilization(일일평균)과 같은 순서·같은 규칙. null이면 평균에 들어간 날. */
type DayExclusion = "port" | "partial" | "fail";
function dayExclusion(date: string, v: DayTotals, today: string, portSwitchDate: string | null): DayExclusion | null {
  if (portSwitchDate && date <= portSwitchDate) return "port";
  if (!isFullDay(date, v, today)) return "partial";
  if (v.a / v.t < MEASURE_FAIL_MAX_UTIL) return "fail";
  return null;
}
const EXCLUSION_NOTE: Record<DayExclusion, string> = {
  port: "포트 전환 전 — 뺌",
  partial: "덜 참 — 평균에서 뺌",
  fail: `${Math.round(MEASURE_FAIL_MAX_UTIL * 100)}% 미만 — 측정 실패로 뺌`,
};

/** 시간대별 칩 — 전체/평일/주말 또는 요일 하나(0=일 … 6=토). 평일·주말은 토·일 기준. */
type DayFilter = "all" | "weekday" | "weekend" | number;
const WEEKDAY_CHIPS = [1, 2, 3, 4, 5, 6, 0];

/** 시간대(0~23시)별 합 — 켜진 합(a)·대수 합(t)·잰 날 수(n). */
function hourTotalsOf(rows: PingDaily[], filter: DayFilter) {
  const out = Array.from({ length: 24 }, () => ({ a: 0, t: 0, n: 0 }));
  for (const row of rows) {
    const dow = dayOfWeek(row.date);
    const weekend = dow === 0 || dow === 6;
    if (filter === "weekday" && weekend) continue;
    if (filter === "weekend" && !weekend) continue;
    if (typeof filter === "number" && dow !== filter) continue;
    for (const [h, v] of Object.entries(row.hours)) {
      const slot = out[Number(h)];
      if (!slot) continue;
      slot.a += v.a;
      slot.t += v.t;
      slot.n += 1;
    }
  }
  return out;
}

export default function PingStoreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [store, setStore] = useState<PingStore | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<string>("7");
  const [from, setFrom] = useState(thisWeek().from);
  const [to, setTo] = useState(thisWeek().to);
  const [dailyLoaded, setDailyLoaded] = useState<{ key: string; rows: PingDaily[] } | null>(null);
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [compare, setCompare] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getPingStore(id)
      .then((row) => !cancelled && setStore(row))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "불러오지 못했습니다."));
    return () => {
      cancelled = true;
    };
  }, [user, id, version]);

  const firstDate = useMemo(() => {
    const dates = Object.keys(store?.days ?? {}).sort();
    return dates[0] ?? kstDaysAgo(0);
  }, [store]);

  function applyPreset(key: string) {
    setPreset(key);
    const p = PRESETS.find((x) => x.key === key);
    const today = kstDaysAgo(0);
    if (!p || p.days == null) {
      setFrom(firstDate);
      setTo(today);
    } else if (p.days === 0) {
      setFrom(today);
      setTo(today);
    } else {
      // "7"은 이번 주 월~일(2026-10-07 사용자), 나머지("28" 포함)는 어제까지 다 찬 n일.
      const r = p.key === "7" ? thisWeek() : lastFullDays(p.days);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  // 시간대별도 고른 기간 전체를 읽는다(2026-10-23 사용자) — 92일 제한은 무료 요금제 시절 것. 종량제라 1년 치 365건 읽어도 1원 남짓.
  const hourlyFrom = from;

  const storeId = store?.id ?? null;
  const dailyKey = storeId ? `${storeId}|${hourlyFrom}|${to}|${version}` : null;
  useEffect(() => {
    if (!user || !storeId || !dailyKey || hourlyFrom > to) return;
    let cancelled = false;
    listPingDaily(storeId, hourlyFrom, to)
      .then((rows) => !cancelled && setDailyLoaded({ key: dailyKey, rows }))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "시간대별 기록을 불러오지 못했습니다."));
    return () => {
      cancelled = true;
    };
  }, [user, storeId, dailyKey, hourlyFrom, to]);
  const daily = dailyLoaded && dailyLoaded.key === dailyKey ? dailyLoaded.rows : null;

  if (error) return <p role="alert" className="app-notice app-badge-danger px-3 py-2 text-sm">{error}</p>;
  if (store === undefined) return <p className="text-sm text-[var(--sl-ink-soft)]">불러오는 중...</p>;
  if (store === null)
    return (
      <p className="text-sm">
        없는 경쟁점입니다. <Link href="/ping-monitor" className="underline">목록으로</Link>
      </p>
    );

  const status = storeStatus(store);
  const today = kstDaysAgo(0);
  // 오늘 하루만 고르면 진행 중인 값을 그대로, 그 밖엔 다 찬 날의 일일평균(2026-10-07 사용자).
  const inProgress = from === today && to === today;
  // 목록과 같은 규칙 — 포트 전환 날·그 이전은 빼고(excludeUpTo), 100% 초과는 화면에서 자른다(2026-10-10 정밀점검: 상세만 값이 달랐다).
  // 오늘(진행 중)은 포트 바꾼 날이어도 그대로 보인다(2026-10-10 최종점검 — 전환 당일 "오늘"이 "-"로 나왔다).
  const range = rangeUtilization(store.days, from, to, { includePartial: inProgress, excludeUpTo: inProgress ? null : store.portSwitchDate });
  // "다 찬 날" 칸은 오늘(진행 중)을 골라도 일일평균 규칙으로 센다 — 오늘은 덜 찬 날로 빠진다.
  const fullRange = inProgress ? rangeUtilization(store.days, from, to, { excludeUpTo: store.portSwitchDate }) : range;
  const r24 = recent24h(store.recent);
  const dates = from <= to ? dateRange(from, to) : [];
  const rawRate = (d: string): number | null => {
    const v = store.days[d];
    return v && v.t > 0 ? capUtil(v.a / v.t) : null;
  };
  // 오늘 진행 중이면 오늘을 그대로(포트 전환 날이어도 — 위 range와 같은 규칙), 아니면 평균에 들어간 날만.
  const exclusionOf = (d: string): DayExclusion | null => {
    const v = store.days[d];
    if (!v) return null;
    if (inProgress && d === today) return null;
    return dayExclusion(d, v, today, store.portSwitchDate);
  };
  const usedDates = dates.filter((d) => store.days[d] && store.days[d].n > 0 && store.days[d].t > 0 && exclusionOf(d) == null);
  const avgOn = usedDates.length ? usedDates.reduce((s, d) => s + store.days[d].a / store.days[d].n, 0) / usedDates.length : null;
  const sparkValues = dates.map((d) => (store.days[d] && isFullDay(d, store.days[d], today) && exclusionOf(d) == null ? rawRate(d) : null));

  // 지난 기간 — store.days만으로 계산(Firestore 추가 읽기 없음). 오늘(진행 중)은 비교하지 않는다.
  const prev = inProgress || dates.length === 0 ? null : prevRange(preset, from, to);
  const prevUtil = prev ? capUtil(rangeUtilization(store.days, prev.from, prev.to, { excludeUpTo: store.portSwitchDate }).util) : null;
  const prevDates = prev ? dateRange(prev.from, prev.to) : [];
  const periodUtil = capUtil(range.util);

  const dayBars: Bar[] = dates.map((d, i) => {
    const v = store.days[d];
    const ex = exclusionOf(d);
    return {
      key: d,
      label: d.slice(5),
      value: rawRate(d),
      faint: v ? !isFullDay(d, v, today) : false,
      prev: compare && prevDates[i] ? rawRate(prevDates[i]) : undefined,
      detail: v
        ? `${WEEKDAY[dayOfWeek(d)]}요일 · ${v.n}회 측정 · 평균 ${(v.a / v.n).toFixed(1)}대 켜짐${ex ? ` · ${EXCLUSION_NOTE[ex]}` : ""}`
        : "기록 없음",
    };
  });

  // 가장 붐비는 시간 — 기간 안 잰 날 전체(오늘·덜 찬 날 포함)의 시간대별 평균 중 가장 높은 시각.
  const hourAll = daily ? hourTotalsOf(daily, "all") : null;
  let peak: { h: number; util: number; n: number; on: number } | null = null;
  for (const [h, v] of (hourAll ?? []).entries()) {
    if (!(v.t > 0)) continue;
    const util = v.a / v.t;
    if (!peak || util > peak.util) peak = { h, util, n: v.n, on: v.a / v.n };
  }

  // 시간대별 — PC방은 밤이 길어 6시부터 다음 날 5시 순서로(2026-11-15 아티팩트). 오늘이 기간에 들면 지금 시각을 진하게.
  const hourTotals = daily ? (dayFilter === "all" ? hourAll! : hourTotalsOf(daily, dayFilter)) : [];
  const nowHour = Number(kstParts(new Date()).hour);
  const liveRange = from <= today && today <= to;
  const hourBars: Bar[] = Array.from({ length: 24 }, (_, i) => (i + 6) % 24).map((h) => {
    const v = hourTotals[h] ?? { a: 0, t: 0, n: 0 };
    return {
      key: String(h),
      label: `${h}시`,
      value: v.t > 0 ? capUtil(v.a / v.t) : null,
      highlight: liveRange && h === nowHour,
      detail: v.n > 0 ? `${v.n}일 평균 ${(v.a / v.n).toFixed(1)}대 켜짐` : "기록 없음",
    };
  });

  const exportCsv = () => {
    downloadCsv(`${store.name}_날짜별_${from}_${to}.csv`, [
      ["날짜", "요일", "측정 횟수", "평균 켜짐", "가동률(%)", "다 찬 날"],
      ...dates.map((d) => {
        const v = store.days[d];
        const r = rawRate(d);
        return [d, WEEKDAY[dayOfWeek(d)], v ? v.n : "", v && v.n > 0 ? (v.a / v.n).toFixed(1) : "", r != null ? (r * 100).toFixed(1) : "", v && isFullDay(d, v, today) ? "Y" : ""];
      }),
    ]);
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/ping-monitor" className="text-xs text-[var(--sl-ink-soft)] hover:underline">← 목록</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">{store.name}</h1>
          <span className={`app-badge ${TONE[status.tone]}`} title={status.hint}>{status.label}</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--sl-ink-soft)]">
          {store.ownName ? `우리 매장 ${store.ownName}${store.distanceM != null ? ` · ${store.distanceM}m` : ""}` : "우리 매장 연결 안 됨"}
          <br />
          {store.address}
          {store.address ? <br /> : null}
          IP대역 <span className="font-mono">{store.ipRanges}</span> · IP {store.ipCount}개 · 대수 {denominator(store)}대
          {store.pcCount ? "" : "(IP 개수)"}
        </p>
        {store.lastSample && (
          <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
            최근 측정 {store.lastSample.date} {store.lastSample.hour}시 — 응답 IP {store.lastSample.alive}개 / 기준 대수 {store.lastSample.total}대
            {store.lastSample.aliveIps.length > 0 ? ` (${shortIps(store.lastSample.aliveIps)})` : ""}
            {store.lastSample.method && <><br />검사 방식: {store.lastSample.method === "icmp+tcp+timestamp" ? "핑 · TCP · 타임스탬프" : store.lastSample.method === "icmp+tcp" ? "핑 · TCP" : store.lastSample.method === "tcp" ? "TCP" : "서버 측정"}</>}
            {store.lastSample.alive === 0 && <><br />응답이 없습니다. 실제 가동률 0%를 뜻하지는 않습니다.</>}
          </p>
        )}
        {/* 실측이 떠서 "측정 중"이면 낡은 메모 경고는 숨긴다 — 상태 배지와 같은 판정(2026-10-10). */}
        {store.ipCheck && status.tone !== "ok" && (
          <p className="app-notice app-badge-warn mt-2 px-3 py-2 text-xs leading-5">
            <b>IP 확인 필요</b> — {store.ipCheck}
            <br />
            맞는 IP대역을 찾으면 아래 &ldquo;정보 수정&rdquo;에서 고쳐 저장하세요. IP대역을 바꾸면 이 표시는 사라집니다.
          </p>
        )}
        {store.memo && <MemoBlock memo={store.memo} header={memoHeader(store)} />}
      </div>

      {/* 2026-10-16 점포팀 요청 — 이 경쟁점 기준 반경 1km 주변 지도(우리 매장·같은 매장의 다른 경쟁점 함께). */}
      <PingMapSection ownCode={store.ownCode} ownName={store.ownName} selfId={store.id} getToken={async () => { if (!user) throw new Error("로그인이 필요합니다."); return user.getIdToken(); }} />

      <section className="app-card flex flex-col gap-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-end gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`rounded-full px-3 py-1 text-xs ${preset === p.key ? "app-btn-primary" : "app-btn-outline"}`}
              onClick={() => applyPreset(p.key)}
            >
              {p.label}
              {p.days != null && (
                <span className="ml-1 opacity-70">
                  {p.days === 0
                    ? dateRangeLabel(kstDaysAgo(0), kstDaysAgo(0))
                    : p.key === "7"
                      ? dateRangeLabel(thisWeek().from, thisWeek().to)
                      : dateRangeLabel(lastFullDays(p.days).from, lastFullDays(p.days).to)}
                </span>
              )}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1 text-xs">
            <input type="date" className="app-input rounded-lg px-2 py-1" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPreset(""); }} />
            ~
            <input type="date" className="app-input rounded-lg px-2 py-1" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPreset(""); }} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--sl-ink-soft)]">
          <span>
            {inProgress ? (
              <>
                {from} 진행 중 · 측정 {range.samples}회{partialNote(range.samples, 1) && ` (${partialNote(range.samples, 1)}라 시간대 치우침이 있을 수 있음)`}
              </>
            ) : (
              <>
                {from} ~ {to} · 다 찬 날 {range.days}일의 일일평균
                {range.skipped > 0 && ` · ${FULL_DAY_MIN_SAMPLES}시간 못 잰 날·오늘 ${range.skipped}일은 뺌`}
              </>
            )}
          </span>
          {prev && (
            <label className="ml-auto flex items-center gap-1.5">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              지난 기간 겹쳐 보기 <span className="opacity-70">({dateRangeLabel(prev.from, prev.to)})</span>
            </label>
          )}
        </div>
      </section>

      <KpiRow>
        <KpiTile
          label="기간 가동률"
          tip={
            inProgress
              ? "오늘 0시부터 지금까지 켜진 합 ÷ 대수 합(진행 중이라 시간대가 치우칠 수 있음)."
              : `다 찬 날(하루 ${FULL_DAY_MIN_SAMPLES}시간 이상 잰 날)의 하루 가동률 평균(일일평균). 옆 증감은 바로 앞 같은 길이 기간과의 차이입니다.`
          }
          value={formatPct(periodUtil)}
          delta={periodUtil != null && prevUtil != null ? ppDelta(periodUtil - prevUtil) : null}
          note={avgOn != null ? `≈${Math.round(avgOn)}대 켜짐${prevUtil != null ? ` · 지난 기간 ${formatPct(prevUtil)}` : ""}` : prevUtil != null ? `지난 기간 ${formatPct(prevUtil)}` : ""}
          spark={dates.length > 1 ? sparkValues : undefined}
        />
        <KpiTile
          label="최근 24시간"
          tip={`지금부터 거꾸로 24시간의 시간대 칸을 합친 값입니다. ${RECENT_MIN_HOURS}칸 이상 차야 값이 나옵니다.`}
          value={formatPct(r24.util)}
          note={r24.util != null ? `시간대 ${r24.hours}/24칸` : `시간대 ${r24.hours}/24칸 — ${RECENT_MIN_HOURS}칸이 차면 값이 나옴`}
        />
        <KpiTile
          label="가장 붐비는 시간"
          tip="기간 안 잰 날들의 시간대별 평균 중 가장 높은 시간입니다(오늘·덜 찬 날 포함)."
          value={peak ? `${peak.h}시` : "-"}
          note={daily == null ? "불러오는 중..." : peak ? `${formatPct(capUtil(peak.util))} · ${peak.n}일 평균 ${peak.on.toFixed(1)}대` : "기록 없음"}
        />
        <KpiTile
          label="다 찬 날"
          tip={`${FULL_DAY_MIN_SAMPLES}시간 이상 잰 날만 평균에 넣습니다. 덜 잰 날(등록한 날·서버 장애)·오늘은 뺍니다.`}
          value={String(fullRange.days)}
          unit={`/ ${dates.length}일`}
          note={fullRange.skipped ? `덜 찬 날·뺀 날 ${fullRange.skipped}일` : "빠진 날 없음"}
        />
      </KpiRow>

      <section className="app-card min-w-0 rounded-2xl p-4">
          <div className="mb-1 flex flex-wrap items-center gap-x-2">
            <h2 className="flex items-center text-sm font-semibold">
              날짜별
              <InfoTip label="날짜별" text="막대 하나가 하루 가동률입니다. 옅은 막대는 덜 찬 날(평균에서 뺌), 빈 칸은 기록이 없는 날입니다. 막대를 누르면 그 하루로 기간을 바꿉니다." />
            </h2>
            {compare && prev && <span className="text-xs text-[var(--sl-ink-soft)]">점선 테두리 = 지난 기간</span>}
          </div>
          {dates.length > 1 ? (
            <BarChart
              bars={dayBars}
              ariaLabel="날짜별 가동률"
              tickEvery={Math.max(1, Math.ceil(dates.length / 10))}
              onPick={(b) => { setFrom(b.key); setTo(b.key); setPreset(""); }}
            />
          ) : (
            <p className="text-xs text-[var(--sl-ink-soft)]">하루만 고른 기간입니다 — 시간대별을 보세요.</p>
          )}
      </section>

      <section className="app-card min-w-0 rounded-2xl p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="flex items-center text-sm font-semibold">
            시간대별
            <InfoTip label="시간대별" text="시간대별 평균 가동률입니다. PC방은 밤이 길어 6시부터 다음 날 5시 순서로 그렸습니다. 진한 막대는 지금 시각(오늘이 기간에 들 때)입니다. 평일·주말은 토·일 기준입니다." />
          </h2>
          <div className="flex flex-wrap gap-1" role="group" aria-label="요일">
            {(["all", "weekday", "weekend", ...WEEKDAY_CHIPS] as DayFilter[]).map((k) => (
              <button
                key={String(k)}
                type="button"
                aria-pressed={dayFilter === k}
                className={`rounded-full px-2.5 py-0.5 text-xs ${dayFilter === k ? "app-btn-primary" : "app-btn-outline"}`}
                onClick={() => setDayFilter(k)}
              >
                {k === "all" ? "전체" : k === "weekday" ? "평일" : k === "weekend" ? "주말" : WEEKDAY[k]}
              </button>
            ))}
          </div>
        </div>
        {daily == null ? (
          <p className="text-xs text-[var(--sl-ink-soft)]">불러오는 중...</p>
        ) : hourBars.every((b) => b.value == null) ? (
          <p className="text-xs text-[var(--sl-ink-soft)]">이 기간·요일엔 측정 기록이 없습니다.</p>
        ) : (
          <BarChart bars={hourBars} ariaLabel="시간대별 가동률" tickEvery={3} />
        )}
      </section>

      {dates.length > 0 && (
        <details className="app-card rounded-2xl p-4">
          <summary className="cursor-pointer text-sm font-semibold">날짜별 표 ({dates.length}일)</summary>
          <div className="mt-2">
            <CsvButton onClick={exportCsv} />
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-[var(--sl-ink-soft)]">
                  <th className="py-1 pr-3 font-medium">날짜</th>
                  <th className="py-1 pr-3 text-right font-medium">측정</th>
                  <th className="py-1 pr-3 text-right font-medium">평균 켜짐</th>
                  <th className="py-1 pr-3 text-right font-medium">가동률</th>
                  <th className="py-1 font-medium">비고</th>
                </tr>
              </thead>
              <tbody>
                {[...dates].reverse().map((d) => {
                  const v = store.days[d];
                  const ex = exclusionOf(d);
                  return (
                    <tr key={d} className="border-t border-[var(--sl-hairline)]">
                      <td className="whitespace-nowrap py-1 pr-3">
                        {d} ({WEEKDAY[dayOfWeek(d)]})
                      </td>
                      <td className="py-1 pr-3 text-right">{v ? `${v.n}회` : "-"}</td>
                      <td className="py-1 pr-3 text-right">{v ? `${(v.a / v.n).toFixed(1)}대` : "-"}</td>
                      <td className="py-1 pr-3 text-right">{formatPct(rawRate(d))}</td>
                      <td className="py-1 text-xs text-[var(--sl-ink-soft)]">{ex ? EXCLUSION_NOTE[ex] : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <section className="app-card rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">정보 수정 · 지금 확인</h2>
          <button type="button" className="app-btn-outline rounded-lg px-3 py-1 text-xs" onClick={() => { setEditing((v) => !v); setSaved(false); }}>
            {editing ? "닫기" : "열기"}
          </button>
        </div>
        {saved && <p className="mt-2 text-xs text-[var(--sl-ink-soft)]">저장했습니다.</p>}
        {editing && (
          <div className="mt-3">
            <StoreForm
              initial={store}
              selfId={store.id}
              showActive
              submitLabel="저장"
              onSubmit={async (input) => {
                await updatePingStore(store.id, input, user?.email ?? null, {
                  clearIpCheck: input.ipRanges.replace(/\s/g, "") !== store.ipRanges.replace(/\s/g, ""),
                });
                setSaved(true);
                setEditing(false);
                setVersion((v) => v + 1);
              }}
            />
            {/* 2026-10-24 사용자 "경쟁점 삭제 버튼" — 잘못 넣은 등록을 측정 기록째 지운다. 수정 칸 안에 둬서 고치러 들어온 사람만 본다(사용자 10-24). */}
            {!store.isOwnStore && (
              <div className="mt-4 border-t border-[var(--sl-hairline)] pt-3">
                <p className="text-xs text-[var(--sl-ink-soft)]">
                  잘못 넣었거나 두 번 들어간 등록이면 지웁니다. 측정 기록({Object.keys(store.days ?? {}).length}일 치)도 같이 지워집니다.
                  폐업 등으로 측정만 멈추려면 지우지 말고 위 &ldquo;1시간마다 측정&rdquo;을 끄고 저장하세요.
                </p>
                {deleteError && <p className="app-notice app-badge-danger mt-2 px-3 py-2 text-xs">{deleteError}</p>}
                <button
                  type="button"
                  className="mt-2 text-xs text-[var(--sl-danger)] underline disabled:opacity-50"
                  disabled={deleting || !user}
                  onClick={async () => {
                    const days = Object.keys(store.days ?? {}).length;
                    if (!window.confirm(`"${store.name}"을(를) 측정기에서 지울까요?${days ? ` 측정 기록 ${days}일 치도 같이 지워집니다.` : ""}`)) return;
                    setDeleting(true);
                    setDeleteError(null);
                    try {
                      const token = await user!.getIdToken();
                      const res = await fetch("/api/ping-monitor/delete", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: store.id }) });
                      const body = (await res.json().catch(() => ({}))) as { error?: string };
                      if (!res.ok) throw new Error(body.error ?? "지우지 못했습니다.");
                      router.push("/ping-monitor");
                    } catch (err) {
                      setDeleteError(err instanceof Error ? err.message : "지우지 못했습니다.");
                      setDeleting(false);
                    }
                  }}
                >
                  {deleting ? "지우는 중..." : "이 경쟁점 삭제"}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

    </div>
  );
}

// 2026-10-16 점포팀 요청 — 조사 메모를 다우 심사요청에 붙여넣는다. 주소와 한 줄로 이어 붙이던 걸 떼어 줄바꿈대로 보이고,
// 복사 버튼은 화면에 보이는 그대로(옛 한 줄 메모는 양식 모양으로 나눈 것) 클립보드에 넣는다.
// 메모에 매장명이 없으면(조사 양식 버튼으로 쓴 새 메모) 기본정보(상호·주소·IP·대수)를 맨 위에 붙인다 — 사용자 10-16.
function memoHeader(store: PingStore): string {
  return [`- 매장명 : ${[store.name, store.address].filter(Boolean).join(" , ")}`, store.ipRanges, `- 전체 대수 : ${denominator(store)}대`].filter(Boolean).join("\n");
}

function MemoBlock({ memo, header }: { memo: string; header: string }) {
  const body = formatSurveyMemo(memo);
  const text = /매장명/.test(body) ? body : `${header}\n\n${body}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="app-card mt-3 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--sl-ink-soft)]">조사 메모</span>
        <button
          type="button"
          className="app-btn-outline rounded-lg px-3 py-1 text-xs"
          onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => setCopied(false))}
        >
          {copied ? "복사됨" : "메모 복사"}
        </button>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{text}</p>
    </div>
  );
}
