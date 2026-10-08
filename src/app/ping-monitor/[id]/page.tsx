"use client";

// 경쟁점 가동률 상세 — 기간 선택 · 날짜별 · 시간대별(전체/평일/주말) · 날짜별 표 · 수정. 2026-10-06 신설.

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getPingStore, listPingDaily, updatePingStore } from "@/lib/pingMonitor/clientStore";
import {
  FULL_DAY_MIN_SAMPLES,
  RECENT_MIN_HOURS,
  dateRangeLabel,
  denominator,
  formatPct,
  isFullDay,
  kstDaysAgo,
  lastFullDays,
  thisWeek,
  partialNote,
  rangeUtilization,
  recent24h,
  shortIps,
  storeStatus,
  type PingDaily,
  type PingStore,
} from "@/lib/pingMonitor/summary";
import { BarChart, type Bar } from "../BarChart";
import { StoreForm } from "../StoreForm";

/** 시간대별 그래프는 날짜 문서를 하나씩 읽는다 — 무료 요금제 읽기 한도 때문에 최근 이만큼만 본다. */
const HOURLY_MAX_DAYS = 92;
// 기간은 날짜(0~24시) 단위 — 오늘은 진행 중, n일은 오늘을 빼고 어제까지 다 찬 n일(2026-10-07 사용자). 전체만 오늘까지.
const PRESETS = [
  { key: "today", label: "오늘(진행 중)", days: 0 },
  { key: "1", label: "어제", days: 1 },
  { key: "7", label: "이번 주(월~일)", days: 7 },
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

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function PingStoreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [store, setStore] = useState<PingStore | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<string>("7");
  const [from, setFrom] = useState(thisWeek().from);
  const [to, setTo] = useState(thisWeek().to);
  const [dailyLoaded, setDailyLoaded] = useState<{ key: string; rows: PingDaily[] } | null>(null);
  const [dayFilter, setDayFilter] = useState<"all" | "weekday" | "weekend">("all");
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
      // "7"은 이번 주 월~일(2026-10-07 사용자), 나머지는 어제까지 다 찬 n일.
      const r = p.key === "7" ? thisWeek() : lastFullDays(p.days);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  const hourlyFrom = from < shiftDate(to, -(HOURLY_MAX_DAYS - 1)) ? shiftDate(to, -(HOURLY_MAX_DAYS - 1)) : from;

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
  const range = rangeUtilization(store.days, from, to, { includePartial: inProgress });
  const r24 = recent24h(store.recent);
  const dates = from <= to ? dateRange(from, to) : [];
  const dayBars: Bar[] = dates.map((d) => {
    const v = store.days[d];
    return {
      key: d,
      label: d.slice(5),
      value: v && v.t > 0 ? v.a / v.t : null,
      detail: v
        ? `${WEEKDAY[dayOfWeek(d)]}요일 · ${v.n}회 측정 · 평균 ${(v.a / v.n).toFixed(1)}대 켜짐${isFullDay(d, v, today) ? "" : " · 덜 참(평균에서 뺌)"}`
        : "기록 없음",
    };
  });

  const hourTotals = Array.from({ length: 24 }, () => ({ a: 0, t: 0, n: 0 }));
  for (const row of daily ?? []) {
    const dow = dayOfWeek(row.date);
    const weekend = dow === 0 || dow === 6;
    if (dayFilter === "weekday" && weekend) continue;
    if (dayFilter === "weekend" && !weekend) continue;
    for (const [h, v] of Object.entries(row.hours)) {
      const slot = hourTotals[Number(h)];
      if (!slot) continue;
      slot.a += v.a;
      slot.t += v.t;
      slot.n += 1;
    }
  }
  const hourBars: Bar[] = hourTotals.map((v, h) => ({
    key: String(h),
    label: String(h),
    value: v.t > 0 ? v.a / v.t : null,
    detail: v.n > 0 ? `${h}시 · ${v.n}일 평균 ${(v.a / v.n).toFixed(1)}대 켜짐` : "기록 없음",
  }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/ping-monitor" className="text-xs text-[var(--sl-ink-soft)] hover:underline">← 목록</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">{store.name}</h1>
          <span className={`app-badge ${TONE[status.tone]}`}>{status.label}</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--sl-ink-soft)]">
          {store.ownName ? `우리 매장 ${store.ownName}${store.distanceM != null ? ` · ${store.distanceM}m` : ""}` : "우리 매장 연결 안 됨"}
          <br />
          {[store.address, store.memo].filter(Boolean).join(" · ")}
          {store.address || store.memo ? <br /> : null}
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
        {store.ipCheck && (
          <p className="app-notice app-badge-warn mt-2 px-3 py-2 text-xs leading-5">
            <b>IP 확인 필요</b> — {store.ipCheck}
            <br />
            맞는 IP대역을 찾으면 아래 &ldquo;정보 수정&rdquo;에서 고쳐 저장하세요. IP대역을 바꾸면 이 표시는 사라집니다.
          </p>
        )}
      </div>

      <section className="app-card flex flex-col gap-4 rounded-2xl p-4">
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

        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <div className="text-xs text-[var(--sl-ink-soft)]">기간 가동률</div>
            <div className="text-3xl font-bold tabular-nums text-[#171310] dark:text-[#f2ede2]">{formatPct(range.util)}</div>
          </div>
          <div className="text-xs text-[var(--sl-ink-soft)]">
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
          </div>
          <div>
            <div className="text-xs text-[var(--sl-ink-soft)]">최근 24시간</div>
            <div className="text-xl font-semibold tabular-nums text-[#171310] dark:text-[#f2ede2]">{formatPct(r24.util)}</div>
            <div className="text-xs text-[var(--sl-ink-soft)]">
              {r24.util != null ? `시간대 ${r24.hours}/24칸` : `시간대 ${r24.hours}/24칸 — ${RECENT_MIN_HOURS}칸이 차면 값이 나옴`}
            </div>
          </div>
        </div>

        {dates.length > 1 && (
          <div>
            <h2 className="mb-1 text-sm font-semibold">날짜별</h2>
            <BarChart bars={dayBars} ariaLabel="날짜별 가동률" tickEvery={Math.max(1, Math.ceil(dates.length / 10))} />
          </div>
        )}

        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">시간대별</h2>
            {(["all", "weekday", "weekend"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`rounded-full px-2.5 py-0.5 text-xs ${dayFilter === k ? "app-btn-primary" : "app-btn-outline"}`}
                onClick={() => setDayFilter(k)}
              >
                {k === "all" ? "전체" : k === "weekday" ? "평일" : "주말"}
              </button>
            ))}
            {hourlyFrom !== from && (
              <span className="text-xs text-[var(--sl-ink-soft)]">최근 {HOURLY_MAX_DAYS}일({hourlyFrom}~)만 반영</span>
            )}
          </div>
          {daily == null ? (
            <p className="text-xs text-[var(--sl-ink-soft)]">불러오는 중...</p>
          ) : (
            <BarChart bars={hourBars} ariaLabel="시간대별 가동률" tickEvery={3} />
          )}
        </div>
      </section>

      {dates.length > 0 && (
        <details className="app-card rounded-2xl p-4">
          <summary className="cursor-pointer text-sm font-semibold">날짜별 표</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-[var(--sl-ink-soft)]">
                  <th className="py-1 pr-3 font-medium">날짜</th>
                  <th className="py-1 pr-3 text-right font-medium">측정</th>
                  <th className="py-1 pr-3 text-right font-medium">평균 켜짐</th>
                  <th className="py-1 text-right font-medium">가동률</th>
                </tr>
              </thead>
              <tbody>
                {[...dates].reverse().map((d) => {
                  const v = store.days[d];
                  return (
                    <tr key={d} className="border-t border-[var(--sl-hairline)]">
                      <td className="py-1 pr-3">
                        {d} ({WEEKDAY[dayOfWeek(d)]})
                        {v && !isFullDay(d, v, today) && <span className="ml-1 text-xs text-[var(--sl-ink-soft)]">덜 참 — 평균에서 뺌</span>}
                      </td>
                      <td className="py-1 pr-3 text-right">{v ? `${v.n}회` : "-"}</td>
                      <td className="py-1 pr-3 text-right">{v ? `${(v.a / v.n).toFixed(1)}대` : "-"}</td>
                      <td className="py-1 text-right">{formatPct(v && v.t > 0 ? v.a / v.t : null)}</td>
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
          </div>
        )}
      </section>
    </div>
  );
}
