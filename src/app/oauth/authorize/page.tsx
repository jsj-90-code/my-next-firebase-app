"use client";

// 채팅 앱(claude.ai·ChatGPT) 연결 허용 화면. (채팅 입지평가 MCP, 2026-09-29)
//
// 채팅 앱 설정에서 우리 앱을 추가하면 이 화면이 한 번 뜬다: 회사 구글 계정으로 로그인 → [허용] → 채팅 앱으로 돌아감.
// 그 뒤로 채팅에서 "입지평가 해줘"라고 하면 이 계정 이름으로 기록이 남는다(quickEvalChatRuns).
// ⚠️ 여기서 보여주는 "돌아갈 곳"이 claude.ai / chatgpt.com 이 아니면 누르지 말라고 적어 둔다 — 허용하면 그 주소가 토큰을 받는다.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail } from "@/lib/seatLayout/authDomain";
import { readJsonOrText } from "@/lib/readJsonOrText";

const PARAM_KEYS = ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method", "scope", "resource"] as const;

function AuthorizeInner() {
  const search = useSearchParams();
  const { user, loading, signInWithGoogle, logout } = useAuth();
  const [client, setClient] = useState<{ clientName: string | null; redirectHost: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const params = Object.fromEntries(PARAM_KEYS.map((k) => [k, search.get(k) ?? undefined]));

  useEffect(() => {
    const clientId = search.get("client_id");
    const redirectUri = search.get("redirect_uri");
    if (!clientId || !redirectUri) {
      setError("연결 요청 정보가 없습니다. 채팅 앱에서 다시 연결해 주세요.");
      return;
    }
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri });
    fetch(`/api/oauth/authorize?${q}`)
      .then((r) => readJsonOrText<{ clientName: string | null; redirectHost: string; error_description?: string }>(r))
      .then((d) => (d.redirectHost ? setClient(d as { clientName: string | null; redirectHost: string }) : setError(d.error_description ?? "연결 요청을 확인하지 못했습니다.")))
      .catch(() => setError("연결 요청을 확인하지 못했습니다."));
  }, [search]);

  const allow = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const r = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      });
      const d = await readJsonOrText<{ redirectTo?: string; error_description?: string }>(r);
      if (!r.ok || !d.redirectTo) throw new Error(d.error_description ?? "허용에 실패했습니다.");
      window.location.href = d.redirectTo;
    } catch (e) {
      setError(e instanceof Error ? e.message : "허용에 실패했습니다.");
      setBusy(false);
    }
  };

  const deny = () => {
    const redirectUri = search.get("redirect_uri");
    if (!redirectUri || !client) return;
    const back = new URL(redirectUri);
    back.searchParams.set("error", "access_denied");
    const state = search.get("state");
    if (state) back.searchParams.set("state", state);
    window.location.href = back.toString();
  };

  const companyUser = user && isAllowedEmail(user.email) ? user : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-4 py-10">
      <section className="app-card space-y-4 rounded-2xl p-5">
        <h1 className="text-lg font-bold">아이센스 입지평가 연결</h1>
        {client ? (
          <p className="text-sm leading-relaxed">
            <b>{client.clientName ?? "채팅 앱"}</b>이(가) 아이센스 입지평가를 쓰도록 연결을 요청합니다.
            허용하면 채팅에서 주소를 넣고 입지평가를 받을 수 있고, 평가 기록이 내 이름으로 남습니다.
          </p>
        ) : null}
        {client ? (
          <p className="rounded-lg bg-[var(--sl-surface-2,rgba(0,0,0,0.04))] p-3 text-xs leading-relaxed">
            돌아갈 곳: <b>{client.redirectHost}</b>
            <br />
            claude.ai · chatgpt.com 처럼 내가 쓰는 채팅 앱 주소가 아니면 허용하지 마세요.
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {loading ? (
          <p className="text-sm">로그인 확인 중…</p>
        ) : !user ? (
          <button
            className="w-full rounded-lg bg-[var(--sl-accent,#1f5aa8)] px-4 py-3 text-sm font-bold text-white"
            onClick={() => signInWithGoogle({ hostedDomain: ALLOWED_EMAIL_DOMAIN }).catch((e) => setError(String(e)))}
          >
            회사 구글 계정으로 로그인
          </button>
        ) : !companyUser ? (
          <div className="space-y-2 text-sm">
            <p>{user.email}은(는) 회사 계정(@{ALLOWED_EMAIL_DOMAIN})이 아닙니다.</p>
            <button className="underline" onClick={() => logout()}>다른 계정으로 로그인</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs">로그인: {companyUser.email}</p>
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-lg bg-[var(--sl-accent,#1f5aa8)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                disabled={!client || busy}
                onClick={allow}
              >
                {busy ? "연결 중…" : "허용"}
              </button>
              <button className="rounded-lg border px-4 py-3 text-sm" disabled={!client || busy} onClick={deny}>
                거부
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense fallback={null}>
      <AuthorizeInner />
    </Suspense>
  );
}
