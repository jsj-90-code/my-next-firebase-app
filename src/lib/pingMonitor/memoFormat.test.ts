import { describe, expect, it } from "vitest";
import { formatSurveyMemo } from "./memoFormat";

describe("formatSurveyMemo", () => {
  it("한 줄로 뭉개진 다우 조사 양식을 항목별 줄로 나눈다", () => {
    const flat = "1. 아센 경쟁점 조사 양식 - 매장명 : 레드포스pc아레나 청주개신점 - 전체 대수 : 123대 - 일반석 : 1. CPU : i5 14400f 2. VGA : rtx 5060 - 매장 현황 1. 방문 일시 고객수 : 59명 5. 1,000원 시간 : 1,300원 종합 평가 : 전형적인 레드포스";
    expect(formatSurveyMemo(flat)).toBe([
      "- 매장명 : 레드포스pc아레나 청주개신점",
      "- 전체 대수 : 123대",
      "- 일반석 :",
      "   1. CPU : i5 14400f",
      "   2. VGA : rtx 5060",
      "- 매장 현황",
      "   1. 방문 일시 고객수 : 59명",
      "   5. 1,000원 시간 : 1,300원",
      "",
      "종합 평가 : 전형적인 레드포스",
    ].join("\n"));
  });

  it("줄바꿈이 있는 메모도 맨 앞 양식 제목 줄은 뺀다", () => {
    expect(formatSurveyMemo("1. 아센 경쟁점 조사 양식\n- 매장명 : A")).toBe("- 매장명 : A");
  });

  it("줄바꿈이 이미 있는 메모는 그대로 둔다", () => {
    expect(formatSurveyMemo("- 매장명 : A\n- 전체 대수 : 10대")).toBe("- 매장명 : A\n- 전체 대수 : 10대");
  });

  it("짧은 메모는 바꾸지 않는다", () => {
    expect(formatSurveyMemo("점포평가 경쟁점 · IP 미등록")).toBe("점포평가 경쟁점 · IP 미등록");
  });
});
