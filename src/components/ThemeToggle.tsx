"use client";

import { useEffect, useState } from "react";

// 라이트/다크 수동 전환 버튼. 실제 적용은 <html> 태그의 "dark" 클래스 하나로 이뤄지고
// (src/app/globals.css가 이 클래스를 기준으로 색을 바꾼다), 선택값은 localStorage에 저장해서
// 다음 방문에도 유지된다. 저장된 값이 없으면 시스템 설정을 따른다 (src/app/layout.tsx의
// 초기화 스크립트가 처리).
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !(isDark ?? false);
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // localStorage를 못 쓰는 환경(프라이빗 모드 등)이어도 이번 방문 동안은 토글 자체는 동작한다.
    }
  }

  // 첫 렌더(서버/하이드레이션 이전)에는 실제 상태를 몰라서 깜빡임 없이 중립적인 아이콘만 보여준다.
  const showDark = isDark ?? false;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isDark === null}
      aria-label={showDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      className={`inline-flex items-center gap-1.5 ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        className="h-[15px] w-[15px] shrink-0"
      >
        {showDark ? (
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 3v2M12 19v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M3 12h2M19 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
          </>
        )}
      </svg>
      <span className="hidden sm:inline">{showDark ? "다크" : "라이트"}</span>
    </button>
  );
}
