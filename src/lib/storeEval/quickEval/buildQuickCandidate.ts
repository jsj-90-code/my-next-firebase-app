// 자동수집 결과 + 자사 기획값 -> V62가 먹을 수 있는 입력(CandidateInput · Competitor[])으로 조립.
// (주소만 초기평가 도구 전용 · **순수 함수**. 네트워크·Firestore를 부르지 않는다)
//
// ── 조립 규칙의 근거 ──────────────────────────────────────────────────────
// `src/lib/storeEval/_addressOnlyMode.test.ts`가 잰 **L3(주소만) 조건과 같은 모양**으로 맞춘다.
// 그 측정이 이 도구가 화면에 띄우는 오차의 근거이므로, 조립을 다르게 하면 그 숫자가 거짓이 된다.
//
//   경쟁점 품질 칸 -> **실측 대표값으로 채운다**(RIVAL_TYPICAL_WHEN_UNSURVEYED).
//     ⚠️ 2026-09-22 밤 3차에 바뀌었다. 예전엔 비웠는데, 비우면 V62가 동급으로 보는 게 아니라
//     경쟁점을 **약하게** 매겨(점수 2.448 -> 1.921) 예상매출이 높게 나온다.
//   경쟁점 대수 -> **실측 경쟁점의 평균**(RIVAL_PC_COUNT_WHEN_UNSURVEYED). 조사수준은
//     "간략"으로 남기되 장치 기본값(90대)에 맡기지 않는다 — 4차에서 바뀌었다.
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
 * 신규후보지 생성 화면(`candidates/[code]/page.tsx` blankCandidate)이 쓰는 **표준 기획값**.
 * "블랙라벨 현재 표준" 실제 구매 사양이다.
 *
 * ⚠️ 이 도구는 이 값을 **안 쓴다**(아래 QUICK_EVAL_OWN_HARDWARE 주석). 여기 남겨 둔 건
 *    두 값의 관계를 한눈에 보이게 하려는 것이고, 그 화면의 값이 바뀌면 여기도 같이 고쳐서
 *    "무엇과 무엇이 다른가"가 계속 맞게 유지하기 위한 것이다.
 */
export const OWN_HARDWARE_PLANNED_STANDARD = {
  ownCpu: "울트라5 225F",
  ownRam: "16GB",
  ownVgaBase: "RTX 5060",
  ownMonitorBase: "제이씨현 32인치 FHD 240Hz",
  ownMonitorTop:
    "QNIX IPS 27인치 FHD 300Hz, BenQ ZOWIE XL2540X+ 24.1인치 FHD 280Hz, 비트엠 34인치 WWQHD 165Hz, 비트엠 27인치 FHD 240Hz",
} as const;

