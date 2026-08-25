"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AutoAuthGate } from "@/components/seatLayout/AutoAuthGate";

const NAV_ITEMS = [
  { href: "/store-eval", label: "대시보드" },
  { href: "/store-eval/candidates", label: "신규후보지" },
  { href: "/store-eval/existing-stores", label: "기존 가맹점 관리" },
  { href: "/store-eval/validation", label: "기존 가맹점 검증" },
  { href: "/store-eval/ai-validation", label: "AI 채점 검증" },
  { href: "/store-eval/settings", label: "운영설정" },
  { href: "/store-eval/backup", label: "백업" },
];

export function StoreEvalChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-theme flex min-h-screen flex-col">
      <AutoAuthGate>
        <header className="border-b border-[#171310]/[0.08] bg-[#fffdf7] dark:border-white/[0.08] dark:bg-[#1c1912]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/store-eval" className="flex items-center gap-2 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-[18px] w-[18px] shrink-0 text-[#c05a2c]">
                <path d="M4 19V9l8-5 8 5v10 M4 19h16 M9 19v-6h6v6" />
              </svg>
              점포평가 <span className="text-[#c05a2c]">V62</span>
            </Link>
            <nav className="app-tabbar flex flex-wrap gap-1 p-1 text-sm">
              {NAV_ITEMS.map((item) => {
                const active = item.href === "/store-eval" ? pathname === item.href : pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`app-tab rounded-lg px-3 py-1.5 ${active ? "app-tab-active" : ""}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </AutoAuthGate>
    </div>
  );
}
