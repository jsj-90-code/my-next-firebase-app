// dualEstimate.inputGapsFor — 결과 탭 "빈 입력" 목록 (2026-09-26 경쟁점 PC대수 빈칸 추가).
import { describe, expect, it } from "vitest";
import { inputGapsFor } from "./dualEstimate";
import type { CandidateInput, Competitor } from "./types";

const candidate = { code: "N999" } as CandidateInput;
const comp = (over: Partial<Competitor>): Competitor =>
  ({ id: "x", candidateCode: "N999", name: "경쟁", lat: 37, lng: 127, investigationStatus: "조사완료", surveyLevel: null, totalPcCount: null, appliedPcCount: null, ...over }) as Competitor;

const pcGap = (gaps: string[]) => gaps.find((g) => g.startsWith("경쟁점 PC대수 빈칸"));

describe("inputGapsFor — 경쟁점 PC대수 빈칸", () => {
  it("상권자료 수집 직후 모양(조사완료 · 조사수준·대수 빈칸)은 빈칸으로 센다 — V62가 0대로 세는 경우", () => {
    const gaps = inputGapsFor(candidate, null, [comp({ id: "a" }), comp({ id: "b" })]);
    expect(pcGap(gaps)).toContain("2곳");
  });

  it("대수가 있거나 조사수준 간략(90대)이면 빈칸이 아니다", () => {
    const gaps = inputGapsFor(candidate, null, [comp({ totalPcCount: 100 }), comp({ appliedPcCount: 80 }), comp({ surveyLevel: "간략" })]);
    expect(pcGap(gaps)).toBeUndefined();
  });

  it("노후저경쟁력미조사·경쟁점없음·다른 후보지 경쟁점은 세지 않는다", () => {
    const gaps = inputGapsFor(candidate, null, [
      comp({ investigationStatus: "노후저경쟁력미조사" }),
      comp({ investigationStatus: "경쟁점없음" }),
      comp({ candidateCode: "N001" }),
    ]);
    expect(pcGap(gaps)).toBeUndefined();
  });
});
