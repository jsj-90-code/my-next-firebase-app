"use client";

import Link from "next/link";

export default function StoreEvalError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <section className="app-card mx-auto max-w-xl rounded-2xl p-6 sm:p-8" role="alert">
      <p className="text-sm font-medium text-[var(--sl-danger)]">화면을 표시하지 못했습니다</p>
      <h1 className="mt-2 text-xl font-semibold">다시 시도해 주세요</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--sl-ink-soft)]">일시적인 오류가 발생했습니다. 저장하지 않은 입력은 다시 확인해 주세요. 문제가 계속되면 대시보드로 이동해 해당 매장을 다시 열어보세요.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={unstable_retry} className="app-btn-primary rounded-lg px-4 py-2">다시 시도</button>
        <Link href="/store-eval" className="app-btn-outline rounded-lg px-4 py-2">대시보드로 이동</Link>
      </div>
    </section>
  );
}
