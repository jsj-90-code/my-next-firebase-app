"use client";

// 2. 신규후보지 입력 - 후보지 목록 화면.
// listCandidates/generateNextCandidateCode/duplicateCandidate는 store.ts 함수를 그대로 쓴다. 삭제는
// 경쟁점·수요거점·업로드이력·행정동참고자료·입지동선평가·최종결과까지 함께 지워야 해서(고아 데이터
// 방지) firebase-admin으로 보안규칙을 우회하는 /api/store-eval/delete-candidate를 대신 쓴다.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  duplicateCandidate,
  getModelSettings,
  listAllCompetitors,
  listAllLocationEvaluations,
  listCandidates,
  listEvaluationResults,
} from "@/lib/storeEval/store";
import type { CandidateInput, ReviewStatus } from "@/lib/storeEval/types";
import { formatDateTime } from "@/lib/storeEval/format";
import { freshnessHint, resultFreshness, type Freshness } from "@/lib/storeEval/resultFreshness";

const REVIEW_STATUS_STYLE: Record<ReviewStatus, string> = {
  진행: "app-badge app-badge-info",
  보류: "app-badge app-badge-warn",
  종료: "app-badge app-badge-neutral",
  완료: "app-badge app-badge-ok",
};

export default function CandidateListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<CandidateInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  // 저장된 결과가 지금 입력과 맞는지 판정할 재료. 조회가 실패하면 null로 두고 배지를 안 그린다 —
  // 부가 정보라서 이것 때문에 목록 자체가 막히면 안 된다.
  const [freshnessInputs, setFreshnessInputs] = useState<{
    calculatedAtByCode: Map<string, number>;
    competitorAtsByCode: Map<string, (number | null | undefined)[]>;
    locationAtByCode: Map<string, number | null | undefined>;
    settingsUpdatedAt: number | null;
  } | null>(null);

  const load = useCallback(() => {
    return listCandidates()
      .then((list) => {
        setCandidates(list);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "후보지 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 2026-09-11 — 목록·대시보드의 예상매출은 "마지막으로 결과 탭을 연 시점"의 값이다.
  // 그 뒤 경쟁점이나 운영설정이 바뀌면 옛 숫자가 그대로 떠 있는데 알 방법이 없었다
  // (N009 평택소사벌점이 실제로 그랬다). 컬렉션 통째 조회 3번이라 후보지 수가 늘어도
  // 읽기 비용은 일정하다.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listEvaluationResults(), listAllCompetitors(), listAllLocationEvaluations(), getModelSettings()])
      .then(([results, competitors, locations, settings]) => {
        if (cancelled) return;
        const competitorAtsByCode = new Map<string, (number | null | undefined)[]>();
        for (const c of competitors) {
          competitorAtsByCode.set(c.candidateCode, [...(competitorAtsByCode.get(c.candidateCode) ?? []), c.updatedAt]);
        }
        setFreshnessInputs({
          calculatedAtByCode: new Map(results.map((r) => [r.candidateCode, r.calculatedAt])),
          competitorAtsByCode,
          locationAtByCode: new Map(locations.map((l) => [l.candidateCode, l.updatedAt])),
          settingsUpdatedAt: settings?.updatedAt ?? null,
        });
      })
      .catch(() => {
        // 배지를 못 그릴 뿐이다. 목록은 그대로 쓴다.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const freshnessByCode = useMemo(() => {
    const map = new Map<string, Freshness>();
    if (!freshnessInputs) return map;
    for (const c of candidates) {
      map.set(
        c.code,
        resultFreshness({
          calculatedAt: freshnessInputs.calculatedAtByCode.get(c.code),
          candidateUpdatedAt: c.updatedAt,
          competitorUpdatedAts: freshnessInputs.competitorAtsByCode.get(c.code) ?? [],
          locationEvaluationUpdatedAt: freshnessInputs.locationAtByCode.get(c.code),
          settingsUpdatedAt: freshnessInputs.settingsUpdatedAt,
        }),
      );
    }
    return map;
  }, [candidates, freshnessInputs]);

  // 요청사항 — 후보지코드는 "임시저장/저장"을 처음 누르는 순간에만 발급한다(BasicInfoTab.handleSave).
  // 여기서 미리 발급해두면 등록 버튼만 누르고 저장 안 하고 나가는 경우 번호가 영구히 건너뛴다.
  function handleCreate() {
    setCreating(true);
    router.push("/store-eval/candidates/new");
  }

  async function handleDuplicate(code: string) {
    setBusyCode(code);
    setError(null);
    setWarning(null);
    try {
      const copy = await duplicateCandidate(code, user?.email ?? null);
      router.push(`/store-eval/candidates/${copy.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "후보지를 복사하지 못했습니다.");
      setBusyCode(null);
    }
  }

  async function handleDelete(code: string) {
    if (!confirm(`${code} 후보지를 삭제하시겠습니까? 경쟁점·입지동선평가·최종결과 등 딸린 데이터도 함께 지워지며, 되돌릴 수 없습니다.`)) return;
    setBusyCode(code);
    setError(null);
    setWarning(null);
    try {
      const token = await user?.getIdToken();
      const response = await fetch("/api/store-eval/delete-candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ candidateCode: code }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "후보지를 삭제하지 못했습니다.");
      }
      const body = (await response.json().catch(() => null)) as { auditWarning?: string | null } | null;
      setLoading(true);
      setError(null);
      await load();
      if (body?.auditWarning) setWarning(body.auditWarning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "후보지를 삭제하지 못했습니다.");
    } finally {
      setBusyCode(null);
    }
  }

  const query = search.trim().toLowerCase();
  const filteredCandidates = query
    ? candidates.filter(
        (c) => c.code.toLowerCase().includes(query) || c.name.toLowerCase().includes(query) || c.address.toLowerCase().includes(query),
      )
    : candidates;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#171310] dark:text-[#f2ede2]">신규후보지</h1>
          <p className="mt-1 text-sm text-[var(--sl-ink-soft)]">
            신규 후보지를 등록하고, 경쟁점·입지동선평가를 거쳐 V62 최종판정을 확인합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="app-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
        >
          {creating ? "입력 화면 여는 중..." : "+ 신규 후보지 등록"}
        </button>
      </div>

      {error && (
        <div role="alert" className="app-notice app-badge-danger w-full px-3 py-2 text-sm">
          <p>{error}</p>
          <button type="button" onClick={() => { setLoading(true); setError(null); void load(); }} disabled={loading || busyCode !== null} className="app-btn-outline mt-3 text-sm disabled:opacity-50">
            목록 다시 불러오기
          </button>
        </div>
      )}
      {warning && <p className="app-notice app-badge-warn w-full justify-start px-3 py-2 text-sm">{warning}</p>}

      {/* 2026-08-25 추가 — 후보지가 늘어나면서 코드/이름/주소로 바로 찾을 방법이 없었다. 서버
          쪽 검색 없이(목록이 크지 않음) 클라이언트에서 이미 불러온 목록을 그대로 필터링한다. */}
      <input
        type="search"
        aria-label="후보지 코드, 이름, 주소 검색"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="코드·이름·주소로 검색"
        className="app-input w-full max-w-xs px-3 py-1.5 text-sm"
      />

      <div className="app-card overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">신규 후보지 목록과 검토 상태</caption>
          <thead className="border-b border-[#171310]/[0.08] bg-[#171310]/[0.02] text-xs uppercase tracking-wide text-[var(--sl-ink-soft)] dark:border-white/[0.08] dark:bg-white/[0.02]">
            <tr>
              <th className="px-4 py-3">코드</th>
              <th className="px-4 py-3">이름</th>
              <th className="px-4 py-3">주소</th>
              <th className="px-4 py-3">검토상태</th>
              <th className="px-4 py-3">최종수정일</th>
              <th className="px-4 py-3 text-right">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#171310]/[0.06] dark:divide-white/[0.06]">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--sl-ink-soft)]">
                  불러오는 중...
                </td>
              </tr>
            ) : error && candidates.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--sl-ink-soft)]">
                  목록을 확인할 수 없습니다. 다시 불러오기를 눌러주세요.
                </td>
              </tr>
            ) : candidates.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--sl-ink-soft)]">
                  등록된 후보지가 없습니다. &ldquo;신규 후보지 등록&rdquo; 버튼으로 시작하세요.
                </td>
              </tr>
            ) : filteredCandidates.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--sl-ink-soft)]">
                  &ldquo;{search}&rdquo;와(과) 일치하는 후보지가 없습니다.
                  <button type="button" onClick={() => setSearch("")} className="app-btn-outline mx-auto mt-3 block text-sm">검색 초기화</button>
                </td>
              </tr>
            ) : (
              filteredCandidates.map((c) => (
                <tr key={c.code} className="app-row">
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-[var(--sl-ink-soft)]">{c.code}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/store-eval/candidates/${c.code}`}
                      className="font-medium text-[#171310] hover:underline dark:text-[#f2ede2]"
                    >
                      {c.name || "(이름 없음)"}
                    </Link>
                    {c.isDraft && (
                      <span className="app-badge app-badge-neutral ml-2 px-1.5 py-0.5 text-[11px]">
                        임시저장
                      </span>
                    )}
                    {freshnessByCode.get(c.code)?.state === "재계산필요" && (
                      <span
                        className="app-badge app-badge-warn ml-2 px-1.5 py-0.5 text-[11px]"
                        title={freshnessHint(freshnessByCode.get(c.code)!) ?? undefined}
                      >
                        재계산 필요
                      </span>
                    )}
                  </td>
                  <td title={c.address || undefined} className="max-w-[240px] truncate px-4 py-3 text-[#5c5346] dark:text-[#c9bfae]">{c.address || "-"}</td>
                  <td className="px-4 py-3">
                    <span className={REVIEW_STATUS_STYLE[c.reviewStatus]}>
                      {c.reviewStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[var(--sl-ink-soft)]">{formatDateTime(c.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/store-eval/candidates/${c.code}`}
                        className="app-btn-outline rounded-md px-2.5 py-1 text-xs"
                      >
                        열기
                      </Link>
                      <button
                        type="button"
                        disabled={busyCode !== null}
                        aria-label={`${c.name || c.code} 복사`}
                        onClick={() => handleDuplicate(c.code)}
                        className="app-btn-outline rounded-md px-2.5 py-1 text-xs disabled:opacity-50"
                      >
                        복사
                      </button>
                      <button
                        type="button"
                        disabled={busyCode !== null}
                        aria-label={`${c.name || c.code} 삭제`}
                        onClick={() => handleDelete(c.code)}
                        className="rounded-md border border-[var(--sl-danger)]/30 px-2.5 py-1 text-xs font-medium text-[var(--sl-danger)] hover:bg-[var(--sl-danger-soft)] disabled:opacity-50"
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
