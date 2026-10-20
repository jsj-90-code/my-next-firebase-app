import { describe, expect, it } from "vitest";
import { profitGrade } from "./profitLoss";

describe("순수익 등급 — 1,000만원당 A, 남은 500만원 이상 +", () => {
  it("사용자 예시", () => {
    expect(profitGrade(10_000_000)).toBe("A");
    expect(profitGrade(15_000_000)).toBe("A+");
    expect(profitGrade(20_000_000)).toBe("AA");
    expect(profitGrade(25_000_000)).toBe("AA+");
  });
  it("경계", () => {
    expect(profitGrade(14_999_999)).toBe("A");
    expect(profitGrade(9_999_999)).toBeNull();
    expect(profitGrade(-3_000_000)).toBeNull();
    expect(profitGrade(null)).toBeNull();
  });
});
