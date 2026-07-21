"use client";

import { useAuth } from "@/contexts/AuthContext";
import { AuthForm } from "@/components/AuthForm";
import { ChatPanel } from "@/components/ChatPanel";

export function AuthPanel() {
  const { user, loading, configured, logout } = useAuth();

  if (!configured) {
    return (
      <div className="w-full max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-8 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <h2 className="text-xl font-semibold">Firebase 설정이 필요합니다</h2>
        <p className="mt-3 text-sm leading-6">
          프로젝트 루트에 <code>.env.local</code> 파일을 만들고 Firebase
          Console에서 발급한 값을 넣어주세요. 예시는{" "}
          <code>.env.local.example</code>을 참고하세요.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-200 px-8 py-12 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        로그인 상태 확인 중...
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex w-full max-w-2xl flex-col items-center gap-6">
        <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-4">
            <div className="text-left">
              <p className="text-sm uppercase tracking-wide text-zinc-500">
                로그인됨
              </p>
              <h2 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                {user.displayName ?? user.email ?? "사용자"}
              </h2>
              {user.email ? (
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {user.email}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              로그아웃
            </button>
          </div>
        </div>

        <ChatPanel />
      </div>
    );
  }

  return <AuthForm />;
}
