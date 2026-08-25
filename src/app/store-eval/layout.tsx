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

export default function StoreEvalLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AutoAuthGate>
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/store-eval" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              점포평가 시스템 (V62)
            </Link>
            <nav className="flex gap-1 text-sm">
              {NAV_ITEMS.map((item) => {
                const active = item.href === "/store-eval" ? pathname === item.href : pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-md px-3 py-1.5 transition ${
                      active
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </div>
    </AutoAuthGate>
  );
}
