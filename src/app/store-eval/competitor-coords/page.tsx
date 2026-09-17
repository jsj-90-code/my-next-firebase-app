"use client";

// 경쟁점 좌표 채우기 화면 (2026-09-17).
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────────
// 경쟁점 좌표는 자동수집으로 178/228(78%)까지 찼는데 나머지 47건이 기계로는 안 열린다.
// 경쟁점 자료는 **가맹점 오픈 당시(23~24년) 스냅샷**이고 카카오맵은 지금이라, 상호가
// 바뀌었거나 폐점한 곳은 이름으로 **원리적으로 못 찾는다**. 주소도 1건뿐이다.
//
// 그런데 **상호명은 47건 전부 있고, 현장조사 거리도 47건 전부 있다.** 그래서 사람이
// 지도에서 찍으면 되고, 찍은 위치가 맞는지 **조사 거리로 검산까지 된다.**
//
// ⚠️ 좌표는 V62 운영 계산에 안 쓰인다(types.ts 380행). 반경분석·입지 실험에만 쓴다.
//    그래도 운영 컬렉션(storeEvalCompetitors)에 저장한다 — 기초자료이기 때문이고,
//    실험실(storeEvalLabCompetitors)로는 syncLabCollections.mjs가 내려보낸다.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CandidateMap, type MapPoint } from "@/components/storeEval/CandidateMap";
import { useAuth } from "@/contexts/AuthContext";
import { formatNumber } from "@/lib/storeEval/format";
import { listAllCompetitors, listCandidates, listExistingStores, saveCompetitor } from "@/lib/storeEval/store";
import type { CandidateInput, Competitor, ExistingStore } from "@/lib/storeEval/types";

/** 두 좌표 사이 거리(m). 카카오 API 없이 브라우저에서 바로 검산하려고 직접 잰다. */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * 찍은 위치가 현장조사 거리와 맞는지 본다.
 *
 * 현장조사 거리는 걸어서 재거나 지도에서 잰 값이라 직선거리와 정확히 같지 않다. 자동수집
 * 좌표를 검산했을 때 중앙 4~6m로 일치했으므로(2026-09-16), 같은 정도를 기준으로 둔다.
 * 가까운 경쟁점일수록 절대오차가 작아야 하므로 **비율과 절대값 중 너그러운 쪽**을 쓴다.
 */
function checkDistance(surveyM: number | null, actualM: number): { level: "ok" | "warn" | "bad"; text: string } {
  if (surveyM == null || !(surveyM > 0)) {
    return { level: "warn", text: `조사 거리가 없어 검산을 못 한다 (찍은 거리 ${Math.round(actualM)}m)` };
  }
  const gap = Math.abs(actualM - surveyM);
  const allow = Math.max(30, surveyM * 0.35);
  const sign = actualM >= surveyM ? "+" : "−";
  const base = `조사 ${Math.round(surveyM)}m · 찍은 위치 ${Math.round(actualM)}m (${sign}${Math.round(gap)}m)`;
  if (gap <= allow * 0.5) return { level: "ok", text: `${base} — 잘 맞는다` };
  if (gap <= allow) return { level: "warn", text: `${base} — 조금 어긋난다` };
  // ⚠️ 어긋난다고 좌표가 틀린 건 아니다. 2026-09-17에 225곳을 다 찍고 대조했더니 14곳이
  //    크게 어긋났는데, 사용자 확인 결과 **틀린 쪽은 조사 거리**였다("초기 데이터"). 그래서
  //    "좌표를 고쳐라"가 아니라 "둘 중 하나가 틀렸다"로 말한다.
  return {
    level: "bad",
    text: `${base} — 많이 어긋난다. 좌표를 잘못 찍었거나 조사 거리가 잘못 적힌 것이다`,
  };
}

type Parent = { code: string; name: string; lat: number; lng: number; kind: "기존점" | "후보지" };

