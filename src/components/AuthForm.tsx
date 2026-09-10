"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * 로그인 화면. 회사 구글 워크스페이스 계정 전용이다.
 *
 * 2026-09-10 보안작업으로 이 화면에서 두 가지가 빠졌다.
 *  - 회원가입: 공개 주소에 가입 폼이 떠 있어서 누구나 "무엇이든@isens.camp"로 계정을 만들 수
 *    있었다(가맹점 매출 전수를 다루는 도구다).
 *  - 이메일/비밀번호 로그인: Firebase 쪽에서 공급자 자체를 껐다(익명 로그인도 함께 껐다).
 *    이제 호출하면 PASSWORD_LOGIN_DISABLED가 떨어지므로, 항상 실패하는 입력칸을 남겨두지 않는다.
 * 되살리려면 Firebase 콘솔 > Authentication > Sign-in method 에서 공급자를 켜고 이 파일을 되돌린다.
 */
export function AuthForm() {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleGoogleSignIn() {
    setError(null);
    setPending(true);
    try {
      await signInWithGoogle({ hostedDomain: "isens.camp" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="app-card w-full max-w-md rounded-2xl p-8">
      <h2 className="text-2xl font-semibold text-[#171310] dark:text-[#f2ede2]">로그인</h2>
      <p className="mt-2 text-sm text-[var(--sl-ink-soft)]">회사 구글 계정(@isens.camp)으로만 접속할 수 있습니다.</p>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={pending}
        className="app-btn-primary mt-6 w-full rounded-full px-5 py-3 font-medium"
      >
        {pending ? "처리 중..." : "Google로 계속하기"}
      </button>

      {error ? (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <p className="mt-6 text-center text-xs text-[var(--sl-ink-soft)]">
        계정이 필요하면 관리자에게 요청하세요. 이 화면에서는 새 계정을 만들 수 없습니다.
      </p>
    </div>
  );
}
