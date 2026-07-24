"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail } from "@/lib/seatLayout/authDomain";

// 좌석배치도 툴은 회사 구글 워크스페이스 계정(@isens.camp)을 가진 팀원만 접속할 수 있어야 한다.
// 로그인 자체는 구글 계정으로 하되, 로그인한 이메일이 회사 도메인이 아니면 즉시 로그아웃시킨다.
// (구글 로그인 화면의 hd 파라미터는 "추천"일 뿐 강제가 아니라서, 로그인 후에도 이메일을 다시 검사해야 한다.
// 진짜 보안은 firestore.rules와 API 라우트의 서버 측 검사에서 걸린다.)
export function AutoAuthGate({ children }: { children: ReactNode }) {
  const { user, loading, configured, signInWithGoogle, logout } = useAuth();
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signInErrorCode, setSignInErrorCode] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const allowed = isAllowedEmail(user?.email);

  useEffect(() => {
    if (!user || allowed) return;
    // 회사 도메인이 아닌 계정으로 로그인됐다면 바로 내보낸다.
    logout().catch(() => {
      // 로그아웃 자체가 실패해도 아래 안내 메시지는 그대로 보여준다.
    });
  }, [user, allowed, logout]);

  async function handleSignIn() {
    setSignInError(null);
    setSignInErrorCode(null);
    setSigningIn(true);
    try {
      await signInWithGoogle({ hostedDomain: ALLOWED_EMAIL_DOMAIN });
    } catch (err) {
      const code = typeof err === "object" && err && "code" in err ? String(err.code) : null;
      setSignInErrorCode(code);
      setSignInError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setSigningIn(false);
    }
  }

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
        불러오는 중...
      </div>
    );
  }

  if (user && allowed) {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">회사 계정 로그인이 필요합니다</h2>
      <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        이 도구는 회사 구글 계정(@{ALLOWED_EMAIL_DOMAIN})으로 로그인한 팀원만 사용할 수 있습니다.
      </p>

      {user && !allowed && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {user.email} 계정은 @{ALLOWED_EMAIL_DOMAIN} 도메인이 아니라서 접속할 수 없습니다. 다른 계정으로 다시
          로그인해주세요.
        </p>
      )}

      {signInError && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {signInError}
          <br />
          {signInErrorCode === "auth/unauthorized-domain" ? (
            <>
              지금 접속한 주소가 Firebase에 등록되지 않았습니다. Firebase 콘솔 → Authentication →
              Settings → 승인된 도메인에 이 사이트 주소를 추가해주세요.
            </>
          ) : (
            <>
              Firebase 콘솔 → Authentication → Sign-in method에서 &ldquo;Google&rdquo; 로그인이 켜져 있는지
              확인해주세요.
            </>
          )}
        </p>
      )}

      <button
        type="button"
        disabled={signingIn}
        onClick={handleSignIn}
        className="mt-5 w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {signingIn ? "로그인 중..." : "회사 구글 계정으로 로그인"}
      </button>
    </div>
  );
}
