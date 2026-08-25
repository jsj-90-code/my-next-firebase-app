"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export function AuthForm() {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      if (mode === "signin") {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setPending(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setPending(true);

    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="app-card w-full max-w-md rounded-2xl p-8">
      <h2 className="text-2xl font-semibold text-[#171310] dark:text-[#f2ede2]">
        {mode === "signin" ? "로그인" : "회원가입"}
      </h2>
      <p className="mt-2 text-sm text-[#8a8072]">Firebase Authentication으로 로그인합니다.</p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-[#171310] dark:text-[#f2ede2]">이메일</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="app-input w-full px-4 py-3"
            placeholder="you@example.com"
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

        <button type="submit" disabled={pending} className="app-btn-primary w-full rounded-full px-5 py-3 font-medium">
          {pending ? "처리 중..." : mode === "signin" ? "로그인" : "회원가입"}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-[#171310]/[0.09] dark:bg-white/[0.09]" />
        <span className="text-xs uppercase tracking-wide text-[#8a8072]">또는</span>
        <div className="h-px flex-1 bg-[#171310]/[0.09] dark:bg-white/[0.09]" />
      </div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={pending}
        className="app-btn-outline w-full rounded-full px-5 py-3 font-medium"
      >
        Google로 계속하기
      </button>

      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="mt-4 w-full text-sm text-[#8a8072] underline-offset-4 hover:underline"
      >
        {mode === "signin" ? "계정이 없나요? 회원가입" : "이미 계정이 있나요? 로그인"}
      </button>
    </div>
  );
}
