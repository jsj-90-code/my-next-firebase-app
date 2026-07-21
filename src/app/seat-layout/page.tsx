"use client";

import { useAuth } from "@/contexts/AuthContext";
import { AuthForm } from "@/components/AuthForm";
import { SeatLayoutWorkspace } from "@/components/seatLayout/SeatLayoutWorkspace";

export default function SeatLayoutPage() {
  const { user, loading, configured } = useAuth();

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

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-zinc-200 px-8 py-12 text-center text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        로그인 상태 확인 중...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            아이센스 PC방 좌석배치도 작업 툴
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            팀 계정으로 로그인하면 매장별 좌석배치도를 관리할 수 있습니다.
          </p>
        </div>
        <div className="mt-8 w-full max-w-md">
          <AuthForm />
        </div>
      </div>
    );
  }

  return <SeatLayoutWorkspace />;
}
