"use client";

// 경쟁점 가동률 측정기 껍데기 — 로그인 관문(AutoAuthGate) · 제목 · 테마 토글.

import Link from "next/link";
import type { ReactNode } from "react";
import { AutoAuthGate } from "@/components/seatLayout/AutoAuthGate";
import { ThemeToggle } from "@/components/ThemeToggle";

export function PingMonitorChrome({ children }: { children: ReactNode }) {
  return (
    <div className="app-theme flex min-h-screen flex-col">
      <AutoAuthGate>
        <header className="border-b border-[#171310]/[0.08] bg-[#fffdf7] dark:border-white/[0.08] dark:bg-[#1c1912]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="text-xs text-[var(--sl-ink-soft)] hover:underline">
              홈
            </Link>
            <Link href="/ping-monitor" className="flex items-center gap-2 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-[18px] w-[18px] shrink-0 text-[var(--sl-gold)]">
                <path d="M3 12h4l3-8 4 16 3-8h4" />
              </svg>
              경쟁점 가동률
            </Link>
            <ThemeToggle className="app-btn-outline ml-auto rounded-full px-3 py-1.5 text-xs" />
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 py-6">{children}</main>
      </AutoAuthGate>
    </div>
  );
}
