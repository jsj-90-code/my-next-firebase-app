"use client";

// 매장별 비교 — 우리 매장(개점 매장만)과 그 경쟁점들의 가동률을 나란히 본다(2026-10-07 사용자 "가맹점명 누르면 비교 상세").
// 표: 오늘 · 최근 24시간 · 이번 주(월~일) · 최근 30일. 그래프: 우리 매장 + 측정 중인 경쟁점 전부, 매장마다 선 하나(사용자 2026-10-07).
// 경쟁점 합산은 뺐다(사용자 "합산은 딱히 쓸 데이터가 없다"). 체크를 풀면 그 선만 숨긴다.
// 색은 거리순 번호로 정해 숨겨도 남은 선 색이 안 바뀐다. 8색 팔레트(1번 우리 매장)라 경쟁점 8번째부터는 같은 색을 점선으로 다시 쓴다
// (2026-10-07 기준 8곳 넘는 매장은 김포구래 10곳뿐).

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  listPingDaily,
  listPingStoresByOwn,
} from "@/lib/pingMonitor/clientStore";
import {
  dateRangeLabel,
  denominator,
  formatPct,
  fullDayRate,
  fullDaysNote,
  hasNoIp,
  kstDaysAgo,
  lastFullDays,
  thisWeek,
  partialNote,
  rangeUtilization,
  recent24h,
  storeStatus,
  type PingDaily,
  type PingStore,
} from "@/lib/pingMonitor/summary";
import { LineChart, type LineSeries } from "../../LineChart";

/** 시간대별은 날짜 문서를 매장마다 하나씩 읽는다 — 최근 이만큼만. */
const HOURLY_MAX_DAYS = 92;
const RIVAL_COLORS = ["var(--pm-c2)", "var(--pm-c3)", "var(--pm-c4)", "var(--pm-c5)", "var(--pm-c6)", "var(--pm-c7)", "var(--pm-c8)"];
const PERIODS = [
  { key: "7", label: "이번 주(월~일)" },
  { key: "30", label: "최근 30일" },
  { key: "custom", label: "직접 고르기" },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  )
    out.push(d.toISOString().slice(0, 10));
  return out;
}
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** 시간대(0~23시)별 켜진 합 ÷ 대수 합 — 기간 안 잰 날들 전부(오늘·등록한 날 포함, 시간대끼리라 치우침 없음). */
function hourProfile(rowsList: PingDaily[][]): (number | null)[] {
  const a = Array(24).fill(0),
    t = Array(24).fill(0);
  for (const rows of rowsList)
    for (const row of rows)
      for (const [h, v] of Object.entries(row.hours)) {
        const i = Number(h);
        if (i >= 0 && i < 24 && v.t > 0) {
          a[i] += v.a;
          t[i] += v.t;
        }
      }
  return a.map((x, i) => (t[i] > 0 ? x / t[i] : null));
}

