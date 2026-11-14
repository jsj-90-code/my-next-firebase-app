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
import { PingMapSection } from "../../PingMap";
import {
  isCustomCandidateCode,
  isCustomOwnCode,
  listPingDaily,
  listPingStoresByOwn,
} from "@/lib/pingMonitor/clientStore";
import { TransferOwnPanel } from "./TransferOwnPanel";
import { OwnIpPanel } from "./OwnIpPanel";
import {
  dateRangeLabel,
  denominator,
  formatPct,
  fullDayRuleText,
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
  statusShowsValues,
  byMeasuredThenDistance,
  capUtil,
  type PingDaily,
  type PingStore,
} from "@/lib/pingMonitor/summary";
import { LineChart, type LineSeries } from "../../LineChart";
import { CsvButton, InfoTip, KpiRow, KpiTile, downloadCsv, ppDelta } from "../../Kpi";

// 2026-11-15 아티팩트(claude.ai 측정기 「상권 비교」)에서 옮김: 요약 타일 4개 · 시간대별 전체/평일/주말 ·
// 표에 「고른 기간」「피크」 칸 · 우리 매장도 체크로 숨기기 · CSV 받기. 계산 규칙은 그대로(rangeUtilization·capUtil·포트 전환 날 제외).
// 「매장 × 시간」 칸표는 사용자 요청으로 넣지 않음(색 진하기로 읽는 표가 보기 어렵다, 2026-11-15).

const HOUR_CHIPS = [
  { key: "all", label: "전체" },
  { key: "weekday", label: "평일" },
  { key: "weekend", label: "주말" },
] as const;
type HourChip = (typeof HOUR_CHIPS)[number]["key"];
/** 토·일 — 한국 날짜(YYYY-MM-DD) 기준. 공휴일은 안 넣는다(아티팩트와 같게). */
function isWeekendDate(date: string): boolean {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
}
function filterByChip(rows: PingDaily[], chip: HourChip): PingDaily[] {
  if (chip === "all") return rows;
  return rows.filter((r) => isWeekendDate(r.date) === (chip === "weekend"));
}
/** 시간대 프로필에서 가장 높은 시각. */
function peakOf(profile: (number | null)[]): { hour: number; util: number } | null {
  let best: { hour: number; util: number } | null = null;
  profile.forEach((v, hour) => {
    if (v != null && (best == null || v > best.util)) best = { hour, util: v };
  });
  return best;
}
/** "확인 필요" — 아티팩트 needsCheck와 같은 판정(측정 중·중지류가 아니고 IP 미등록도 아닌 것). */
function needsCheck(s: PingStore): boolean {
  const st = storeStatus(s);
  return st.tone !== "ok" && st.tone !== "neutral" && st.kind !== "noIp";
}
const csvPct = (v: number | null) => (v == null ? "" : (v * 100).toFixed(1));

