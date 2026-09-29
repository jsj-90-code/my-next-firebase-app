// 토큰 교환 — 인가 코드(+PKCE) 또는 갱신 토큰을 접근 토큰으로 바꾼다. (채팅 입지평가 MCP, 2026-09-29)
import { exchangeAuthorizationCode, OAuthError, refreshTokens } from "@/lib/server/mcpOAuth";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };

async function readParams(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const j = (await request.json()) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  }
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

export async function POST(request: Request) {
  const headers = { ...CORS, "Cache-Control": "no-store" };
  try {
    const p = await readParams(request);
    if (p.grant_type === "authorization_code") {
      if (!p.code || !p.code_verifier || !p.redirect_uri || !p.client_id) {
        throw new OAuthError("invalid_request", "code·code_verifier·redirect_uri·client_id가 필요합니다.");
      }
      return Response.json(
        await exchangeAuthorizationCode({ code: p.code, codeVerifier: p.code_verifier, redirectUri: p.redirect_uri, clientId: p.client_id }),
        { headers },
      );
    }
    if (p.grant_type === "refresh_token") {
      if (!p.refresh_token) throw new OAuthError("invalid_request", "refresh_token이 필요합니다.");
      return Response.json(await refreshTokens({ refreshToken: p.refresh_token, clientId: p.client_id ?? null }), { headers });
    }
    throw new OAuthError("unsupported_grant_type", "authorization_code 또는 refresh_token만 됩니다.");
  } catch (err) {
    const e = err instanceof OAuthError ? err : new OAuthError("server_error", err instanceof Error ? err.message : String(err), 500);
    return Response.json({ error: e.code, error_description: e.message }, { status: e.status, headers });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
