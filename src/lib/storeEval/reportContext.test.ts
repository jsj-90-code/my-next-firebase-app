import { describe, expect, it } from "vitest";
import { buildDaouReportContext } from "./reportContext";
import type { EvaluationResult } from "./types";

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
    locationScore: 4,
    inflowRestriction: "없음",
    v62Rate: -0.03,
    v62Final: 63_000_000,
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
    aaBaselineRevenue: 56_600_000,
    aaJudgement: "AA 미달",
    ...overrides,
  };
}

describe("buildDaouReportContext", () => {
  it("상권등급을 언급하지 않는다", () => {
    const text = buildDaouReportContext({
      candidate: { name: "하안금당사거리", address: "경기 광명시 하안동 200-2", pop500m: 24390, floating500Avg: 64229 },
      competitors: [{ name: "메타피씨방", distanceM: 420, investigationStatus: "조사완료" }],
      result: baseResult(),
    });
    expect(text).not.toContain("상권등급");
    expect(text).not.toContain("상권등급 A");
  });

  it("경쟁력격차(비율)를 원점수 대신 우위/동등/열세 라벨로 바꾼다", () => {
    const superior = buildDaouReportContext({
      candidate: { name: "후보1", address: "주소1", pop500m: 1000, floating500Avg: 1000 },
      competitors: [],
      result: baseResult({ competitivenessGap: 1.69 }),
    });
    expect(superior).toContain("우위");
    expect(superior).not.toContain("4.28");
    expect(superior).not.toContain("2.53");

    const equal = buildDaouReportContext({
      candidate: { name: "후보1", address: "주소1", pop500m: 1000, floating500Avg: 1000 },
      competitors: [],
      result: baseResult({ competitivenessGap: 1.0 }),
    });
    expect(equal).toContain("동등");

    const inferior = buildDaouReportContext({
      candidate: { name: "후보1", address: "주소1", pop500m: 1000, floating500Avg: 1000 },
      competitors: [],
      result: baseResult({ competitivenessGap: 0.5 }),
    });
    expect(inferior).toContain("열세");
  });

  it("예상 수요확보율을 백분율로 포함한다", () => {
    const text = buildDaouReportContext({
      candidate: { name: "후보1", address: "주소1", pop500m: 1000, floating500Avg: 1000 },
      competitors: [],
      result: baseResult({ demandCaptureRate: 0.6 }),
    });
    expect(text).toContain("60.0%");
  });

  it("보수판단매출/상한참고매출을 언급하지 않는다", () => {
    const text = buildDaouReportContext({
      candidate: { name: "후보1", address: "주소1", pop500m: 1000, floating500Avg: 1000 },
      competitors: [],
      result: baseResult(),
    });
    expect(text).not.toContain("보수판단");
    expect(text).not.toContain("상한참고");
  });

  it("경쟁점없음으로 처리된 경쟁점은 목록에서 제외한다", () => {
    const text = buildDaouReportContext({
      candidate: { name: "후보1", address: "주소1", pop500m: 1000, floating500Avg: 1000 },
      competitors: [{ name: "제외대상", distanceM: 100, investigationStatus: "경쟁점없음" }],
      result: baseResult(),
    });
    expect(text).toContain("조사된 경쟁점 없음");
    expect(text).not.toContain("제외대상");
  });
});
