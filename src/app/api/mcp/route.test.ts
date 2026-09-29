import { describe, expect, it, vi } from "vitest";

// 커넥터 하나로 두 부류(2026-09-29 사용자): 주소만 초기평가 = 회사 계정 누구나, 정밀평가 입지 초안 = 담당자 본인만.
// 로그인한 사람에 따라 **도구 목록 자체가 달라지는지** 라우트를 직접 불러 확인한다(토큰 확인만 가짜로 바꾼다).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ adminDb: null, adminAuth: null }));
vi.mock("@/lib/server/mcpOAuth", () => ({
  verifyAccessToken: async (token: string) =>
    token === "owner" || token === "staff"
      ? {
          user: { uid: token, email: token === "owner" ? "jsj-90@isens.camp" : "staff@isens.camp", name: null },
          clientId: "test", scope: "quick-eval", expiresAt: Date.now() + 60_000,
        }
      : null,
}));

import { POST } from "./route";

async function toolNames(token: string): Promise<string[]> {
  const res = await POST(
    new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
  );
  const raw = await res.text();
  const json = raw.trim().startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
  return (json.result?.tools ?? []).map((t: { name: string }) => t.name).sort();
}

describe("채팅 입지평가 도구 목록은 사람마다 다르다", () => {
  it("담당자 본인: 5개(주소만 2 + 정밀평가 3)", async () => {
    expect(await toolNames("owner")).toEqual(
      ["find_candidate", "get_candidate_location_data", "get_site_data", "submit_candidate_location_draft", "submit_location_scores"],
    );
  });
  it("다른 직원: 주소만 초기평가 2개만 보인다", async () => {
    expect(await toolNames("staff")).toEqual(["get_site_data", "submit_location_scores"]);
  });
  it("토큰이 없거나 틀리면 401", async () => {
    const res = await POST(new Request("https://example.test/api/mcp", { method: "POST", headers: { Authorization: "Bearer nope" }, body: "{}" }));
    expect(res.status).toBe(401);
  });
});
