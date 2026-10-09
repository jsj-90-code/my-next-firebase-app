"use client";

// 경쟁점 가동률 목록 + 등록 — 2026-10-06 신설.
// 기본은 "매장별": 우리 매장(기존점·후보지)을 누르면 펼쳐지며 그 매장 경쟁점들의 가동률이 뜬다(사용자 요청 2026-10-06).
// 옛 핑봇 값 칸은 2026-10-06 사용자 요청으로 뺐다("옛 핑봇 가동률은 몰라도 될 듯").

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createPingStore, listPingStores } from "@/lib/pingMonitor/clientStore";
import {
  BLOCKED_SUSPECT_SAMPLES,
  RECENT_MIN_HOURS,
  SAMPLE_INTERVAL_MINUTES,
  fullDayRuleText,
  dateRangeLabel,
  denominator,
  formatPct,
  capUtil,
  hasFullDay,
  fullDaysNote,
  hasNoIp,
  kstDaysAgo,
  lastFullDays,
  thisWeek,
  lastWeek,
  partialNote,
  rangeUtilization,
  recent24h,
  storeStatus,
  type PingStore,
} from "@/lib/pingMonitor/summary";
import { StoreForm } from "./StoreForm";

const TONE: Record<string, string> = {
  ok: "app-badge-ok",
  warn: "app-badge-warn",
  danger: "app-badge-danger",
  neutral: "app-badge-neutral",
};
const UNLINKED = "__unlinked__";
// 후보지 코드는 N0xx, 기존점은 숫자 가맹점코드다(후보지 → 기존점 전환 시 코드도 바뀐다).
const isCandidateCode = (code: string) => /^N\d+$/.test(code);
type View = "existing" | "candidate" | "all" | "check";
const VIEW_LABEL: Record<View, string> = { existing: "기존가맹점", candidate: "신규후보지", all: "경쟁점 전체", check: "IP 확인" };

// own = 우리 매장 자체를 잰 등록(있으면). stores = 경쟁점만.
type Group = { key: string; name: string; own: PingStore | null; stores: PingStore[] };

/**
 * 우리 가맹점 줄 — 펼친 표 맨 위(2026-10-07 사용자 "기존가맹점도 목록에 같이"). 핑으로 잰 우리 매장 값을 경쟁점과 같은 칸에.
 * 우리 매장 IP가 없는 곳(2026-10-07 단톡 보강 뒤 41곳 중 양주덕정 1곳)은 줄만 두고 "IP 없음".
 */
function OwnRow({ name, ping }: { name: string; ping: PingStore | null }) {
  const { today, yesterday, fromPrev, toPrev, from7, to7, monthStart, monthLabel } = useRanges();
  const status = ping ? storeStatus(ping) : null;
  return (
    <tr className="border-b border-[var(--sl-hairline)] bg-black/[0.02] dark:bg-white/[0.03]">
      <td className="px-3 py-2">
        {ping ? (
          <Link href={`/ping-monitor/${ping.id}`} className="font-semibold text-[#171310] hover:underline dark:text-[#f2ede2]">
            {name}
          </Link>
        ) : (
          <span className="font-semibold text-[#171310] dark:text-[#f2ede2]">{name}</span>
        )}
        <span className="ml-1.5 text-xs text-[var(--sl-ink-soft)]">우리 매장</span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">-</td>
      <td className="px-3 py-2 text-right tabular-nums">{ping ? denominator(ping) : "-"}</td>
      {ping ? (
        <>
          <RealtimeCell store={ping} muted={!!status && status.tone !== "ok" && !status.label.startsWith("과응답")} />
          <UtilCell days={ping.days} from={today} to={today} nDays={1} inProgress muted={!!status && status.tone !== "ok" && !status.label.startsWith("과응답")} />
          <Recent24Cell store={ping} muted={!!status && status.tone !== "ok" && !status.label.startsWith("과응답")} />
          <UtilCell days={ping.days} from={fromPrev} to={toPrev} nDays={7} excludeUpTo={ping.portSwitchDate} muted={!!status && status.tone !== "ok" && !status.label.startsWith("과응답")} />
          <UtilCell days={ping.days} from={from7} to={to7} nDays={7} bold excludeUpTo={ping.portSwitchDate} muted={!!status && status.tone !== "ok" && !status.label.startsWith("과응답")} />
          <UtilCell days={ping.days} from={monthStart} to={yesterday} nDays={31} excludeUpTo={ping.portSwitchDate} muted={!!status && status.tone !== "ok" && !status.label.startsWith("과응답")} />
        </>
      ) : (
        <td colSpan={6} className="px-3 py-2 text-right text-xs text-[var(--sl-ink-soft)]">
          우리 매장 IP 없음 — 측정 안 함
        </td>
      )}
      <td className="px-3 py-2">{status && <span className={`app-badge ${TONE[status.tone]}`}>{status.label}</span>}</td>
    </tr>
  );
}

