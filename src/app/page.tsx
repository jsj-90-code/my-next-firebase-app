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

        <AuthPanel />
      </main>
    </div>
  );
}