export default function CompetitorCoordsPage() {
  const { user } = useAuth();
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [parents, setParents] = useState<Map<string, Parent>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  /**
   * 경쟁점과 **우리 매장 좌표**를 같이 읽는다. 지도 중심이 우리 매장이라 매장 좌표가
   * 없으면 그 상권은 아예 작업을 못 한다(목록에서 그렇게 표시한다).
   *
   * 상태를 여기서 바꾸지 않는다 — 효과 안에서 동기로 상태를 세우면 렌더가 연쇄된다
   * (eslint react-hooks). 읽기만 하고 심는 건 효과 쪽에서 한다.
   */
  const fetchAll = useCallback(async () => {
    const [comps, stores, cands] = await Promise.all([
      listAllCompetitors(),
      listExistingStores(),
      listCandidates(),
    ]);
    const map = new Map<string, Parent>();
    for (const s of stores as ExistingStore[]) {
      if (s.lat != null && s.lng != null) {
        map.set(s.storeCode, { code: s.storeCode, name: s.storeName ?? s.storeCode, lat: s.lat, lng: s.lng, kind: "기존점" });
      }
    }
    for (const c of cands as CandidateInput[]) {
      if (c.lat != null && c.lng != null && !map.has(c.code)) {
        map.set(c.code, { code: c.code, name: c.name ?? c.code, lat: c.lat, lng: c.lng, kind: "후보지" });
      }
    }
    return { comps, map };
  }, []);

  useEffect(() => {
    let alive = true;
    fetchAll()
      .then(({ comps, map }) => {
        if (!alive) return;
        setCompetitors(comps);
        setParents(map);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [fetchAll]);

  /** 조사 대상 경쟁점만 본다 — "경쟁점없음"은 자리만 채운 행이라 좌표가 필요 없다. */
  const real = useMemo(
    () => competitors.filter((c) => c.investigationStatus !== "경쟁점없음"),
    [competitors],
  );
  const missing = useMemo(() => real.filter((c) => c.lat == null || c.lng == null), [real]);
  const filled = useMemo(() => real.filter((c) => c.lat != null && c.lng != null), [real]);

  /** 우리 매장별로 묶는다. 좌표 없는 게 많은 매장부터 — 한 매장에서 여러 건을 몰아 찍는 게 빠르다. */
  const groups = useMemo(() => {
    const by = new Map<string, { parent: Parent | null; code: string; missing: Competitor[]; filled: Competitor[] }>();
    for (const c of real) {
      const g = by.get(c.candidateCode)
        ?? { parent: parents.get(c.candidateCode) ?? null, code: c.candidateCode, missing: [], filled: [] };
      (c.lat == null || c.lng == null ? g.missing : g.filled).push(c);
      by.set(c.candidateCode, g);
    }
    return [...by.values()]
      .filter((g) => showDone || g.missing.length > 0)
      .sort((a, b) => b.missing.length - a.missing.length
        || (a.parent?.name ?? a.code).localeCompare(b.parent?.name ?? b.code));
  }, [real, parents, showDone]);

  const selected = useMemo(() => real.find((c) => c.id === selectedId) ?? null, [real, selectedId]);
  const selectedParent = selected ? parents.get(selected.candidateCode) ?? null : null;

  /**
   * 지도에 같이 띄울 점.
   *  - 우리 매장(검은 점) — 거리를 재는 기준점이다. 이미 찍은 좌표를 고칠 때는 마커가
   *    경쟁점 자리에서 시작하므로, 우리 매장이 안 보이면 방향 감각을 잃는다.
   *  - 같은 상권에서 **좌표가 이미 있는 다른 경쟁점**(빨간 점) — 위치 감을 잡는 데 쓴다.
   */
  const points: MapPoint[] = useMemo(() => {
    if (!selected || !selectedParent) return [];
    const others = filled
      .filter((c) => c.candidateCode === selected.candidateCode && c.id !== selected.id)
      .map((c) => ({ id: c.id, name: c.name ?? "경쟁점", lat: c.lat!, lng: c.lng!, category: "PC방(경쟁점)" as const }));
    return [
      { id: `parent:${selectedParent.code}`, name: selectedParent.name, lat: selectedParent.lat, lng: selectedParent.lng, category: "우리 매장" as const },
      ...others,
    ];
  }, [filled, selected, selectedParent]);

  /** 이미 좌표가 있으면 **그 자리에서** 마커를 띄운다 — 잘못 찍힌 위치를 보고 고쳐야 한다. */
  const markerStart = useMemo(() => {
    if (!selectedParent) return null;
    if (selected?.lat != null && selected?.lng != null) return { lat: selected.lat, lng: selected.lng };
    return { lat: selectedParent.lat, lng: selectedParent.lng };
  }, [selected, selectedParent]);

  /** 지금 저장돼 있는 좌표가 조사 거리와 맞는지 — 잘못 찍은 걸 찾아내는 데 쓴다. */
  const savedCheck = useMemo(() => {
    if (!selected || !selectedParent || selected.lat == null || selected.lng == null) return null;
    return checkDistance(
      selected.distanceM == null ? null : Number(selected.distanceM),
      haversineM(selectedParent.lat, selectedParent.lng, selected.lat, selected.lng),
    );
  }, [selected, selectedParent]);

  const check = useMemo(() => {
    if (!selected || !selectedParent || !pending) return null;
    return checkDistance(
      selected.distanceM == null ? null : Number(selected.distanceM),
      haversineM(selectedParent.lat, selectedParent.lng, pending.lat, pending.lng),
    );
  }, [selected, selectedParent, pending]);

  const onSave = useCallback(async () => {
    if (!selected || !pending) return;
    setSaving(true);
    setNotice(null);
    try {
      await saveCompetitor({ ...selected, lat: pending.lat, lng: pending.lng }, user?.email ?? null, selected);
      setCompetitors((prev) => prev.map((c) => (c.id === selected.id ? { ...c, lat: pending.lat, lng: pending.lng } : c)));
      const wasNew = selected.lat == null || selected.lng == null;
      setNotice(`${selected.name ?? "경쟁점"} 좌표를 ${wasNew ? "저장" : "수정"}했습니다.`);
      setPending(null);
      // 새로 찍은 거면 같은 매장의 다음 건으로 자동으로 넘어간다 — 몰아서 찍는 게 빠르다.
      // 고친 거면 그 자리에 머문다. 제대로 고쳐졌는지 눈으로 확인하고 싶을 것이다.
      if (wasNew) {
        const next = missing.find((c) => c.candidateCode === selected.candidateCode && c.id !== selected.id);
        setSelectedId(next?.id ?? null);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }, [selected, pending, user, missing]);

  const pct = real.length ? Math.round((filled.length / real.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">경쟁점 좌표</h1>
        <p className="text-sm text-[var(--sl-ink-soft)]">
          자동수집으로 못 찾은 경쟁점을 지도에서 직접 찍는다. 경쟁점 자료가{" "}
          <strong>오픈 당시(23~24년) 스냅샷</strong>이라 <strong>폐점한 곳이 대다수</strong>고,
          그래서 오늘 지도·로드뷰로는 안 나온다. 카카오맵에서 로드뷰 날짜를 그때로 돌리면
          간판이 보인다(경쟁점을 고르면 링크가 뜬다). 찍은 위치는{" "}
          <strong>현장조사 거리와 대조</strong>해서 맞는지 바로 알려준다.
        </p>
        <p className="text-xs text-[var(--sl-ink-soft)]">
          이 좌표는 운영 예상매출(V62) 계산에 쓰이지 않는다. 반경분석과 입지 실험에만 쓴다.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-[var(--sl-ink-soft)]">불러오는 중…</p>
      ) : error ? (
        <p className="text-sm text-[var(--sl-danger)]">{error}</p>
      ) : (
        <>
          <section className="app-card rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-[#171310] dark:text-[#f2ede2]">
                조사 대상 경쟁점 <strong>{formatNumber(real.length)}</strong>건 중 좌표{" "}
                <strong>{formatNumber(filled.length)}</strong>건 ({pct}%) ·{" "}
                <span className="text-[var(--sl-danger)]">남은 {formatNumber(missing.length)}건</span>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--sl-ink-soft)]">
                <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
이미 찍은 것도 보기 <span className="text-[var(--sl-ink-soft)]">(잘못 찍은 걸 고치려면 켜기)</span>
              </label>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#171310]/[0.08] dark:bg-white/[0.08]">
              <div className="h-full rounded-full bg-[var(--sl-success)]" style={{ width: `${pct}%` }} />
            </div>
          </section>

          {notice && (
            <p className="rounded-lg bg-[var(--sl-info-soft)] px-3 py-2 text-sm text-[var(--sl-info)]">{notice}</p>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <section className="app-card max-h-[38rem] overflow-auto rounded-xl p-3">
              {groups.length === 0 ? (
                <p className="p-3 text-sm text-[var(--sl-ink-soft)]">좌표를 채울 경쟁점이 없습니다.</p>
              ) : (
                <ul className="space-y-3">
                  {groups.map((g) => (
                    <li key={g.code}>
                      <div className="flex items-baseline justify-between gap-2 px-1 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
                        <span>{g.parent?.name ?? `(좌표 없는 매장 ${g.code})`}</span>
                        <span className="text-xs font-normal text-[var(--sl-ink-soft)]">
                          {g.missing.length ? `남은 ${g.missing.length}건` : "완료"}
                        </span>
                      </div>
                      {!g.parent && (
                        <p className="px-1 pb-1 text-xs text-[var(--sl-danger)]">
                          우리 매장 좌표가 없어 지도를 못 띄운다. 매장 좌표부터 채울 것.
                        </p>
                      )}
                      <ul className="mt-1 space-y-1">
                        {g.missing.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              disabled={!g.parent}
                              onClick={() => { setSelectedId(c.id); setPending(null); setNotice(null); }}
                              className={`w-full rounded-lg px-2 py-2 text-left text-sm transition ${
                                selectedId === c.id
                                  ? "bg-[var(--sl-info-soft)] text-[var(--sl-info)]"
                                  : "hover:bg-[#171310]/[0.04] dark:hover:bg-white/[0.06]"
                              } ${g.parent ? "" : "cursor-not-allowed opacity-50"}`}
                            >
                              <span className="font-medium">{c.name ?? "(상호 없음)"}</span>
                              <span className="ml-2 text-xs text-[var(--sl-ink-soft)]">
                                조사 {c.distanceM == null ? "-" : `${formatNumber(Number(c.distanceM))}m`}
                                {" · PC "}
                                {c.appliedPcCount ?? c.totalPcCount ?? "-"}대
                              </span>
                            </button>
                          </li>
                        ))}
                        {/* 이미 찍은 것도 **다시 고를 수 있어야 한다** — 잘못 찍으면
                            고쳐야 하기 때문이다(2026-09-17 사용자: "카카오를 잘못 찍었다").
                            찍은 좌표가 조사 거리와 얼마나 맞는지 옆에 붙여, 잘못 찍은 걸
                            목록에서 바로 찾을 수 있게 한다. */}
                        {showDone && g.filled.map((c) => {
                          const gap = g.parent && c.lat != null && c.lng != null
                            ? checkDistance(
                                c.distanceM == null ? null : Number(c.distanceM),
                                haversineM(g.parent.lat, g.parent.lng, c.lat, c.lng),
                              )
                            : null;
                          return (
                            <li key={c.id}>
                              <button
                                type="button"
                                disabled={!g.parent}
                                onClick={() => { setSelectedId(c.id); setPending(null); setNotice(null); }}
                                className={`w-full rounded-lg px-2 py-2 text-left text-sm transition ${
                                  selectedId === c.id
                                    ? "bg-[var(--sl-info-soft)] text-[var(--sl-info)]"
                                    : "hover:bg-[#171310]/[0.04] dark:hover:bg-white/[0.06]"
                                } ${g.parent ? "" : "cursor-not-allowed opacity-50"}`}
                              >
                                <span className={gap?.level === "bad" ? "font-medium text-[var(--sl-danger)]" : "text-[var(--sl-ink-soft)]"}>
                                  {gap?.level === "bad" ? "⚠" : "✓"} {c.name ?? "(상호 없음)"}
                                </span>
                                {gap && (
                                  <span className={`ml-2 text-xs ${gap.level === "bad" ? "text-[var(--sl-danger)]" : "text-[var(--sl-ink-soft)]"}`}>
                                    {gap.level === "ok" ? "거리 맞음" : gap.level === "warn" ? "조금 어긋남" : "많이 어긋남"}
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="app-card rounded-xl p-4">
              {!selected || !selectedParent ? (
                <p className="text-sm text-[var(--sl-ink-soft)]">
                  왼쪽에서 경쟁점을 고르면 지도가 열린다.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">
                      {selected.name ?? "(상호 없음)"}
                    </h2>
                    <p className="text-sm text-[var(--sl-ink-soft)]">
                      {selectedParent.name}({selectedParent.kind})에서 조사 거리{" "}
                      <strong>{selected.distanceM == null ? "자료 없음" : `${formatNumber(Number(selected.distanceM))}m`}</strong>
                      {" · PC "}{selected.appliedPcCount ?? selected.totalPcCount ?? "-"}대
                      {selected.address ? ` · ${selected.address}` : ""}
                    </p>
                    <p className="text-xs text-[var(--sl-ink-soft)]">
                      마커를 <strong>경쟁점 건물 위로 끌어다 놓고</strong> 확정하면 조사 거리와 대조해 준다.
                      검은 점이 우리 매장(거리 재는 기준), 빨간 점은 이미 좌표를 채운 같은 상권 경쟁점이다.
                    </p>

                    {savedCheck && (
                      <div
                        className={`rounded-lg px-3 py-2 text-xs ${
                          savedCheck.level === "ok"
                            ? "bg-[var(--sl-success-soft)] text-[var(--sl-success)]"
                            : savedCheck.level === "warn"
                              ? "bg-[var(--sl-warning-soft)] text-[var(--sl-warning)]"
                              : "bg-[var(--sl-danger-soft)] text-[var(--sl-danger)]"
                        }`}
                      >
                        <strong>지금 저장된 좌표</strong> — {savedCheck.text}
                        <br />
                        마커가 그 자리에서 시작한다. 좌표가 맞다면 그냥 두면 된다 —{" "}
                        <strong>산식은 조사 거리가 아니라 좌표로 잰 거리를 쓴다.</strong>{" "}
                        조사 거리는 현장 기록이라 고치지 않고 그대로 남긴다.
                      </div>
                    )}
                  </div>

                  {/* ── 폐점한 경쟁점을 찾는 길 ─────────────────────────────
                      자동수집이 실패한 47건은 **폐점한 곳이 대다수**다(2026-09-17 사용자
                      확인). 지금 지도에는 간판이 없으니 오늘 로드뷰로는 못 찾는다.
                      카카오맵 웹 UI에서 **로드뷰 날짜를 오픈 당시로 돌리면** 보인다 —
                      그 기능은 공식 SDK에 없어 자동화가 안 될 뿐이고(2026-09-16 런타임
                      확인), 사람이 웹에서 하는 건 된다. 그래서 링크로 건네준다. */}
                  <div className="rounded-lg bg-[var(--sl-warning-soft)] p-3 text-xs text-[var(--sl-warning)]">
                    <p className="font-semibold">폐점한 곳이면 지금 지도에는 안 보인다</p>
                    <p className="mt-1">
                      카카오맵에서 <strong>로드뷰 날짜를 매장 오픈 무렵으로 돌려</strong> 간판을 찾은 뒤,
                      여기 지도에서 그 건물을 찍으면 된다. 날짜 변경은 카카오맵 웹에서만 되고
                      자동화는 안 된다.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <a
                        href={`https://map.kakao.com/link/roadview/${selectedParent.lat},${selectedParent.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-[var(--sl-warning)]/40 px-2 py-1 font-semibold hover:bg-[var(--sl-warning)]/10"
                      >
                        우리 매장 앞 로드뷰 열기 ↗
                      </a>
                      <a
                        href={`https://map.kakao.com/link/map/${encodeURIComponent(selectedParent.name)},${selectedParent.lat},${selectedParent.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-[var(--sl-warning)]/40 px-2 py-1 font-semibold hover:bg-[var(--sl-warning)]/10"
                      >
                        우리 매장 지도 열기 ↗
                      </a>
                      {selected.name && (
                        <a
                          href={`https://map.kakao.com/?q=${encodeURIComponent(selected.name)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-md border border-[var(--sl-warning)]/40 px-2 py-1 font-semibold hover:bg-[var(--sl-warning)]/10"
                        >
                          &ldquo;{selected.name}&rdquo; 검색 ↗
                        </a>
                      )}
                    </div>
                  </div>

                  <CandidateMap
                    key={selected.id}
                    lat={markerStart?.lat ?? selectedParent.lat}
                    lng={markerStart?.lng ?? selectedParent.lng}
                    points={points}
                    onConfirmPosition={(lat, lng) => { setPending({ lat, lng }); setNotice(null); }}
                  />

                  {pending && check && (
                    <div className="space-y-2">
                      <p
                        className={`rounded-lg px-3 py-2 text-sm ${
                          check.level === "ok"
                            ? "bg-[var(--sl-success-soft)] text-[var(--sl-success)]"
                            : check.level === "warn"
                              ? "bg-[var(--sl-warning-soft)] text-[var(--sl-warning)]"
                              : "bg-[var(--sl-danger-soft)] text-[var(--sl-danger)]"
                        }`}
                      >
                        {check.text}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void onSave()}
                          disabled={saving}
                          className="app-btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                        >
                          {saving ? "저장 중…" : check.level === "bad" ? "그래도 이 좌표로 저장" : "이 좌표로 저장"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPending(null)}
                          className="rounded-lg border border-[#171310]/[0.12] px-3 py-2 text-sm dark:border-white/[0.12]"
                        >
                          다시 찍기
                        </button>
                        <span className="text-xs text-[var(--sl-ink-soft)]">
                          {pending.lat.toFixed(6)}, {pending.lng.toFixed(6)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          <p className="text-xs text-[var(--sl-ink-soft)]">
            다 채우면 실험실에도 내려보내야 한다 —{" "}
            <code className="rounded bg-[#171310]/[0.06] px-1 dark:bg-white/[0.08]">node scripts/syncLabCollections.mjs --apply</code>
            {" "}(⚠️ 실험실에서 따로 고친 값이 있으면 덮인다). 자세한 내용은{" "}
            <Link href="/store-eval/how-it-works" className="underline">매출 계산법</Link> 참고.
          </p>
        </>
      )}
    </div>
  );
}
