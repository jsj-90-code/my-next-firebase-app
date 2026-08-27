// evaluate.ts는 calc.ts 순수함수들을 배선(wiring)하는 오케스트레이션 함수라, 각 산식 자체의
// 정확도는 calc.test.ts의 골든데이터가 이미 검증한다. 여기서는 배선이 올바른지(필드 매핑 오타 등)만
// 스모크 테스트로 확인한다.

import { describe, expect, it } from "vitest";
import { evaluateCandidate } from "./evaluate";
import { defaultModelSettings } from "./settings";
import type { CandidateInput, Competitor, LocationEvaluation } from "./types";

const settings = { ...defaultModelSettings(), updatedAt: 0, updatedBy: null };

function emptyCandidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    code: "N001",
    name: "테스트후보지",
    address: "테스트주소",
    lat: null,
    lng: null,
    roadAddress: null,
    jibunAddress: null,
    buildingName: null,
    geocodedAt: null,
    reviewDate: null,
    reviewStatus: "진행",
    expectedPcCount: 100,
    floor: 3,
    groundLevel: "지상",
    hasElevator: true,
    hourlyRate: 1400,
    demographicsYear: 2026,
    plannedOpenMonth: 3,
    pop500m: 10338,
    area1kmKm2: 3.14,
    pop1km: 67450,
    male1kmRatio: 0.4963,
    age1km_0_9: 0,
    age1km_10_19: 0,
    age1km_20_29: 0,
    age1km_30_39: 0,
    age1km_40_49: 0,
    age1km_50_59: 0,
    age1km_60_69: 0,
    age1km_70_79: 0,
    age1km_80plus: 0,
    floating500Avg: 166062,
    floating500Male: 92686,
    floating500_10s: 10319,
    floating500_20s: 19694,
    floating500_30s: 25521,
    floating500_40s: 34130,
    floating500_50s: 35995,
    floating500_60plus: 40403,
    operatingPcStores500m: 5,
    commercialDataYearMonth: null,
    businessCountAsOfDate: null,
    operatingPcStores1km: null,
    employ500Total: null,
    employ500Male: null,
    employ500Female: null,
    employ1kmTotal: null,
    employ1kmMale: null,
    employ1kmFemale: null,
    facility500SubwayRiders: null,
    facility1kmSubwayRiders: null,
    ownCpu: null,
    ownRam: null,
    ownVgaBase: null,
    ownVgaTop: null,
    ownGameZoneCount: 1,
    ownRoom1: 0,
    ownRoom2: 0,
    ownTeamRoom: 2,
    ownCoupleZone: 1,
    ownVipZone: 1,
    ownFriendsZone: 0,
    ownFoodScore: 4,
    ownInteriorScore: 4,
    ownMonitorScore: 4,
    createdAt: 0,
    updatedAt: 0,
    updatedBy: null,
    isDraft: false,
    ...overrides,
  };
}

const competitor: Competitor = {
  id: "c1",
  candidateCode: "N001",
  name: "경쟁점A",
  surveyLevel: "상세",
  investigationStatus: "조사완료",
  distanceM: 300,
  floor: 1,
  groundLevel: "지상",
  totalPcCount: 80,
  appliedPcCount: 80,
  hasElevator: true,
  cpu: null,
  vgaBase: null,
  vgaTop: null,
  ram: null,
  monitor: null,
  ratePer1000Won: null,
  hourlyRateConverted: null,
  paidDeduction: null,
  visitedAt: null,
  visitedDow: null,
  visitorCount: null,
  measuredSeatRate: null,
  pingbotUtilization: null,
  pingbotPeriod: null,
  renovationYear: null,
  foodScore: 3,
  foodBasis: null,
  interiorScore: 3,
  interiorBasis: null,
  monitorScore: 3,
  monitorBasis: null,
  room1: 0,
  room2: 0,
  teamRoom: 0,
  coupleZone: 0,
  premiumZone: 0,
  premiumSpec: null,
  createdAt: 0,
  updatedAt: 0,
};

const locationEval: LocationEvaluation = {
  candidateCode: "N001",
  name: "테스트후보지",
  address: "테스트주소",
  locationScore: 4,
  flowScore: 4,
  preemptionScore: 3,
  visibilityScore: 4,
  mapMemo: null,
  attractionScore: 4,
  specialDemandType: "없음",
  specialDemandIntensity: "없음",
  inflowRestriction: "없음",
  demandLeakageRisk: "없음",
  marketStructureMemo: null,
  brandType: "블랙라벨",
  updatedAt: 0,
  updatedBy: null,
};

