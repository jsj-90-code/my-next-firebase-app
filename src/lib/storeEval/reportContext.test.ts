import { describe, expect, it } from "vitest";
import { buildDaouReportContext, type DaouReportContextCandidate } from "./reportContext";
import type { EvaluationResult } from "./types";

function baseCandidate(overrides: Partial<DaouReportContextCandidate> = {}): DaouReportContextCandidate {
  return {
    name: "후보1",
    address: "주소1",
    pop500m: 1000,
    floating500Avg: 1000,
    facility500SubwayRiders: null,
    ...overrides,
  };
}

function baseResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    candidateCode: "N999",
    candidateName: "테스트후보지",
    address: "테스트주소",
    reviewStatus: "진행",
    expectedPcCount: 100,
    hourlyRate: 1200,
    v61Baseline: 65_000_000,
    v61IsFallback: false,
    v61ModelLabel: "V61 실측 학습모형",
    v61TrainingSampleCount: 34,
    v61ValidationMeanAbsError: null,
    v61TrainedModelExplain: null,
    locationScore: 4,
    inflowRestriction: "없음",
    v62Rate: -0.03,
    v62Final: 63_000_000,
    v62FinalBeforeCap: null,
    capacityCapped: false,
    competitorOverflowRevenueBonus: 0,
    conservativeSales: 53_000_000,
    upperSales: 72_000_000,
    marketDemand: 5000,
    marketGrade: "A",
    marketCharacter: "주거중심",
    competitorIp: 277,
    ipPerDemand: 13.4,
    competitivenessGap: 1.69,
    ownCompetitivenessScore: 4.28,
    competitorAvgCompetitiveness: 2.53,
    expectedOwnDemand: 3200,
    completionStatus: "완료",
    finalJudgement: "평가 완료",
    modelVersion: "V62",
    settingsSnapshotId: "settings-1",
    calculatedAt: 0,
    competitorOccupiedSeats: 24.71,
    competitorOccupiedSeatsCoverage: null,
    demandCaptureRate: 0.6,
    newDemandGrowthRate: 0.05,
    expectedOccupiedSeats: 15.57,
    expectedUtilization: 0.156,
    expectedDailyRevenuePerPc: 8968,
    measuredForecastMonthlyRevenue: 26_900_000,
    measuredForecastNeedsReview: false,
    v62ImpliedUtilization: 0.42,
    aaBaselineRevenue: 56_600_000,
    aaBaselineRevenue1500: 45_000_000,
    aaBaselineRevenue1000: 33_500_000,
    aaJudgement: "1,000만원 미달",
    ...overrides,
  };
}

describe("buildDaouReportContext", () => {
  it("상권등급을 언급하지 않는다", () => {
    const text = buildDaouReportContext({
      candidate: baseCandidate({ name: "하안금당사거리", address: "경기 광명시 하안동 200-2", pop500m: 24390, floating500Avg: 64229 }),
      competitors: [{ name: "메타피씨방", distanceM: 420, investigationStatus: "조사완료" }],
      result: baseResult(),
    });
    expect(text).not.toContain("상권등급");
    expect(text).not.toContain("상권등급 A");
  });

  it("경쟁력격차(비율)를 원점수 대신 5단계 라벨로 바꾼다 (경쟁점이 있을 때)", () => {
    const oneCompetitor = [{ name: "경쟁점A", distanceM: 200, investigationStatus: "조사완료" as const }];
    const labelFor = (gap: number) =>
      buildDaouReportContext({ candidate: baseCandidate(), competitors: oneCompetitor, result: baseResult({ competitivenessGap: gap }) });

    expect(labelFor(2.2)).toContain("매우우위");
    expect(labelFor(1.5)).toContain("우위");
    expect(labelFor(1.5)).not.toContain("매우우위");
    expect(labelFor(1.0)).toContain("동등");
    expect(labelFor(0.9)).toContain("열세");
    expect(labelFor(0.9)).not.toContain("매우열세");
    expect(labelFor(0.5)).toContain("매우열세");

    const superior = labelFor(1.69);
    expect(superior).not.toContain("4.28");
    expect(superior).not.toContain("2.53");
  });

  it("예상 수요확보율을 백분율로 포함한다", () => {
    const text = buildDaouReportContext({
      candidate: baseCandidate(),
      competitors: [],
      result: baseResult({ demandCaptureRate: 0.6 }),
    });
    expect(text).toContain("60.0%");
  });

  it("V62 매출예측 근거로 상권수요·자사확보예상수요를 포함한다", () => {
    const text = buildDaouReportContext({
      candidate: baseCandidate(),
      competitors: [],
      result: baseResult({ marketDemand: 5000, expectedOwnDemand: 3200, v62Final: 63_000_000 }),
    });
    expect(text).toContain("5,000명");
    expect(text).toContain("3,200명");
    expect(text).toContain("63,000,000원");
  });

  it("반경500m 특이사항(지하철)이 있으면 포함하고, 없으면 생략한다", () => {
    const withNotes = buildDaouReportContext({
      candidate: baseCandidate({ facility500SubwayRiders: 30693 }),
      competitors: [],
      result: baseResult(),
    });
    expect(withNotes).toContain("특이사항");
    expect(withNotes).toContain("지하철 승하차인구(500m) 약 30,693명");

    const withoutNotes = buildDaouReportContext({
      candidate: baseCandidate(),
      competitors: [],
      result: baseResult(),
    });
    expect(withoutNotes).not.toContain("특이사항");
  });

  it("보수판단매출/상한참고매출을 언급하지 않는다", () => {
    const text = buildDaouReportContext({
      candidate: baseCandidate(),
      competitors: [],
      result: baseResult(),
    });
    expect(text).not.toContain("보수판단");
    expect(text).not.toContain("상한참고");
  });

  it("경쟁점이 없으면 경쟁력 라벨을 붙이지 않는다 (gap=1.0 원본 기본값과 모순 방지)", () => {
    const text = buildDaouReportContext({
      candidate: baseCandidate(),
      competitors: [],
      result: baseResult({ competitivenessGap: 1.0, demandCaptureRate: 0.55 }),
    });
    expect(text).not.toContain("우위");
    expect(text).not.toContain("동등");
    expect(text).not.toContain("열세");
    expect(text).toContain("비교할 경쟁점이 없어 경쟁력 비교 대상 없음");
  });

  it("경쟁점없음으로 처리된 경쟁점은 목록에서 제외한다", () => {
    const text = buildDaouReportContext({
      candidate: baseCandidate(),
      competitors: [{ name: "제외대상", distanceM: 100, investigationStatus: "경쟁점없음" }],
      result: baseResult(),
    });
    expect(text).toContain("조사된 경쟁점 없음");
    expect(text).not.toContain("제외대상");
  });
});
