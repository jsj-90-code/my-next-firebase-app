import Link from "next/link";
import { AuthPanel } from "@/components/AuthPanel";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col items-center gap-8 text-center">
        <div className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
            Next.js + Firebase + Vercel + Claude
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            GitHub · Vercel · Firebase · Claude
          </h1>
          <p className="mx-auto max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Firebase Auth로 로그인한 뒤 Claude와 대화하세요. GitHub에 푸시하면
            Vercel이 자동으로 배포합니다.
          </p>
        </div>

        <Link
          href="/seat-layout"
          className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            사내 도구
          </p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            PC방 좌석배치도 작업 툴 →
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            매장 도면에 존을 그리고, AI로 좌석 수를 인식하고, 발주용 FHD 이미지를 만듭니다.
          </p>
        </Link>

        <AuthPanel />
      </main>
    </div>
  );
}
