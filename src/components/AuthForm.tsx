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
    <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {mode === "signin" ? "로그인" : "회원가입"}
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Firebase Authentication으로 로그인합니다.
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            이메일
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            placeholder="you@example.com"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            비밀번호
          </span>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            placeholder="6자 이상"
          />
        </label>

        {error ? (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-full bg-zinc-900 px-5 py-3 font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? "처리 중..." : mode === "signin" ? "로그인" : "회원가입"}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        <span className="text-xs uppercase tracking-wide text-zinc-500">또는</span>
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={pending}
        className="w-full rounded-full border border-zinc-300 px-5 py-3 font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
      >
        Google로 계속하기
      </button>

      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="mt-4 w-full text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
      >
        {mode === "signin"
          ? "계정이 없나요? 회원가입"
          : "이미 계정이 있나요? 로그인"}
      </button>
    </div>
  );
}
