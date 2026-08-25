"use client";

// 2. 신규후보지 입력 - 후보지 목록 화면.
// listCandidates/generateNextCandidateCode/duplicateCandidate/deleteCandidate 전부 store.ts 함수를 그대로 사용한다.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { deleteCandidate, duplicateCandidate, listCandidates } from "@/lib/storeEval/store";
import type { CandidateInput, ReviewStatus } from "@/lib/storeEval/types";
import { formatDateTime } from "@/lib/storeEval/format";

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
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listCandidates();
      setCandidates(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "후보지 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 요청사항 — 후보지코드는 "임시저장/저장"을 처음 누르는 순간에만 발급한다(BasicInfoTab.handleSave).
  // 여기서 미리 발급해두면 등록 버튼만 누르고 저장 안 하고 나가는 경우 번호가 영구히 건너뛴다.
  function handleCreate() {
    setCreating(true);
    router.push("/store-eval/candidates/new");
  }

  async function handleDuplicate(code: string) {
    setBusyCode(code);
    setError(null);
    try {
      const copy = await duplicateCandidate(code, user?.email ?? null);
      router.push(`/store-eval/candidates/${copy.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "후보지를 복사하지 못했습니다.");
      setBusyCode(null);
    }
  }

  async function handleDelete(code: string) {
    if (!confirm(`${code} 후보지를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    setBusyCode(code);
    setError(null);
    try {
      await deleteCandidate(code, user?.email ?? null);
      await load();
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
          <p className="mt-1 text-sm text-[#8a8072]">
            신규 후보지를 등록하고, 경쟁점·입지동선평가를 거쳐 V62 최종판정을 확인합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="app-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
        >
          {creating ? "코드 발급 중..." : "+ 신규 후보지 등록"}
        </button>
      </div>

      {error && (
        <p className="app-badge app-badge-danger w-full justify-start px-3 py-2 text-sm">{error}</p>
      )}

      {/* 2026-08-25 추가 — 후보지가 늘어나면서 코드/이름/주소로 바로 찾을 방법이 없었다. 서버
          쪽 검색 없이(목록이 크지 않음) 클라이언트에서 이미 불러온 목록을 그대로 필터링한다. */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="코드·이름·주소로 검색"
        className="app-input w-full max-w-xs px-3 py-1.5 text-sm"
      />

      <div className="app-card overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-[#171310]/[0.08] bg-[#171310]/[0.02] text-xs uppercase tracking-wide text-[#8a8072] dark:border-white/[0.08] dark:bg-white/[0.02]">
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
                <td colSpan={6} className="px-4 py-8 text-center text-[#8a8072]">
                  불러오는 중...
                </td>
              </tr>
            ) : candidates.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[#8a8072]">
                  등록된 후보지가 없습니다. &ldquo;신규 후보지 등록&rdquo; 버튼으로 시작하세요.
                </td>
              </tr>
            ) : filteredCandidates.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[#8a8072]">
                  &ldquo;{search}&rdquo;와(과) 일치하는 후보지가 없습니다.
                </td>
              </tr>
            ) : (
              filteredCandidates.map((c) => (
                <tr key={c.code} className="app-row">
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-[#8a8072]">{c.code}</td>
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
                  </td>
                  <td className="max-w-[240px] truncate px-4 py-3 text-[#5c5346] dark:text-[#c9bfae]">{c.address || "-"}</td>
                  <td className="px-4 py-3">
                    <span className={REVIEW_STATUS_STYLE[c.reviewStatus]}>
                      {c.reviewStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[#8a8072]">{formatDateTime(c.updatedAt)}</td>
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
                        disabled={busyCode === c.code}
                        onClick={() => handleDuplicate(c.code)}
                        className="app-btn-outline rounded-md px-2.5 py-1 text-xs disabled:opacity-50"
                      >
                        복사
                      </button>
                      <button
                        type="button"
                        disabled={busyCode === c.code}
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
