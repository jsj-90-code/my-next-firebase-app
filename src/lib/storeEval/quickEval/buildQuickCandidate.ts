// 자동수집 결과 + 자사 기획값 -> V62가 먹을 수 있는 입력(CandidateInput · Competitor[])으로 조립.
// (주소만 초기평가 도구 전용 · **순수 함수**. 네트워크·Firestore를 부르지 않는다)
//
// ── 조립 규칙의 근거 ──────────────────────────────────────────────────────
// `src/lib/storeEval/_addressOnlyMode.test.ts`가 잰 **L3(주소만) 조건과 같은 모양**으로 맞춘다.
// 그 측정이 이 도구가 화면에 띄우는 오차의 근거이므로, 조립을 다르게 하면 그 숫자가 거짓이 된다.
//
//   경쟁점 품질 칸 전부 null      -> 운영 V62가 결측으로 처리(동급 취급)
//   경쟁점 대수 null + 조사수준 "간략" -> 간략_기본대수(90대) 장치가 작동한다
//   자사 시설 칸 null             -> 회사 표준 존 구성이 들어간다
//
// ⚠️ **자사 쪽은 비우지 않는다.** PC대수·시급·층·엘리베이터·브랜드는 조사값이 아니라 기획값이라
//    점포개발 초기에도 사람이 정한다. 비우면 재는 대상이 달라진다.
// ⚠️ 여기서 값을 지어내지 않는다. 수집 실패는 null로 남고, 무엇이 비었는지는 `filledNotes`로
//    화면·AI 평가문에 올라간다.

import type { Competitor, CandidateInput, GroundLevel, FoodBrand, LocationEvaluation } from "../types";
import type { KakaoPcBangPlace } from "./kakaoPcBangs";
import { judgePcBangName, hasUnknownCategory } from "./pcBangNameFilter";
import type { SbizFloatingResult } from "./sbizFloating";
import type { SgisRadiusStats } from "./sgisRadiusPopulation";

/** 도구 안에서만 쓰는 후보지 코드. 운영 후보지(N001…)와 절대 겹치지 않게 접두사를 다르게 둔다. */
export const QUICK_EVAL_CANDIDATE_CODE = "QUICK-TEMP";

/** 사람이 정하는 기획값 — 화면 상단 입력칸이 그대로 이 모양이다. */
export type QuickEvalPlanInput = {
  name: string;
  address: string;
  expectedPcCount: number | null;
  hourlyRate: number | null;
  floor: number | null;
  groundLevel: GroundLevel | null;
  hasElevator: boolean | null;
  ownFoodBrand: FoodBrand | null;
  plannedOpenMonth: number | null;
};

export type QuickEvalCollected = {
  geocode: { lat: number; lng: number; roadAddress: string | null; jibunAddress: string | null; buildingName: string | null };
  sgis: { baseYear: string; byRadius: Record<number, SgisRadiusStats> } | null;
  floating: SbizFloatingResult | null;
  pcBangs: KakaoPcBangPlace[];
  /** 카카오 목록이 잘렸을 가능성 */
  pcBangsPossiblyTruncated: boolean;
};

export type QuickEvalCompetitorRow = {
  competitor: Competitor;
  place: KakaoPcBangPlace;
  /** 경쟁점으로 셌는가 */
  counted: boolean;
  excludedReason: string | null;
  /** 카카오가 업종을 안 줘서 PC방임을 확인하지 못한 경우 */
  categoryUnknown: boolean;
};

export type QuickEvalAssembly = {
  candidate: CandidateInput;
  /** V62에 넘기는 경쟁점 — 센 것만 들어간다 */
  competitors: Competitor[];
  /** 화면 목록용 — 제외된 것까지 이유와 함께 전부 */
  competitorRows: QuickEvalCompetitorRow[];
  /** 자동으로 못 채운 항목(사람이 봐야 하는 자리) */
  missing: string[];
};

/**
 * 하드웨어 기본값 — 신규후보지 생성 화면(`candidates/[code]/page.tsx` blankCandidate)이 쓰는
 * 것과 **같은 값**이다. "블랙라벨 현재 표준" 실제 구매 사양이라 기획값에 해당한다.
 * ⚠️ 그 화면의 값이 바뀌면 여기도 같이 바꿔야 한다 — 두 곳이 갈라지면 같은 후보지가 도구와
 *    정밀 평가에서 다른 자사 경쟁력점수를 받는다.
 */
export const QUICK_EVAL_OWN_HARDWARE = {
  ownCpu: "울트라5 225F",
  ownRam: "16GB",
  ownVgaBase: "RTX 5060",
  ownMonitorBase: "제이씨현 32인치 FHD 240Hz",
  ownMonitorTop:
    "QNIX IPS 27인치 FHD 300Hz, BenQ ZOWIE XL2540X+ 24.1인치 FHD 280Hz, 비트엠 34인치 WWQHD 165Hz, 비트엠 27인치 FHD 240Hz",
} as const;

