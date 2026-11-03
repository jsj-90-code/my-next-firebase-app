// 다우오피스 평가기록 초안 — 점포평가 등급 판정 테스트 (2026-09-13 신설, 2026-10-20 순수익 등급으로 바꿈).
//
// 이 등급은 결재 문서의 첫 줄이자 결론이라 AI가 아니라 코드가 확정한다. 규칙:
//   M  : 상권성격이 번화가일 때만 앞에 붙인다(2026-09-13 사용자 확정)
//   뒤 : 순수익 1,000만원당 A, 남은 500만원 이상이면 +(2026-10-20 사용자 — 예전 선투자 기준매출 AA/A+/A 대신)

import { describe, expect, it } from "vitest";
import { storeEvaluationGrade } from "./reportContext";

describe("점포평가 등급", () => {
  it("순수익 등급을 그대로 쓴다", () => {
    expect(storeEvaluationGrade({ floating500Avg: 50_000, mainLocationFloating500Min: 100_000, netProfit: 20_000_000 })).toBe("AA");
    expect(storeEvaluationGrade({ floating500Avg: 50_000, mainLocationFloating500Min: 100_000, netProfit: 15_200_000 })).toBe("A+");
    expect(storeEvaluationGrade({ floating500Avg: 50_000, mainLocationFloating500Min: 100_000, netProfit: 10_000_000 })).toBe("A");
  });

  it("유동 500m 절대량이 기준 이상이면 앞에 M이 붙는다(2026-11-03)", () => {
    expect(storeEvaluationGrade({ floating500Avg: 100_000, mainLocationFloating500Min: 100_000, netProfit: 15_200_000 })).toBe("MA+");
    expect(storeEvaluationGrade({ floating500Avg: null, mainLocationFloating500Min: 100_000, netProfit: 25_000_000 })).toBe("AA+");
    // 화정역(N030) — 유동 11.5만인데 비율 4.3이라 옛 기준(비율 번화가)에선 M이 빠졌다
    expect(storeEvaluationGrade({ floating500Avg: 115_331, mainLocationFloating500Min: 100_000, netProfit: 15_200_000 })).toBe("MA+");
    expect(storeEvaluationGrade({ floating500Avg: 99_999, mainLocationFloating500Min: 100_000, netProfit: 15_200_000 })).toBe("A+");
  });

  it("순수익 1,000만원 미만이거나 없으면 등급을 지어내지 않고 null", () => {
    expect(storeEvaluationGrade({ floating500Avg: 100_000, mainLocationFloating500Min: 100_000, netProfit: 9_000_000 })).toBeNull();
    expect(storeEvaluationGrade({ floating500Avg: 100_000, mainLocationFloating500Min: 100_000, netProfit: null })).toBeNull();
  });
});
