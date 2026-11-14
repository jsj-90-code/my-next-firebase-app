"use client";

// 경쟁점 가동률 측정기 껍데기 — 로그인 관문(AutoAuthGate) · 제목 · 테마 토글.

import Link from "next/link";
import type { ReactNode } from "react";
import { AutoAuthGate } from "@/components/seatLayout/AutoAuthGate";
import { ThemeToggle } from "@/components/ThemeToggle";

/** 측정기 아티팩트(claude.ai) 주소 — 원본 artifacts/ping-monitor, 2026-11-15 첫 게시. */
const ARTIFACT_URL = "https://claude.ai/artifact/FkgkXiP3zycFLTEpyhAUDp";

export function PingMonitorChrome({ children }: { children: ReactNode }) {
  return (
    <div className="app-theme flex min-h-screen flex-col">
      <AutoAuthGate>
        <header className="border-b border-[#171310]/[0.08] bg-[#fffdf7] dark:border-white/[0.08] dark:bg-[#1c1912]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/ping-monitor" className="flex items-center gap-2 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-[18px] w-[18px] shrink-0 text-[var(--sl-gold)]">
                <path d="M3 12h4l3-8 4 16 3-8h4" />
              </svg>
              경쟁점 가동률
            </Link>
            {/* 2026-11-15 사용자: 웹은 현장·등록(내 위치·끄는 지도)용으로 남기고, 보기·AI에게 묻기는 claude.ai 아티팩트로 — 거기로 가는 링크. */}
            <a
              href={ARTIFACT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="app-btn-outline ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs"
              title="claude.ai에서 여는 측정기 화면 — 같은 자료로 상권 비교와 AI에게 묻기를 씁니다(「PC 점포평가」 커넥터 연결 필요)"
            >
              claude.ai에서 보기 · AI에게 묻기 ↗
            </a>
            <ThemeToggle className="app-btn-outline rounded-full px-3 py-1.5 text-xs" />
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-6">{children}</main>
      </AutoAuthGate>
    </div>
  );
}
