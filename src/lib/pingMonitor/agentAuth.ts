import "server-only";
import { createHash, createPublicKey, verify } from "node:crypto";

// 측정 서버(Oracle 무료, 도쿄 168.110.12.33)가 보낸 요청인지 서명으로 확인한다(2026-10-06).
// 비밀 열쇠는 그 서버(~/ping-agent/agent.key) 안에서 만들어 밖으로 나온 적이 없다. 여기엔 공개 열쇠만 둔다 —
// 공개 저장소에 있어도 괜찮다(서명 확인만 할 수 있고 서명을 만들 수는 없다). 비밀값을 사람이 옮길 일이 없다.
// 서명할 글: `${ts}\n${method}\n${path}\n${sha256(body) hex}`. 5분 넘은 요청은 거절(가로채 다시 보내기 방지).
// 열쇠를 바꾸면: 서버에서 openssl genpkey -algorithm ed25519 → pubout 결과를 아래에 붙인다.

const AGENT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABClelS/h7vq5gh3egLWt3UB/OdfjtYktE7qa2jvDzeA=
-----END PUBLIC KEY-----`;
const MAX_SKEW_SECONDS = 300;

/** 통과하면 null, 아니면 거절 사유. */
export function checkAgentSignature(request: Request, body: string): string | null {
  const ts = request.headers.get("x-ping-agent-ts");
  const sig = request.headers.get("x-ping-agent-sig");
  if (!ts || !sig) return "서명이 없습니다.";
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > MAX_SKEW_SECONDS) return "시각이 맞지 않습니다.";
  const url = new URL(request.url);
  const message = `${ts}\n${request.method}\n${url.pathname}\n${createHash("sha256").update(body).digest("hex")}`;
  const ok = verify(null, Buffer.from(message), createPublicKey(AGENT_PUBLIC_KEY), Buffer.from(sig, "base64"));
  return ok ? null : "서명이 맞지 않습니다.";
}
