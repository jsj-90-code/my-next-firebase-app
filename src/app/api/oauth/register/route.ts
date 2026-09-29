// 동적 클라이언트 등록(RFC 7591) — 채팅 앱이 처음 연결할 때 자기를 등록한다. (채팅 입지평가 MCP, 2026-09-29)
// 등록만으로는 아무것도 못 한다: 토큰을 받으려면 사람이 /oauth/authorize에서 회사 계정으로 로그인해 [허용]을 눌러야 한다.
import { OAuthError, registerClient } from "@/lib/server/mcpOAuth";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_client_metadata", error_description: "JSON 본문이 필요합니다." }, { status: 400, headers: CORS });
  }
  try {
    const c = await registerClient(body);
    return Response.json(
      {
        client_id: c.clientId,
        client_name: c.clientName ?? undefined,
        redirect_uris: c.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      { status: 201, headers: CORS },
    );
  } catch (err) {
    const e = err instanceof OAuthError ? err : new OAuthError("server_error", String(err), 500);
    return Response.json({ error: e.code, error_description: e.message }, { status: e.status, headers: CORS });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
