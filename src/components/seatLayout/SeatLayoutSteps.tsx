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
};

export function SeatLayoutSteps({ steps }: { steps: WorkStep[] }) {
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
              {expanded && (s.hint || s.prompt || s.action) && (
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
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
