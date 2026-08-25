"use client";

// 데이터 백업/복원 화면 - 관리자만 접근 가능.
// 복원은 "병합(upsert)"만 한다 — 백업 파일에 없는 기존 문서를 지우지 않는다(store.ts 참고).
// 실행 전 항상: 파일 검증 → 미리보기(몇 건 추가/덮어쓸지) → 확인창 → 사전 자동백업 → 복원 순서를 지킨다.

import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  exportFullBackup,
  performRestore,
  validateBackupPayload,
  computeRestorePreview,
  type RestorePreviewItem,
  type StoreEvalBackupPayload,
} from "@/lib/storeEval/backup";
import { formatDateTime } from "@/lib/storeEval/format";
import { listRestoreLog, type RestoreLogEntry } from "@/lib/storeEval/store";
import { useIsStoreEvalAdmin } from "@/lib/storeEval/useIsAdmin";

type RestoreStage = "idle" | "previewing" | "ready" | "restoring" | "done";

export default function StoreEvalBackupPage() {
  const { user } = useAuth();
  const { isAdmin, loading } = useIsStoreEvalAdmin();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [stage, setStage] = useState<RestoreStage>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [payload, setPayload] = useState<StoreEvalBackupPayload | null>(null);
  const [preview, setPreview] = useState<RestorePreviewItem[] | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreLogEntry | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const [log, setLog] = useState<RestoreLogEntry[] | null>(null);
  const [logLoading, setLogLoading] = useState(false);

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

  async function loadLog() {
    setLogLoading(true);
    try {
      setLog(await listRestoreLog());
    } catch {
      // 로그 조회 실패는 복원 기능 자체를 막을 이유가 없어 조용히 무시한다 - 새로고침하면 다시 시도됨.
    } finally {
      setLogLoading(false);
    }
  }

  function resetRestoreFlow() {
    setStage("idle");
    setFileName(null);
    setPayload(null);
    setPreview(null);
    setRestoreError(null);
    setRestoreResult(null);
    setConfirmText("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileSelected(file: File) {
    resetRestoreFlow();
    setFileName(file.name);
    setStage("previewing");
    try {
      const text = await file.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        setRestoreError("파일을 JSON으로 읽지 못했습니다 — 이 화면에서 받은 백업 파일이 맞는지 확인해주세요.");
        setStage("idle");
        return;
      }
      const validation = validateBackupPayload(raw);
      if (!validation.valid) {
        setRestoreError(validation.errors.join(" / "));
        setStage("idle");
        return;
      }
      const previewItems = await computeRestorePreview(validation.payload);
      setPayload(validation.payload);
      setPreview(previewItems);
      setStage("ready");
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "미리보기를 만들지 못했습니다.");
      setStage("idle");
    }
  }

  async function handleRestore() {
    if (!payload) return;
    if (confirmText !== "복원") {
      setRestoreError('확인을 위해 아래 입력란에 정확히 "복원"이라고 입력해주세요.');
      return;
    }
    setStage("restoring");
    setRestoreError(null);
    try {
      // 요청사항 17 — 복원 전 지금 상태를 반드시 한 번 더 자동 백업(다운로드)한다.
      await exportFullBackup();
      const result = await performRestore(payload, user?.email ?? null);
      setRestoreResult(result);
      setStage("done");
      await loadLog();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "복원 중 오류가 발생했습니다.");
      setStage("ready");
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
          데이터 백업/복원은 점포평가 시스템 관리자만 이용할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">데이터 백업 / 복원</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          신규후보지, 기존 가맹점, 매출, 경쟁점, 입지동선평가, 운영설정과 그 변경이력까지 전체 데이터를 다룹니다.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">백업</h2>
        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="mt-3 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {busy ? "백업 생성 중..." : "전체 데이터 백업(JSON)"}
        </button>
        {message && <p className="mt-3 text-sm text-green-600 dark:text-green-400">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">백업 실패: {error}</p>}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">복원</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          백업 파일에 있는 문서만 지금 데이터 위에 덮어씁니다(병합) — 백업 파일에 없는 기존 데이터는 지우지 않습니다.
          실행 전 지금 상태를 자동으로 한 번 더 백업 다운로드합니다.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          disabled={stage === "restoring"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelected(file);
          }}
          className="mt-4 block w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white dark:text-zinc-400 dark:file:bg-zinc-100 dark:file:text-zinc-900"
        />
        {fileName && <p className="mt-2 text-xs text-zinc-400">선택한 파일: {fileName}</p>}

        {restoreError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{restoreError}</p>
        )}

        {stage === "previewing" && <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">파일 확인 중...</p>}

        {(stage === "ready" || stage === "restoring") && preview && payload && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              이 백업은 {new Date(payload.exportedAt).toLocaleString("ko-KR")}에 만들어졌습니다.
            </p>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  <tr>
                    <th className="px-3 py-2">항목</th>
                    <th className="px-3 py-2">현재 보유</th>
                    <th className="px-3 py-2">새로 추가될 문서</th>
                    <th className="px-3 py-2">덮어써질 문서</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {preview.map((p) => (
                    <tr key={p.label}>
                      <td className="px-3 py-2 font-medium text-zinc-800 dark:text-zinc-200">{p.label}</td>
                      <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{p.currentTotal === -1 ? "-" : `${p.currentTotal}건`}</td>
                      <td className="px-3 py-2 text-emerald-700 dark:text-emerald-400">{p.toAdd}건</td>
                      <td className="px-3 py-2 text-amber-700 dark:text-amber-400">{p.toUpdate > 0 ? `${p.toUpdate}건` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-700 dark:text-zinc-300">
                되돌릴 수 없는 작업입니다. 계속하려면 아래에 정확히 <strong>복원</strong>이라고 입력하세요.
              </span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={stage === "restoring"}
                className="w-40 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </label>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleRestore}
                disabled={stage === "restoring" || confirmText !== "복원"}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
              >
                {stage === "restoring" ? "사전 백업 후 복원 중..." : "사전 백업 후 복원 실행"}
              </button>
              <button
                type="button"
                onClick={resetRestoreFlow}
                disabled={stage === "restoring"}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {stage === "done" && restoreResult && (
          <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
            <p className="font-semibold">복원이 완료되었습니다.</p>
            <ul className="mt-2 list-inside list-disc text-xs">
              {restoreResult.counts &&
                Object.entries(restoreResult.counts).map(([key, count]) => (
                  <li key={key}>
                    {key}: {count}건
                  </li>
                ))}
            </ul>
            <button
              type="button"
              onClick={resetRestoreFlow}
              className="mt-3 rounded-md border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300"
            >
              닫기
            </button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">복원 로그</h2>
          <button
            type="button"
            onClick={loadLog}
            disabled={logLoading}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {logLoading ? "불러오는 중..." : "불러오기"}
          </button>
        </div>
        {log == null ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">&ldquo;불러오기&rdquo;를 눌러 지금까지의 복원 시도 이력을 확인하세요.</p>
        ) : log.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">아직 복원 이력이 없습니다.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {log.map((entry) => (
              <li key={entry.id} className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{formatDateTime(entry.restoredAt)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      entry.success
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                    }`}
                  >
                    {entry.success ? "성공" : "실패"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  실행자: {entry.actor ?? "알수없음"} · 백업 시점: {entry.sourceExportedAt ? new Date(entry.sourceExportedAt).toLocaleString("ko-KR") : "-"}
                </p>
                {entry.success && entry.counts && (
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {Object.entries(entry.counts)
                      .map(([k, v]) => `${k} ${v}건`)
                      .join(" · ")}
                  </p>
                )}
                {!entry.success && entry.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{entry.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
