// 허용 화면(/oauth/authorize)이 부르는 서버 쪽 — 회사 계정 확인 후 1회용 코드를 만들어 채팅 앱으로 돌려보낼 주소를 준다. (2026-09-29)
//   GET  ?client_id=…  → 화면에 보여줄 클라이언트 이름·되돌아갈 주소(검증 결과)
//   POST {params}      → 로그인한 회사 계정(Firebase ID 토큰)으로 코드 발급 → { redirectTo }
import { getPublicOrigin } from "mcp-handler";
import { getVerifiedCompanyUser } from "@/lib/server/companyAuth";
import { createAuthorizationCode, OAuthError, resolveClient } from "@/lib/server/mcpOAuth";

type Params = {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  resource?: string;
};

const fail = (e: unknown) => {
  const err = e instanceof OAuthError ? e : new OAuthError("server_error", e instanceof Error ? e.message : String(e), 500);
  return Response.json({ error: err.code, error_description: err.message }, { status: err.status });
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  try {
    if (!clientId || !redirectUri) throw new OAuthError("invalid_request", "client_id와 redirect_uri가 필요합니다.");
    const client = await resolveClient(clientId);
    if (!client.redirectUris.includes(redirectUri)) throw new OAuthError("invalid_request", "redirect_uri가 등록된 주소와 다릅니다.");
    return Response.json({ clientName: client.clientName, redirectHost: new URL(redirectUri).host });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  const user = await getVerifiedCompanyUser(request);
  if (!user?.email) return Response.json({ error: "access_denied", error_description: "회사 계정(@isens.camp) 로그인이 필요합니다." }, { status: 401 });
  let p: Params;
  try {
    p = (await request.json()) as Params;
  } catch {
    return fail(new OAuthError("invalid_request", "JSON 본문이 필요합니다."));
  }
  try {
    if (p.response_type !== "code") throw new OAuthError("unsupported_response_type", "response_type=code만 됩니다.");
    if (!p.client_id || !p.redirect_uri || !p.code_challenge) throw new OAuthError("invalid_request", "client_id·redirect_uri·code_challenge가 필요합니다.");
    const client = await resolveClient(p.client_id);
    const code = await createAuthorizationCode({
      client,
      redirectUri: p.redirect_uri,
      codeChallenge: p.code_challenge,
      codeChallengeMethod: p.code_challenge_method ?? "plain",
      scope: p.scope ?? null,
      resource: p.resource ?? null,
      user: { uid: user.uid, email: user.email, name: (user.name as string | undefined) ?? null },
    });
    const back = new URL(p.redirect_uri);
    back.searchParams.set("code", code);
    if (p.state) back.searchParams.set("state", p.state);
    back.searchParams.set("iss", getPublicOrigin(request));
    return Response.json({ redirectTo: back.toString() });
  } catch (e) {
    return fail(e);
  }
}