/**
 * ⭐⭐ 이 도구가 자사 사양으로 넣는 값 — **기존 가맹점 38곳의 최빈 사양**이다.
 *
 * ── 왜 표준 기획값이 아닌가 (2026-09-22 밤, `_quickEvalBias.test.ts`) ──────────
 * 사용자: *"실제보다 21퍼 높게나오는 경향있따고했잖아. 이걸 산식을통해 개선하면되지않니?
 * 보정말고 값을 조정하면되자나"* — 그래서 조정할 수 있는 값을 다 재 봤다.
 *
 *   경쟁점 기본대수(90 -> 300대, 학습·후보지 양쪽 같이) : 배율 1.211 -> 1.199. **안 움직인다**
 *   경쟁점 품질을 실측 대표값으로 메움(학습도 같이 비운 조건) : 배율 1.240으로 나빠졌다
 *     ⚠️ 이 줄은 **그 조건에서만** 맞다. 학습을 실측으로 두고 후보지만 채우면 크게 좋아진다
 *     (배율 1.105 · MAPE 20.23%) — 3차에서 그쪽으로 바꿨다.
 *   자사 사양을 비움(미정)                            : V62가 금액을 **못 낸다**(n=0)
 *   **자사 사양을 표본 최빈으로**                       : 배율 1.211 -> **1.140**, MAPE 27.79 -> **23.14%**
 *
 * 표준 기획값(울트라5 225F · RTX 5060)은 **학습 표본에 없는 사양 구간**이다. 기존점은 전부
 * i5 14400F · RTX 4060 세대라, 표준 기획값을 넣으면 모형이 표본 밖으로 외삽한다. 그 사양
 * 프리미엄이 진짜인지는 확인할 길이 없다 — 신사양 매장의 실매출이 아직 없고, 사양과 개점
 * 시점이 얽혀 있다(코호트 교란). 그래서 **표본 안쪽 값**을 쓴다.
 *
 * ⚠️ 이 값은 **화면에도 AI 평가문에도 안 나온다**(2026-09-22 확인 — grep으로 확인했다).
 *    V62 경쟁력점수 계산에만 들어가므로, 낮춰도 화면에 거짓 사양을 적는 일은 없다.
 * ⚠️ 그래서 이 도구와 정밀 평가는 같은 후보지에 **다른 자사 경쟁력점수**를 준다(도구가 약
 *    6% 낮다). 일부러 그렇게 뒀다 — 정밀 평가도 표준 기획값 때문에 실제보다 13% 높게 나온다는
 *    게 같은 측정에서 나왔고(②단계 배율 1.132), 그쪽에 맞추는 건 같이 틀리자는 뜻이 된다.
 *    ⛔ 정밀 평가(`/store-eval`)를 이 판단으로 고치지 마라 — 사용자 지시로 이 도구 전용이다.
 * ⚠️ 이 값을 되돌리면 `quickEvalDefaults.QUICK_EVAL_BACKTEST`의 숫자도 같이 되돌려야 한다.
 */
// ⛔⛔ 2026-09-23 **되돌렸다** — 표본 최빈 사양(i5 14400F · RTX 4060)으로 낮췄던 걸
//     표준 기획값으로 원복했다. 위 주석의 근거(표본 밖 외삽)는 여전히 맞지만, **되짚기가
//     실제 도구를 대표하지 못했다**: 되짚기로는 −10%였는데 실제 후보지에서는 전부 −45%가
//     나왔다(사용자 확인, 인천 호구포점 등 여러 곳). 되짚기는 기존점의 **조사된** 경쟁점
//     (중앙 4곳·최대 10곳)으로 도는데 실제는 카카오 500m(10~20곳)이라, 경쟁점을 통해
//     작동하는 변경의 충격을 크게 과소평가했다.
//     ⚠️ 대표성 없는 측정에 기대어 값을 바꾸면 안 된다. **카카오 경쟁점 수를 반영한
//        되짚기를 새로 만든 뒤에** 다시 판단한다.
export const QUICK_EVAL_OWN_HARDWARE = OWN_HARDWARE_PLANNED_STANDARD;

/**
 * ⭐⭐⭐ 미조사 경쟁점에 넣는 **PC 대수** (2026-09-22 밤 4차).
 *
 * 운영 V62의 간략_기본대수(`DEFAULT_UNSURVEYED_PC_COUNT` = 90대)를 쓰지 않고 이 값을 쓴다.
 *
 * ── 왜 90대가 아닌가 ──────────────────────────────────────────────────────
 * 실측으로 대수를 아는 경쟁점 159곳: 최소 61 · 1사분위 97 · 중앙 111 · 3사분위 150 · 최대 400 ·
 * **평균 129.1**. 90대보다 작은 건 14%뿐이라 90대는 분포의 아래쪽이다.
 *
 * ⚠️ 3차까지는 이걸 고쳐도 소용없었다 — 학습 쪽도 같이 비워서 수준 변화를 재학습이 흡수했기
 *    때문이다(90 -> 300대에 배율 1.211 -> 1.199). 3차에서 **학습을 실측으로 되돌리자 대수
 *    비대칭이 다시 살아났고**(학습은 진짜 대수, 후보지만 90대), 그때부터 지렛대가 된다.
 *
 * ── 왜 중앙값(111)이 아니라 평균(129)인가 ─────────────────────────────────
 * 경쟁IP는 경쟁점 대수의 **합계**다(`calc.computeCompetitorIp` — reduce로 더한다).
 * n개 경쟁점 합계의 기댓값은 n × **평균**이지 n × 중앙값이 아니다. 대수 분포가 오른쪽으로
 * 치우쳐 있어(최대 400대) 중앙값을 넣으면 합계를 과소평가한다.
 * 측정도 같은 답을 준다: 중앙 111대 MAPE 19.72% vs 평균 129대 **19.34%**.
 *
 * ⚠️ 3사분위(150대)를 넣으면 18.98%로 더 좋아진다. **안 쓴다** — 근거가 없는 지점이고,
 *    "좋아질 때까지 올리기"는 이 저장소가 지수 눈금 보정에서 이미 겪은 실패다.
 */
