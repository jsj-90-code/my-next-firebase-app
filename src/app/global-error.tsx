"use client";

/**
 * 루트 레이아웃까지 죽었을 때 뜨는 최후의 화면. 레이아웃이 통째로 대체되므로 `.app-theme`
 * 클래스나 globals.css에 기댈 수 없어(그게 못 불러와졌을 수도 있는 상황이다) 색을 이 파일 안에
 * 직접 넣는다. 대신 값은 globals.css의 크림/테라코타 토큰을 그대로 복사해 앱과 같아 보이게 했다
 * (배경 #f5f1e6/#14120d, 카드 #fffdf7/#1c1912, 잉크 #171310/#f2ede2, 테라코타 #c05a2c).
 *
 * 다크모드는 `<html class="dark">` 수동 토글로 동작하는데 여기선 html을 새로 그리므로 그 클래스가
 * 없다. 그래서 이 화면만 prefers-color-scheme으로 대신 맞춘다 — 사용자가 앱에서 고른 테마와
 * 어긋날 수 있지만, 흰 배경에 검은 기본 글꼴이 튀어나오는 것보다는 낫다.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0 }}>
        <style>{`
          .ge-root {
            min-height: 100vh; display: grid; place-items: center; padding: 24px;
            background: #f5f1e6; color: #171310;
            font-family: system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif;
          }
          .ge-card {
            width: 100%; max-width: 480px; text-align: center; padding: 32px;
            border-radius: 16px; border: 1px solid rgba(23, 19, 16, 0.09); background: #fffdf7;
            box-shadow: 0 1px 2px rgba(23, 19, 16, 0.04), 0 10px 30px -22px rgba(23, 19, 16, 0.22);
          }
          .ge-title { margin: 0; font-size: 20px; font-weight: 600; }
          .ge-desc { margin: 12px 0 0; font-size: 14px; color: #6b6459; }
          .ge-btn {
            margin-top: 24px; padding: 10px 20px; font-size: 14px; font-weight: 500;
            border: 0; border-radius: 999px; cursor: pointer; background: #c05a2c; color: #fffdf7;
          }
          .ge-btn:hover { filter: brightness(1.06); }
          @media (prefers-color-scheme: dark) {
            .ge-root { background: #14120d; color: #f2ede2; }
            .ge-card {
              background: #1c1912; border-color: rgba(255, 255, 255, 0.09);
              box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 10px 30px -22px rgba(0, 0, 0, 0.7);
            }
            .ge-desc { color: #a39b8c; }
          }
        `}</style>
        <main className="ge-root">
          <section className="ge-card">
            <h1 className="ge-title">서비스 오류가 발생했습니다.</h1>
            <p className="ge-desc">일시적인 오류일 수 있습니다. 잠시 후 다시 시도해 주세요.</p>
            <button type="button" onClick={reset} className="ge-btn">
              다시 시도
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
