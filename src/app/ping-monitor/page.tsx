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
  FULL_DAY_MIN_SAMPLES,
  SAMPLE_INTERVAL_MINUTES,
  dateRangeLabel,
  denominator,
  formatPct,
  fullDaysNote,
  groupUtilization,
  hasNoIp,
  kstDaysAgo,
  lastFullDays,
  thisWeek,
  partialNote,
  rangeUtilization,
  recent24h,
  storeStatus,
  type PingStore,
} from "@/lib/pingMonitor/summary";
import { IndustryIndexCard } from "./IndustryIndexCard";
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
const VIEW_LABEL: Record<View, string> = { existing: "기존가맹점", candidate: "신규후보지", all: "경쟁점 전체", check: "IP 확인 필요" };

// own = 우리 매장 자체를 잰 등록(있으면). stores = 경쟁점만.
type Group = { key: string; name: string; own: PingStore | null; stores: PingStore[] };

// 기간은 날짜(0~24시) 단위 — 오늘은 진행 중, 어제·7일·30일은 어제까지 다 찬 날만(2026-10-07 사용자).
function useRanges() {
  return useMemo(() => {
    const d30 = lastFullDays(30);
    const week = thisWeek();
    return { today: kstDaysAgo(0), yesterday: d30.to, from7: week.from, to7: week.to, from30: d30.from };
  }, []);
}

