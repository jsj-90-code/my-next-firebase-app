// dualEstimate.inputGapsFor — 결과 탭 "빈 입력" 목록 (2026-09-26 경쟁점 PC대수 빈칸 추가).
import { describe, expect, it } from "vitest";
import { chooseEstimate, inputGapsFor, needsFieldCheck, rangeFlagsFor } from "./dualEstimate";
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

// 2026-09-26 밤 개정 규칙 — 크게 벗어나면 실험실, 조금 벗어나면 V62 + 경고, 밀집 판정은 거리 무관 대수.
describe("chooseEstimate · rangeFlagsFor — 범위 밖 규칙(2026-09-26 개정)", () => {
  const range = { demand: [1128, 17429] as [number, number], rate: [1000, 2000] as [number, number], pc: [80, 150] as [number, number], competitorIp: [0, 1050] as [number, number], demandPerSupply: [4.4, 36.6] as [number, number], sampleCount: 40 };
  const res = (marketDemand: number, competitorIp: number, pc = 100) => ({ marketDemand, competitorIp, hourlyRate: 1500, expectedPcCount: pc });

  it("크게 벗어남(끝값의 절반 아래) → 실험실 주 값 — 영월형", () => {
    const flags = rangeFlagsFor(res(383, 85, 90), range);
    expect(flags.some((f) => f.field === "상권수요" && f.far)).toBe(true);
    const d = chooseEstimate(71_000_000, 38_000_000, flags, 85, 40);
    expect(d.primary).toBe("실험실");
    expect(d.reason).toContain("크게 벗어남");
  });

  it("조금 벗어남 → V62 주 값 + 범위 밖 경고 — 창원상남형(경쟁IP 1103 > 1050)", () => {
    const flags = rangeFlagsFor(res(5000, 1103), range);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => !f.far)).toBe(true);
    const d = chooseEstimate(54_000_000, 29_000_000, flags, 1231, 40);
    expect(d.primary).toBe("V62");
    expect(d.reason).toContain("범위 밖 경고");
    expect(d.reason).toContain("경쟁 밀집(경쟁 PC 1231대)"); // 밀집 판정은 넘겨받은 거리 무관 대수로
  });
});

describe("검증 불가 구간 — 낮은 쪽이 주 값(특정 산식을 편들지 않는다) · 현장 확인 표시", () => {
  const range = { demand: [1128, 17429] as [number, number], rate: [1000, 2000] as [number, number], pc: [80, 150] as [number, number], competitorIp: [0, 1050] as [number, number], demandPerSupply: [4.4, 36.6] as [number, number], sampleCount: 40 };
  it("크게 벗어났는데 실험실이 더 크면 V62(낮은 쪽)가 주 값", () => {
    const flags = rangeFlagsFor({ marketDemand: 400, competitorIp: 0, hourlyRate: 1500, expectedPcCount: 100 }, range);
    const d = chooseEstimate(30_000_000, 45_000_000, flags, 0, 40);
    expect(d.primary).toBe("V62");
    expect(d.reason).toContain("검증 불가");
    expect(needsFieldCheck(d)).toBe(true);
  });
  it("범위 안·20% 안이면 현장 확인 없음, 20% 넘게 갈리면 있음", () => {
    expect(needsFieldCheck(chooseEstimate(50_000_000, 48_000_000, [], 300, 40))).toBe(false);
    expect(needsFieldCheck(chooseEstimate(50_000_000, 38_000_000, [], 300, 40))).toBe(true);
  });
});
