// 인가 서버 메타데이터(RFC 8414) — 채팅 앱이 "어디서 로그인하고 토큰을 받나"를 여기서 읽는다. (채팅 입지평가 MCP, 2026-09-29)
// 경로 뒤에 /api/mcp 같은 꼬리가 붙어서 오는 클라이언트도 있어 선택 꼬리([[...path]])로 받는다.
import { getPublicOrigin, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { authorizationServerMetadata } from "@/lib/server/mcpOAuth";

export function GET(request: Request) {
  return Response.json(authorizationServerMetadata(getPublicOrigin(request)), {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" },
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
