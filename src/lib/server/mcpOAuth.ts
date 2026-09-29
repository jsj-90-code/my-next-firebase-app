import "server-only";
// 채팅 입지평가(MCP) 연결용 **OAuth 로그인** — 우리 웹 앱이 스스로 인가 서버가 된다. (2026-09-29)
//
// 왜: 사용자가 claude.ai·ChatGPT 채팅(휴대폰 포함)에서 쓰기로 했다(2026-09-29 "휴대폰으로 하는 경우도 있으니 채팅으로").
// 채팅 앱은 외부 연결을 붙일 때 OAuth(로그인 버튼 → 우리 화면에서 로그인 → 허용)로만 인증한다.
// 로그인은 기존 회사 구글 계정(@isens.camp, email_verified)을 그대로 쓴다 — 새 비밀번호·계정은 없다.
//
// 흐름(OAuth 2.1 + PKCE, 공개 클라이언트):
//   1. 채팅 앱이 클라이언트 등록 — 동적 등록(/api/oauth/register) 또는 CIMD(client_id가 https 주소, 그 주소의 JSON을 읽음)
//   2. 사용자를 /oauth/authorize 화면으로 보냄 → 회사 구글 로그인 → [허용] → 1회용 코드(10분)
//   3. 채팅 앱이 /api/oauth/token에서 코드+검증값(PKCE)으로 토큰 교환 → 접근 토큰(24시간) + 갱신 토큰(60일, 쓸 때마다 교체)
//   4. MCP 호출마다 접근 토큰 확인
//
// 저장(Firestore, **서버만** 읽고 쓴다 — 보안 규칙에서 브라우저 접근을 전부 막는다):
//   mcpOAuthClients/{clientId}   동적 등록된 채팅 앱(이름·되돌아갈 주소)
//   mcpOAuthCodes/{sha256(code)}  1회용 인가 코드
//   mcpOAuthTokens/{sha256(token)} 접근·갱신 토큰(원문은 저장하지 않는다 — 해시만)
// ⚠️ 무료 요금제(Spark) — 토큰 확인은 메모리 캐시(5분)로 읽기를 줄인다.
import { createHash, randomBytes } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";

export const MCP_SCOPE = "quick-eval";
const CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TTL_S = 24 * 60 * 60;
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const TOKEN_CACHE_MS = 5 * 60 * 1000;

const CLIENTS = "mcpOAuthClients";
const CODES = "mcpOAuthCodes";
const TOKENS = "mcpOAuthTokens";

export type McpUser = { uid: string; email: string; name: string | null };
export type OAuthClient = { clientId: string; clientName: string | null; redirectUris: string[]; source: "dcr" | "cimd" };

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const newSecret = () => b64url(randomBytes(32));

function db() {
  if (!adminDb) throw new OAuthError("server_error", "서버 Firebase 설정이 없습니다.", 500);
  return adminDb;
}

/** 되돌아갈 주소 — https만(개발용 localhost http는 허용). 조각(#) 금지. */
export function isAcceptableRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

// ── 1. 클라이언트 ─────────────────────────────────────────────────────────

export async function registerClient(meta: { client_name?: unknown; redirect_uris?: unknown }): Promise<OAuthClient> {
  const uris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10 || !uris.every(isAcceptableRedirectUri)) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris는 https 주소 1~10개여야 합니다.");
  }
  const clientName = typeof meta.client_name === "string" ? meta.client_name.slice(0, 100) : null;
  const clientId = `dcr_${newSecret().slice(0, 24)}`;
  await db().collection(CLIENTS).doc(clientId).set({ clientId, clientName, redirectUris: uris, createdAt: Date.now() });
  return { clientId, clientName, redirectUris: uris, source: "dcr" };
}

const cimdCache = new Map<string, { at: number; client: OAuthClient }>();