export const RIVAL_PC_COUNT_WHEN_UNSURVEYED = 129;

/**
 * ⭐⭐⭐ 미조사 경쟁점에 넣는 **실측 대표값** (2026-09-22 밤 3차, `_quickEvalBias.test.ts`).
 *
 * 사용자: *"그럼 주소만초기평가에서 경쟁점 점수를 좀 높여야겠네."* — 맞는 판단이었고, 재 보니
 * 효과가 컸다.
 *
 * ── 왜 비워 두면 안 되나 ──────────────────────────────────────────────────
 * 품질 칸을 비우면 V62가 **동급(중립)으로 보지 않는다.** 경쟁점 경쟁력점수가 실측 2.448에서
 * **1.921로 떨어지고** 경쟁력격차가 1.455 -> 1.904로 벌어진다. 자사 점수는 거의 안 변한다
 * (3.700 -> 3.735) — 즉 **예상매출이 높게 나온 건 자사를 후하게 봐서가 아니라 경쟁점을 약하게
 * 봐서**였다.
 *
 * ── 값의 근거 ─────────────────────────────────────────────────────────────
 * 실측으로 품질을 아는 경쟁점 **159곳**의 대표값이다. 숫자 칸은 중앙값, 사양(문자)은 최빈값.
 * 먹거리·인테리어·관리 점수의 중앙값이 3점이라 3점을 쓴다 — "좋아질 때까지 올린" 값이 아니다
 * (4·5점으로 올리면 성적이 더 좋아지지만, 그건 산식의 과한 퍼짐을 누르는 것이라 안 한다.
 * 이 저장소는 2026-09-21에 지수 눈금 보정으로 같은 짓을 했다가 껐다).
 *
 * ⚠️ 이 값을 바꾸면 `quickEvalDefaults.QUICK_EVAL_BACKTEST`도 같이 고쳐야 한다.
 */
