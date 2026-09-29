// 보호 자원 메타데이터(RFC 9728) — "이 MCP 서버의 토큰은 어느 인가 서버가 주나"를 알려준다. (채팅 입지평가 MCP, 2026-09-29)
// 인가 서버도 같은 웹 앱이라 자기 주소 하나만 적는다.
import { generateProtectedResourceMetadata, getPublicOrigin, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { MCP_SCOPE } from "@/lib/server/mcpOAuth";

export function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const body = generateProtectedResourceMetadata({
    authServerUrls: [origin],
    resourceUrl: `${origin}/api/mcp`,
    additionalMetadata: { scopes_supported: [MCP_SCOPE], resource_name: "아이센스 입지평가" },
  });
  return Response.json(body, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
