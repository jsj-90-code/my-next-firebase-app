import "server-only";
import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

// GitHub Actions가 발급한 OIDC 토큰(서명된 신분증)을 확인한다 — 비밀값 없이 "이 저장소의 main 알람이 보낸 요청"만 통과시킨다.
// 2026-10-06: Vercel 무료 요금제는 예약 실행이 하루 1번이라 매시 알람을 GitHub Actions로 두는데, 비밀값을 사용자가
// 손으로 넣어야 하는 게 걸림돌이었다. 토큰은 GitHub 키로 서명되고 저장소·브랜치·이벤트가 들어 있어, 공개 저장소를
// 포크한 사람이 같은 워크플로를 돌려도 repository 값이 달라 막힌다.

const ISSUER = "https://token.actions.githubusercontent.com";
export const PING_OIDC_AUDIENCE = "isens-ping-monitor";
const REPOSITORY = "jsj-90-code/my-next-firebase-app";
const ALLOWED_EVENTS = new Set(["schedule", "workflow_dispatch"]);

let jwksCache: { at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;

async function getKeys() {
  if (jwksCache && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const res = await fetch(`${ISSUER}/.well-known/jwks`);
  if (!res.ok) throw new Error(`GitHub 키 목록을 못 받았습니다(${res.status}).`);
  const body = (await res.json()) as { keys: (JsonWebKey & { kid?: string })[] };
  jwksCache = { at: Date.now(), keys: body.keys };
  return body.keys;
}

function b64urlJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/** 통과하면 null, 아니면 거절 사유. */
export async function checkGithubOidc(token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return "토큰 모양이 아닙니다.";
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (header.alg !== "RS256") return "서명 방식이 다릅니다.";

  const keys = await getKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return "모르는 서명 키입니다.";
  const ok = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  if (!ok) return "서명이 맞지 않습니다.";

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER) return "발급처가 다릅니다.";
  if (claims.aud !== PING_OIDC_AUDIENCE) return "대상이 다릅니다.";
  if (typeof claims.exp !== "number" || claims.exp < now) return "만료된 토큰입니다.";
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) return "아직 쓸 수 없는 토큰입니다.";
  if (claims.repository !== REPOSITORY) return "다른 저장소입니다.";
  if (claims.ref !== "refs/heads/main") return "main 브랜치가 아닙니다.";
  if (!ALLOWED_EVENTS.has(String(claims.event_name))) return "예약·수동 실행만 됩니다.";
  return null;
}
