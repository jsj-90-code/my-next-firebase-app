import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ adminDb: null }));

import { isMcpOwner } from "./mcpCandidateLocation";

describe("정밀평가 채팅 도구는 담당자 본인만 (2026-09-29)", () => {
  afterEach(() => {
    delete process.env.MCP_OWNER_EMAILS;
  });

  it("기본값: 본인 계정만 통과, 다른 회사 계정·로그인 없음은 막는다", () => {
    expect(isMcpOwner({ uid: "u", email: "jsj-90@isens.camp", name: null })).toBe(true);
    expect(isMcpOwner({ uid: "u", email: "JSJ-90@ISENS.CAMP", name: null })).toBe(true);
    expect(isMcpOwner({ uid: "u", email: "someone@isens.camp", name: null })).toBe(false);
    expect(isMcpOwner(null)).toBe(false);
  });

  it("환경변수 MCP_OWNER_EMAILS가 있으면 그 명단을 쓴다", () => {
    process.env.MCP_OWNER_EMAILS = "a@isens.camp, b@isens.camp";
    expect(isMcpOwner({ uid: "u", email: "b@isens.camp", name: null })).toBe(true);
    expect(isMcpOwner({ uid: "u", email: "jsj-90@isens.camp", name: null })).toBe(false);
  });
});
