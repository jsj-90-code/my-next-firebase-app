import Link from "next/link";

export default function NotFound() {
  return (
    <main className="app-theme flex min-h-screen items-center justify-center p-6">
      <section className="app-card w-full max-w-lg rounded-2xl p-8 text-center">
        <h1 className="text-xl font-semibold text-[#171310] dark:text-[#f2ede2]">페이지를 찾을 수 없습니다.</h1>
        <p className="mt-3 text-sm text-[#8a8072]">주소가 변경되었거나 존재하지 않는 페이지입니다.</p>
        <Link href="/" className="app-btn-primary mt-6 inline-block rounded-full px-5 py-2.5 text-sm">
          홈으로 이동
        </Link>
      </section>
    </main>
  );
}