// 기간은 날짜(0~24시) 단위 — 오늘은 진행 중, 어제·7일·30일은 어제까지 다 찬 날만(2026-10-07 사용자).
function useRanges() {
  return useMemo(() => {
    const d30 = lastFullDays(30);
    const week = thisWeek();
    const prevWeek = lastWeek();
    const today = kstDaysAgo(0);
    // 이달(달력 월) 1일~어제. "최근 30일" 대신 월 가동률로(2026-10-08 사용자).
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthLabel = `${Number(today.slice(5, 7))}월`;
    return { today, yesterday: d30.to, fromPrev: prevWeek.from, toPrev: prevWeek.to, from7: week.from, to7: week.to, from30: d30.from, monthStart, monthLabel };
  }, []);
}

// 가동률 + 꼬리말. 오늘(진행 중)은 덜 찬 그대로 "15시간치", n일 칸은 다 찬 날 일일평균에 모자라면 "3일치".
// 칸 구성 오늘·최근 24시간·7일·30일(2026-10-07 사용자 — 신규후보지는 첫날 "오늘"밖에 값이 없다).
// 가동률 밑에 "≈N명"(가동률×대수 = 켜진 PC 수). 대수 많은 곳이 낮은 %여도 손님 많은 걸 보려고(2026-10-08 사용자).
function headcount(util: number | null, seats: number | undefined): string {
  return util != null && seats && seats > 0 ? `${Math.round(util * seats)}대` : "";
}

