"use client";

import { useState } from "react";

// 2026-10-27 밤 사용자: 채팅 버튼이 구석에 있고 설명이 화면 맨 아래 목록에 묻혀 "아무도 안 쓸 듯", 저장·불러오기를
// 놓치기 쉽다 → 탭마다 "작업 순서" 단계 표시. 끝난 단계는 한 줄로 접고, 지금 할 단계만 펼쳐 그 자리에 버튼과
// 채팅에 칠 문장(복사)을 둔다. 단계가 끝났는지는 프로젝트 상태로 판단한다(Workspace가 done을 계산해 넘김).
export type WorkStep = {
  key: string;
  title: string;
  done: boolean;
  /** 펼쳤을 때 보이는 짧은 설명 */
  hint?: string;
  /** Claude 채팅에 칠 문장 — 복사 버튼과 같이 보인다 */
  prompt?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean; emphasize?: boolean };
  /** 버튼 아래 "또는 …" — 채팅 대신 손으로 하는 길(10-27 사용자: 몇 개만 고칠 땐 직접 입력이 편하다) */
  alt?: string;
};

// 10-27 밤 사용자: 작업 순서에서 [채팅 결과 불러오기]를 눌렀는데 "반응이 없다" — 안내(결과 없음·오류)가 위쪽 바에만 떠서
// 안 보였다. 같은 문구를 지금 단계 버튼 아래에도 띄운다.
type Status = { text: string; tone: "info" | "success" | "error" };

