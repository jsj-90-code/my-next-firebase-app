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
  진행: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  보류: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  종료: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  완료: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

export default function CandidateListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<CandidateInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">신규후보지</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            신규 후보지를 등록하고, 경쟁점·입지동선평가를 거쳐 V62 최종판정을 확인합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {creating ? "코드 발급 중..." : "+ 신규 후보지 등록"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">코드</th>
              <th className="px-4 py-3">이름</th>
              <th className="px-4 py-3">주소</th>
              <th className="px-4 py-3">검토상태</th>
              <th className="px-4 py-3">최종수정일</th>
              <th className="px-4 py-3 text-right">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400">
                  불러오는 중...
                </td>
              </tr>
            ) : candidates.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400">
                  등록된 후보지가 없습니다. &ldquo;신규 후보지 등록&rdquo; 버튼으로 시작하세요.
                </td>
              </tr>
            ) : (
              candidates.map((c) => (
                <tr key={c.code} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">{c.code}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/store-eval/candidates/${c.code}`}
                      className="font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                    >
                      {c.name || "(이름 없음)"}
                    </Link>
                    {c.isDraft && (
                      <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        임시저장
                      </span>
                    )}
                  </td>
                  <td className="max-w-[240px] truncate px-4 py-3 text-zinc-600 dark:text-zinc-400">{c.address || "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REVIEW_STATUS_STYLE[c.reviewStatus]}`}>
                      {c.reviewStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{formatDateTime(c.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/store-eval/candidates/${c.code}`}
                        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        열기
                      </Link>
                      <button
                        type="button"
                        disabled={busyCode === c.code}
                        onClick={() => handleDuplicate(c.code)}
                        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        복사
                      </button>
                      <button
                        type="button"
                        disabled={busyCode === c.code}
                        onClick={() => handleDelete(c.code)}
                        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
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