/** 값을 보여줄 매장 — 측정 중 또는 과응답(측정기 목록 page.tsx의 muted 규칙과 같다). */
function showsValues(s: PingStore): boolean {
  if (hasNoIp(s) || !s.active) return false;
  return statusShowsValues(storeStatus(s));
}

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
  /** 표에서 마우스를 올린 매장 — 그래프에서 그 선만 진하게(2026-10-26). 우리 매장은 "own". */
  const [rowHover, setRowHover] = useState<string | null>(null);
  /** 시간대별 그래프의 요일 고르기(전체·평일·주말). */
  const [hourChip, setHourChip] = useState<HourChip>("all");
  /** 우리 매장 IP를 등록하면 올려서 목록을 다시 읽는다(2026-10-28). */
  const [reloadKey, setReloadKey] = useState(0);
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
  }, [user, ownCode, reloadKey]);

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
        .sort(byMeasuredThenDistance), // 측정기 목록과 같은 순서(2026-10-14)
    [stores],
  );
  const measured = useMemo(
    // 화면 목록과 같은 판정(storeStatus) — IP만 있으면 "측정 중"으로 세던 것을 고침(2026-10-10).
    // 과응답은 값이 있으니 그래프·표엔 넣고(100% 상한), "측정 중 N곳" 수엔 안 센다.
    () => rivals.filter((s) => showsValues(s)),
    [rivals],
  );
  const measuringCount = rivals.filter((s) => storeStatus(s).tone === "ok").length;
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
  // 92일 제한은 2026-10-23에 풀었다(무료 요금제 시절 것, 종량제라 읽기 비용이 몇 원).
  const hFrom = range.from;
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
  const isCandidate = /^N\d+$/.test(ownCode) || isCustomCandidateCode(ownCode);
  const dates = range.from <= range.to ? dateRange(range.from, range.to) : [];

  // 선 순서: 우리 매장 → 경쟁점(거리순). 우리 매장도 체크로 숨길 수 있다(숨김 키 "own").
  const ownShown = !!own && !hidden.has("own");
  const buildSeries = (ownValues: () => (number | null)[], storeValues: (s: PingStore) => (number | null)[]): LineSeries[] => [
    ...(own && ownShown ? [{ key: "own", label: "우리 매장", color: "var(--pm-c1)", values: ownValues() }] : []),
    ...shownStores.map((s) => ({ key: s.id, label: s.name, ...lineOf(s), values: storeValues(s) })),
  ];
  const daySeries = buildSeries(
    () => (own ? dates.map((d) => fullDayRate(own.days, d, today)) : []),
    (s) => dates.map((d) => fullDayRate(s.days, d, today)),
  );
  const anyDayValue = daySeries.some((s) => s.values.some((v) => v != null));

  // 시간대 프로필 — 이미 읽은 날짜별 시간 기록을 요일로 거르기만 한다(추가 읽기 없음).
  const profileOf = (id: string, chip: HourChip) =>
    hourly ? hourProfile([filterByChip(hourly[id] ?? [], chip)]) : null;
  const hourSeries = hourly
    ? buildSeries(
        () => (own ? (profileOf(own.id, hourChip) ?? []) : []),
        (s) => profileOf(s.id, hourChip) ?? [],
      )
    : null;

  // 매장별 값 — 측정기 목록과 같은 규칙(2026-10-10): 측정 안 되는 매장은 null, 100% 초과는 100%로, 포트 전환 날 이전은 평균에서 뺀다.
  // 「고른 기간」은 위 기간 버튼(이번 주/최근 30일/직접)과 같은 범위, 다 찬 날만의 일일평균.
  const statsOf = (s: PingStore) => {
    if (!showsValues(s)) return null;
    const t = rangeUtilization(s.days, today, today, { includePartial: true });
    const d7 = rangeUtilization(s.days, r7.from, r7.to, { excludeUpTo: s.portSwitchDate });
    const d30 = rangeUtilization(s.days, r30.from, r30.to, { excludeUpTo: s.portSwitchDate });
    const p = rangeUtilization(s.days, range.from, range.to, { excludeUpTo: s.portSwitchDate });
    return {
      today: capUtil(t.util),
      todaySamples: t.samples,
      r24: capUtil(recent24h(s.recent).util),
      d7: capUtil(d7.util),
      d7Days: d7.days,
      d30: capUtil(d30.util),
      d30Days: d30.days,
      period: capUtil(p.util),
      periodDays: p.days,
    };
  };
  const ownStats = own ? statsOf(own) : null;
  const rivalStats = new Map(rivals.map((s) => [s.id, statsOf(s)] as const));

  // 요약 타일
  const rivalPeriod = measured
    .map((s) => ({ s, v: rivalStats.get(s.id)?.period ?? null }))
    .filter((x): x is { s: PingStore; v: number } => x.v != null);
  const rivalAvg = rivalPeriod.length ? rivalPeriod.reduce((a, x) => a + x.v, 0) / rivalPeriod.length : null;
  const busiest = rivalPeriod.reduce<{ s: PingStore; v: number } | null>((b, x) => (b == null || x.v > b.v ? x : b), null);
  const noIpCount = rivals.filter((s) => hasNoIp(s)).length;
  const checkCount = rivals.filter(needsCheck).length;
  const periodLabel = dateRangeLabel(range.from, range.to);

  const exportCsv = () => {
    const head = ["매장", "거리m", "대수", "상태", "오늘", "이번주", "최근30일", "고른기간"];
    const line = (label: string, s: PingStore, isOwn: boolean) => {
      const st = isOwn ? ownStats : rivalStats.get(s.id);
      const noIp = hasNoIp(s);
      return [
        label,
        isOwn ? "" : (s.distanceM ?? ""),
        noIp ? (s.pcCount ?? "") : denominator(s),
        storeStatus(s).label,
        csvPct(st?.today ?? null),
        csvPct(st?.d7 ?? null),
        csvPct(st?.d30 ?? null),
        csvPct(st?.period ?? null),
      ];
    };
    downloadCsv(`${name}_상권비교_${range.from}_${range.to}.csv`, [
      head,
      ...(own ? [line("우리 매장", own, true)] : []),
      ...rivals.map((s) => line(s.name, s, false)),
    ]);
  };
  const peakCell = (id: string | null) => {
    if (!id || !hourly) return <td className={cell}>{hourly ? "-" : "…"}</td>;
    const pk = peakOf(profileOf(id, "all") ?? []);
    return <td className={cell}>{pk ? `${pk.hour}시 ${formatPct(pk.util, 0)}` : "-"}</td>;
  };

  // 표는 한 줄로(2026-10-10 사용자) — 꼬리말은 값 옆에, 칸은 줄바꿈 안 함(좁으면 가로 스크롤).
  const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  const util = (v: number | null, note?: string) => (
    <td className={cell}>
      {formatPct(v)}
      {note && <span className="ml-1 text-xs text-[var(--sl-ink-soft)]">{note}</span>}
    </td>
  );
  // 측정기 목록과 같은 규칙(2026-10-10): 측정 안 되는 매장은 "-", 100% 초과는 100%로, 포트 전환 날 이전은 평균에서 뺀다.
  const rowFor = (s: PingStore, isOwn: boolean) => {
    const st = isOwn ? ownStats : rivalStats.get(s.id);
    if (!st) return <>{util(null)}{util(null)}{util(null)}{util(null)}{util(null)}{peakCell(null)}</>;
    return (
      <>
        {util(st.today, partialNote(st.todaySamples, 1))}
        {util(st.r24)}
        {util(st.d7, fullDaysNote(st.d7Days, 7))}
        {util(st.d30, fullDaysNote(st.d30Days, 30))}
        {util(st.period, fullDaysNote(st.periodDays, dates.length))}
        {peakCell(s.id)}
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
          곳(측정 중 {measuringCount}곳)
          {!own &&
            (isCandidate
              ? " · 개점 전이라 우리 매장 값은 없습니다"
              : " · 우리 매장 IP가 없어 우리 매장 값은 없습니다")}
        </p>
      </div>

      {/* 직접 입력 후보지는 점포평가 신규후보지 등록 화면의 "측정기에서 불러오기"로 옮긴다 — 여기 전환은 직접 입력 기존점용. */}
      {isCustomOwnCode(ownCode) && !isCandidate && <TransferOwnPanel fromCode={ownCode} fromName={name} preferCandidate={false} />}
      {stores && !own && !isCandidate && !isCustomOwnCode(ownCode) && <OwnIpPanel ownCode={ownCode} onSaved={() => setReloadKey((k) => k + 1)} />}

      {/* 2026-10-16 점포팀 요청 — 우리 매장 기준 반경 1km 주변 지도. */}
      <PingMapSection ownCode={ownCode} ownName={name} getToken={async () => { if (!user) throw new Error("로그인이 필요합니다."); return user.getIdToken(); }} />

      {/* 기간 고르기 — 요약 타일·표의 「고른 기간」·그래프가 모두 이 기간을 따른다. */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`rounded-full px-3 py-1 text-xs ${period === p.key ? "app-btn-primary" : "app-btn-outline"}`}
            onClick={() => setPeriod(p.key)}
            aria-pressed={period === p.key}
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
        <span className="ml-auto text-xs text-[var(--sl-ink-soft)]">{periodLabel}</span>
      </div>

      <KpiRow>
        <KpiTile
          label="우리 매장"
          tip="고른 기간의 우리 매장 일일평균(경쟁점과 같은 측정 방식)입니다. 옆 숫자는 경쟁점 평균보다 몇 %p 높은지(↑)·낮은지(↓)입니다."
          value={own ? formatPct(ownStats?.period ?? null) : "-"}
          delta={ownStats?.period != null && rivalAvg != null ? `${ppDelta(ownStats.period - rivalAvg)} vs 경쟁점` : null}
          note={!own ? "측정 안 함" : ownStats?.period == null ? "값 없음" : periodLabel}
        />
        <KpiTile
          label="경쟁점 평균"
          tip="값을 쓰는 경쟁점(측정 중·과응답)의 고른 기간 가동률을 단순 평균했습니다. 우리 매장은 빼고 셉니다."
          value={formatPct(rivalAvg)}
          note={`${rivalPeriod.length}곳 평균`}
        />
        <KpiTile
          label="가장 바쁜 경쟁점"
          tip="고른 기간 가동률이 가장 높은 경쟁점입니다."
          value={busiest ? formatPct(busiest.v) : "-"}
          note={busiest ? `${busiest.s.name}${busiest.s.distanceM != null ? ` · ${busiest.s.distanceM}m` : ""}` : ""}
        />
        <KpiTile
          label="측정 중"
          tip="지금 정상으로 재고 있는 경쟁점 수입니다. IP 미등록은 아직 IP를 못 받은 곳, 확인 필요는 응답이 이상해 IP를 다시 확인해야 하는 곳입니다."
          value={String(measuringCount)}
          unit={`/ ${rivals.length}곳`}
          note={`IP 미등록 ${noIpCount} · 확인 필요 ${checkCount}`}
        />
      </KpiRow>

      <section className="app-card min-w-0 rounded-2xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--sl-hairline)] px-3 py-2">
          <h2 className="flex items-center text-sm font-semibold">
            우리 매장과 경쟁점
            <InfoTip
              label="표"
              text="체크를 풀면 아래 그래프에서 그 선만 숨깁니다. 줄에 마우스를 올리면 그 선만 진하게 보입니다. 색은 거리순 번호로 정해져 숨겨도 다른 선 색이 바뀌지 않습니다. 피크는 고른 기간(오늘 포함) 시간대 평균이 가장 높은 시각입니다."
            />
          </h2>
          <span className="text-xs text-[var(--sl-ink-soft)]">측정 중 → 못 잼 → IP 미등록, 그 안은 거리순</span>
          <span className="ml-auto">
            <CsvButton onClick={exportCsv} />
          </span>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-[var(--sl-hairline)] text-left text-xs text-[var(--sl-ink-soft)]">
              <th className="px-3 py-2 font-medium whitespace-nowrap">매장</th>
              <th className="px-3 py-2 text-right font-medium">거리</th>
              <th className="px-3 py-2 text-right font-medium">대수</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                오늘(진행 중)<span className="font-normal"> ({dateRangeLabel(today, today)})</span>
              </th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">최근 24시간</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                이번 주(월~일)<span className="font-normal"> ({dateRangeLabel(r7.from, r7.to)})</span>
              </th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                최근 30일<span className="font-normal"> ({dateRangeLabel(r30.from, r30.to)})</span>
              </th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                고른 기간<span className="font-normal"> ({periodLabel})</span>
              </th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">피크</th>
            </tr>
          </thead>
          <tbody>
            {own && (
              <tr
                className="border-b border-[var(--sl-hairline)] bg-black/[0.02] dark:bg-white/[0.03]"
                onMouseEnter={() => ownShown && setRowHover("own")}
                onMouseLeave={() => setRowHover(null)}
              >
                <td className="px-3 py-2 font-semibold whitespace-nowrap">
                  <input
                    type="checkbox"
                    className="mr-1.5 align-middle"
                    checked={ownShown}
                    onChange={() => toggleHidden("own")}
                    aria-label="우리 매장 그래프에 그리기"
                    style={{ accentColor: "var(--pm-c1)" }}
                  />
                  <span
                    className="mr-1.5 inline-block w-4 border-t-[3px] align-middle"
                    style={{ borderColor: "var(--pm-c1)", opacity: ownShown ? 1 : 0.3 }}
                    aria-hidden
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
                {rowFor(own, true)}
              </tr>
            )}
            {rivals.map((s) => {
              const noIp = hasNoIp(s);
              // 체크박스·선 표시는 그래프에 그리는 매장(값이 있는 곳)에만 — 포트 조회 실패처럼 IP는 있어도 값이 없으면 안 붙인다(2026-10-14).
              const plottable = measured.some((m) => m.id === s.id);
              const isShown = plottable && !hidden.has(s.id);
              const line = plottable ? lineOf(s) : null;
              return (
                <tr
                  key={s.id}
                  className={`border-b border-[var(--sl-hairline)] last:border-0 ${plottable ? "cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]" : ""}`}
                  onClick={() => plottable && toggleHidden(s.id)}
                  onMouseEnter={() => isShown && setRowHover(s.id)}
                  onMouseLeave={() => setRowHover(null)}
                  aria-selected={isShown}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {plottable && (
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
                      colSpan={6}
                      className="px-3 py-2 text-right text-xs text-[var(--sl-ink-soft)]"
                    >
                      측정 안 함
                    </td>
                  ) : (
                    rowFor(s, false)
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <p className="border-t border-[var(--sl-hairline)] px-3 py-2 text-xs text-[var(--sl-ink-soft)]">
          측정 중인 경쟁점은 모두 아래 그래프에 선으로 그려집니다. 체크를 풀면 그 선만 숨기고, 줄에 마우스를 올리면 그 선만 진하게 보입니다.
          이름을 누르면 그 매장 상세 화면으로 갑니다.
        </p>
      </section>

      <section className="app-card flex min-w-0 flex-col gap-5 rounded-2xl p-4">
        <div>
          <h2 className="mb-1 flex items-center text-sm font-semibold">
            날짜별
            <InfoTip label="날짜별" text="다 찬 날의 하루 가동률입니다. 등록한 날·덜 잰 날은 비어 있습니다." />
            <span className="ml-1 text-xs font-normal text-[var(--sl-ink-soft)]">({periodLabel})</span>
          </h2>
          {anyDayValue ? (
            <LineChart
              series={daySeries}
              xLabels={dates.map((d) => d.slice(5).replace("-", "/"))}
              ariaLabel="날짜별 가동률 비교"
              highlightKey={rowHover}
              tickEvery={Math.max(1, Math.ceil(dates.length / 10))}
            />
          ) : (
            <p className="text-xs text-[var(--sl-ink-soft)]">
              이 기간엔 꽉 찬 날({fullDayRuleText()})이 아직 없습니다. 등록한 날은
              빼고, 다음 날부터 하루씩 쌓입니다.
            </p>
          )}
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h2 className="flex items-center text-sm font-semibold">
              시간대별
              <InfoTip
                label="시간대별"
                text="기간 시작부터 오늘까지 잰 날들의 시간대별 평균입니다(오늘 포함 — 시간대끼리라 치우침이 없음). 평일·주말은 토·일로만 나눕니다(공휴일은 평일에 들어감)."
              />
              <span className="ml-1 text-xs font-normal text-[var(--sl-ink-soft)]">
                ({dateRangeLabel(hFrom, today)} 잰 날들 평균, 오늘 포함)
              </span>
            </h2>
            <div className="ml-auto flex gap-1" role="group" aria-label="요일 고르기">
              {HOUR_CHIPS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs ${hourChip === c.key ? "app-btn-primary" : "app-btn-outline"}`}
                  aria-pressed={hourChip === c.key}
                  onClick={() => setHourChip(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          {hourSeries == null ? (
            <p className="text-xs text-[var(--sl-ink-soft)]">불러오는 중...</p>
          ) : (
            <LineChart
              series={hourSeries}
              xLabels={Array.from({ length: 24 }, (_, h) => `${h}시`)}
              ariaLabel="시간대별 가동률 비교"
              highlightKey={rowHover}
              tickEvery={3}
            />
          )}
        </div>
      </section>
    </div>
  );
}