// 가동률 + 꼬리말. 오늘(진행 중)은 덜 찬 그대로 "15시간치", n일 칸은 다 찬 날 일일평균에 모자라면 "3일치".
// 칸 구성 오늘·최근 24시간·7일·30일(2026-10-07 사용자 — 신규후보지는 첫날 "오늘"밖에 값이 없다).
function UtilCell({ days, from, to, nDays, bold = false, inProgress = false }: { days: PingStore["days"]; from: string; to: string; nDays: number; bold?: boolean; inProgress?: boolean }) {
  const r = rangeUtilization(days, from, to, { includePartial: inProgress });
  const note = inProgress ? partialNote(r.samples, 1) : fullDaysNote(r.days, nDays);
  return (
    <td className={`px-3 py-2 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
      {formatPct(r.util)}
      {note && <div className="text-xs font-normal text-[var(--sl-ink-soft)]">{note}</div>}
    </td>
  );
}

/** 묶음 안에서 다 찬 날이 가장 많은 경쟁점의 일수 — 합산값이 며칠치인지 보이려고. */
function groupFullDays(stores: PingStore[], from: string, to: string): number {
  return Math.max(0, ...stores.map((s) => rangeUtilization(s.days, from, to).days));
}

// 최근 24시간 — 시간대 24칸이 다 차야 값이 나온다(신규 후보지용, 날짜 하루를 안 기다려도 됨).
function Recent24Cell({ store }: { store: PingStore }) {
  const r = recent24h(store.recent);
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {formatPct(r.util)}
      {r.util == null && r.hours > 0 && <div className="text-xs font-normal text-[var(--sl-ink-soft)]">{r.hours}/24시간</div>}
    </td>
  );
}

// 목록은 한눈에 볼 칸만(2026-10-07 사용자 "덕지덕지 부산스럽다") — 어제·전체·최근 측정·메모는 상세 화면에.
// showOwn: "IP 확인 필요" 탭 — 우리 매장 이름과 확인 사유·IP대역을 같이 보인다.
function CompetitorTable({ stores, showOwn = false }: { stores: PingStore[]; showOwn?: boolean }) {
  const { today, yesterday, from7, to7, from30 } = useRanges();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px] text-sm">
        <thead>
          <tr className="border-b border-[var(--sl-hairline)] text-left text-xs text-[var(--sl-ink-soft)]">
            <th className="px-3 py-2 font-medium">경쟁점</th>
            <th className="px-3 py-2 text-right font-medium">거리</th>
            <th className="px-3 py-2 text-right font-medium">대수</th>
            <th className="px-3 py-2 text-right font-medium">오늘(진행 중)<div className="font-normal">{dateRangeLabel(today, today)}</div></th>
            <th className="px-3 py-2 text-right font-medium">최근 24시간<div className="font-normal">&nbsp;</div></th>
            <th className="px-3 py-2 text-right font-medium">이번 주(월~일)<div className="font-normal">{dateRangeLabel(from7, to7)}</div></th>
            <th className="px-3 py-2 text-right font-medium">최근 30일<div className="font-normal">{dateRangeLabel(from30, yesterday)}</div></th>
            <th className="px-3 py-2 font-medium">상태</th>
          </tr>
        </thead>
        <tbody>
          {stores.map((s) => {
            const status = storeStatus(s);
            return (
              <tr key={s.id} className="border-b border-[var(--sl-hairline)] last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                <td className="px-3 py-2">
                  {showOwn && <div className="text-xs text-[var(--sl-ink-soft)]">{s.ownName ?? "우리 매장 연결 안 됨"}{s.isOwnStore ? " (우리 매장 자체)" : ""}</div>}
                  <Link href={`/ping-monitor/${s.id}`} className="font-medium text-[#171310] hover:underline dark:text-[#f2ede2]">
                    {s.name}
                  </Link>
                  {s.ipCheck && (
                    <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                      ⚠ IP 확인 필요{showOwn && <> — {s.ipCheck} <span className="font-mono">({s.ipRanges})</span></>}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.distanceM != null ? `${s.distanceM}m` : "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{hasNoIp(s) ? (s.pcCount ?? "-") : denominator(s)}</td>
                <UtilCell days={s.days} from={today} to={today} nDays={1} inProgress />
                <Recent24Cell store={s} />
                <UtilCell days={s.days} from={from7} to={to7} nDays={7} bold />
                <UtilCell days={s.days} from={from30} to={yesterday} nDays={30} />
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
  const note7 = fullDaysNote(groupFullDays(group.stores, from7, to7), 7);
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
          경쟁점 {group.stores.length}곳{noIp > 0 ? ` · IP 미등록 ${noIp}` : ""}{ipCheck > 0 ? ` · IP 확인 필요 ${ipCheck}` : ""}{blocked > 0 ? ` · 측정 불가 의심 ${blocked}` : ""}
        </span>
        <span className="ml-auto flex gap-4 text-xs tabular-nums text-[var(--sl-ink-soft)]">
          {group.own && (
            <span>
              우리 매장{" "}
              <b className="text-sm text-[var(--sl-terracotta,#c05a2c)]">{formatPct(rangeUtilization(group.own.days, from7, to7).util)}</b>
            </span>
          )}
          <span>
            경쟁점 <b className="text-sm text-[#171310] dark:text-[#f2ede2]">{formatPct(groupUtilization(group.stores, from7, to7))}</b>
            {note7 && ` (${note7})`}
          </span>
          <span>이번 주 {dateRangeLabel(from7, to7)}</span>
        </span>
        </button>
      </div>
      {open && (
        <div className="border-t border-[var(--sl-hairline)]">
          <CompetitorTable stores={[...group.stores].sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9))} />
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

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const s of stores ?? []) {
      const key = s.ownCode ?? UNLINKED;
      const g = map.get(key) ?? { key, name: s.ownCode ? (s.ownName ?? s.ownCode) : "우리 매장 연결 안 됨", own: null, stores: [] };
      if (s.isOwnStore) g.own = s;
      else g.stores.push(s);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => (a.key === UNLINKED ? 1 : b.key === UNLINKED ? -1 : a.name.localeCompare(b.name, "ko")));
  }, [stores]);
  // 우리 매장에 연결되지 않은 경쟁점은 "경쟁점 전체"에서만 보인다.
  const groupsByView: Record<"existing" | "candidate", Group[]> = useMemo(
    () => ({
      existing: groups.filter((g) => g.key !== UNLINKED && !isCandidateCode(g.key)),
      candidate: groups.filter((g) => g.key !== UNLINKED && isCandidateCode(g.key)),
    }),
    [groups],
  );
  const shownGroups = view === "all" || view === "check" ? [] : groupsByView[view];
  const competitorsOnly = useMemo(() => (stores ?? []).filter((s) => !s.isOwnStore), [stores]);
  // 2026-10-06 사용자 "웹에 표기해주면 내가 따로 서치해볼게" — 등록 IP가 의심스러운 곳(우리 매장 자체 포함)만 모아 본다.
  const ipCheckStores = useMemo(
    () => (stores ?? []).filter((s) => s.ipCheck).sort((a, b) => String(a.ownName).localeCompare(String(b.ownName), "ko")),
    [stores],
  );

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
          <details className="mt-1 max-w-2xl text-xs leading-5 text-[var(--sl-ink-soft)]">
            <summary className="cursor-pointer hover:underline">계산 기준 보기</summary>
            {BLOCKED_SUSPECT_SAMPLES}번 넘게 재는 동안 한 대도 대답하지 않으면 &ldquo;측정 불가 의심&rdquo;(PC가 바깥 확인을 막아 둔 매장)으로 따로 표시합니다.
            이번 주(월~일)·최근 30일은 <b>일일평균</b>입니다 — 하루(한국 시각 0~24시) 가동률을 날마다 구해 평균하고,
            {` ${FULL_DAY_MIN_SAMPLES}`}시간 넘게 못 잰 날(등록한 날 오후부터 잰 날 등)은 낮·밤이 치우치므로 뺍니다. 다 찬 날이 모자라면 &ldquo;3일치&rdquo;처럼 적습니다.
            &ldquo;최근 24시간&rdquo;은 지금부터 거꾸로 24시간입니다(진행 중인 &ldquo;오늘&rdquo;은 보는 시각에 따라 치우쳐 상세 화면에만 둡니다) — 24개 시간대가
            꽉 차야 값이 나와서, 신규 후보지는 등록 다음 날 같은 시각이면 하루치 값을 쓸 수 있습니다.
            매장 줄의 &ldquo;우리 매장&rdquo;은 우리 매장 PC를 같은 방식으로 잰 이번 주, &ldquo;경쟁점&rdquo;은 날마다 그 매장 경쟁점들의 켜진 PC 합 ÷ 대수 합을 구해 평균한 이번 주 값입니다.
            이번 주는 지나간 꽉 찬 날만 넣어서 월요일엔 비어 있고 날이 갈수록 &ldquo;2일치&rdquo;처럼 늘어납니다.
            어제·전체 같은 다른 기간은 매장 상세 화면에서 고릅니다.
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
          {/* 업계 지수 — 매장별 목록 위(2026-10-07). 이미 읽은 days로 계산, 추가 읽기 없음. */}
          <IndustryIndexCard stores={stores} />
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
