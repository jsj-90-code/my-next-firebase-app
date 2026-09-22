"use client";

// 주소만 초기평가 전용 껍데기. **점포평가(StoreEvalChrome)와 공유하지 않는다** — 그 파일에
// 메뉴를 걸면 "V62 웹 안의 한 화면"이 되어 버리기 때문이다(사용자 지시 2026-09-22).
//
// 여기서 하는 일은 둘뿐이다: 로그인 관문(AutoAuthGate) · 테마 토글.
// 메뉴가 없는 건 의도다 — 이 도구는 화면이 하나다.
//
// ⚠️ **다른 화면으로 가는 링크를 넣지 마라**(사용자 지시 2026-09-22: "홈버튼 없애줘 홈으로
//    못가게해. 이거 페이지 점포팀에 공유할건데"). 이 페이지는 점포개발팀에 공유하는 것이고,
//    홈 화면에는 다른 사내 도구들이 걸려 있다. 홈으로 가는 길을 내면 그것들이 노출된다.
//    링크를 지우는 게 접근 통제는 아니지만(주소를 직접 치면 열린다), 길을 내지 않는 건
//    의도적인 선택이다.

import type { ReactNode } from "react";
import { AutoAuthGate } from "@/components/seatLayout/AutoAuthGate";
import { ThemeToggle } from "@/components/ThemeToggle";

export function QuickEvalChrome({ children }: { children: ReactNode }) {
  return (
    <div className="app-theme flex min-h-screen flex-col">
      <AutoAuthGate>
        <a
          href="#quick-eval-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 app-btn-primary rounded-lg px-4 py-2"
        >
          본문으로 바로가기
        </a>
        <header className="border-b border-[#171310]/[0.08] bg-[#fffdf7] dark:border-white/[0.08] dark:bg-[#1c1912]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="h-[18px] w-[18px] shrink-0 text-[var(--sl-gold)]"
              >
                <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z M12 10.5h.01" />
              </svg>
              주소만 초기평가
            </span>
            <ThemeToggle className="app-btn-outline ml-auto rounded-full px-3 py-1.5 text-xs" />
          </div>
        </header>
        <main id="quick-eval-content" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 py-6">
          {children}
        </main>
      </AutoAuthGate>
    </div>
  );
}
