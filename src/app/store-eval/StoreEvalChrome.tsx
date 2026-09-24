"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AutoAuthGate } from "@/components/seatLayout/AutoAuthGate";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV_ITEMS = [
  { href: "/store-eval", label: "대시보드" },
  { href: "/store-eval/how-it-works", label: "매출 계산법" },
  { href: "/store-eval/candidates", label: "신규후보지" },
  { href: "/store-eval/existing-stores", label: "기존 가맹점 관리" },
  { href: "/store-eval/validation", label: "기존 가맹점 검증" },
  { href: "/store-eval/competitor-coords", label: "경쟁점 좌표" },
  { href: "/store-eval/ai-validation", label: "AI 채점 검증" },
  { href: "/store-eval/settings", label: "운영설정" },
  { href: "/store-eval/backup", label: "백업" },
  // 실험실은 별도 화면(자기 헤더·탭)이다 — 여기서는 들어가는 문만 둔다.
  { href: "/store-eval/lab", label: "실험실 →" },
];

export function StoreEvalChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const currentPage = NAV_ITEMS.find((item) => item.href === "/store-eval" ? pathname === item.href : pathname?.startsWith(item.href))?.label ?? "점포평가";
  // 2026-09-24 밤 사용자: "V62랑 실험실이랑 웹을 분리하자" — 실험실(/store-eval/lab)에서는 운영(V62) 메뉴를 안 그린다.
  // 실험실은 자기 탭(성적·후보지·계수·산식·경쟁점·자료)을 페이지 안에서 그리고, 여기서는 운영으로 돌아가는 길만 둔다.
  const isLab = pathname?.startsWith("/store-eval/lab") ?? false;
  if (isLab) {
    return (
      <div className="app-theme flex min-h-screen flex-col">
        <AutoAuthGate>
          <a href="#store-eval-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 app-btn-primary rounded-lg px-4 py-2">본문으로 바로가기</a>
          <header className="border-b border-[#171310]/[0.08] bg-[#fffdf7] dark:border-white/[0.08] dark:bg-[#1c1912]">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
              <div className="flex items-center gap-3">
                <Link href="/" className="text-xs text-[var(--sl-ink-soft)] transition hover:text-[#171310] dark:hover:text-[#f2ede2]">← 홈으로</Link>
                <Link href="/store-eval/lab" className="flex items-center gap-2 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-[18px] w-[18px] shrink-0 text-[var(--sl-gold)]">
                    <path d="M9 3h6 M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" />
                  </svg>
                  점포평가 실험실
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">교과서식 · 운영과 분리</span>
                </Link>
              </div>
              <Link href="/store-eval" className="app-btn-outline rounded-lg px-3 py-1.5 text-xs">운영 점포평가(V62) →</Link>
              <ThemeToggle className="app-btn-outline ml-auto rounded-full px-3 py-1.5 text-xs" />
            </div>
          </header>
          <main id="store-eval-content" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6">{children}</main>
        </AutoAuthGate>
      </div>
    );
  }
  return (
    <div className="app-theme flex min-h-screen flex-col">
      <AutoAuthGate>
        <a href="#store-eval-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 app-btn-primary rounded-lg px-4 py-2">본문으로 바로가기</a>
        <header className="border-b border-[#171310]/[0.08] bg-[#fffdf7] dark:border-white/[0.08] dark:bg-[#1c1912]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="text-xs text-[var(--sl-ink-soft)] transition hover:text-[#171310] dark:hover:text-[#f2ede2]"
              >
                ← 홈으로
              </Link>
              <Link href="/store-eval" className="flex items-center gap-2 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-[18px] w-[18px] shrink-0 text-[var(--sl-gold)]">
                  <path d="M4 19V9l8-5 8 5v10 M4 19h16 M9 19v-6h6v6" />
                </svg>
                점포평가
              </Link>
            </div>
            <nav aria-label="점포평가 메뉴" className="app-tabbar hidden gap-1 p-1 text-sm lg:flex">
              {NAV_ITEMS.map((item) => {
                const active = item.href === "/store-eval" ? pathname === item.href : pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`app-tab shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 ${active ? "app-tab-active" : ""}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <ThemeToggle className="app-btn-outline ml-auto rounded-full px-3 py-1.5 text-xs" />
            <div className="order-3 w-full lg:hidden">
              <button type="button" aria-expanded={menuOpen} aria-controls="store-eval-mobile-menu" onClick={() => setMenuOpen((open) => !open)} className="app-btn-outline flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm">
                <span className="font-semibold">{currentPage}</span>
                <span className="text-xs text-[var(--sl-ink-soft)]">{menuOpen ? "메뉴 닫기 −" : "전체 메뉴 +"}</span>
              </button>
              <nav id="store-eval-mobile-menu" aria-label="점포평가 모바일 메뉴" hidden={!menuOpen} className="mt-2">
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-[#171310]/[0.08] p-2 dark:border-white/[0.08]">
                  {NAV_ITEMS.map((item) => {
                    const active = item.href === "/store-eval" ? pathname === item.href : pathname?.startsWith(item.href);
                    return <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} aria-current={active ? "page" : undefined} className={`app-tab rounded-lg px-3 py-3 text-sm ${active ? "app-tab-active" : ""}`}>{item.label}</Link>;
                  })}
                </div>
              </nav>
            </div>
          </div>
        </header>
        <main id="store-eval-content" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6">{children}</main>
      </AutoAuthGate>
    </div>
  );
}