function ratio(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part == null || whole == null || whole <= 0) return null;
  return part / whole;
}

function blankCompetitorFromPlace(place: KakaoPcBangPlace, now: number): Competitor {
  return {
    id: `${QUICK_EVAL_CANDIDATE_CODE}_kakao_${place.id}`,
    candidateCode: QUICK_EVAL_CANDIDATE_CODE,
    name: place.name,
    // ⭐ 조사수준 "간략" — 이 한 줄이 간략_기본대수(90대) 장치를 켠다. `_addressOnlyMode.test.ts`의
    //    L2/L3가 같은 처리를 한다("대수를 모르면 조사수준도 간략이다").
    surveyLevel: "간략",
    investigationStatus: "조사완료",
    distanceM: place.distanceM,
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
    managementScore: null,
    regularCoupleSeatCount: null,
    teamRoomTotalSeats: null,
    teamRoomTotalSeatsBasis: null,
    source: "kakao",
    sourcePlaceId: place.id,
    lat: place.lat,
    lng: place.lng,
    createdAt: now,
    updatedAt: now,
  };
}

/** 자동수집 결과를 V62 입력으로 조립한다. */
export function buildQuickCandidate(
  plan: QuickEvalPlanInput,
  collected: QuickEvalCollected,
  now = Date.now(),
): QuickEvalAssembly {
  const missing: string[] = [];
  const r500 = collected.sgis?.byRadius?.[500] ?? null;
  const r1km = collected.sgis?.byRadius?.[1000] ?? null;
  const fl = collected.floating;

  if (!r500 || r500.totalPopulation == null) missing.push("주거인구 500m (SGIS 수집 실패)");
  if (!r1km || r1km.totalPopulation == null) missing.push("주거인구 1km·연령구성 (SGIS 수집 실패)");
  if (!fl) missing.push("유동인구 500m (소상공인365 수집 실패 — 수요가 낮게 나올 수 있다)");
  if (plan.expectedPcCount == null) missing.push("자사 예상 PC대수 (기획값, 사람이 입력)");
  if (plan.hourlyRate == null) missing.push("자사 시간당 요금 (기획값, 사람이 입력)");

  const competitorRows: QuickEvalCompetitorRow[] = collected.pcBangs.map((place) => {
    const verdict = judgePcBangName(place);
    return {
      competitor: blankCompetitorFromPlace(place, now),
      place,
      counted: verdict.counted,
      excludedReason: verdict.excludedReason,
      categoryUnknown: hasUnknownCategory(place),
    };
  });
  const competitors = competitorRows.filter((row) => row.counted).map((row) => row.competitor);

  const candidate: CandidateInput = {
    code: QUICK_EVAL_CANDIDATE_CODE,
    name: plan.name,
    address: plan.address,
    lat: collected.geocode.lat,
    lng: collected.geocode.lng,
    roadAddress: collected.geocode.roadAddress,
    jibunAddress: collected.geocode.jibunAddress,
    buildingName: collected.geocode.buildingName,
    geocodedAt: now,
    reviewDate: null,
    reviewStatus: "진행",

    // ---- 사람이 정하는 기획값 ----
    expectedPcCount: plan.expectedPcCount,
    floor: plan.floor,
    groundLevel: plan.groundLevel,
    hasElevator: plan.hasElevator,
    hourlyRate: plan.hourlyRate,
    plannedOpenMonth: plan.plannedOpenMonth,

    // ---- SGIS 자동수집 ----
    demographicsYear: collected.sgis ? Number(collected.sgis.baseYear) : null,
    pop500m: r500?.totalPopulation ?? null,
    // 조회면적(㎡) -> ㎢. SGIS가 자른 원이면 areaOffRatio로 드러난다(화면에 경고).
    area1kmKm2: r1km?.areaSizeM2 != null ? Number((r1km.areaSizeM2 / 1_000_000).toFixed(4)) : null,
    pop1km: r1km?.totalPopulation ?? null,
    male1kmRatio: ratio(r1km?.malePopulation, r1km?.totalPopulation),
    age1km_0_9: r1km?.ageBands[0] ?? null,
    age1km_10_19: r1km?.ageBands[1] ?? null,
    age1km_20_29: r1km?.ageBands[2] ?? null,
    age1km_30_39: r1km?.ageBands[3] ?? null,
    age1km_40_49: r1km?.ageBands[4] ?? null,
    age1km_50_59: r1km?.ageBands[5] ?? null,
    age1km_60_69: r1km?.ageBands[6] ?? null,
    age1km_70_79: r1km?.ageBands[7] ?? null,
    age1km_80plus: r1km?.ageBands[8] ?? null,

    // ---- 소상공인365 자동수집 ----
    floating500Avg: fl?.avg ?? null,
    floating500Male: fl?.scaled.male ?? null,
    floating500_10s: fl?.scaled.age10s ?? null,
    floating500_20s: fl?.scaled.age20s ?? null,
    floating500_30s: fl?.scaled.age30s ?? null,
    floating500_40s: fl?.scaled.age40s ?? null,
    floating500_50s: fl?.scaled.age50s ?? null,
    floating500_60plus: fl?.scaled.age60plus ?? null,

    // ---- 카카오 자동수집 ----
    // 실영업 PC방업소수 500m — 이름 규칙으로 걸러낸 뒤의 개수다.
    operatingPcStores500m: competitors.length,

    // ---- 참고자료(calc.ts가 읽지 않는 칸) — 자동수집 범위 밖이라 비운다 ----
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

    // ---- 자사 하드웨어(기획값, 신규후보지 화면과 같은 기본값) ----
    ownCpu: QUICK_EVAL_OWN_HARDWARE.ownCpu,
    ownCpuTop1: null,
    ownCpuTop2: null,
    ownRam: QUICK_EVAL_OWN_HARDWARE.ownRam,
    ownRamTop: null,
    ownVgaBase: QUICK_EVAL_OWN_HARDWARE.ownVgaBase,
    ownVgaTop: null,
    ownVgaTop2: null,
    ownMonitorBase: QUICK_EVAL_OWN_HARDWARE.ownMonitorBase,
    ownMonitorTop: QUICK_EVAL_OWN_HARDWARE.ownMonitorTop,

    // ---- 자사 시설 구성 — 전부 비운다. 회사 표준 존 구성이 들어간다 ----
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
    ownFoodBrand: plan.ownFoodBrand,
    ownInteriorLevelScore: null,
    ownInteriorConditionScore: null,
    ownSeatZoneScore: null,
    ownComfortScore: null,

    // ---- 담당자 판단 매출 — 이 도구는 쓰지 않는다 ----
    judgedRevenue: null,
    judgedReason: null,
    judgedAt: null,
    judgedBy: null,

    createdAt: now,
    updatedAt: now,
    updatedBy: null,
    isDraft: true,
  };

  return { candidate, competitors, competitorRows, missing };
}

