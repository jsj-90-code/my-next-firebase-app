// 다우오피스 평가기록 초안 — 점포평가 등급 판정 테스트 (2026-09-13 신설).
//
// 이 등급은 결재 문서의 첫 줄이자 결론이라 AI가 아니라 코드가 확정한다. 규칙 자체는 사용자가
// 확정해줬다(2026-09-13):
//   M  : 상권성격이 번화가일 때만 앞에 붙인다
//   AA : 선투자 2,000만원 기준 부합 / A+ : 1,500만원 기준 / A : 1,000만원 기준
// 기준매출은 "그 순수익을 내려면 필요한 월매출"이라 2,000만원 기준이 가장 높다 — 높은 쪽부터
// 검사해야 한다. 순서를 뒤집으면 모든 후보지가 A로 떨어지므로 그 경계를 여기서 고정한다.

import { describe, expect, it } from "vitest";
import { storeEvaluationGrade } from "./reportContext";

type GradeInput = Parameters<typeof storeEvaluationGrade>[0];

function make(overrides: Partial<GradeInput> = {}): GradeInput {
  return {
    marketCharacter: "주거중심",
    v62Final: 60_000_000,
    aaBaselineRevenue: 56_460_000, // 2,000만원 기준
    aaBaselineRevenue1500: 50_000_000,
    aaBaselineRevenue1000: 44_000_000,
    ...overrides,
  };
}

describe("점포평가 등급", () => {
  it("2,000만원 기준을 넘으면 AA", () => {
    expect(storeEvaluationGrade(make())).toBe("AA");
  });

  it("번화가면 앞에 M이 붙는다", () => {
    expect(storeEvaluationGrade(make({ marketCharacter: "번화가" }))).toBe("MAA");
  });

  it("번화가가 아니면 M을 붙이지 않는다", () => {
    expect(storeEvaluationGrade(make({ marketCharacter: "혼합" }))).toBe("AA");
    expect(storeEvaluationGrade(make({ marketCharacter: null }))).toBe("AA");
  });

  it("2,000만원엔 못 미치고 1,500만원은 넘으면 A+", () => {
    expect(storeEvaluationGrade(make({ v62Final: 52_000_000 }))).toBe("A+");
    expect(storeEvaluationGrade(make({ v62Final: 52_000_000, marketCharacter: "번화가" }))).toBe("MA+");
  });

  it("1,000만원 기준만 넘으면 A", () => {
    expect(storeEvaluationGrade(make({ v62Final: 45_000_000 }))).toBe("A");
  });

  it("기준매출과 정확히 같으면 그 등급에 포함된다(이상 기준)", () => {
    expect(storeEvaluationGrade(make({ v62Final: 56_460_000 }))).toBe("AA");
    expect(storeEvaluationGrade(make({ v62Final: 50_000_000 }))).toBe("A+");
    expect(storeEvaluationGrade(make({ v62Final: 44_000_000 }))).toBe("A");
  });

  it("셋 다 미달이면 등급을 지어내지 않고 null", () => {
    // 이 경우의 등급명은 정해진 바가 없다. 화면이 "직접 입력"으로 안내한다.
    expect(storeEvaluationGrade(make({ v62Final: 30_000_000 }))).toBeNull();
    expect(storeEvaluationGrade(make({ v62Final: 30_000_000, marketCharacter: "번화가" }))).toBeNull();
  });

  it("예상매출이 없으면 판정하지 않는다", () => {
    expect(storeEvaluationGrade(make({ v62Final: null }))).toBeNull();
  });

  it("기준매출이 아직 계산되지 않았으면 그 단계는 건너뛴다", () => {
    // 오픈월 미입력 등으로 기준매출이 null일 수 있다. 그때 그 기준을 "통과"로 처리하면 안 된다.
    expect(storeEvaluationGrade(make({ aaBaselineRevenue: null, v62Final: 52_000_000 }))).toBe("A+");
    expect(
      storeEvaluationGrade(make({ aaBaselineRevenue: null, aaBaselineRevenue1500: null, v62Final: 45_000_000 })),
    ).toBe("A");
    expect(
      storeEvaluationGrade(
        make({ aaBaselineRevenue: null, aaBaselineRevenue1500: null, aaBaselineRevenue1000: null }),
      ),
    ).toBeNull();
  });
});
