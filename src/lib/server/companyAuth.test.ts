import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdToken = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken },
}));

import { getVerifiedCompanyUser } from "./companyAuth";

function requestWithAuthorization(value?: string) {
  return new Request("https://example.test", {
    headers: value ? { authorization: value } : undefined,
  });
}

describe("getVerifiedCompanyUser", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
  });

  it("Bearer 토큰이 없으면 Firebase 검증을 호출하지 않는다", async () => {
    await expect(getVerifiedCompanyUser(requestWithAuthorization())).resolves.toBeNull();
    await expect(getVerifiedCompanyUser(requestWithAuthorization("Basic token"))).resolves.toBeNull();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("유효한 회사 계정만 반환한다", async () => {
    const companyUser = { uid: "company", email: "staff@isens.camp", email_verified: true };
    verifyIdToken
      .mockResolvedValueOnce(companyUser)
      .mockResolvedValueOnce({ uid: "external", email: "staff@example.com", email_verified: true });

    await expect(getVerifiedCompanyUser(requestWithAuthorization("Bearer company-token"))).resolves.toBe(companyUser);
    await expect(getVerifiedCompanyUser(requestWithAuthorization("Bearer external-token"))).resolves.toBeNull();
    expect(verifyIdToken).toHaveBeenNthCalledWith(1, "company-token");
  });

  it("회사 도메인이어도 이메일 미인증 토큰은 거부한다", async () => {
    verifyIdToken.mockResolvedValue({ uid: "unverified", email: "staff@isens.camp", email_verified: false });

    await expect(getVerifiedCompanyUser(requestWithAuthorization("Bearer unverified-token"))).resolves.toBeNull();
  });

  it("만료되거나 잘못된 토큰은 null로 처리한다", async () => {
    verifyIdToken.mockRejectedValue(new Error("expired"));
    await expect(getVerifiedCompanyUser(requestWithAuthorization("Bearer expired-token"))).resolves.toBeNull();
  });
});
