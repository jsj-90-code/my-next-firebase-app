"use client";

// 채팅 입지평가 기록 — 2026-10-06 신설(사용자 "남은일 하셈"). Claude 커넥터 "PC 점포평가"로 직원들이 주소만 평가를
// 돌린 기록(quickEvalChatRuns)을 본다. 읽기 전용이고 담당자 본인만 열린다(/api/store-eval/chat-runs).
// ⚠️ 주소만 초기평가 화면(점포팀 공유)에서는 여기로 오는 링크를 걸지 않는다(QuickEvalChrome 주석).

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime, formatManwonRough } from "@/lib/storeEval/format";
import type { ChatRunRow } from "@/app/api/store-eval/chat-runs/route";

const SCORE_LABELS: [string, string][] = [
  ["locationScore", "위치"],
  ["preemptionScore", "선점"],
  ["visibilityScore", "가시성"],
];

export default function ChatRunsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ChatRunRow[] | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/store-eval/chat-runs", { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "기록을 불러오지 못했습니다.");
      setRows(body.rows);
      setLimit(body.limit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "기록을 불러오지 못했습니다.");
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const scored = rows?.filter((r) => r.result) ?? [];
  const people = new Set(scored.map((r) => r.email ?? "-"));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">채팅 평가 기록</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--sl-ink-soft)]">
          Claude 커넥터 &ldquo;PC 점포평가&rdquo;로 주소만 평가를 돌린 기록입니다. 최근 {limit ?? "-"}건까지 보여주며, 담당자만 볼 수 있습니다.
          점수를 내지 않고 자료만 받아 간 건은 &ldquo;자료만 받음&rdquo;으로 표시합니다.
        </p>
      </div>

      {error && <p role="alert" className="app-notice app-badge-danger px-3 py-2 text-sm">{error}</p>}
      {rows == null && !error && <p className="text-sm text-[var(--sl-ink-soft)]">불러오는 중...</p>}

      {rows != null && (
        <>
          <p className="text-sm text-[var(--sl-ink-soft)]">
            전체 {rows.length}건 · 평가 완료 {scored.length}건 · 사용한 사람 {people.size}명 · 가능 {scored.filter((r) => r.result?.verdict === "가능").length}건
          </p>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.runId} className="app-card-sm rounded-xl p-3">
                <button type="button" onClick={() => setOpen(open === r.runId ? null : r.runId)} className="w-full text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.result ? (
                      <span className={`app-badge ${r.result.verdict === "가능" ? "app-badge-ok" : r.result.verdict === "불가" ? "app-badge-danger" : "app-badge-neutral"}`}>
                        {r.result.verdict}
                      </span>
                    ) : (
                      <span className="app-badge app-badge-neutral">자료만 받음</span>
                    )}
                    <span className="font-medium text-[#171310] dark:text-[#f2ede2]">{r.roadAddress ?? r.address ?? "-"}</span>
                    {r.result && <span className="tabular-nums text-sm">{formatManwonRough(r.result.finalRevenue)}</span>}
                  </div>
                  <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
                    {formatDateTime(r.scoredAt ?? r.createdAt)} · {r.name ?? r.email ?? "-"} · {r.modelName ?? "모델 미기재"}
                    {r.scores ? ` · ${SCORE_LABELS.map(([k, l]) => `${l} ${r.scores?.[k] ?? "-"}`).join(" / ")}` : ""}
                  </p>
                </button>
                {open === r.runId && (
                  <div className="mt-2 border-t border-[var(--sl-hairline)] pt-2 text-xs leading-5 text-[var(--sl-ink-soft)]">
                    {r.result && (
                      <p>
                        판정 값 출처 {r.result.finalSource ?? "-"} · 상권등급 {r.result.marketGrade ?? "-"} · 500m 경쟁 PC방 {r.result.competitorCount ?? "-"}곳 · 참고한 웹 주소 {r.sourcesCount}개
                      </p>
                    )}
                    {r.scores && (
                      <p className="mt-1">
                        특수수요 {String(r.scores.specialDemandType ?? "-")}({String(r.scores.specialDemandIntensity ?? "-")}) · 외부유입 제한 {String(r.scores.inflowRestriction ?? "-")}
                        {r.scores.marketStructureMemo ? ` · ${String(r.scores.marketStructureMemo)}` : ""}
                      </p>
                    )}
                    {r.rationale && <p className="mt-1 whitespace-pre-wrap">근거: {r.rationale}</p>}
                    <p className="mt-1">기록 ID {r.runId} · {r.email ?? "-"}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
