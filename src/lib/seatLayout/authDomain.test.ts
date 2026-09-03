import { describe, expect, it } from "vitest";
import { isAllowedEmail } from "./authDomain";

describe("isAllowedEmail", () => {
  it("회사 도메인의 정확한 이메일만 허용한다", () => {
    expect(isAllowedEmail("staff@isens.camp")).toBe(true);
    expect(isAllowedEmail("STAFF@ISENS.CAMP")).toBe(true);
    expect(isAllowedEmail("staff@evil-isens.camp")).toBe(false);
    expect(isAllowedEmail("staff@isens.camp.evil.example")).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
  });
});
