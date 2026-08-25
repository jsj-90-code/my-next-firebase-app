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
  if (isDark === null) {
    return (
      <button type="button" aria-label="다크모드 전환" className={className} disabled>
        🌓
      </button>
    );
  }

  return (
    <button type="button" onClick={toggle} aria-label="다크모드 전환" className={className}>
      {isDark ? "☀️ 라이트모드" : "🌙 다크모드"}
    </button>
  );
}
