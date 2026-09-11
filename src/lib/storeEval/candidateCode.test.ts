// 후보지코드 발급은 카운터 문서(storeEvalMeta/candidateCodeCounter) 하나에 의존하는데,
// 그 문서는 백업 파일에 들어 있지 않다. 복원한 환경에서 카운터가 0이면 N001부터 다시
// 발급되고, saveCandidate가 setDoc이라 기존 N001을 통째로 덮어쓴다 — 그래서 실제로 쓰이고
// 있는 코드도 같이 보도록 고쳤다. 그 판정부만 순수함수로 떼어 검증한다.
import { describe, expect, it } from "vitest";
import { maxUsedCandidateNumber } from "./store";

describe("maxUsedCandidateNumber", () => {
  it("가장 큰 번호를 찾는다", () => {
    expect(maxUsedCandidateNumber(["N001", "N012", "N005"])).toBe(12);
  });

  it("후보지가 없으면 0이다 (카운터가 그대로 이긴다)", () => {
    expect(maxUsedCandidateNumber([])).toBe(0);
  });

  it("자릿수가 늘어난 코드도 숫자로 비교한다 (문자열 비교면 N009가 이긴다)", () => {
    expect(maxUsedCandidateNumber(["N009", "N010", "N100"])).toBe(100);
  });

  it("형식이 다른 코드는 무시한다", () => {
    expect(maxUsedCandidateNumber(["N001", "20230324392", "임시", "NX1", "n002"])).toBe(1);
  });

  it("소문자 n은 후보지코드가 아니다 (발급 형식은 항상 대문자 N)", () => {
    expect(maxUsedCandidateNumber(["n999"])).toBe(0);
  });
});