describe("evaluateCandidate 배선 검증", () => {
  it("09/05 입력이 모두 있으면 완료까지 계산된다", () => {
    const result = evaluateCandidate({
      candidate: emptyCandidate(),
      competitors: [competitor],
      locationEvaluation: locationEval,
      settings,
      existingMarketDemands: [1000, 2000, 3000],
      existingStores: [],
    });
    expect(result.candidateCode).toBe("N001");
    expect(result.marketCharacter).toBe("번화가"); // 유동500=166062 / 거주500=10338 → 16배
    expect(result.v61Baseline).not.toBeNull();
    expect(result.v62Final).not.toBeNull();
    expect(result.completionStatus).toBe("완료");
    expect(["평가 완료", "포화 주의", "입지 재검토"]).toContain(result.finalJudgement);
    expect(result.conservativeSales).toBe(Math.round((result.v62Final ?? 0) * 0.85));
  });

  it("09 입지평가가 없으면 09 입지평가 필요로 멈춘다", () => {
    const result = evaluateCandidate({
      candidate: emptyCandidate(),
      competitors: [competitor],
      locationEvaluation: null,
      settings,
      existingMarketDemands: [],
      existingStores: [],
    });
    expect(result.completionStatus).toBe("09 입지평가 필요");
    expect(result.finalJudgement).toBe("09 입지평가 필요");
  });

  it("브랜드가 블랙라벨이 아니면 브랜드 확인 필요", () => {
    const result = evaluateCandidate({
      candidate: emptyCandidate(),
      competitors: [competitor],
      locationEvaluation: { ...locationEval, brandType: "리그PC방" },
      settings,
      existingMarketDemands: [],
      existingStores: [],
    });
    expect(result.completionStatus).toBe("브랜드 확인 필요");
  });

  it("경쟁점이 하나도 없으면 실영업업소수 대체값으로 경쟁IP를 추정한다", () => {
    const result = evaluateCandidate({
      candidate: emptyCandidate(),
      competitors: [],
      locationEvaluation: locationEval,
      settings,
      existingMarketDemands: [],
      existingStores: [],
    });
    // (실영업 5 - 1) * 100 = 400
    expect(result.competitorIp).toBe(400);
  });

  it("자사 시설 입력값이 비어있으면 표준 존 구성(2026-08-21)으로 계산해 실제 입력값과 같은 결과를 낸다", () => {
    const blankFacility = {
      ownGameZoneCount: null,
      ownRoom1: 0,
      ownRoom2: 0,
      ownTeamRoom: null,
      ownCoupleZone: null,
      ownVipZone: null,
      ownFriendsZone: null,
      ownFoodScore: null,
      ownInteriorScore: null,
      ownMonitorScore: null,
    };
    const standardFacility = {
      ownGameZoneCount: 3,
      ownRoom1: 0,
      ownRoom2: 0,
      ownTeamRoom: 2,
      ownCoupleZone: 3,
      ownVipZone: 5,
      ownFriendsZone: 15,
      // 2026-08-27: 표준값이 4→5(먹거리/인테리어)로 재조정됨 - STANDARD_OWN_FACILITY_DEFAULTS와 맞춘다.
      ownFoodScore: 5,
      ownInteriorScore: 5,
      ownMonitorScore: 4,
    };
    const blankResult = evaluateCandidate({
      candidate: emptyCandidate(blankFacility),
      competitors: [competitor],
      locationEvaluation: locationEval,
      settings,
      existingMarketDemands: [1000, 2000, 3000],
      existingStores: [],
    });
    const explicitResult = evaluateCandidate({
      candidate: emptyCandidate(standardFacility),
      competitors: [competitor],
      locationEvaluation: locationEval,
      settings,
      existingMarketDemands: [1000, 2000, 3000],
      existingStores: [],
    });
    expect(blankResult.competitivenessGap).toBeCloseTo(explicitResult.competitivenessGap ?? 0, 6);
    expect(blankResult.v62Final).toBe(explicitResult.v62Final);
  });
});
