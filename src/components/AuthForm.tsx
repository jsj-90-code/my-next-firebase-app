"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * 로그인 전용 화면. 회원가입 UI는 2026-09-10 보안감사에서 제거했다 — 이 도구가 다루는 자료가
 * 가맹점 매출 전수(기밀)인데 공개 주소에 가입 폼이 떠 있어서, 아무나 "무엇이든@isens.camp"로
 * 계정을 만들어 들어올 수 있었다. 팀 계정은 회사 구글 워크스페이스로만 발급한다.
 */
export function AuthForm() {
  const { signInWithEmail, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<void>) {
    setError(null);
    setPending(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(() => signInWithEmail(email, password));
  }

  return (
    <div className="app-card w-full max-w-md rounded-2xl p-8">
      <h2 className="text-2xl font-semibold text-[#171310] dark:text-[#f2ede2]">로그인</h2>
      <p className="mt-2 text-sm text-[#8a8072]">회사 구글 계정(@isens.camp)으로 로그인하세요.</p>

      <button
        type="button"
        onClick={() => run(() => signInWithGoogle({ hostedDomain: "isens.camp" }))}
        disabled={pending}
        className="app-btn-primary mt-6 w-full rounded-full px-5 py-3 font-medium"
      >
        Google로 계속하기
      </button>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-[#171310]/[0.09] dark:bg-white/[0.09]" />
        <span className="text-xs uppercase tracking-wide text-[#8a8072]">또는</span>
        <div className="h-px flex-1 bg-[#171310]/[0.09] dark:bg-white/[0.09]" />
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-[#171310] dark:text-[#f2ede2]">이메일</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="app-input w-full px-4 py-3"
            placeholder="you@isens.camp"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-[#171310] dark:text-[#f2ede2]">비밀번호</span>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="app-input w-full px-4 py-3"
            placeholder="6자 이상"
          />
        </label>

        {error ? (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={pending} className="app-btn-outline w-full rounded-full px-5 py-3 font-medium">
          {pending ? "처리 중..." : "이메일로 로그인"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-[#8a8072]">
        계정이 필요하면 관리자에게 요청하세요. 이 화면에서는 새 계정을 만들 수 없습니다.
      </p>
    </div>
  );
}
