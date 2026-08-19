"use client";

// 데이터 백업 화면 - 관리자만 접근 가능. 전체 데이터를 JSON 하나로 내려받는다.

import { useState } from "react";
import { exportFullBackup } from "@/lib/storeEval/backup";
import { useIsStoreEvalAdmin } from "@/lib/storeEval/useIsAdmin";

export default function StoreEvalBackupPage() {
  const { isAdmin, loading } = useIsStoreEvalAdmin();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await exportFullBackup();
      setMessage("백업 파일을 다운로드했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "백업에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">불러오는 중...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">접근 권한이 없습니다</h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          데이터 백업은 점포평가 시스템 관리자만 이용할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">데이터 백업</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          신규후보지, 기존 가맹점, 매출, 운영설정과 그 변경이력까지 전체 데이터를 JSON 파일 하나로 내려받습니다.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {busy ? "백업 생성 중..." : "전체 데이터 백업(JSON)"}
        </button>
        {message && <p className="mt-3 text-sm text-green-600 dark:text-green-400">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">백업 실패: {error}</p>}
      </section>
    </div>
  );
}
