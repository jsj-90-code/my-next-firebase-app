"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "sans-serif" }}>
          <section style={{ maxWidth: 480, textAlign: "center" }}>
            <h1>서비스 오류가 발생했습니다.</h1>
            <p>잠시 후 다시 시도해 주세요.</p>
            <button type="button" onClick={reset}>다시 시도</button>
          </section>
        </main>
      </body>
    </html>
  );
}
