// 담당자 판단 매출(CandidateInput.judgedRevenue / judgedReason)이 산식으로 새어 들어가지 못하게
// 막는 정적 검사 (2026-09-13 신설).
//
// 왜 이 테스트가 따로 필요한가 —
// 이 프로젝트의 적중률(MAPE 9.88%)은 "산식이 스스로 내놓은 예측"을 실제 매출과 대조해서 잰 값이다.
// 사람이 적어둔 판단값이 예측 경로 어디로든 흘러들면 그 순간 채점이 자기 자신을 채점하는 꼴이
// 되어 무의미해진다. 그런데 이런 되먹임은 악의 없이 들어오기 쉽다 — "판단값이 있으면 그걸
// 우선 쓰자"는 편의 한 줄이면 충분하다. 동작 비교 테스트(evaluate.test.ts)는 그 한 줄이 결과를
// 바꿀 때만 잡아내지만, 이 검사는 **필드 이름이 산식 파일에 등장하는 것 자체**를 막는다.
//
// 막는 게 아니라 옮기려는 거라면(예: 판단값을 학습 표본의 한 피처로 쓰는 실험) 이 테스트를
// 지우기 전에 docs/backlog.md에 근거부터 남겨라. 적중률 측정 체계 전체가 걸린 문제다.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 예측값을 만들어내는 경로에 있는 파일들. 여기에 judged*가 나오면 안 된다.
const FORECAST_SOURCES = ["calc.ts", "evaluate.ts"] as const;

describe("담당자 판단 매출 격리", () => {
  for (const file of FORECAST_SOURCES) {
    it(`${file}은 담당자 판단 매출을 읽지 않는다`, () => {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      const hits = source
        .split(/\r?\n/)
        .map((line, index) => ({ line, lineNumber: index + 1 }))
        .filter(({ line }) => /\bjudged(Revenue|Reason|At|By)\b/.test(line));
      expect(
        hits,
        `${file}에서 담당자 판단 매출 필드를 참조하고 있습니다. 이 값이 예측에 반영되면 ` +
          `적중률 검증이 무의미해집니다(위 주석 참고).\n` +
          hits.map((h) => `  ${file}:${h.lineNumber}  ${h.line.trim()}`).join("\n"),
      ).toEqual([]);
    });
  }

  // 전환 스냅샷 쪽은 반대로 **반드시** 담고 있어야 한다. 개점 후 "산식이 맞았나 사람이 맞았나"를
  // 비교하려면 전환 시점의 판단값이 동결돼 있어야 하기 때문이다. 누가 정리하다 지우면 여기서 깨진다.
  it("후보지를 기존 가맹점으로 전환할 때 판단값을 함께 동결한다", () => {
    const source = readFileSync(new URL("store.ts", import.meta.url), "utf8");
    expect(source).toContain("judgedRevenue: c.judgedRevenue ?? null");
    expect(source).toContain("judgedRevenue: candidate?.judgedRevenue ?? null");
  });
});