function UtilCell({ days, from, to, nDays, seats, bold = false, inProgress = false, muted = false, excludeUpTo = null }: { days: PingStore["days"]; from: string; to: string; nDays: number; seats?: number; bold?: boolean; inProgress?: boolean; muted?: boolean; excludeUpTo?: string | null }) {
  const r = rangeUtilization(days, from, to, { includePartial: inProgress, excludeUpTo });
  const util = capUtil(r.util); // 100% 초과(과응답)는 100%로 막아 표시
  const note = inProgress ? partialNote(r.samples, 1) : fullDaysNote(r.days, nDays);
  const head = headcount(util, seats);
  if (muted) return <td className="px-3 py-2 text-right tabular-nums text-[var(--sl-ink-soft)]">-</td>;
  return (
    <td className={`px-3 py-2 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
      {formatPct(util)}
      {head && <span className="ml-1 text-xs font-normal text-[var(--sl-ink-soft)]" title="평균 동시에 켜진 PC 대수 = 가동률 × 대수 (≈손님 규모)">{head}</span>}
      {note && <span className="ml-1 text-xs font-normal text-[var(--sl-ink-soft)]">{note}</span>}
    </td>
  );
}

// 실시간 — 마지막 회차(lastSample)의 켜진 수/대수. 지금 몇 대 켜져 있나(현재 손님 규모).
function RealtimeCell({ store, muted = false }: { store: PingStore; muted?: boolean }) {
  const ls = store.lastSample;
  const util = capUtil(ls && ls.total > 0 ? ls.alive / ls.total : null); // 100% 초과(과응답) 막음
  if (muted) return <td className="px-3 py-2 text-right tabular-nums text-[var(--sl-ink-soft)]">-</td>;
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {formatPct(util)}
      {ls && ls.total > 0 && <span className="ml-1 text-xs font-normal text-[var(--sl-ink-soft)]" title="마지막 회차에 켜져 있던 PC 수">{ls.alive}대</span>}
    </td>
  );
}

// 최근 24시간 — 시간대 칸이 RECENT_MIN_HOURS 이상 차야 값이 나온다(신규 후보지용, 날짜 하루를 안 기다려도 됨).
function Recent24Cell({ store, seats, muted = false }: { store: PingStore; seats?: number; muted?: boolean }) {
  const r = recent24h(store.recent);
  const head = headcount(r.util, seats);
  if (muted) return <td className="px-3 py-2 text-right tabular-nums text-[var(--sl-ink-soft)]">-</td>;
  // 일별 가동률(꽉 찬 날)이 쌓인 매장은 24시간 칸이 의미 없다 — 신규 후보지(일별 없음)용이라 "-"로 비운다(2026-10-09).
  if (hasFullDay(store.days)) return <td className="px-3 py-2 text-right tabular-nums text-[var(--sl-ink-soft)]" title="일별 가동률이 있어 '최근 24시간'은 생략 — 24시간 칸은 신규 후보지(등록 하루)용">-</td>;
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {r.util == null && r.hours > 0 ? (
        <span className="text-xs font-normal text-[var(--sl-ink-soft)]">수집중</span>
      ) : (
        <>
          {formatPct(r.util)}
          {head && <span className="ml-1 text-xs font-normal text-[var(--sl-ink-soft)]" title="평균 동시에 켜진 PC 대수 = 가동률 × 대수 (≈손님 규모)">{head}</span>}
        </>
      )}
    </td>
  );
}

// 목록은 한눈에 볼 칸만(2026-10-07 사용자 "덕지덕지 부산스럽다") — 어제·전체·최근 측정·메모는 상세 화면에.
// showOwn: "IP대역 재확인" 탭 — 우리 매장 이름과 확인 사유·IP대역을 같이 보인다.
// 정렬: 측정 중(맨 위) → IP 있는데 안 됨(핑차단·과응답 등) → IP 미등록(맨 아래). 각 묶음 안에서는 거리순(2026-10-08 사용자).
function byMeasuredThenDistance(a: PingStore, b: PingStore): number {
  const rank = (s: PingStore) => (storeStatus(s).tone === "ok" ? 0 : hasNoIp(s) ? 2 : 1);
  return rank(a) - rank(b) || (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9);
}

function CompetitorTable({ stores, showOwn = false, ownRow }: { stores: PingStore[]; showOwn?: boolean; ownRow?: React.ReactNode }) {
  const { today, yesterday, fromPrev, toPrev, from7, to7, monthStart, monthLabel } = useRanges();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px] text-sm">
        <thead>
          <tr className="border-b border-[var(--sl-hairline)] text-left text-xs text-[var(--sl-ink-soft)]">
            <th className="px-3 py-2 font-medium">점포명</th>
            <th className="px-3 py-2 text-right font-medium">거리</th>
            <th className="px-3 py-2 text-right font-medium">대수</th>
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap">실시간</th>
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap">오늘<span className="font-normal text-[var(--sl-ink-soft)]"> ({dateRangeLabel(today, today)})</span></th>
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap">24시간</th>
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap text-[var(--sl-ink-soft)]">지난주<span className="font-normal"> ({dateRangeLabel(fromPrev, toPrev)})</span></th>
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap">이번주<span className="font-normal text-[var(--sl-ink-soft)]"> ({dateRangeLabel(from7, to7)})</span></th>
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap">{monthLabel}<span className="font-normal text-[var(--sl-ink-soft)]"> (이달)</span></th>
            <th className="px-3 py-2 font-medium">상태</th>
          </tr>
        </thead>
        <tbody>
          {ownRow}
          {stores.map((s) => {
            const status = storeStatus(s);
            // 측정 중·과응답만 값 표시, 그 외(IP·핑차단·미등록·확인전·대기)는 모든 가동률 칸을 "-"로(2026-10-08 사용자).
            const muted = status.tone !== "ok" && !status.label.startsWith("과응답");
            return (
              <tr key={s.id} className="border-b border-[var(--sl-hairline)] last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                <td className="px-3 py-2">
                  {showOwn && <div className="text-xs text-[var(--sl-ink-soft)]">{s.ownName ?? "우리 매장 연결 안 됨"}{s.isOwnStore ? " (우리 매장 자체)" : ""}</div>}
                  <Link href={`/ping-monitor/${s.id}`} className="font-medium text-[#171310] hover:underline dark:text-[#f2ede2]">
                    {s.name}
                  </Link>
                  {s.ipCheck && showOwn && (
                    <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                      ⚠ {s.ipCheck} <span className="font-mono">({s.ipRanges})</span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.distanceM != null ? `${s.distanceM}m` : "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{hasNoIp(s) ? (s.pcCount ?? "-") : denominator(s)}</td>
                <RealtimeCell store={s} muted={muted} />
                <UtilCell days={s.days} from={today} to={today} nDays={1} inProgress muted={muted} />
                <Recent24Cell store={s} muted={muted} />
                <UtilCell days={s.days} from={fromPrev} to={toPrev} nDays={7} excludeUpTo={s.portSwitchDate} muted={muted} />
                <UtilCell days={s.days} from={from7} to={to7} nDays={7} bold excludeUpTo={s.portSwitchDate} muted={muted} />
                <UtilCell days={s.days} from={monthStart} to={yesterday} nDays={31} excludeUpTo={s.portSwitchDate} muted={muted} />
                <td className="px-3 py-2">
                  <span className={`app-badge ${TONE[status.tone]}`}>{status.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupRow({ group, open, onToggle }: { group: Group; open: boolean; onToggle: () => void }) {
  const { from7, to7 } = useRanges();
  const blocked = group.stores.filter((s) => storeStatus(s).tone === "danger").length;
  const noIp = group.stores.filter(hasNoIp).length;
  const ipCheck = group.stores.filter((s) => s.ipCheck).length + (group.own?.ipCheck ? 1 : 0);
  return (
    <li className="app-card overflow-hidden rounded-2xl">
      {/* 이름은 매장별 비교 화면으로, 나머지(화살표·숫자)는 펼치기 — 단추 안에 링크를 넣을 수 없어 나눴다(2026-10-07). */}
      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${group.name} 경쟁점 ${open ? "접기" : "펼치기"}`} className="text-[var(--sl-ink-soft)]">
          {open ? "▾" : "▸"}
        </button>
        {group.key === UNLINKED ? (
          <span className="font-semibold text-[#171310] dark:text-[#f2ede2]">{group.name}</span>
        ) : (
          <Link href={`/ping-monitor/store/${encodeURIComponent(group.key)}`} className="font-semibold text-[#171310] underline-offset-2 hover:underline dark:text-[#f2ede2]">
            {group.name} <span className="text-xs font-normal text-[var(--sl-ink-soft)]">비교 →</span>
          </Link>
        )}
        <button type="button" onClick={onToggle} className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-left">
        <span className="text-xs text-[var(--sl-ink-soft)]">
          경쟁점 {group.stores.length}곳{noIp > 0 ? ` · IP 미등록 ${noIp}` : ""}{ipCheck > 0 ? ` · IP 확인 ${ipCheck}` : ""}{blocked > 0 ? ` · 핑차단 ${blocked}` : ""}
        </span>
        <span className="ml-auto flex gap-4 text-xs tabular-nums text-[var(--sl-ink-soft)]">
          {group.own && (
            <span>
              우리 매장{" "}
              <b className="text-sm text-[var(--sl-terracotta,#c05a2c)]">{formatPct(rangeUtilization(group.own.days, from7, to7, { excludeUpTo: group.own.portSwitchDate }).util)}</b>
            </span>
          )}
          <span>이번 주 {dateRangeLabel(from7, to7)}</span>
        </span>
        </button>
      </div>
      {open && (
        <div className="border-t border-[var(--sl-hairline)]">
          <CompetitorTable
            stores={[...group.stores].sort(byMeasuredThenDistance)}
            ownRow={isCandidateCode(group.key) || group.key === UNLINKED ? undefined : <OwnRow name={group.name} ping={group.own} />}
          />
        </div>
      )}
    </li>
  );
}