export default function PingOwnComparePage() {
  const { code } = useParams<{ code: string }>();
  const ownCode = decodeURIComponent(code);
  const { user } = useAuth();
  const [stores, setStores] = useState<PingStore[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("7");
  const [customFrom, setCustomFrom] = useState(lastFullDays(30).from);
  const [customTo, setCustomTo] = useState(lastFullDays(30).to);
  /** 그래프에서 숨긴 경쟁점 id. */
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hourlyLoaded, setHourlyLoaded] = useState<{
    key: string;
    byId: Record<string, PingDaily[]>;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listPingStoresByOwn(ownCode)
      .then((rows) => !cancelled && setStores(rows))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof Error ? err.message : "불러오지 못했습니다."),
      );
    return () => {
      cancelled = true;
    };
  }, [user, ownCode]);

  const today = kstDaysAgo(0);
  const r7 = thisWeek();
  const r30 = lastFullDays(30);
  const range =
    period === "custom"
      ? { from: customFrom, to: customTo }
      : period === "30"
        ? r30
        : r7;

  const own = useMemo(
    () => stores?.find((s) => s.isOwnStore) ?? null,
    [stores],
  );
  const rivals = useMemo(
    () =>
      (stores ?? [])
        .filter((s) => !s.isOwnStore)
        .sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9)),
    [stores],
  );
  const measured = useMemo(
    () => rivals.filter((s) => !hasNoIp(s) && s.active),
    [rivals],
  );
  /** 거리순 번호 → 색·선 모양. 7곳까지 서로 다른 색 실선, 8번째부터 같은 색 점선. */
  const lineOf = (s: PingStore) => {
    const i = measured.findIndex((m) => m.id === s.id);
    return { color: RIVAL_COLORS[i % RIVAL_COLORS.length], dashed: i >= RIVAL_COLORS.length };
  };
  const toggleHidden = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const shownStores = measured.filter((s) => !hidden.has(s.id));

  // 시간대별: 기간 시작 ~ 오늘(진행 중 포함). 우리 매장 + 측정 중인 경쟁점 전부.
  const hFrom =
    range.from < shiftDate(today, -(HOURLY_MAX_DAYS - 1))
      ? shiftDate(today, -(HOURLY_MAX_DAYS - 1))
      : range.from;
  const hourlyIds = useMemo(
    () =>
      [own, ...measured].filter((s): s is PingStore => !!s).map((s) => s.id),
    [own, measured],
  );
  const hourlyKey = `${hourlyIds.join(",")}|${hFrom}|${today}`;
  useEffect(() => {
    if (!user || hourlyIds.length === 0) return;
    let cancelled = false;
    Promise.all(
      hourlyIds.map((id) =>
        listPingDaily(id, hFrom, today).then((rows) => [id, rows] as const),
      ),
    )
      .then(
        (pairs) =>
          !cancelled &&
          setHourlyLoaded({ key: hourlyKey, byId: Object.fromEntries(pairs) }),
      )
      .catch(
        (err) =>
          !cancelled &&
          setError(
            err instanceof Error
              ? err.message
              : "시간대별 기록을 불러오지 못했습니다.",
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [user, hourlyKey, hourlyIds, hFrom, today]);
  const hourly = hourlyLoaded?.key === hourlyKey ? hourlyLoaded.byId : null;

  if (error)
    return (
      <p role="alert" className="app-notice app-badge-danger px-3 py-2 text-sm">
        {error}
      </p>
    );
  if (stores == null)
    return <p className="text-sm text-[var(--sl-ink-soft)]">불러오는 중...</p>;

  const name = stores[0]?.ownName ?? ownCode;
  const isCandidate = /^N\d+$/.test(ownCode);
  const dates = range.from <= range.to ? dateRange(range.from, range.to) : [];

  // 선 순서: 우리 매장 → 경쟁점(거리순).
  const buildSeries = (ownValues: () => (number | null)[], storeValues: (s: PingStore) => (number | null)[]): LineSeries[] => [
    ...(own ? [{ key: "own", label: "우리 매장", color: "var(--pm-c1)", values: ownValues() }] : []),
    ...shownStores.map((s) => ({ key: s.id, label: s.name, ...lineOf(s), values: storeValues(s) })),
  ];
  const daySeries = buildSeries(
    () => (own ? dates.map((d) => fullDayRate(own.days, d, today)) : []),
    (s) => dates.map((d) => fullDayRate(s.days, d, today)),
  );
  const anyDayValue = daySeries.some((s) => s.values.some((v) => v != null));

  const hourSeries = hourly
    ? buildSeries(
        () => (own ? hourProfile([hourly[own.id] ?? []]) : []),
        (s) => hourProfile([hourly[s.id] ?? []]),
      )
    : null;

  const cell = "px-3 py-2 text-right tabular-nums";
  const util = (v: number | null, note?: string) => (
    <td className={cell}>
      {formatPct(v)}
      {note && <div className="text-xs text-[var(--sl-ink-soft)]">{note}</div>}
    </td>
  );
  const rowFor = (s: PingStore) => {
    const t = rangeUtilization(s.days, today, today, { includePartial: true });
    const d7 = rangeUtilization(s.days, r7.from, r7.to);
    const d30 = rangeUtilization(s.days, r30.from, r30.to);
    return (
      <>
        {util(t.util, partialNote(t.samples, 1))}
        {util(recent24h(s.recent).util)}
        {util(d7.util, fullDaysNote(d7.days, 7))}
        {util(d30.util, fullDaysNote(d30.days, 30))}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/ping-monitor"
          className="text-xs text-[var(--sl-ink-soft)] hover:underline"
        >
          ← 목록
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">
          {name} · 경쟁점 가동률 비교
        </h1>
        <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
          {isCandidate ? "신규후보지" : "기존가맹점"} · 경쟁점 {rivals.length}
          곳(측정 중 {measured.length}곳)
          {!own &&
            (isCandidate
              ? " · 개점 전이라 우리 매장 값은 없습니다"
              : " · 우리 매장 IP가 없어 우리 매장 값은 없습니다")}
        </p>
      </div>

      <section className="app-card overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-[var(--sl-hairline)] text-left text-xs text-[var(--sl-ink-soft)]">
              <th className="px-3 py-2 font-medium">매장</th>
              <th className="px-3 py-2 text-right font-medium">거리</th>
              <th className="px-3 py-2 text-right font-medium">대수</th>
              <th className="px-3 py-2 text-right font-medium">
                오늘(진행 중)
                <div className="font-normal">
                  {dateRangeLabel(today, today)}
                </div>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                최근 24시간<div className="font-normal">&nbsp;</div>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                이번 주(월~일)
                <div className="font-normal">
                  {dateRangeLabel(r7.from, r7.to)}
                </div>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                최근 30일
                <div className="font-normal">
                  {dateRangeLabel(r30.from, r30.to)}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {own && (
              <tr className="border-b border-[var(--sl-hairline)] bg-black/[0.02] dark:bg-white/[0.03]">
                <td className="px-3 py-2 font-semibold">
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full"
                    style={{ background: "var(--pm-c1)" }}
                  />
                  <Link
                    href={`/ping-monitor/${own.id}`}
                    className="hover:underline"
                  >
                    우리 매장
                  </Link>
                </td>
                <td className={cell}>-</td>
                <td className={cell}>{denominator(own)}</td>
                {rowFor(own)}
              </tr>
            )}
            {rivals.map((s) => {
              const noIp = hasNoIp(s);
              const isShown = !noIp && !hidden.has(s.id);
              const line = noIp ? null : lineOf(s);
              return (
                <tr
                  key={s.id}
                  className={`border-b border-[var(--sl-hairline)] last:border-0 ${noIp ? "" : "cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"}`}
                  onClick={() => !noIp && toggleHidden(s.id)}
                  aria-selected={isShown}
                >
                  <td className="px-3 py-2">
                    {!noIp && (
                      <input
                        type="checkbox"
                        className="mr-1.5 align-middle"
                        checked={isShown}
                        onChange={() => toggleHidden(s.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`${s.name} 그래프에 그리기`}
                        style={{ accentColor: line?.color }}
                      />
                    )}
                    {line && (
                      <span
                        className={`mr-1.5 inline-block w-4 border-t-2 align-middle ${line.dashed ? "border-dashed" : ""}`}
                        style={{ borderColor: line.color, opacity: isShown ? 1 : 0.3 }}
                        aria-hidden
                      />
                    )}
                    <Link
                      href={`/ping-monitor/${s.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {s.name}
                    </Link>
                    {noIp ? (
                      <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                        IP 미등록
                      </span>
                    ) : (
                      storeStatus(s).tone !== "ok" && (
                        <span className="ml-2 text-xs text-[var(--sl-ink-soft)]">
                          {storeStatus(s).label}
                        </span>
                      )
                    )}
                  </td>
                  <td className={cell}>
                    {s.distanceM != null ? `${s.distanceM}m` : "-"}
                  </td>
                  <td className={cell}>
                    {noIp ? (s.pcCount ?? "-") : denominator(s)}
                  </td>
                  {noIp ? (
                    <td
                      colSpan={4}
                      className="px-3 py-2 text-right text-xs text-[var(--sl-ink-soft)]"
                    >
                      측정 안 함
                    </td>
                  ) : (
                    rowFor(s)
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-[var(--sl-hairline)] px-3 py-2 text-xs text-[var(--sl-ink-soft)]">
          측정 중인 경쟁점은 모두 아래 그래프에 선으로 그려집니다. 체크를 풀면 그 선만 숨깁니다.
          이름을 누르면 그 매장 상세 화면으로 갑니다.
        </p>
      </section>

      <section className="app-card flex flex-col gap-5 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`rounded-full px-3 py-1 text-xs ${period === p.key ? "app-btn-primary" : "app-btn-outline"}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
          {period === "custom" && (
            <label className="flex items-center gap-1 text-xs">
              <input
                type="date"
                className="app-input rounded-lg px-2 py-1"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              ~
              <input
                type="date"
                className="app-input rounded-lg px-2 py-1"
                value={customTo}
                min={customFrom}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
          )}
          <span className="ml-auto text-xs text-[var(--sl-ink-soft)]">
            {dateRangeLabel(range.from, range.to)}
          </span>
        </div>

        <div>
          <h2 className="mb-1 text-sm font-semibold">날짜별</h2>
          {anyDayValue ? (
            <LineChart
              series={daySeries}
              xLabels={dates.map((d) => d.slice(5).replace("-", "/"))}
              ariaLabel="날짜별 가동률 비교"
              tickEvery={Math.max(1, Math.ceil(dates.length / 10))}
            />
          ) : (
            <p className="text-xs text-[var(--sl-ink-soft)]">
              이 기간엔 꽉 찬 날(22시간 넘게 잰 날)이 아직 없습니다. 등록한 날은
              빼고, 다음 날부터 하루씩 쌓입니다.
            </p>
          )}
        </div>

        <div>
          <h2 className="mb-1 text-sm font-semibold">
            시간대별{" "}
            <span className="text-xs font-normal text-[var(--sl-ink-soft)]">
              ({dateRangeLabel(hFrom, today)} 잰 날들 평균, 오늘 포함)
            </span>
          </h2>
          {hourSeries == null ? (
            <p className="text-xs text-[var(--sl-ink-soft)]">불러오는 중...</p>
          ) : (
            <LineChart
              series={hourSeries}
              xLabels={Array.from({ length: 24 }, (_, h) => `${h}시`)}
              ariaLabel="시간대별 가동률 비교"
              tickEvery={3}
            />
          )}
        </div>
      </section>
    </div>
  );
}