export function SeatLayoutSteps({
  steps,
  connectorUsed = null,
  status,
}: {
  steps: WorkStep[];
  connectorUsed?: boolean | null;
  status?: Status;
}) {
  // 커넥터를 한 번도 안 쓴 사람(서버 기록 없음)이면 연결 안내를 펼치고 강조한다. 모르면(null) 접어 둔다.
  const firstTime = connectorUsed === false;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const currentIdx = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      // 클립보드가 막힌 브라우저 — 문장이 화면에 보이니 직접 복사하면 된다.
    }
  }

  return (
    <section className="app-card rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[#171310] dark:text-[#f2ede2]">작업 순서</h2>
        <span className="text-xs font-medium text-[var(--sl-ink-soft)]">
          {doneCount} / {steps.length}
        </span>
      </div>
      {/* 10-27 밤 사용자: 커넥터 설치 안내가 없다. 조직 커넥터 "PC 점포평가"는 관리자가 이미 추가해 둠(09-29,
          docs/chat-location-eval-20260929.md) — 직원은 각자 처음 한 번 [연결]만 하면 된다. */}
      <details
        open={firstTime}
        className={`mt-3 rounded-xl border px-3 py-2 ${
          firstTime
            ? "border-[var(--sl-gold)]/60 bg-[var(--sl-gold)]/[0.08]"
            : "border-[#171310]/[0.1] dark:border-white/[0.1]"
        }`}
      >
        <summary className="cursor-pointer text-xs font-semibold text-[var(--sl-gold-ink)]">
          {firstTime ? "먼저 Claude 커넥터를 연결하세요 (한 번만)" : "처음이면: Claude 커넥터 연결 (한 번만)"}
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">
          <li>
            PC 웹{" "}
            {/* 커넥터 페이지로 바로 가면 빈 화면이 뜬다(10-27 사용자) — 설정 첫 화면으로 열고 메뉴를 누르게 한다. */}
            <a
              href="https://claude.ai/settings"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--sl-gold-ink)] underline"
            >
              claude.ai 설정 열기 ↗
            </a>{" "}
            → 왼쪽 메뉴 [커넥터]
          </li>
          <li><strong>PC 점포평가</strong> 옆 [연결] → 회사 구글 계정으로 로그인 → [허용]</li>
          <li>도구 권한은 &quot;항상 허용&quot;으로 두면 매번 묻지 않습니다.</li>
          <li>새 채팅에서 아래 단계의 문장을 붙여 넣으면 됩니다. 모델은 Opus를 권장합니다(도면 읽기 정확도).</li>
          <li>도구가 안 보이거나 예전 목록이면: 커넥터 [연결 해제] 후 다시 [연결].</li>
        </ol>
      </details>
      <ol className="mt-3 space-y-1.5">
        {steps.map((s, i) => {
          const isCurrent = i === currentIdx;
          const expanded = isCurrent || openKey === s.key;
          return (
            <li
              key={s.key}
              className={`rounded-xl px-3 py-2 ${
                isCurrent
                  ? "border border-[var(--sl-gold)]/50 bg-[var(--sl-gold)]/[0.08]"
                  : "border border-transparent"
              }`}
            >
              <button
                type="button"
                onClick={() => setOpenKey((k) => (k === s.key ? null : s.key))}
                className="flex w-full items-center gap-2.5 text-left"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    s.done
                      ? "bg-[#3f7d4e] text-white"
                      : isCurrent
                        ? "bg-[var(--sl-gold)] text-white"
                        : "border border-[#171310]/20 text-[var(--sl-ink-soft)] dark:border-white/20"
                  }`}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <span
                  className={`text-sm ${
                    isCurrent
                      ? "font-semibold text-[#171310] dark:text-[#f2ede2]"
                      : s.done
                        ? "text-[var(--sl-ink-soft)]"
                        : "text-[#5c5346] dark:text-[#c9bfae]"
                  }`}
                >
                  {s.title}
                </span>
              </button>
              {expanded && (s.hint || s.prompt || s.action || s.alt) && (
                <div className="mt-2 space-y-2 pl-7">
                  {s.hint && <p className="text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">{s.hint}</p>}
                  {s.prompt && (
                    <div>
                      <p className="text-[11px] font-medium text-[var(--sl-ink-soft)]">Claude 채팅에 이렇게 입력하세요</p>
                      <div className="mt-1 flex items-center gap-2 rounded-lg bg-[#171310]/[0.05] px-2.5 py-1.5 dark:bg-white/[0.06]">
                        <code className="flex-1 truncate text-xs text-[#171310] dark:text-[#f2ede2]">{s.prompt}</code>
                        <button
                          type="button"
                          onClick={() => void copy(s.key, s.prompt!)}
                          className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold text-[var(--sl-gold-ink)] hover:bg-[var(--sl-gold)]/15"
                        >
                          {copiedKey === s.key ? "복사됨" : "복사"}
                        </button>
                      </div>
                      {/* 10-30: 이 화면이 채팅 결과를 실시간으로 받아 넣는다(SeatLayoutWorkspace onChatDraftArrived). */}
                      <p className="mt-1 text-[11px] text-[var(--sl-ink-soft)]">이 화면을 열어 둔 채 채팅하면 결과가 저절로 들어옵니다(아래 버튼은 다시 넣을 때).</p>
                    </div>
                  )}
                  {s.action && (
                    <button
                      type="button"
                      disabled={s.action.disabled}
                      onClick={s.action.onClick}
                      className={`w-full rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
                        s.action.emphasize ? "app-btn-accent" : "app-btn-outline"
                      }`}
                    >
                      {s.action.label}
                    </button>
                  )}
                  {isCurrent && status?.text && (
                    <p
                      className={`text-xs font-medium leading-5 ${
                        status.tone === "error"
                          ? "text-[var(--sl-danger)]"
                          : status.tone === "success"
                            ? "text-[var(--sl-ok)]"
                            : "text-[var(--sl-ink-soft)]"
                      }`}
                    >
                      {status.text}
                    </p>
                  )}
                  {s.alt && (
                    <p className="text-xs leading-5 text-[var(--sl-ink-soft)]">
                      <span className="font-semibold text-[#5c5346] dark:text-[#c9bfae]">또는 직접 수정: </span>
                      {s.alt}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
