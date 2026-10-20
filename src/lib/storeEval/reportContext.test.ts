// 다우오피스 평가기록 초안 — 점포평가 등급 판정 테스트 (2026-09-13 신설, 2026-10-20 순수익 등급으로 바꿈).
//
// 이 등급은 결재 문서의 첫 줄이자 결론이라 AI가 아니라 코드가 확정한다. 규칙:
//   M  : 상권성격이 번화가일 때만 앞에 붙인다(2026-09-13 사용자 확정)
//   뒤 : 순수익 1,000만원당 A, 남은 500만원 이상이면 +(2026-10-20 사용자 — 예전 선투자 기준매출 AA/A+/A 대신)

import { describe, expect, it } from "vitest";
import { storeEvaluationGrade } from "./reportContext";

describe("점포평가 등급", () => {
  it("순수익 등급을 그대로 쓴다", () => {
    expect(storeEvaluationGrade({ marketCharacter: "주거중심", netProfit: 20_000_000 })).toBe("AA");
    expect(storeEvaluationGrade({ marketCharacter: "주거중심", netProfit: 15_200_000 })).toBe("A+");
    expect(storeEvaluationGrade({ marketCharacter: "혼합", netProfit: 10_000_000 })).toBe("A");
  });

  it("번화가면 앞에 M이 붙는다", () => {
    expect(storeEvaluationGrade({ marketCharacter: "번화가", netProfit: 15_200_000 })).toBe("MA+");
    expect(storeEvaluationGrade({ marketCharacter: null, netProfit: 25_000_000 })).toBe("AA+");
  });

  it("순수익 1,000만원 미만이거나 없으면 등급을 지어내지 않고 null", () => {
    expect(storeEvaluationGrade({ marketCharacter: "번화가", netProfit: 9_000_000 })).toBeNull();
    expect(storeEvaluationGrade({ marketCharacter: "번화가", netProfit: null })).toBeNull();
  });
});