/**
 * AI 입지평가 초안(Gemini)을 V62가 먹는 LocationEvaluation으로 옮긴다.
 *
 * ⚠️ 가시성(visibilityScore)이 비면 정식검증군 조건이 깨지고, 이 도구에서는 입지 항이 통째로
 *    빠진다. AI가 근거 부족으로 null을 주면 **지어내지 않고** null로 남기고, 호출부가
 *    "입지평가 없음"으로 표시한다.
 */
export function buildQuickLocationEvaluation(
  plan: Pick<QuickEvalPlanInput, "name" | "address">,
  draft: { fields: Record<string, number | string | null> } | null,
  now = Date.now(),
): LocationEvaluation | null {
  if (!draft) return null;
  const f = draft.fields;
  // 1~5 밖의 값은 버린다 — AI가 스키마를 벗어난 값을 주면 지어낸 값이 계산에 들어간다.
  const score = (key: string): 1 | 2 | 3 | 4 | 5 | null => {
    const v = f[key];
    return typeof v === "number" && v >= 1 && v <= 5 ? (Math.round(v) as 1 | 2 | 3 | 4 | 5) : null;
  };
  const text = (key: string): string | null => (typeof f[key] === "string" ? (f[key] as string) : null);
  return {
    candidateCode: QUICK_EVAL_CANDIDATE_CODE,
    name: plan.name,
    address: plan.address,
    // 브랜드는 입지평가를 안 해도 안다 — 우리가 정하는 값이지 조사값이 아니다
    // (`_addressOnlyMode.test.ts`가 같은 이유로 브랜드를 따로 챙긴다).
    brandType: "블랙라벨",
    locationScore: score("locationScore"),
    // 레거시 항목 — 2026-09-01에 AI 채점 대상에서 빠졌다(locationScore로 통합).
    flowScore: null,
    attractionScore: null,
    demandLeakageRisk: null,
    preemptionScore: score("preemptionScore"),
    visibilityScore: score("visibilityScore"),
    mapMemo: null,
    specialDemandType: text("specialDemandType") as LocationEvaluation["specialDemandType"],
    specialDemandIntensity: text("specialDemandIntensity") as LocationEvaluation["specialDemandIntensity"],
    inflowRestriction: text("inflowRestriction") as LocationEvaluation["inflowRestriction"],
    marketStructureMemo: text("marketStructureMemo"),
    updatedAt: now,
    updatedBy: null,
  };
}