/** client_id로 클라이언트를 찾는다 — https 주소면 CIMD(그 주소의 메타데이터 JSON), 아니면 동적 등록 문서. */
export async function resolveClient(clientId: string): Promise<OAuthClient> {
  if (clientId.startsWith("https://")) {
    const hit = cimdCache.get(clientId);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.client;
    // 서버가 남의 주소를 대신 읽는 자리라, 내부망·IP 직접 주소는 막는다(SSRF 방지). 도메인 이름만 허용.
    const host = new URL(clientId).hostname;
    if (host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || host.endsWith(".local") || host.endsWith(".internal")) {
      throw new OAuthError("invalid_client", "클라이언트 주소는 공개 도메인이어야 합니다.");
    }
    let json: Record<string, unknown>;
    try {
      const res = await fetch(clientId, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000), redirect: "error" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      throw new OAuthError("invalid_client", `클라이언트 정보를 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (json.client_id !== clientId) throw new OAuthError("invalid_client", "클라이언트 정보의 client_id가 주소와 다릅니다.");
    const uris = Array.isArray(json.redirect_uris) ? json.redirect_uris.filter((u): u is string => typeof u === "string") : [];
    if (!uris.length || !uris.every(isAcceptableRedirectUri)) throw new OAuthError("invalid_client", "클라이언트의 redirect_uris가 올바르지 않습니다.");
    const client: OAuthClient = {
      clientId, clientName: typeof json.client_name === "string" ? json.client_name : null, redirectUris: uris, source: "cimd",
    };
    cimdCache.set(clientId, { at: Date.now(), client });
    return client;
  }
  const snap = await db().collection(CLIENTS).doc(clientId).get();
  if (!snap.exists) throw new OAuthError("invalid_client", "등록되지 않은 클라이언트입니다.");
  const v = snap.data() as { clientName: string | null; redirectUris: string[] };
  return { clientId, clientName: v.clientName ?? null, redirectUris: v.redirectUris ?? [], source: "dcr" };
}

// ── 2. 인가 코드 ─────────────────────────────────────────────────────────

export async function createAuthorizationCode(args: {
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string | null;
  resource: string | null;
  user: McpUser;
}): Promise<string> {
  if (!args.client.redirectUris.includes(args.redirectUri)) throw new OAuthError("invalid_request", "redirect_uri가 등록된 주소와 다릅니다.");
  if (args.codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(args.codeChallenge)) {
    throw new OAuthError("invalid_request", "PKCE(S256) code_challenge가 필요합니다.");
  }
  const code = newSecret();
  await db().collection(CODES).doc(sha256(code)).set({
    clientId: args.client.clientId,
    redirectUri: args.redirectUri,
    codeChallenge: args.codeChallenge,
    scope: args.scope ?? MCP_SCOPE,
    resource: args.resource,
    user: args.user,
    expiresAt: Date.now() + CODE_TTL_MS,
    createdAt: Date.now(),
  });
  return code;
}

// ── 3. 토큰 ─────────────────────────────────────────────────────────────

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

async function issueTokens(user: McpUser, clientId: string, scope: string, resource: string | null): Promise<TokenResponse> {
  const access = newSecret();
  const refresh = newSecret();
  const now = Date.now();
  const batch = db().batch();
  batch.set(db().collection(TOKENS).doc(sha256(access)), {
    kind: "access", user, clientId, scope, resource, expiresAt: now + ACCESS_TTL_S * 1000, createdAt: now,
  });
  batch.set(db().collection(TOKENS).doc(sha256(refresh)), {
    kind: "refresh", user, clientId, scope, resource, expiresAt: now + REFRESH_TTL_MS, createdAt: now,
  });
  await batch.commit();
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

export async function exchangeAuthorizationCode(args: {
  code: string; codeVerifier: string; redirectUri: string; clientId: string;
}): Promise<TokenResponse> {
  const ref = db().collection(CODES).doc(sha256(args.code));
  const data = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    tx.delete(ref); // 1회용 — 성공·실패와 무관하게 한 번 쓰면 끝
    return snap.data() as {
      clientId: string; redirectUri: string; codeChallenge: string; scope: string; resource: string | null; user: McpUser; expiresAt: number;
    };
  });
  if (!data || data.expiresAt < Date.now()) throw new OAuthError("invalid_grant", "코드가 없거나 만료됐습니다.");
  if (data.clientId !== args.clientId) throw new OAuthError("invalid_grant", "코드를 받은 클라이언트가 아닙니다.");
  if (data.redirectUri !== args.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri가 다릅니다.");
  const challenge = b64url(createHash("sha256").update(args.codeVerifier).digest());
  if (challenge !== data.codeChallenge) throw new OAuthError("invalid_grant", "PKCE 검증에 실패했습니다.");
  return issueTokens(data.user, data.clientId, data.scope, data.resource);
}

export async function refreshTokens(args: { refreshToken: string; clientId: string | null }): Promise<TokenResponse> {
  const ref = db().collection(TOKENS).doc(sha256(args.refreshToken));
  const data = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    tx.delete(ref); // 갱신 토큰은 쓸 때마다 교체(재사용 방지)
    return snap.data() as { kind: string; user: McpUser; clientId: string; scope: string; resource: string | null; expiresAt: number };
  });
  if (!data || data.kind !== "refresh" || data.expiresAt < Date.now()) throw new OAuthError("invalid_grant", "갱신 토큰이 없거나 만료됐습니다.");
  if (args.clientId && args.clientId !== data.clientId) throw new OAuthError("invalid_grant", "다른 클라이언트의 토큰입니다.");
  return issueTokens(data.user, data.clientId, data.scope, data.resource);
}

// ── 4. 접근 토큰 확인 ─────────────────────────────────────────────────────

const tokenCache = new Map<string, { at: number; value: { user: McpUser; clientId: string; scope: string; expiresAt: number } | null }>();

export async function verifyAccessToken(token: string): Promise<{ user: McpUser; clientId: string; scope: string; expiresAt: number } | null> {
  const key = sha256(token);
  const hit = tokenCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TOKEN_CACHE_MS) return hit.value && hit.value.expiresAt > now ? hit.value : null;
  const snap = await db().collection(TOKENS).doc(key).get();
  const v = snap.exists ? (snap.data() as { kind: string; user: McpUser; clientId: string; scope: string; expiresAt: number }) : null;
  const value = v && v.kind === "access" && v.expiresAt > now ? { user: v.user, clientId: v.clientId, scope: v.scope, expiresAt: v.expiresAt } : null;
  tokenCache.set(key, { at: now, value });
  if (tokenCache.size > 500) tokenCache.delete(tokenCache.keys().next().value as string);
  return value;
}

/** 인가 서버 메타데이터(RFC 8414). issuer = 웹 앱 주소. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE],
    client_id_metadata_document_supported: true,
  };
}
