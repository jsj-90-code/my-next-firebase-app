"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";

// 좌석배치도 툴은 사내 전용 공유 도구라, 로그인 화면 없이 조용히 익명 로그인 후 바로 쓰게 한다.
// Firestore/Storage 규칙은 여전히 "로그인한 사용자만" 허용하므로, 데이터 자체가 인터넷에
// 그대로 노출되는 것은 아니다 (진짜 계정 없이 접근 가능한 정도로 보안 수준이 낮아질 뿐).
export function AutoAuthGate({ children }: { children: ReactNode }) {
  const { user, loading, configured, signInAsGuest } = useAuth();
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured || loading || user) return;
    // 익명 로그인 자체는 외부 시스템(Firebase Auth) 호출이며, 로그인 성공 여부는
    // AuthContext의 onAuthStateChanged 구독을 통해 반영된다.
    signInAsGuest().catch((err) => {
      setSignInError(err instanceof Error ? err.message : "자동 로그인에 실패했습니다.");
    });
  }, [configured, loading, user, signInAsGuest]);

  if (!configured) {
    return (
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-8 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <h2 className="text-xl font-semibold">Firebase 설정이 필요합니다</h2>
        <p className="mt-3 text-sm leading-6">
          프로젝트 루트에 <code>.env.local</code> 파일을 만들고 Firebase Console에서 발급한 값을 넣어주세요.
        </p>
      </div>
    );
  }

  if (signInError) {
    return (
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-red-200 bg-red-50 p-8 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
        <h2 className="text-xl font-semibold">자동 로그인에 실패했습니다</h2>
        <p className="mt-3 text-sm leading-6">
          {signInError}
          <br />
          Firebase 콘솔 → Authentication → Sign-in method에서 &ldquo;익명&rdquo; 로그인이 켜져 있는지 확인해주세요.
        </p>
      </div>
    );
  }

  if (loading || !user) {
    return (
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-zinc-200 px-8 py-12 text-center text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        불러오는 중...
      </div>
    );
  }

  return <>{children}</>;
}
