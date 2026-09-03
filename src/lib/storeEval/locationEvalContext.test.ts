import { describe, expect, it } from "vitest";
import { buildLocationEvalContext } from "./locationEvalContext";
import type { AdminDongReference, CandidateInput, Competitor, DemandPoint } from "./types";

function baseCandidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    code: "N999",
    name: "테스트후보지",
    address: "서울 강남구 테스트로 1",
    lat: 37.5,
    lng: 127.0,
    roadAddress: "서울 강남구 테스트로 1",
    jibunAddress: null,
    buildingName: null,
    geocodedAt: null,
    reviewDate: null,
    reviewStatus: "진행",
    expectedPcCount: null,
    floor: null,
    groundLevel: null,
    hasElevator: null,
    hourlyRate: null,
    demographicsYear: null,
    plannedOpenMonth: null,
    pop500m: null,
    area1kmKm2: null,
    pop1km: null,
    male1kmRatio: null,
    age1km_0_9: null,
    age1km_10_19: null,
    age1km_20_29: null,
    age1km_30_39: null,
    age1km_40_49: null,
    age1km_50_59: null,
    age1km_60_69: null,
    age1km_70_79: null,
    age1km_80plus: null,
    floating500Avg: null,
    floating500Male: null,
    floating500_10s: null,
    floating500_20s: null,
    floating500_30s: null,
    floating500_40s: null,
    floating500_50s: null,
    floating500_60plus: null,
    operatingPcStores500m: null,
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
    ownCpuTop1: null,
    ownCpuTop2: null,
    ownRam: null,
    ownRamTop: null,
    ownVgaBase: null,
    ownVgaTop: null,
    ownVgaTop2: null,
    ownSingleSeatCount: null,
    ownRoom1: null,
    ownRoom2: null,
    ownTeamRoom: null,
    ownCoupleZone: null,
    ownVipZone: null,
    ownFriendsZone: null,
    ownFirstClassZone: null,
    ownTeamRoomTotalSeats: null,
    ownTeamRoomTotalSeatsBasis: null,
    ownFoodScore: null,
    ownInteriorScore: null,
    ownManagementScore: null,
    ownMonitorBase: null,
    ownMonitorTop: null,
    ownFoodBrand: null,
    ownInteriorLevelScore: null,
    ownInteriorConditionScore: null,
    ownSeatZoneScore: null,
    ownComfortScore: null,
    createdAt: 0,
    updatedAt: 0,
    updatedBy: null,
    isDraft: false,
    ...overrides,
  };
}

function competitor(overrides: Partial<Competitor>): Competitor {
  return {
    id: "c1",
    candidateCode: "N999",
    name: "경쟁점",
    surveyLevel: null,
    investigationStatus: "조사완료",
    distanceM: null,
    floor: null,
    groundLevel: null,
    totalPcCount: null,
    appliedPcCount: null,
    hasElevator: null,
    cpu: null,
    cpuTop1: null,
    cpuTop2: null,
    vgaBase: null,
    vgaTop: null,
    vgaTop2: null,
    ram: null,
    ramTop: null,
    monitorBase: null,
    monitorTop: null,
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
    foodScore: null,
    foodBasis: null,
    foodBrand: null,
    interiorScore: null,
    interiorBasis: null,
    interiorLevelScore: null,
    interiorConditionScore: null,
    monitorBasis: null,
    managementScore: null,
    seatZoneScore: null,
    comfortScore: null,
    singleSeatCount: null,
    room1: null,
    room2: null,
    teamRoom: null,
    coupleZone: null,
    vipZone: null,
    friendsZone: null,
    firstClassZone: null,
    regularCoupleSeatCount: null,
    teamRoomTotalSeats: null,
    teamRoomTotalSeatsBasis: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function demandPoint(overrides: Partial<DemandPoint>): DemandPoint {
  return {
    id: "d1",
    candidateCode: "N999",
    name: "수요거점",
    category: "지하철역",
    lat: 37.5,
    lng: 127.0,
    distanceM: 100,
    source: "kakao",
    sourcePlaceId: null,
    fetchedAt: 0,
    confirmed: false,
    ...overrides,
  };
}

describe("buildLocationEvalContext", () => {
  it("데이터가 하나도 없으면 '없음' 계열 문구로 채운다(값을 지어내지 않는다)", () => {
    const text = buildLocationEvalContext({
      candidate: baseCandidate(),
      competitors: [],
      demandPoints: [],
      adminDongReference: null,
    });
    expect(text).toContain("수집된 경쟁점 없음");
    expect(text).toContain("수집된 수요거점 없음");
    expect(text).toContain("행정동 인구통계 없음");
    expect(text).toContain("소상공인365/SGIS 참고자료 없음");
  });

  it("경쟁점은 500m/1km 카운트와 거리순 목록을 만든다", () => {
    const text = buildLocationEvalContext({
      candidate: baseCandidate(),
      competitors: [
        competitor({ id: "c1", name: "가까운PC방", distanceM: 200 }),
        competitor({ id: "c2", name: "먼PC방", distanceM: 900 }),
        competitor({ id: "c3", name: "범위밖PC방", distanceM: 1500 }),
        competitor({ id: "c4", name: "거리모름PC방", distanceM: null }),
      ],
      demandPoints: [],
      adminDongReference: null,
    });
    expect(text).toContain("500m 이내 1곳");
    expect(text).toContain("1km 이내 2곳");
    expect(text).toContain("가까운PC방 (200m)");
    // 거리 정보 없는 경쟁점은 목록에서 제외되지만 카운트를 틀리게 만들지 않는다.
    expect(text).not.toContain("거리모름PC방");
  });

  it("수요거점은 카테고리별로 묶고 거리순으로 정렬한다", () => {
    const text = buildLocationEvalContext({
      candidate: baseCandidate(),
      competitors: [],
      demandPoints: [
        demandPoint({ id: "d1", name: "먼역", category: "지하철역", distanceM: 800 }),
        demandPoint({ id: "d2", name: "가까운역", category: "지하철역", distanceM: 300 }),
        demandPoint({ id: "d3", name: "학교", category: "학교", distanceM: 400 }),
      ],
      adminDongReference: null,
    });
    expect(text).toContain("지하철역 (2건): 가까운역(300m), 먼역(800m)");
    expect(text).toContain("학교 (1건): 학교(400m)");
  });

  it("행정동 인구통계와 소상공인365 참고자료를 있는 값만 요약한다", () => {
    const ref: AdminDongReference = {
      candidateCode: "N999",
      admCd: "1168010100",
      admName: "역삼동",
      totalPopulation: 12345,
      malePopulation: 6000,
      femalePopulation: 6345,
      year: 2024,
      fetchedAt: 0,
    };
    const text = buildLocationEvalContext({
      candidate: baseCandidate({ floating500Avg: 5000, operatingPcStores500m: 3 }),
      competitors: [],
      demandPoints: [],
      adminDongReference: ref,
    });
    expect(text).toContain("역삼동(2024년 기준) 총인구 12,345명");
    expect(text).toContain("유동인구 500m 일평균 5,000명");
    expect(text).toContain("실영업 PC방업소수 500m 3개");
    // 채워지지 않은 필드는 지어내지 않고 아예 줄 자체를 안 만든다.
    expect(text).not.toContain("직장인구 500m");
  });
});