export const RIVAL_TYPICAL_WHEN_UNSURVEYED = {
  singleSeatCount: 0,
  room1: 0,
  room2: 0,
  teamRoom: 0,
  coupleZone: 0,
  vipZone: 0,
  friendsZone: 0,
  firstClassZone: 0,
  regularCoupleSeatCount: 0,
  teamRoomTotalSeats: 0,
  foodScore: 3,
  interiorScore: 3,
  managementScore: 3,
  vgaBase: "RTX 4060",
  vgaTop: "RTX 3060 Ti",
  vgaTop2: "RTX 4060",
  cpu: "i5 12400F",
  cpuTop1: "i5 13400F",
  cpuTop2: "i5 13400F",
  ram: "16GB",
  ramTop: "32GB",
  monitorBase: "(32인치·FHD·240Hz)",
  monitorTop: "BenQ ZOWIE XL2746K (27인치·FHD·240Hz)",
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
    // ⭐ 조사수준은 "간략"으로 남긴다 — 실사한 값이 아니라는 표시다.
    //    다만 **대수는 장치 기본값(90대)에 맡기지 않고 직접 채운다**(아래 appliedPcCount).
    //    appliedPcCount가 있으면 computeCompetitorAppliedPcCount가 그 값을 먼저 쓴다.
    surveyLevel: "간략",
    investigationStatus: "조사완료",
    distanceM: place.distanceM,
    floor: null,
    groundLevel: null,
    totalPcCount: null,
    // ⭐ 실측 경쟁점 159곳의 **평균** 대수. 경쟁IP가 합계라서 중앙값이 아니라 평균이 맞다
    //    (RIVAL_PC_COUNT_WHEN_UNSURVEYED 주석에 근거가 다 있다).
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

/**
 * ⛔⛔ **이제 도구가 안 쓴다** (2026-09-22 밤 3차). 측정 시험(`_quickEvalSensitivity.test.ts`)이
 * 아직 부르고 있어서 남겨 둘 뿐이다. 아래 설명은 **그날 낮의 판단**이고, 밤에 뒤집혔다.
 *
 * 비대칭을 없애는 길은 둘인데 여기서는 **정보를 버리는 쪽**을 골랐다. 반대로 후보지 쪽을
 * 실측 대표값으로 **채우면**(`RIVAL_TYPICAL_WHEN_UNSURVEYED`) 모든 지표에서 이긴다:
 *
 *   학습 비움 + 후보지 비움(이 함수)  MAPE 23.14% · ±20% 47.37% · 배율 1.140
 *   학습 실측 + 후보지 대표값(지금)   MAPE 20.23% · ±20% 71.05% · 배율 1.105
 *
 * 기존점 경쟁점은 사람이 **실제로 조사한 값**이다. 그걸 버리면 매장끼리 구별하는 정보가 같이
 * 사라진다. ⛔ 화면 배선에 이 함수를 다시 끼우지 마라.
 *
 * ── 아래는 그날 낮의 기록(맥락 보존용) ────────────────────────────────────
 * ⭐ **학습 표본의 경쟁점도 같은 수준으로 비운다** (2026-09-22 밤 — 측정으로 찾은 최대 결함).
 *
 * 왜 필요한가: 도구는 후보지 경쟁점을 전부 기본값(90대·품질 결측)으로 넣는데, **학습은 사람이
 * 다 조사한 실측 경쟁점**으로 하고 있었다. 학습은 큰 경쟁점을 보고 계수를 정했는데 후보지엔
 * 작은 경쟁점만 놓이니 경쟁IP가 과소평가되고 점유율이 과대평가된다 => 매출이 높게 나왔다.
 *
 * 기존매장 38곳을 후보지인 척 재평가해 잰 값(`_quickEvalBias.test.ts`, 자기 자신은 학습에서 뺌):
 *
 *   비대칭(고치기 전)  MAPE 46.35% · ±20% 26.32% · 예측÷실측 중앙 **1.461** · 35/38곳 과대
 *   대칭(고친 뒤)      MAPE 27.79% · ±20% 42.11% · 예측÷실측 중앙 **1.211** · 30/38곳 과대
 *
 * ⚠️ 기본대수를 90 -> 200으로 올려도 배율이 1.211 -> 1.166으로 조금 움직일 뿐이다. 그건 근거
 *    없는 값이라(실측 분포와 안 맞고 38곳에 과적합) 안 쓴다. 구조를 맞추는 게 먼저다.
 * ⚠️ 남은 과대(1.21) 중 큰 몫은 **자사를 표준값으로 두는 것**(+14.2%)이다. 그건 "지금 새로
 *    지으면"이라 후보지 평가의 본질이고 정밀 평가도 똑같다 — 도구만의 결함이 아니다.
 */
export function blankCompetitorForTraining(c: Competitor): Competitor {
  const out = { ...c } as unknown as Record<string, unknown>;
  for (const key of [
    "singleSeatCount", "room1", "room2", "teamRoom", "coupleZone", "vipZone",
    "friendsZone", "firstClassZone", "regularCoupleSeatCount", "teamRoomTotalSeats",
    "vgaBase", "vgaTop", "vgaTop2", "cpu", "cpuTop1", "cpuTop2",
    "ram", "ramTop", "monitorBase", "monitorTop",
    "foodScore", "interiorScore", "managementScore",
  ]) {
    out[key] = null;
  }
  out.totalPcCount = null;
  out.appliedPcCount = null;
  // 대수를 모르면 조사수준도 "간략"이다 — 그래야 기본대수 장치가 작동한다.
  out.surveyLevel = "간략";
  return out as unknown as Competitor;
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
  if (plan.hourlyRate == null) missing.push("자사 기본요금 (기획값, 사람이 입력)");

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
