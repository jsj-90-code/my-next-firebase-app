"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="app-theme flex min-h-screen items-center justify-center p-6">
      <section className="app-card w-full max-w-lg rounded-2xl p-8 text-center">
        <h1 className="text-xl font-semibold text-[#171310] dark:text-[#f2ede2]">화면을 불러오지 못했습니다.</h1>
        <p className="mt-3 text-sm text-[#8a8072]">일시적인 오류일 수 있습니다. 다시 시도해 주세요.</p>
        <button type="button" onClick={reset} className="app-btn-primary mt-6 rounded-full px-5 py-2.5 text-sm">
          다시 시도
        </button>
      </section>
    </main>
  );
}