export default function PingMonitorPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [stores, setStores] = useState<PingStore[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  // 2026-10-06 사용자 요청: 기존가맹점 / 신규후보지 / 경쟁점 전체 세 칸으로 나눈다.
  const [view, setView] = useState<View>("existing");
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listPingStores()
      .then((rows) => !cancelled && setStores(rows))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "목록을 불러오지 못했습니다."));
    return () => {
      cancelled = true;
    };
  }, [user]);

  // 측정 중지(폐업·중복)된 매장은 목록에서 숨긴다(2026-10-08 사용자). 숨긴 수만 따로 보여준다.
  const visibleStores = useMemo(() => (stores ?? []).filter((s) => s.active !== false), [stores]);
  const hiddenCount = useMemo(() => (stores ?? []).filter((s) => s.active === false).length, [stores]);
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const s of visibleStores) {
      const key = s.ownCode ?? UNLINKED;
      const g = map.get(key) ?? { key, name: s.ownCode ? (s.ownName ?? s.ownCode) : "우리 매장 연결 안 됨", own: null, stores: [] };
      if (s.isOwnStore) g.own = s;
      else g.stores.push(s);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => (a.key === UNLINKED ? 1 : b.key === UNLINKED ? -1 : a.name.localeCompare(b.name, "ko")));
  }, [visibleStores]);
  // 우리 매장에 연결되지 않은 경쟁점은 "경쟁점 전체"에서만 보인다.
  const groupsByView: Record<"existing" | "candidate", Group[]> = useMemo(
    () => ({
      existing: groups.filter((g) => g.key !== UNLINKED && !isCandidateCode(g.key)),
      candidate: groups.filter((g) => g.key !== UNLINKED && isCandidateCode(g.key)),
    }),
    [groups],
  );
  const shownGroups = view === "all" || view === "check" ? [] : groupsByView[view];
  const competitorsOnly = useMemo(() => visibleStores.filter((s) => !s.isOwnStore).sort(byMeasuredThenDistance), [visibleStores]);
  // 2026-10-06 사용자 "웹에 표기해주면 내가 따로 서치해볼게" — 등록 IP가 의심스러운 곳(우리 매장 자체 포함)만 모아 본다.
  const ipCheckStores = useMemo(
    () => visibleStores.filter((s) => s.ipCheck).sort((a, b) => String(a.ownName).localeCompare(String(b.ownName), "ko")),
    [visibleStores],
  );

  // 최근 24시간 중 서버가 거른(측정 안 된) 시각 — 전 매장 공통이라, 어느 매장도 그 시각 칸이 최근 24시간 안에 안 차 있으면 거른 회차다.
  // 진행 중인 현재 시각은 아직 안 찬 게 정상이라 뺀다(오탐 방지). 2026-10-08 사용자 "어느 시간대 빠졌는지 알게".
  const missedHours = useMemo(() => {
    const now = Date.now();
    const nowKstHour = (new Date().getUTCHours() + 9) % 24;
    const fresh = new Set<number>();
    for (const s of stores ?? []) {
      for (const [h, v] of Object.entries(s.recent ?? {})) {
        if (v.at && now - v.at.getTime() <= 24 * 3600 * 1000 && v.t > 0) fresh.add(Number(h));
      }
    }
    const missing: number[] = [];
    for (let h = 0; h < 24; h++) if (h !== nowKstHour && !fresh.has(h)) missing.push(h);
    return missing;
  }, [stores]);

  const intervalText = SAMPLE_INTERVAL_MINUTES % 60 === 0 ? `${SAMPLE_INTERVAL_MINUTES / 60}시간` : `${SAMPLE_INTERVAL_MINUTES}분`;

  function toggle(key: string) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">경쟁점 가동률</h1>
          <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
            {intervalText}마다 켜진 PC 수 ÷ 대수를 잽니다. 매장을 누르면 날짜별·시간대별로 볼 수 있습니다.
          </p>
          {/* 2026-10-07 사용자 "읽기도 싫을 지경" — 한 문단에 몰려 있던 설명을 칸별 표로 나눴다. 내용은 그대로. */}
          <details className="mt-1 max-w-2xl text-xs text-[var(--sl-ink-soft)]">
            <summary className="cursor-pointer hover:underline">계산 기준 보기</summary>
            <div className="app-card-sm mt-2 flex flex-col gap-3 rounded-xl p-3 leading-5">
              <section>
                <h3 className="mb-1 font-semibold text-[var(--sl-ink)]">가동률</h3>
                <p>{intervalText}마다 핑·TCP·타임스탬프를 검사해 <b>응답 IP 수 ÷ 대수</b>를 계산합니다. 같은 IP는 한 번만 셉니다.</p>
                <p>응답 수는 실제 이용 좌석 수와 다를 수 있으며, 무응답만으로 PC 꺼짐이나 실제 가동률 0%를 확정할 수 없습니다.</p>
              </section>
              <section>
                <h3 className="mb-1 font-semibold text-[var(--sl-ink)]">칸별 뜻</h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                  <dt className="font-medium text-[var(--sl-ink)]">이번 주 · 최근 30일</dt>
                  <dd>
                    <b>일일평균</b> — 하루(0~24시) 가동률을 날마다 구해 평균합니다.
                    이번 주는 지나간 날만 넣어서 월요일엔 비어 있습니다.
                  </dd>
                  <dt className="font-medium text-[var(--sl-ink)]">최근 24시간</dt>
                  <dd>지금부터 거꾸로 24시간. 신규 후보지는 등록 다음 날 같은 시각부터 값이 나옵니다.</dd>
                  <dt className="font-medium text-[var(--sl-ink)]">우리 매장</dt>
                  <dd>우리 매장 PC를 같은 방식으로 잰 이번 주 값.</dd>
                </dl>
              </section>
              <section>
                <h3 className="mb-1 font-semibold text-[var(--sl-ink)]">표시가 붙는 경우</h3>
                <ul className="flex flex-col gap-1">
                  <li>
                    <b>&ldquo;3일치&rdquo;</b> — 다 찬 날이 모자랄 때. 하루로 치는 건 {fullDayRuleText()}뿐이고, 그보다 덜 잰 날(등록한 날, 서버 장애가 길었던 날)은 낮·밤이 치우쳐 뺍니다.
                  </li>
                  <li>
                    <b>&ldquo;IP·핑차단 확인&rdquo;</b> — IP를 넣었는데 응답이 없을 때. IP가 틀렸거나 PC가 바깥 확인(핑)을 막아 둔 것 — 자료로는 둘을 못 가립니다.
                  </li>
                  <li>
                    <b>&ldquo;과응답 · IP 확인&rdquo;</b> — 일일평균이 60%를 넘을 때. 손님만으론 잘 안 나오는 값이라 공유기·늘 켜진 기기가 섞인 의심입니다.
                  </li>
                </ul>
              </section>
              <p className="border-t border-[var(--sl-hairline)] pt-2">어제·전체 같은 다른 기간은 매장을 눌러 상세 화면에서 고릅니다.</p>
            </div>
          </details>
        </div>
        <button type="button" className="app-btn-primary rounded-lg px-4 py-2 text-sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "닫기" : "+ 경쟁점 등록"}
        </button>
      </div>

      {showForm && (
        <section className="app-card rounded-2xl p-4">
          <h2 className="mb-3 text-sm font-semibold">새 경쟁점</h2>
          <StoreForm
            submitLabel="등록하고 측정 시작"
            onSubmit={async (input) => {
              const id = await createPingStore(input, user?.email ?? null);
              router.push(`/ping-monitor/${id}`);
            }}
          />
        </section>
      )}

      {error && <p role="alert" className="app-notice app-badge-danger px-3 py-2 text-sm">{error}</p>}
      {stores == null && !error && <p className="text-sm text-[var(--sl-ink-soft)]">불러오는 중...</p>}
      {stores != null && stores.length === 0 && (
        <p className="app-card-sm rounded-xl p-4 text-sm text-[var(--sl-ink-soft)]">아직 등록된 경쟁점이 없습니다. 오른쪽 위 &ldquo;경쟁점 등록&rdquo;으로 시작하세요.</p>
      )}

      {stores != null && stores.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(["existing", "candidate", "all", "check"] as const).map((v) => (
              <button key={v} type="button" className={`rounded-full px-3 py-1 text-xs ${view === v ? "app-btn-primary" : "app-btn-outline"}`} onClick={() => setView(v)}>
                {VIEW_LABEL[v]} ({v === "all" ? `${competitorsOnly.length}곳` : v === "check" ? `${ipCheckStores.length}곳` : `${groupsByView[v].length}개 매장`})
              </button>
            ))}
            {view !== "all" && view !== "check" && shownGroups.length > 0 && (
              <button
                type="button"
                className="ml-auto text-xs text-[var(--sl-ink-soft)] hover:underline"
                onClick={() => {
                  const allOpen = shownGroups.every((g) => openKeys.has(g.key));
                  setOpenKeys((prev) => {
                    const next = new Set(prev);
                    for (const g of shownGroups) {
                      if (allOpen) next.delete(g.key);
                      else next.add(g.key);
                    }
                    return next;
                  });
                }}
              >
                {shownGroups.every((g) => openKeys.has(g.key)) ? "모두 접기" : "모두 펼치기"}
              </button>
            )}
          </div>
          <p className="text-xs text-[var(--sl-ink-soft)]">실시간 옆 <b>○대</b> = 지금 켜져 있는 PC 수(≈현재 손님) — 대수 다른 매장끼리 규모 비교용.</p>
          {hiddenCount > 0 && (
            <p className="text-xs text-[var(--sl-ink-soft)]">폐업·중지한 매장 {hiddenCount}곳은 목록에서 숨겼습니다.</p>
          )}
          {missedHours.length > 0 && (
            <p className="app-notice app-badge-warn rounded-xl px-3 py-2 text-xs leading-5">
              ⚠ 최근 24시간 중 <b>{missedHours.map((h) => `${h}시`).join("·")}</b> 회차가 측정 안 됐습니다.{" "}
              {24 - missedHours.length >= RECENT_MIN_HOURS
                ? <>&ldquo;최근 24시간&rdquo; 값은 나머지 {24 - missedHours.length}시간 기준입니다.</>
                : <>&ldquo;최근 24시간&rdquo;은 {RECENT_MIN_HOURS}시간 이상 차야 값이 나와, 빠진 회차가 24시간 밖으로 밀려날 때까지 비어 있습니다.</>}
            </p>
          )}
          {view !== "all" && view !== "check" && shownGroups.length === 0 && (
            <p className="app-card-sm rounded-xl p-4 text-sm text-[var(--sl-ink-soft)]">{VIEW_LABEL[view]}에 연결된 경쟁점이 아직 없습니다.</p>
          )}
          {view === "check" ? (
            <div className="app-card rounded-2xl">
              <p className="border-b border-[var(--sl-hairline)] px-3 py-2 text-xs leading-5 text-[var(--sl-ink-soft)]">
                등록된 IP대역이 맞는지 확인이 필요한 곳입니다. 근거는 등록 범위 안에서 잰 결과뿐입니다(범위 밖 주소로는 보내지 않습니다).
                맞는 대역을 찾으면 경쟁점을 눌러 IP대역을 고쳐 저장하세요 — 표시가 사라집니다.
              </p>
              {ipCheckStores.length === 0 ? (
                <p className="p-4 text-sm text-[var(--sl-ink-soft)]">확인이 필요한 곳이 없습니다.</p>
              ) : (
                <CompetitorTable stores={ipCheckStores} showOwn />
              )}
            </div>
          ) : view !== "all" ? (
            <ul className="flex flex-col gap-2">
              {shownGroups.map((g) => (
                <GroupRow key={g.key} group={g} open={openKeys.has(g.key)} onToggle={() => toggle(g.key)} />
              ))}
            </ul>
          ) : (
            <div className="app-card rounded-2xl">
              <CompetitorTable stores={competitorsOnly} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
