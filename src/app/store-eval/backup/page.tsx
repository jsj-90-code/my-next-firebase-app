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
    return <div className="py-16 text-center text-sm text-[#8a8072]">불러오는 중...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="app-card rounded-2xl p-8 text-center">
        <h2 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">접근 권한이 없습니다</h2>
        <p className="mt-2 text-sm text-[#8a8072]">
          데이터 백업/복원은 점포평가 시스템 관리자만 이용할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-[#171310] dark:text-[#f2ede2]">데이터 백업 / 복원</h1>
        <p className="mt-1 text-sm text-[#8a8072]">
          신규후보지, 기존 가맹점, 매출, 경쟁점, 입지동선평가, 운영설정과 그 변경이력까지 전체 데이터를 다룹니다.
        </p>
      </div>

      <section className="app-card rounded-2xl p-6">
        <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">백업</h2>
        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="app-btn-primary mt-3 rounded-lg px-4 py-2.5 text-sm disabled:opacity-50"
        >
          {busy ? "백업 생성 중..." : "전체 데이터 백업(JSON)"}
        </button>
        {message && <p className="mt-3 text-sm text-[var(--sl-ok)]">{message}</p>}
        {error && <p className="mt-3 text-sm text-[var(--sl-danger)]">백업 실패: {error}</p>}
      </section>

      <section className="app-card rounded-2xl p-6">
        <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">복원</h2>
        <p className="mt-1 text-xs leading-5 text-[#8a8072]">
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
          className="mt-4 block w-full text-sm text-[#5c5346] file:mr-3 file:rounded-md file:border-0 file:bg-[#171310] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white dark:text-[#c9bfae] dark:file:bg-[#f2ede2] dark:file:text-[#171310]"
        />
        {fileName && <p className="mt-2 text-xs text-[#8a8072]">선택한 파일: {fileName}</p>}

        {restoreError && <p className="app-badge app-badge-danger mt-3 w-full justify-start py-2 text-sm">{restoreError}</p>}

        {stage === "previewing" && <p className="mt-3 text-sm text-[#8a8072]">파일 확인 중...</p>}

        {(stage === "ready" || stage === "restoring") && preview && payload && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs text-[#8a8072]">
              이 백업은 {new Date(payload.exportedAt).toLocaleString("ko-KR")}에 만들어졌습니다.
            </p>
            <div className="app-card-sm overflow-x-auto rounded-lg">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-medium text-[#8a8072]">
                  <tr>
                    <th className="px-3 py-2">항목</th>
                    <th className="px-3 py-2">현재 보유</th>
                    <th className="px-3 py-2">새로 추가될 문서</th>
                    <th className="px-3 py-2">덮어써질 문서</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#171310]/[0.06] dark:divide-white/[0.06]">
                  {preview.map((p) => (
                    <tr key={p.label}>
                      <td className="px-3 py-2 font-medium text-[#171310] dark:text-[#f2ede2]">{p.label}</td>
                      <td className="px-3 py-2 text-[#8a8072]">{p.currentTotal === -1 ? "-" : `${p.currentTotal}건`}</td>
                      <td className="px-3 py-2 text-[var(--sl-ok)]">{p.toAdd}건</td>
                      <td className="px-3 py-2 text-[var(--sl-warn)]">{p.toUpdate > 0 ? `${p.toUpdate}건` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[#5c5346] dark:text-[#c9bfae]">
                되돌릴 수 없는 작업입니다. 계속하려면 아래에 정확히 <strong>복원</strong>이라고 입력하세요.
              </span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={stage === "restoring"}
                className="app-input w-40 px-3 py-1.5 text-sm"
              />
            </label>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleRestore}
                disabled={stage === "restoring" || confirmText !== "복원"}
                className="rounded-lg bg-[var(--sl-danger)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
              >
                {stage === "restoring" ? "사전 백업 후 복원 중..." : "사전 백업 후 복원 실행"}
              </button>
              <button
                type="button"
                onClick={resetRestoreFlow}
                disabled={stage === "restoring"}
                className="app-btn-outline rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {stage === "done" && restoreResult && (
          <div className="app-badge app-badge-ok mt-4 w-full flex-col items-start gap-0 rounded-lg px-4 py-3 text-sm">
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
              className="app-btn-outline mt-3 rounded-md px-3 py-1 text-xs font-medium"
            >
              닫기
            </button>
          </div>
        )}
      </section>

      <section className="app-card rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">복원 로그</h2>
          <button
            type="button"
            onClick={loadLog}
            disabled={logLoading}
            className="app-btn-outline rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
          >
            {logLoading ? "불러오는 중..." : "불러오기"}
          </button>
        </div>
        {log == null ? (
          <p className="mt-3 text-sm text-[#8a8072]">&ldquo;불러오기&rdquo;를 눌러 지금까지의 복원 시도 이력을 확인하세요.</p>
        ) : log.length === 0 ? (
          <p className="mt-3 text-sm text-[#8a8072]">아직 복원 이력이 없습니다.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {log.map((entry) => (
              <li key={entry.id} className="app-card-sm rounded-xl p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-[#171310] dark:text-[#f2ede2]">{formatDateTime(entry.restoredAt)}</span>
                  <span className={`app-badge ${entry.success ? "app-badge-ok" : "app-badge-danger"}`}>
                    {entry.success ? "성공" : "실패"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#8a8072]">
                  실행자: {entry.actor ?? "알수없음"} · 백업 시점: {entry.sourceExportedAt ? new Date(entry.sourceExportedAt).toLocaleString("ko-KR") : "-"}
                </p>
                {entry.success && entry.counts && (
                  <p className="mt-1 text-xs text-[#5c5346] dark:text-[#c9bfae]">
                    {Object.entries(entry.counts)
                      .map(([k, v]) => `${k} ${v}건`)
                      .join(" · ")}
                  </p>
                )}
                {!entry.success && entry.error && <p className="mt-1 text-xs text-[var(--sl-danger)]">{entry.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
