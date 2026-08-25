"use client";

import { useAuth } from "@/contexts/AuthContext";
import { AuthForm } from "@/components/AuthForm";

export function HomeAuthStatus() {
  const { user, loading, configured, logout } = useAuth();

  if (!configured) {
    return (
      <div className="w-full rounded-2xl border border-amber-200 bg-amber-50 p-6 text-left text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <h2 className="text-base font-semibold">Firebase 설정이 필요합니다</h2>
        <p className="mt-2 text-sm leading-6">
          프로젝트 루트에 <code>.env.local</code> 파일을 만들고 Firebase Console에서 발급한 값을 넣어주세요. 예시는{" "}
          <code>.env.local.example</code>을 참고하세요.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="app-card w-full rounded-2xl px-6 py-4 text-sm text-[#8a8072]">로그인 상태 확인 중...</div>
    );
  }

  if (user) {
    return (
      <div className="app-card flex w-full items-center justify-between gap-4 rounded-2xl px-5 py-4">
        <div className="text-left">
          <p className="text-xs uppercase tracking-wide text-[#8a8072]">로그인됨</p>
          <p className="mt-0.5 text-sm font-medium text-[#171310] dark:text-[#f2ede2]">
            {user.displayName ?? user.email ?? "사용자"}
          </p>
        </div>
        <button type="button" onClick={() => logout()} className="app-btn-outline shrink-0 rounded-full px-4 py-1.5 text-sm">
          로그아웃
        </button>
      </div>
    );
  }

  return <AuthForm />;
}
