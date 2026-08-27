// 점포평가 V61/V62 계산 순수함수.
// 근거: docs/model-spec.md (원본 구글시트 "점포평가_V62_원본.xlsx" 셀 수식·08_계산기준 프로즈 명세 분석).
// 이 파일의 모든 계수는 함수 인자로 받는 ModelSettings에서 온다 - 값 자체를 이 파일에 새로
// 하드코딩하지 않는다 (요청사항: 판정 기준값은 설정 테이블에서 관리).
//
// docs/data-issues.md에 남긴 미해결 항목(연령×성별 원수요 계산의 정확한 성별분배 방식 등)은
// 이 파일 안에서도 해당 함수 바로 위에 동일한 경고 주석을 남겨둔다.
//
// 2026-08-20: 원본 Apps Script(점포평가.gs/repair.gs)를 확보해 아래 항목을 실제 코드로 교체했다
// (docs/data-issues.md 갱신 이력 참고).
//   - 사양/좌석/입지 점수: VGA 모델명·존구성·층수+엘리베이터 자동계산 (scoreFromVga/computeSpecScore/
//     computeSeatScore/computeLocationScoreFromFacts) — 종전엔 이 셋도 1~5 직접입력이었다.
//   - V61 정상운영모형의 진짜 알고리즘(비음수 릿지회귀)을 포팅했다(fitEmpiricalRevenueModel 등).
//     다만 학습에 쓸 기존 가맹점 특징 데이터가 아직 앱에 없어 evaluate.ts는 당분간 계속
//     computeV61Fallback(폴백 회귀식)을 쓴다 — 해당 함수 바로 위 주석 참고.

import type {
  Competitor,
  CandidateInput,
  CompetitorInvestigationStatus,
  ExistingStore,
  GroundLevel,
  InflowRestriction,
  ModelSettings,
  CompletionStatus,
  FinalJudgement,
} from "./types";

// ---------------------------------------------------------------------------
// 3.1 상권분석
// ---------------------------------------------------------------------------

// 08_계산기준 프로즈("10대 남39%·여13% / ... / 60대이상 남1%·여0%")는 반올림된 요약이다.
// 실제 실행되는 값은 점포평가.gs CONFIG.MARKET.이용률(2026-08-22 원본 재대조로 확인)이며,
// 30대 여성·50대 남녀·60대이상 여성이 08_계산기준 반올림과 소수점 단위로 다르다 — 이 값이
// 정확한 원본이다.
export const PC_USAGE_RATE_BY_AGE_GENDER = {
  age10s: { male: 0.39, female: 0.13 },
  age20s: { male: 0.42, female: 0.15 },
  age30s: { male: 0.17, female: 0.045 },
  age40s: { male: 0.1, female: 0.02 },
  age50s: { male: 0.035, female: 0.008 },
  age60plus: { male: 0.01, female: 0.003 },
} as const;

export type AgeBandPopulation = {
  age10s: number;
  age20s: number;
  age30s: number;
  age40s: number;
  age50s: number;
  age60plus: number;
};

/**
 * 유동/주거 원수요 공통 계산 (점포평가.gs analyzeMarket_/residentDemand_ 이식).
 * 원본도 성별 비율 하나(연령×성별 교차표 없이)를 모든 연령대에 동일하게 적용한다 —
 * 근사가 아니라 원본 그대로의 계산 방식이다.
 */
export function estimateRawDemand(ages: AgeBandPopulation, maleRatio: number): number {
  const femaleRatio = 1 - maleRatio;
  const bands: (keyof AgeBandPopulation)[] = ["age10s", "age20s", "age30s", "age40s", "age50s", "age60plus"];
  let total = 0;
  for (const band of bands) {
    const pop = ages[band] ?? 0;
    const rate = PC_USAGE_RATE_BY_AGE_GENDER[band];
    total += pop * maleRatio * rate.male + pop * femaleRatio * rate.female;
  }
  return total;
}

export function floatingAgeSum(c: Pick<CandidateInput, "floating500_10s" | "floating500_20s" | "floating500_30s" | "floating500_40s" | "floating500_50s" | "floating500_60plus">): number {
  return (
    (c.floating500_10s ?? 0) +
    (c.floating500_20s ?? 0) +
    (c.floating500_30s ?? 0) +
    (c.floating500_40s ?? 0) +
    (c.floating500_50s ?? 0) +
    (c.floating500_60plus ?? 0)
  );
}

/**
 * 08_계산기준 R4 "연령별 합계가 유동인구의 80% 이상이면 실측 연령구성, 아니면 40개 상권
 * 평균 연령구성을 사용"의 그 40개 상권 평균값(CONFIG.MARKET.기본연령구성/기본남성비율)을
 * 점포평가.gs에서 확보했다(data-issues.md #5 해결). 남성비율도 같은 방식(남성인구÷유동인구,
 * 없으면 기본값)으로 대체한다.
 */
export const DEFAULT_FLOATING_AGE_COMPOSITION: AgeBandPopulation = {
  age10s: 0.07,
  age20s: 0.09,
  age30s: 0.14,
  age40s: 0.2,
  age50s: 0.23,
  age60plus: 0.27,
};
export const DEFAULT_FLOATING_MALE_RATIO = 0.55;

export function computeFloatingRawDemand(c: CandidateInput): number | null {
  const flow = c.floating500Avg;
  if (flow == null || flow <= 0) return null;
  const ageSum = floatingAgeSum(c);
  const useReal = ageSum > flow * 0.8;
  const maleRatio = c.floating500Male != null && c.floating500Male > 0 ? c.floating500Male / flow : DEFAULT_FLOATING_MALE_RATIO;
  const ages: AgeBandPopulation = useReal
    ? {
        age10s: c.floating500_10s ?? 0,
        age20s: c.floating500_20s ?? 0,
        age30s: c.floating500_30s ?? 0,
        age40s: c.floating500_40s ?? 0,
        age50s: c.floating500_50s ?? 0,
        age60plus: c.floating500_60plus ?? 0,
      }
    : {
        age10s: flow * DEFAULT_FLOATING_AGE_COMPOSITION.age10s,
        age20s: flow * DEFAULT_FLOATING_AGE_COMPOSITION.age20s,
        age30s: flow * DEFAULT_FLOATING_AGE_COMPOSITION.age30s,
        age40s: flow * DEFAULT_FLOATING_AGE_COMPOSITION.age40s,
        age50s: flow * DEFAULT_FLOATING_AGE_COMPOSITION.age50s,
        age60plus: flow * DEFAULT_FLOATING_AGE_COMPOSITION.age60plus,
      };
  return estimateRawDemand(ages, maleRatio);
}

/** 08_계산기준: "연령별 입력 합계가 총인구의 50% 이상일 때만 계산". */
export function computeResidentRawDemand(c: CandidateInput): number | null {
  if (c.pop1km == null || c.pop1km <= 0 || c.male1kmRatio == null) return null;
  const ageSum =
    (c.age1km_0_9 ?? 0) +
    (c.age1km_10_19 ?? 0) +
    (c.age1km_20_29 ?? 0) +
    (c.age1km_30_39 ?? 0) +
    (c.age1km_40_49 ?? 0) +
    (c.age1km_50_59 ?? 0) +
    (c.age1km_60_69 ?? 0) +
    (c.age1km_70_79 ?? 0) +
    (c.age1km_80plus ?? 0);
  if (ageSum < c.pop1km * 0.5) return null;
  // 1km 연령구간은 10년 단위 9구간이라 07 입력표의 10대/20대.. 6구간과 다르다.
  // PC_USAGE_RATE_BY_AGE_GENDER 6구간에 맞춰 합산한다: 10~19→10대, 20~29→20대 ... 60+ = 60~69+70~79+80+.
  return estimateRawDemand(
    {
      age10s: c.age1km_10_19 ?? 0,
      age20s: c.age1km_20_29 ?? 0,
      age30s: c.age1km_30_39 ?? 0,
      age40s: c.age1km_40_49 ?? 0,
      age50s: c.age1km_50_59 ?? 0,
      age60plus: (c.age1km_60_69 ?? 0) + (c.age1km_70_79 ?? 0) + (c.age1km_80plus ?? 0),
    },
    c.male1kmRatio,
  );
}

export type MarketCharacter = "번화가" | "혼합" | "주거중심";

/** 08_계산기준: "유동500m ÷ 거주500m" — 8배 이상 번화가 / 4~8배 혼합 / 4배 미만 주거중심. */
export function computeMarketCharacter(
  floating500Avg: number | null,
  resident500Pop: number | null,
  settings: Pick<ModelSettings, "marketCharacterThreshold">,
): MarketCharacter | null {
  if (!floating500Avg || !resident500Pop || resident500Pop <= 0) return null;
  const ratio = floating500Avg / resident500Pop;
  if (ratio >= settings.marketCharacterThreshold.downtown) return "번화가";
  if (ratio >= settings.marketCharacterThreshold.mixed) return "혼합";
  return "주거중심";
}

export type MarketDemandResult = {
  marketCharacter: MarketCharacter | null;
  demandSource: "유동" | "주거" | null;
  rawDemand: number | null;
  marketDemand: number | null;
};

/** 08_계산기준: "선택된 원수요 × 상권성격별 유효율" (번화가/혼합→유동원수요, 주거중심→주거원수요). */
export function computeMarketDemand(c: CandidateInput, settings: Pick<ModelSettings, "marketCharacterThreshold" | "marketDemandEffectiveRate">): MarketDemandResult {
  const marketCharacter = computeMarketCharacter(c.floating500Avg, c.pop500m, settings);
  const floatingDemand = computeFloatingRawDemand(c);
  const residentDemand = computeResidentRawDemand(c);

  if (!marketCharacter) return { marketCharacter: null, demandSource: null, rawDemand: null, marketDemand: null };

  const useFloating = marketCharacter !== "주거중심";
  const demandSource: "유동" | "주거" = useFloating ? "유동" : "주거";
  const rawDemand = useFloating ? floatingDemand : residentDemand;

  // 08_계산기준/analyzeMarket_ 원본: 주거중심인데 반경1km 연령 실측이 50% 미달(residentDemand=null)
  // 이어도 포기하지 않고, 이미 있는 유동원수요 × 혼합유효율(0.61)로 상권수요를 낸다("유동 ×
  // 0.61 (주거 미입력)"). 추측으로 새 데이터를 지어내는 게 아니라 이미 실측된 다른 원수요를
  // 원본이 설계한 대체 계산에 쓰는 것이라 추측성 보정 금지 원칙과 배치되지 않는다.
  if (rawDemand == null) {
    if (marketCharacter === "주거중심" && floatingDemand != null) {
      const fallbackDemand = Math.round(floatingDemand * settings.marketDemandEffectiveRate.mixed);
      return { marketCharacter, demandSource: "유동", rawDemand: floatingDemand, marketDemand: fallbackDemand };
    }
    return { marketCharacter, demandSource, rawDemand: null, marketDemand: null };
  }

  const rate =
    marketCharacter === "번화가"
      ? settings.marketDemandEffectiveRate.downtown
      : marketCharacter === "혼합"
        ? settings.marketDemandEffectiveRate.mixed
        : settings.marketDemandEffectiveRate.residential;

  return { marketCharacter, demandSource, rawDemand, marketDemand: Math.round(rawDemand * rate) };
}

export type MarketGrade = "SS" | "S" | "A" | "B";

/**
 * 08_계산기준: "기존 가맹점 상권수요 분포의 백분위. SS 상위10% / S 상위30% / A 상위60% / B 상위100%".
 * 고정 금액 기준이 아니라 검증표본(existingMarketDemands) 분포에서 매번 다시 계산해야 한다.
 */
export function computeMarketGrade(
  marketDemand: number | null,
  existingMarketDemands: number[],
  settings: Pick<ModelSettings, "marketGradePercentile">,
): MarketGrade | null {
  if (marketDemand == null || existingMarketDemands.length === 0) return null;
  const sorted = [...existingMarketDemands].sort((a, b) => b - a); // 내림차순
  const rank = sorted.filter((v) => v >= marketDemand).length; // marketDemand보다 크거나 같은 표본 수
  const percentileFromTop = rank / sorted.length;
  if (percentileFromTop <= settings.marketGradePercentile.SS) return "SS";
  if (percentileFromTop <= settings.marketGradePercentile.S) return "S";
  if (percentileFromTop <= settings.marketGradePercentile.A) return "A";
  return "B";
}

// ---------------------------------------------------------------------------
// 3.2 경쟁
// ---------------------------------------------------------------------------

/** 08_계산기준: 경쟁점 실사값이 하나도 없으면 (실영업 업소수-1)×100대로 대체한다. */
export function computeCompetitorIp(competitors: Competitor[], operatingPcStores500m: number | null): number {
  // computeCompetitorAppliedPcCount가 조사수준·investigationStatus 기본값(간략_기본대수 70)까지
  // 반영하므로, "실사 있음"의 기준은 그 결과가 null이 아닌지로 판정한다(값 누락/경쟁점없음은 제외).
  const withCount = competitors
    .map((c) => computeCompetitorAppliedPcCount(c))
    .filter((n): n is number => n != null);
  if (withCount.length > 0) {
    return withCount.reduce((sum, n) => sum + n, 0);
  }
  if (operatingPcStores500m != null && operatingPcStores500m > 0) {
    return Math.max(0, operatingPcStores500m - 1) * 100;
  }
  return 0;
}

/** IP당수요 = 상권수요 ÷ (자사IP + 경쟁IP). 여유 >15 / 포화 <7 (08_계산기준). */
export function computeIpPerDemand(marketDemand: number | null, ownPcCount: number | null, competitorIp: number): number | null {
  if (marketDemand == null || !ownPcCount) return null;
  const totalIp = ownPcCount + competitorIp;
  if (totalIp <= 0) return null;
  return marketDemand / totalIp;
}

/**
 * 조사수준별 미입력 항목 기본값(간략_기본점수). 상세 조사가 아니면 아는 항목을 우선하고,
 * 미입력 항목만 이 기본값으로 채운다 — 그래야 층수만 아는 1층 매장이 5.00점이 되는 문제를 막는다.
 */
export const SURVEY_LEVEL_DEFAULT_SCORE: Record<"간략" | "외관만", number> = { 간략: 2.0, 외관만: 1.5 };

/**
 * applySurveyLevelDefault: 조사수준이 간략/외관만이면 미입력 항목을 기본값으로 채운다.
 * investigationStatus가 "노후저경쟁력미조사"이면 조사수준이 비어 있어도 "외관만"과 동일하게
 * 취급한다 — 노후·저경쟁력이라 상세조사를 생략했다는 업무 판단을 반영한다(요청사항 5).
 * "값 누락"(조사완료인데 값이 비어 있는 경우)은 이 함수에서 채우지 않고 그대로 null을 돌려준다
 * — 평균값·0점으로 단순 치환하지 않기 위함이다.
 */
export function applySurveyLevelDefault(
  score: number | null,
  surveyLevel: "상세" | "간략" | "외관만" | null,
  investigationStatus?: CompetitorInvestigationStatus,
): number | null {
  if (score != null) return score;
  if (surveyLevel === "간략" || surveyLevel === "외관만") return SURVEY_LEVEL_DEFAULT_SCORE[surveyLevel];
  if (surveyLevel == null && investigationStatus === "노후저경쟁력미조사") return SURVEY_LEVEL_DEFAULT_SCORE["외관만"];
  return null;
}

/**
 * 간략_기본대수: 조사수준이 간략/외관만이거나 investigationStatus가 "노후저경쟁력미조사"이면
 * 대수를 70대로 간주한다(경쟁점이 실제로 존재한다는 업무 판단은 보존하되, 실사 없이 지어낸
 * 값이라는 걸 잊지 않는다). "경쟁점없음"은 0(경쟁점 자체가 없음), 그 외 값 누락은 null(집계 제외).
 */
export function computeCompetitorAppliedPcCount(
  c: Pick<Competitor, "totalPcCount" | "appliedPcCount" | "surveyLevel"> & { investigationStatus?: CompetitorInvestigationStatus },
): number | null {
  if (c.investigationStatus === "경쟁점없음") return 0;
  if (c.appliedPcCount != null) return c.appliedPcCount;
  if (c.totalPcCount != null) return c.totalPcCount;
  if (c.surveyLevel === "간략" || c.surveyLevel === "외관만") return 70;
  if (c.investigationStatus === "노후저경쟁력미조사") return 70;
  return null;
}

// ---------------------------------------------------------------------------
// 3.3 자동 채점 — VGA 사양 / 존구성(좌석) / 층수+엘리베이터(입지)
// 원본 Apps Script(점포평가.gs)의 scoreFromVga_ / summarizeZones_ /
// scoreFromZoneComposition_ / scoreFromAccess_ / scoreFromSpecWithMonitor_를 그대로 옮긴 것이다.
// (기존에는 이 변환표를 확보하지 못해 사양/좌석/입지도 먹거리·인테리어처럼 1~5 직접입력으로
// 대체했었다 — 원본 코드 확보로 이 부분은 자동계산으로 되돌린다.)
// ---------------------------------------------------------------------------

/** scoreFromVga_: VGA 모델명 4자리 숫자의 천단위 → 5(50번대~)/시리즈값(20~40번대)/1(그 미만). */
export function scoreFromVga(text: string | null): number | null {
  if (!text) return null;
  const cleaned = text.toUpperCase().replace(/\s/g, "");
  const m = cleaned.match(/(\d{4})/);
  if (!m) return null;
  const series = Math.floor(Number(m[1]) / 1000);
  if (series >= 5) return 5;
  if (series >= 2) return series;
  return 1;
}

/** clampRating_: 1~5 범위로 보정. 범위 밖·비숫자는 null(가중합에서 제외). */
export function clampRating(v: number | null): number | null {
  if (v == null || Number.isNaN(v) || v <= 0) return null;
  return Math.min(5, Math.max(1, Math.round(v * 10) / 10));
}

/** scoreFromSpec_: VGA 기본·최고 평균 + 가산(상한 5). 기본/최고 중 하나만 있어도 계산한다. */
export function scoreFromVgaSpec(vgaBase: string | null, vgaTop: string | null, bonus: number): number | null {
  const b = scoreFromVga(vgaBase);
  const t = scoreFromVga(vgaTop);
  if (b == null && t == null) return null;
  const base = b == null ? (t as number) : t == null ? b : (b + t) / 2;
  return Math.round(Math.min(5, base + bonus) * 100) / 100;
}

/**
 * scoreFromSpecWithMonitor_: 사양점수 = VGA 70% + 모니터 30% (specWeights).
 * 모니터 미입력 시 VGA만으로 계산해 기존과 같게 동작한다(원본 그대로).
 * @param bonus 자사: 게임존수 × GAME_ZONE_BONUS(0.2) / 경쟁점: 프리미엄존 유(1) × 0.5, 무(0) × 0.5
 */
export function computeSpecScore(
  vgaBase: string | null,
  vgaTop: string | null,
  bonus: number,
  monitorScore: number | null,
  settings: Pick<ModelSettings, "specWeights">,
): number | null {
  const vga = scoreFromVgaSpec(vgaBase, vgaTop, bonus);
  const m = clampRating(monitorScore);
  if (vga == null) return m;
  if (m == null) return vga;
  const w = settings.specWeights;
  return Math.round((vga * w.vga + m * w.monitor) * 100) / 100;
}

/** 자사 게임존 사양 가산: 게임존 수 × GAME_ZONE_BONUS(0.2). */
export const GAME_ZONE_BONUS = 0.2;
/** 경쟁점 프리미엄존 사양 가산: 유(존재) 시 +0.5. */
export const PREMIUM_ZONE_BONUS = 0.5;

/**
 * summarizeZones_: 존 개수 집계.
 *   종류수 = 일반석(1) + 개수>0인 존 종류 수
 *   독립룸수 = 룸형 존(1인룸/2인룸/팀룸/커플존/VIP존, 프렌즈존 제외) 개수의 단순 합계
 * ⚠️ 종전 웹 구현은 팀룸×2+커플존×3+VIP존×5 라는 가중치를 임의로 지어냈었다(data-issues.md #7).
 * 원본 코드에는 그런 가중치가 없고 그냥 개수를 더한다 — 이 함수로 교체한다.
 * @param roomZoneCounts 룸형 존 개수 목록(1인룸/2인룸/팀룸/커플존/VIP존 — 자사는 전부, 경쟁점은 VIP존 제외)
 * @param openZoneCounts 파티션형 존 개수 목록(프렌즈존 — 종류수에는 포함, 독립룸수에서는 제외)
 */
export function computeZoneComposition(roomZoneCounts: (number | null)[], openZoneCounts: (number | null)[] = []): { kinds: number; rooms: number } {
  let kinds = 1; // 일반석
  let rooms = 0;
  for (const n of roomZoneCounts) {
    const v = n ?? 0;
    if (v > 0) {
      kinds++;
      rooms += v;
    }
  }
  for (const n of openZoneCounts) {
    if ((n ?? 0) > 0) kinds++;
  }
  return { kinds, rooms };
}

/** scoreFromDiversity_: 다양성 점수(종류수). 자사 표준 5종(일반석+팀룸+커플존+VIP존+프렌즈존) = 4점. */
export function scoreFromZoneDiversity(kinds: number): number {
  if (kinds >= 7) return 5;
  if (kinds >= 5) return 4;
  if (kinds >= 3) return 3;
  if (kinds >= 2) return 2;
  return 1;
}

/** scoreFromCapacity_: 수용력 점수(독립룸수). 자사 표준 10개(팀룸2+커플존3+VIP존5) = 4점. */
export function scoreFromZoneCapacity(rooms: number): number {
  if (rooms >= 15) return 5;
  if (rooms >= 8) return 4;
  if (rooms >= 4) return 3;
  if (rooms >= 2) return 2;
  return 1;
}

/** scoreFromZoneComposition_: 좌석점수 = 다양성 50% + 수용력 50%. */
export function computeSeatScore(kinds: number, rooms: number): number {
  return Math.round((scoreFromZoneDiversity(kinds) * 0.5 + scoreFromZoneCapacity(rooms) * 0.5) * 100) / 100;
}

/**
 * 07_신규후보지 헤더 셀 메모("비우면 표준 N개/표준값 적용") 근거 — 신규후보지는 아직 시설이
 * 갖춰지지 않은 경우가 많아, 자사 시설 입력값이 비어 있으면 평균적으로 들어가는 회사 표준
 * 구성으로 간주한다(2026-08-21, 사용자 확인). 1인룸/2인룸/VGA최고사양은 표준값이 없어(비우면
 * 그대로 0/공란) 대상이 아니다. 이미 실제 값이 입력돼 있으면 그 값을 그대로 쓴다.
 */
export const STANDARD_OWN_FACILITY_DEFAULTS = {
  gameZoneCount: 3,
  teamRoom: 2,
  coupleZone: 3,
  vipZone: 5,
  friendsZone: 15,
  foodScore: 4,
  interiorScore: 4,
  monitorScore: 4,
};

export type StandardOwnFacilityInput = {
  ownGameZoneCount: number | null;
  ownTeamRoom: number | null;
  ownCoupleZone: number | null;
  ownVipZone: number | null;
  ownFriendsZone: number | null;
  ownFoodScore: number | null;
  ownInteriorScore: number | null;
  ownMonitorScore: number | null;
};

export function applyStandardOwnFacilityDefaults(input: StandardOwnFacilityInput): {
  ownGameZoneCount: number;
  ownTeamRoom: number;
  ownCoupleZone: number;
  ownVipZone: number;
  ownFriendsZone: number;
  ownFoodScore: number;
  ownInteriorScore: number;
  ownMonitorScore: number;
} {
  const d = STANDARD_OWN_FACILITY_DEFAULTS;
  return {
    ownGameZoneCount: input.ownGameZoneCount ?? d.gameZoneCount,
    ownTeamRoom: input.ownTeamRoom ?? d.teamRoom,
    ownCoupleZone: input.ownCoupleZone ?? d.coupleZone,
    ownVipZone: input.ownVipZone ?? d.vipZone,
    ownFriendsZone: input.ownFriendsZone ?? d.friendsZone,
    ownFoodScore: input.ownFoodScore ?? d.foodScore,
    ownInteriorScore: input.ownInteriorScore ?? d.interiorScore,
    ownMonitorScore: input.ownMonitorScore ?? d.monitorScore,
  };
}

/**
 * scoreFromAccess_: 층수 + 엘리베이터 + 지상/지하 → 입지(진입편의) 점수.
 * 지하1~2층·1~2층 4 / 3층 3 / 4층 2 / 5층 1 / 6층이상 0, 엘리베이터 유 +1(상한 5).
 * 지하는 계단 하나라 2층과 동급으로 본다(전대후문점 지하1층이 40개 중 실적 1위 — 원본 근거).
 */
export function computeLocationScoreFromFacts(
  floor: number | null,
  groundLevel: "지상" | "지하" | null,
  hasElevator: boolean | null,
): number | null {
  if (floor == null) return null;
  const signedFloor = groundLevel === "지하" ? -Math.abs(floor) : Math.abs(floor);
  let base: number;
  if (signedFloor < 0) base = signedFloor >= -2 ? 4 : 3;
  else if (signedFloor <= 2) base = 4;
  else if (signedFloor === 3) base = 3;
  else if (signedFloor === 4) base = 2;
  else if (signedFloor === 5) base = 1;
  else base = 0;
  return Math.min(5, base + (hasElevator ? 1 : 0));
}

// ---------------------------------------------------------------------------
// 3.4 경쟁력 점수
// ---------------------------------------------------------------------------

/**
 * 종합 경쟁력점수 = 사양25% + 좌석30% + 먹거리20% + 인테리어15% + 입지10% (08_계산기준).
 * 사양·좌석·입지는 computeSpecScore/computeSeatScore/computeLocationScoreFromFacts로 자동
 * 계산한 값을 넣는다. 먹거리·인테리어는 원본에서도 평가자가 1~5점을 직접 입력하는 항목이다.
 */
export function computeCompetitivenessScore(
  scores: { spec: number | null; seat: number | null; food: number | null; interior: number | null; location: number | null },
  settings: Pick<ModelSettings, "competitivenessWeights">,
): number | null {
  const { spec, seat, food, interior, location } = scores;
  if (spec == null || seat == null || food == null || interior == null || location == null) return null;
  const w = settings.competitivenessWeights;
  return spec * w.spec + seat * w.seat + food * w.food + interior * w.interior + location * w.location;
}

/**
 * 경쟁점 한 곳의 경쟁력점수 5개 구성요소를 계산한다.
 * 사양/좌석/입지는 VGA·존구성(1인룸/2인룸/팀룸/커플존 — VIP존/프렌즈존은 경쟁점 조사 대상 제외)·
 * 층수+엘리베이터로 자동 계산하고, 조사수준이 간략/외관만이면 미입력 항목을 기본값(2.0/1.5)으로
 * 채운다(applySurveyLevelDefault). 먹거리/인테리어는 조사자 직접 입력을 그대로 쓴다.
 */
export function computeCompetitorScores(
  c: Competitor,
  settings: Pick<ModelSettings, "specWeights" | "competitivenessWeights">,
): { spec: number | null; seat: number | null; food: number | null; interior: number | null; location: number | null; total: number | null } {
  const { kinds, rooms } = computeZoneComposition([c.room1, c.room2, c.teamRoom, c.coupleZone]);
  const hasPremium = (c.premiumZone ?? 0) > 0;
  const spec = applySurveyLevelDefault(
    computeSpecScore(c.vgaBase, c.vgaTop, hasPremium ? PREMIUM_ZONE_BONUS : 0, c.monitorScore, settings),
    c.surveyLevel,
    c.investigationStatus,
  );
  const seat = applySurveyLevelDefault(computeSeatScore(kinds, rooms), c.surveyLevel, c.investigationStatus);
  const food = applySurveyLevelDefault(c.foodScore, c.surveyLevel, c.investigationStatus);
  const interior = applySurveyLevelDefault(c.interiorScore, c.surveyLevel, c.investigationStatus);
  const location = applySurveyLevelDefault(
    computeLocationScoreFromFacts(c.floor, c.groundLevel, c.hasElevator),
    c.surveyLevel,
    c.investigationStatus,
  );
  const total = computeCompetitivenessScore({ spec, seat, food, interior, location }, settings);
  return { spec, seat, food, interior, location, total };
}

/** 경쟁점_평균경쟁력 = 경쟁점들의 경쟁력점수를 적용대수로 가중평균. */
export function computeCompetitorAvgCompetitiveness(
  competitors: Competitor[],
  settings: Pick<ModelSettings, "specWeights" | "competitivenessWeights">,
): number | null {
  const scored = competitors
    .map((c) => ({
      score: computeCompetitorScores(c, settings).total,
      weight: computeCompetitorAppliedPcCount(c) ?? 0,
    }))
    .filter((x) => x.score != null && x.weight > 0);
  if (scored.length === 0) return null;
  const totalWeight = scored.reduce((s, x) => s + x.weight, 0);
  if (totalWeight <= 0) return null;
  const weightedSum = scored.reduce((s, x) => s + (x.score as number) * x.weight, 0);
  return weightedSum / totalWeight;
}

/** 경쟁력격차 = 자사 경쟁력점수 ÷ 경쟁점 평균 경쟁력점수. 경쟁점이 없으면 1.0(08_계산기준). */
export function computeCompetitivenessGap(ownScore: number | null, competitorAvgScore: number | null): number | null {
  if (ownScore == null) return null;
  if (competitorAvgScore == null || competitorAvgScore <= 0) return 1.0;
  return ownScore / competitorAvgScore;
}

// ---------------------------------------------------------------------------
// 09_입지동선평가!H열 (입지동선종합점수)
// ---------------------------------------------------------------------------

/** ROUND(상권내위치×0.3 + 주요동선×0.3 + 선점경쟁×0.25 + 접근가시성×0.15, 2). */
export function computeLocationCompositeScore(
  scores: { withinMarket: number | null; flow: number | null; preemption: number | null; visibility: number | null },
  settings: Pick<ModelSettings, "locationCompositeWeights">,
): number | null {
  const { withinMarket, flow, preemption, visibility } = scores;
  if (withinMarket == null || flow == null || preemption == null || visibility == null) return null;
  const w = settings.locationCompositeWeights;
  const value = withinMarket * w.withinMarket + flow * w.flow + preemption * w.preemption + visibility * w.visibility;
  return Math.round(value * 100) / 100;
}

/**
 * 예측_자사수요 = 상권수요 × 점유율, 점유율 = (자사IP×격차) ÷ (자사IP×격차+경쟁IP) — 경쟁점이
 * 없으면 100%. V61 실측 학습모형의 특징치(log(자사수요/PC))를 신규 후보지에도 동일하게 만들 때 쓴다
 * (기존 가맹점은 04_점포평가요약!예측_자사수요를 그대로 쓰고, 후보지는 이 함수로 새로 계산한다).
 */
export function computeExpectedOwnDemand(
  marketDemand: number | null,
  ownPcCount: number | null,
  competitivenessGap: number | null,
  competitorIp: number | null,
): number | null {
  if (marketDemand == null || !ownPcCount) return null;
  const gap = competitivenessGap ?? 1;
  const rivalIp = competitorIp ?? 0;
  const share = rivalIp > 0 ? (ownPcCount * gap) / (ownPcCount * gap + rivalIp) : 1;
  return Math.round(marketDemand * share);
}

// ---------------------------------------------------------------------------
// §4.1 13_신규후보지판정 G열 폴백 회귀식 (V61 기본예측)
// ---------------------------------------------------------------------------

/**
 * ⚠️ docs/data-issues.md #1(갱신): 진짜 V61은 "비음수 릿지회귀 60%+대당월매출 중앙값 40%"이고
 * 그 알고리즘은 fitEmpiricalRevenueModel/predictEmpiricalRevenue로 이미 포팅해 두었다. 다만
 * 학습에 쓸 기존 가맹점 특징 데이터(요금·예측자사수요/PC·경쟁력점수, 12개월 완료·정상영업
 * 표본만)가 아직 앱에 없어 그 함수들을 아직 연결할 수 없다. 이 computeV61Fallback은
 * 13_신규후보지판정!G열에 원본 설계자가 넣어둔 폴백 회귀식(model-spec.md §4.1, 26개 검증표본을
 * 4개 계수로 근사)이며, 위 학습 데이터가 갖춰질 때까지 임시로 계속 사용한다.
 */
export function computeV61Fallback(
  input: {
    expectedPcCount: number | null;
    hourlyRate: number | null;
    marketDemand: number | null;
    competitivenessGap: number | null;
    competitorIp: number | null;
    ownCompetitivenessScore: number | null;
  },
  settings: Pick<ModelSettings, "v61Fallback">,
): number | null {
  const { expectedPcCount: E, hourlyRate: F, marketDemand: N, competitivenessGap: S, competitorIp: Q, ownCompetitivenessScore: BM } = input;
  if (E == null || F == null || N == null || S == null || BM == null) return null;
  const competitorIp = Q ?? 0;
  const denominator = E * S + competitorIp;
  if (denominator === 0) return null;
  const demandPerPc = (N * S) / denominator;
  const { intercept, hourlyRateCoef, demandPerPcCoef, competitivenessCoef } = settings.v61Fallback;
  const linear = intercept + hourlyRateCoef * F + demandPerPcCoef * demandPerPc + competitivenessCoef * BM;
  return Math.round(E * Math.max(0, linear));
}

// ---------------------------------------------------------------------------
// V62 보정 + 85%/115% 범위
// ---------------------------------------------------------------------------

export function getV62Rate(inflowRestriction: InflowRestriction | null, settings: Pick<ModelSettings, "inflowAdjustment">): number | null {
  if (inflowRestriction == null) return null;
  return settings.inflowAdjustment[inflowRestriction];
}

/** 12_운영판정!G열: ROUND(V61 × (1+보정률), 0). */
export function computeV62Final(v61: number | null, v62Rate: number | null): number | null {
  if (v61 == null || v62Rate == null) return null;
  return Math.round(v61 * (1 + v62Rate));
}

export function computeBoundedSales(v62Final: number | null, settings: Pick<ModelSettings, "lowerBoundFactor" | "upperBoundFactor">) {
  if (v62Final == null) return { conservativeSales: null, upperSales: null };
  return {
    conservativeSales: Math.round(v62Final * settings.lowerBoundFactor),
    upperSales: Math.round(v62Final * settings.upperBoundFactor),
  };
}

// ---------------------------------------------------------------------------
// §6.1/§6.2 13_신규후보지판정 T열(입력완성도)/U열(최종운영판정) — 원문 그대로
// ---------------------------------------------------------------------------

export function computeCompletionStatus(input: {
  v61: number | null;
  locationScore: number | null;
  inflowRestriction: InflowRestriction | null;
  brandType: string | null;
  brandFilter: string;
}): CompletionStatus {
  if (input.v61 == null) return "07 분석 필요";
  if (input.locationScore == null) return "09 입지평가 필요";
  if (input.inflowRestriction == null) return "외부유입 확인 필요";
  if (input.brandType !== input.brandFilter) return "브랜드 확인 필요";
  return "완료";
}

export function computeFinalJudgement(input: {
  completionStatus: CompletionStatus;
  v62Final: number | null;
  ipPerDemand: number | null;
  inflowRestriction: InflowRestriction | null;
  saturationThreshold: number;
}): FinalJudgement {
  if (input.completionStatus !== "완료") return input.completionStatus;
  if (input.v62Final == null) return "V62 계산 확인 필요";
  if (input.ipPerDemand != null && input.ipPerDemand < input.saturationThreshold) return "포화 주의";
  if (input.inflowRestriction === "강함") return "입지 재검토";
  return "평가 완료";
}

// ---------------------------------------------------------------------------
// 6. 기존 가맹점 검증 (12_운영판정!A36:N200)
// ---------------------------------------------------------------------------

/**
 * 12_운영판정의 "실제매출"은 04_점포평가요약!13열(누적평균매출)과 정확히 일치한다
 * (실사례 검증: 수원인계점 66332128.18181818 == 66332128.18). 즉 매출DB에 쌓인 월별
 * (PC매출+상품매출) 전체를 단순 평균한 값이다 - 6~12개월 안정화 구간으로 따로 자르지 않는다.
 */
export function computeCumulativeAverageSales(
  monthlySales: { pcSales: number | null; productSales: number | null }[],
): number | null {
  const totals = monthlySales
    .map((m) => (m.pcSales ?? 0) + (m.productSales ?? 0))
    .filter((v) => v > 0);
  if (totals.length === 0) return null;
  return totals.reduce((a, b) => a + b, 0) / totals.length;
}

/**
 * 완료월 수 = 실제매출이 확정된(0보다 큰) 월별 레코드 개수. 진행 중인 이번 달은 아직 매출이
 * 없거나 0으로 들어오므로 자동으로 빠진다. classifyTenureCohort/isEligibleForV61Training의
 * completedMonths 입력이며, 신규 매출이 storeEvalExistingStoreSales에 쌓일 때마다 이 값과
 * computeCumulativeAverageSales를 다시 계산해 ExistingStore.completedMonths/
 * actualMonthlyRevenueAvg를 갱신한다(요청사항: 12개월 미만 매장 자동 반영).
 */
export function computeCompletedMonthsCount(monthlySales: { pcSales: number | null; productSales: number | null }[]): number {
  return monthlySales.filter((m) => (m.pcSales ?? 0) + (m.productSales ?? 0) > 0).length;
}

/** 점포평가.gs CONFIG: 오픈 1~12개월만 평가창(EVAL_MONTHS=12), 누적평균은 2개월차부터(CUMUL_FROM=2). */
export const EVAL_WINDOW_MONTHS = 12;
export const CUMULATIVE_AVERAGE_FROM_MONTH = 2;

/**
 * 원본 buildEvaluationSummary_의 "누적평균매출" 정의 그대로: 오픈 1~12개월(EVAL_MONTHS) 구간의
 * 매출만 평가 대상으로 삼고, 그중 2개월차부터 최신 완료월까지 평균한다(1개월차는 오픈 효과가
 * 커서 제외) — 단 2개월차 이후 데이터가 아직 없으면 1개월차라도 쓴다. 매출DB는 매달 계속
 * 쌓이므로(오픈 후 수년이 지난 매장도 있음), 이 창을 씌우지 않으면 "누적평균매출"이 평생
 * 평균이 되어 신규 후보지 예측과 비교할 수 없는 값이 된다 — 반드시 이 함수를 거쳐야 한다.
 */
export function computeStabilizedPerformance(
  monthlySales: { elapsedMonths: number; pcSales: number | null; productSales: number | null }[],
): { completedMonths: number; actualMonthlyRevenueAvg: number | null } {
  const inWindow = monthlySales.filter((m) => m.elapsedMonths >= 1 && m.elapsedMonths <= EVAL_WINDOW_MONTHS);
  const completedMonths = computeCompletedMonthsCount(inWindow);

  const fromMonth2 = inWindow.filter((m) => m.elapsedMonths >= CUMULATIVE_AVERAGE_FROM_MONTH);
  let avg = computeCumulativeAverageSales(fromMonth2);
  if (avg == null) avg = computeCumulativeAverageSales(inWindow); // 2개월차 데이터가 아직 없으면 1개월차라도 쓴다
  return { completedMonths, actualMonthlyRevenueAvg: avg };
}

export type ValidationInputRow = {
  storeCode: string;
  storeName: string;
  actualSales: number;
  v61Predicted: number; // 04_점포평가요약 예측_월매출을 그대로 사용 (재계산 불가, data-issues #1)
  inflowRestriction: InflowRestriction | "미평가";
  brandType: string; // 09_입지동선평가!P열
};

export type ValidationComputedRow = ValidationInputRow & {
  v62Rate: number;
  v62Predicted: number;
  absoluteError: number;
  bias: number;
  storeJudgement: "양호" | "주의" | "재검토" | "입지평가 필요";
  lowerBound85: number;
  upperBound115: number;
  usedInSample: "사용" | "제외";
};

/** 12_운영판정 E~N열 로직을 그대로 적용 (model-spec.md §5). */
export function computeValidationRow(row: ValidationInputRow, settings: ModelSettings): ValidationComputedRow {
  const v62Rate = row.inflowRestriction === "미평가" ? 0 : settings.inflowAdjustment[row.inflowRestriction];
  const v62Predicted = Math.round(row.v61Predicted * (1 + v62Rate));
  const absoluteError = Math.abs(v62Predicted - row.actualSales) / row.actualSales;
  const bias = v62Predicted / row.actualSales - 1;
  const storeJudgement: ValidationComputedRow["storeJudgement"] =
    row.inflowRestriction === "미평가" ? "입지평가 필요" : absoluteError <= 0.1 ? "양호" : absoluteError <= 0.2 ? "주의" : "재검토";
  const usedInSample: "사용" | "제외" = row.brandType === settings.brandFilter ? "사용" : "제외";
  return {
    ...row,
    v62Rate,
    v62Predicted,
    absoluteError,
    bias,
    storeJudgement,
    lowerBound85: Math.round(v62Predicted * settings.lowerBoundFactor),
    upperBound115: Math.round(v62Predicted * settings.upperBoundFactor),
    usedInSample,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export type ValidationSummaryResult = {
  sampleCount: number;
  meanAbsoluteError: number;
  medianAbsoluteError: number;
  within10PctRatio: number;
  within20PctRatio: number;
  maxError: number;
  meanBias: number;
  passed: {
    sampleCount: boolean;
    strongInflowSampleCount: boolean;
    meanAbsoluteError: boolean;
    medianAbsoluteError: boolean;
    within20PctRatio: boolean;
    meanBias: boolean;
  };
  strongInflowSampleCount: number;
  overallStatus: "정식 적용 가능" | "조건부 사용" | "재보정 필요";
};

/** model-spec.md §5 F4/E24 로직. 스냅샷 문자열을 하드코딩하지 않고 매번 재계산한다. */
export function summarizeValidation(rows: ValidationComputedRow[], settings: ModelSettings): ValidationSummaryResult {
  const used = rows.filter((r) => r.usedInSample === "사용");
  const n = used.length;
  const errors = used.map((r) => r.absoluteError);
  const meanAbsoluteError = n ? errors.reduce((a, b) => a + b, 0) / n : 0;
  const medianAbsoluteError = n ? median(errors) : 0;
  const within10PctRatio = n ? errors.filter((e) => e <= 0.1).length / n : 0;
  const within20PctRatio = n ? errors.filter((e) => e <= 0.2).length / n : 0;
  const maxError = n ? Math.max(...errors) : 0;
  const meanBias = n ? used.reduce((a, r) => a + r.bias, 0) / n : 0;
  const strongInflowSampleCount = used.filter((r) => r.inflowRestriction === "강함").length;

  const passed = {
    sampleCount: n >= settings.minTotalSample,
    strongInflowSampleCount: strongInflowSampleCount >= settings.minStrongInflowSample,
    meanAbsoluteError: meanAbsoluteError <= settings.targetMAE,
    medianAbsoluteError: medianAbsoluteError <= settings.targetMedianAE,
    within20PctRatio: within20PctRatio >= settings.target20pctRatio,
    meanBias: Math.abs(meanBias) <= settings.maxAvgBias,
  };

  const performancePassed =
    passed.meanAbsoluteError && passed.medianAbsoluteError && passed.within20PctRatio && passed.meanBias;
  const overallStatus: ValidationSummaryResult["overallStatus"] =
    performancePassed && passed.sampleCount && passed.strongInflowSampleCount
      ? "정식 적용 가능"
      : performancePassed
        ? "조건부 사용"
        : "재보정 필요";

  return {
    sampleCount: n,
    meanAbsoluteError,
    medianAbsoluteError,
    within10PctRatio,
    within20PctRatio,
    maxError,
    meanBias,
    passed,
    strongInflowSampleCount,
    overallStatus,
  };
}

// ---------------------------------------------------------------------------
// V61 정상운영모형 — 비음수 릿지회귀 (점포평가.gs fitNonnegativeRidge_/
// fitEmpiricalRevenueModel_/predictEmpiricalRevenue_ 이식)
//
// ⚠️ 알고리즘 자체는 원본 Apps Script를 확보해 정확히 포팅했지만(이 파일의 함수들),
// 학습에 필요한 기존 가맹점 특징 데이터(자사_요금표_시간당·예측_자사수요/PC·자사_경쟁력점수를
// 12개월 완료·정상영업·산식학습제외 아닌 표본마다 계산해 둔 값)는 아직 앱에 없다
// (README.md §4 — 기존 가맹점 매출DB 연동조차 자동화되지 않은 상태). 따라서 evaluate.ts는
// 이 함수들을 아직 연결하지 않고 computeV61Fallback(폴백 회귀식)을 계속 쓴다. 기존 가맹점의
// 위 세 특징치를 모을 수 있게 되면 evaluate.ts에서 fitEmpiricalRevenueModel/predictEmpiricalRevenue로
// 교체해야 한다.
// ---------------------------------------------------------------------------

/**
 * 학습 표본 하나. featuresRaw = [log(시간당요금), log(자사수요/PC), 자사_경쟁력점수,
 * 특수수요점수(0~3)]. 4번째 피처는 2026-08-20에 추가했다 — 10_오차원인분석에서 대학가·
 * 군부대·산업단지 상권이 계통적으로 과소예측되는 패턴이 확인돼, 그 강도를 학습에 반영한다.
 */
export type EmpiricalRevenueSample = {
  featuresRaw: number[];
  revenuePerPc: number; // 대당 월매출 (원)
};

export type EmpiricalRevenueModel = {
  sampleCount: number;
  featureMeans: number[];
  featureSds: number[];
  yMean: number; // log(대당월매출) 평균
  coefficients: number[]; // 표준화 좌표계의 비음수 계수
  perPcMedian: number; // 대당월매출 중앙값 (기준모형)
};

function meanOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * fitNonnegativeRidge_: 좌표하강법 비음수 릿지회귀.
 * 표본이 작을 때 상식과 반대 방향(계수 음수)의 계수가 생기지 않도록 0 이상으로 제한한다.
 */
export function fitNonnegativeRidgeRegression(z: number[][], yCentered: number[], lambda: number): number[] | null {
  if (!z.length || !z[0].length) return null;
  const p = z[0].length;
  const beta = new Array(p).fill(0);

  for (let iter = 0; iter < 1000; iter++) {
    let maxDelta = 0;
    for (let j = 0; j < p; j++) {
      let numerator = 0;
      let denominator = lambda;
      for (let i = 0; i < z.length; i++) {
        let residual = yCentered[i];
        for (let k = 0; k < p; k++) {
          if (k !== j) residual -= z[i][k] * beta[k];
        }
        numerator += z[i][j] * residual;
        denominator += z[i][j] * z[i][j];
      }
      const next = Math.max(0, denominator > 0 ? numerator / denominator : 0);
      maxDelta = Math.max(maxDelta, Math.abs(next - beta[j]));
      beta[j] = next;
    }
    if (maxDelta < 1e-8) break;
  }
  return beta;
}

/** fitEmpiricalRevenueModel_: 표준화 후 비음수 릿지회귀로 학습. 최소 학습표본 미달이면 null. */
export function fitEmpiricalRevenueModel(samples: EmpiricalRevenueSample[], lambda: number, minSamples: number): EmpiricalRevenueModel | null {
  if (samples.length < minSamples) return null;
  const p = samples[0].featuresRaw.length;
  const n = samples.length;

  const featureMeans: number[] = [];
  const featureSds: number[] = [];
  for (let j = 0; j < p; j++) {
    const col = samples.map((s) => s.featuresRaw[j]);
    const mean = meanOf(col);
    const sd = Math.sqrt(col.reduce((s, v) => s + (v - mean) ** 2, 0) / n) || 1;
    featureMeans.push(mean);
    featureSds.push(sd);
  }

  const y = samples.map((s) => Math.log(s.revenuePerPc));
  const yMean = meanOf(y);
  const z = samples.map((s) => s.featuresRaw.map((v, j) => (v - featureMeans[j]) / featureSds[j]));
  const coefficients = fitNonnegativeRidgeRegression(
    z,
    y.map((v) => v - yMean),
    lambda,
  );
  if (!coefficients) return null;

  return {
    sampleCount: n,
    featureMeans,
    featureSds,
    yMean,
    coefficients,
    perPcMedian: medianOf(samples.map((s) => s.revenuePerPc)),
  };
}

/**
 * predictEmpiricalRevenue_: 최종예측 = 릿지회귀 60% + 대당월매출 중앙값 40%
 * (VALIDATION.회귀가중치/기준모형가중치 — settings.v61Fallback과는 별개의 계수 테이블이 필요하다).
 */
export function predictEmpiricalRevenue(
  model: EmpiricalRevenueModel,
  featuresRaw: number[],
  pcCount: number,
  ridgeWeight: number,
  baselineWeight: number,
): {
  monthlyRevenue: number;
  dailyRevenuePerPc: number;
  // 2026-08-25 추가 — 화면(ResultTab "적용된 산식과 계수 보기")에서 이 예측이 어떻게 나왔는지
  // 사람이 실제 숫자를 따라가며 이해할 수 있게, 이미 계산하는 중간값을 그대로 노출한다(새 계산
  // 아님). model.featureMeans/featureSds/coefficients/yMean/perPcMedian은 호출부(evaluate.ts)가
  // model 인자를 그대로 갖고 있어 여기서 다시 안 돌려준다 - 중복 방지.
  explain: { z: number[]; logPerPc: number; ridgeRevenue: number; baselineRevenue: number };
} | null {
  if (!pcCount) return null;
  const z = featuresRaw.map((v, j) => (v - model.featureMeans[j]) / model.featureSds[j]);
  const logPerPc = model.yMean + z.reduce((s, v, j) => s + v * model.coefficients[j], 0);
  const ridgeRevenue = Math.exp(logPerPc) * pcCount;
  const baselineRevenue = model.perPcMedian * pcCount;
  const monthlyRevenue = ridgeRevenue * ridgeWeight + baselineRevenue * baselineWeight;
  return {
    monthlyRevenue: Math.round(monthlyRevenue),
    dailyRevenuePerPc: Math.round(monthlyRevenue / pcCount / 30),
    explain: { z, logPerPc, ridgeRevenue, baselineRevenue },
  };
}

// ---------------------------------------------------------------------------
// V61 실측 학습모형 — 기존 가맹점 데이터를 학습표본으로 조립하고, 리브-원-아웃으로 검증한다.
// 2026-08-20: 이 섹션이 추가되면서 evaluate.ts는 더 이상 무조건 computeV61Fallback을 쓰지
// 않는다 — 학습표본이 v61Training.minSampleCount 이상이면 이 모형이 우선한다.
// ---------------------------------------------------------------------------

/**
 * 특수수요 점수(0~3) — 10_오차원인분석 실사례 근거로 추가한 V61 4번째 학습 피처.
 *   구미산동(특수수요 없음, 상권규모 과대 63.5%) · 남악(기타/보통, 경쟁가정 과대 23.4%)처럼
 *   특수수요가 없거나 "기타"인 상권의 오차는 다른 원인(상권규모·경쟁가정)이라 이 피처와 무관하다.
 *   반면 금촌역(군부대/높음) · 전대후문·울산대(대학가/높음) · 탕정역·시흥정왕(산업단지) 같은
 *   대학가·군부대·산업단지 상권은 전부 "과소예측"으로 몰려 있다 — 일반 산식이 못 잡는 추가
 *   수요가 있다는 뜻이라 이 세 유형만 강도를 점수화한다("관광유흥"/"기타"는 이런 계통적 패턴이
 *   관측되지 않아 0으로 둔다 — 근거 없이 넣지 않는다).
 * 비음수 릿지회귀라 이 피처의 계수는 항상 0 이상으로만 나온다(음수로 뒤집혀 방향이 반대가 될
 * 수 없다) — 과소예측을 보정하는 방향과 정확히 일치한다.
 */
const SPECIAL_DEMAND_TYPES_WITH_EVIDENCE = new Set(["대학가", "군부대", "산업단지"]);
const SPECIAL_DEMAND_INTENSITY_SCORE: Record<string, number> = { 없음: 0, 낮음: 1, 보통: 2, 높음: 3 };

export function computeSpecialDemandScore(
  type: string | null | undefined,
  intensity: string | null | undefined,
): number {
  if (!type || !SPECIAL_DEMAND_TYPES_WITH_EVIDENCE.has(type)) return 0;
  return SPECIAL_DEMAND_INTENSITY_SCORE[intensity ?? "없음"] ?? 0;
}

/** V61 학습 대상 판정: 블랙라벨 + 정상영업 + 산식학습제외 아님 + 학습 특징치 4종 모두 존재. */
export function isEligibleForV61Training(store: {
  brandType: string | null;
  franchiseStatus: string | null;
  excludedFromModel: boolean;
  pcCount: number | null;
  evaluationPcCount?: number | null;
  hourlyRate: number | null;
  ownDemand: number | null;
  competitivenessScore: number | null;
  actualMonthlyRevenueAvg: number | null;
}): boolean {
  if (store.brandType !== "블랙라벨") return false;
  if (store.excludedFromModel) return false;
  if (store.franchiseStatus !== "정상") return false;
  // 학습에 실제로 쓰이는 값은 evaluationPcCount ?? pcCount (buildV61TrainingStores와 동일 규칙) —
  // evaluationPcCount가 0으로 들어오면 대당매출이 Infinity가 되어 회귀 전체를 오염시키므로
  // 반드시 이 "해석된" 값으로 양수 검사를 해야 한다(2026-08-24 확인).
  const resolvedPcCount = store.evaluationPcCount ?? store.pcCount;
  if (!resolvedPcCount || resolvedPcCount <= 0) return false;
  if (store.hourlyRate == null || store.hourlyRate <= 0) return false;
  if (store.ownDemand == null || store.ownDemand <= 0) return false;
  if (store.competitivenessScore == null) return false;
  if (store.actualMonthlyRevenueAvg == null || store.actualMonthlyRevenueAvg <= 0) return false;
  return true;
}

/** ExistingStore 목록에서 V61 학습에 실제로 쓸 수 있는 표본만 골라 학습 입력 형태로 만든다. */
export function buildV61TrainingStores(stores: ExistingStore[]): V61TrainingStore[] {
  return stores.filter(isEligibleForV61Training).map((s) => ({
    storeCode: s.storeCode,
    storeName: s.storeName,
    // 오픈 후 좌석을 늘린 매장은 evaluationPcCount(오픈 초기 대수)로 대당매출을 계산해야
    // 한다 - 현재 pcCount로 나누면 실제보다 낮게 왜곡된다(2026-08-22 확인).
    pcCount: (s.evaluationPcCount ?? s.pcCount) as number,
    hourlyRate: s.hourlyRate as number,
    ownDemand: s.ownDemand as number,
    competitivenessScore: s.competitivenessScore as number,
    actualMonthlyRevenueAvg: s.actualMonthlyRevenueAvg as number,
    specialDemandScore: computeSpecialDemandScore(s.specialDemandType, s.specialDemandIntensity),
  }));
}

export type V61TrainingStore = {
  storeCode: string;
  storeName: string;
  pcCount: number;
  hourlyRate: number;
  ownDemand: number; // 예측_자사수요 (총량, PC당이 아님 — 아래에서 pcCount로 나눈다)
  competitivenessScore: number;
  actualMonthlyRevenueAvg: number;
  specialDemandScore: number; // 0~3, computeSpecialDemandScore
};

/**
 * ⚠️ 2026-08-20 실험 결과: 특수수요점수를 4번째 피처로 넣어 34개 표본으로 리브-원-아웃
 * 재검증했더니 개선이 아니라 오히려 소폭 악화했다(평균절대오차 13.85%→13.74%로 거의 그대로,
 * 중앙값 9.89%→10.12%·±10% 52.9%→50.0%·±20% 79.4%→76.5%는 나빠짐). 대학가·군부대·산업단지
 * 상권 중 일부(전대후문·울산대·금촌역·탕정역·시흥정왕)는 개선됐지만 다른 일부(전대상대·청주대·
 * 부경대)는 오히려 더 나빠져 방향이 일관되지 않았다 — 표본 34개에 피처 4개는 과적합 위험이
 * 커서 라벨 하나로 뭉뚱그린 강도 점수보다 더 정교한 신호(예: 통학 시즌성, 실제 배후 학생 수)가
 * 필요해 보인다. 그래서 기본 학습 피처는 3개로 되돌렸다 — computeSpecialDemandScore/
 * V61TrainingStore.specialDemandScore는 진단·향후 재실험용으로 남겨두되 모형에는 안 쓴다.
 */
export function toEmpiricalSample(store: V61TrainingStore): EmpiricalRevenueSample {
  return {
    featuresRaw: [
      Math.log(Math.max(1, store.hourlyRate)),
      Math.log(Math.max(0.1, store.ownDemand / store.pcCount)),
      store.competitivenessScore,
    ],
    revenuePerPc: store.actualMonthlyRevenueAvg / store.pcCount,
  };
}

/** 특정 매장의 학습 특징치를 모형 입력 형태로 변환 (예측 시에도 동일 특징을 써야 한다). */
export function empiricalFeaturesFor(input: {
  hourlyRate: number;
  ownDemand: number;
  pcCount: number;
  competitivenessScore: number;
  specialDemandScore?: number;
}): number[] {
  return [
    Math.log(Math.max(1, input.hourlyRate)),
    Math.log(Math.max(0.1, input.ownDemand / input.pcCount)),
    input.competitivenessScore,
  ];
}

export type LeaveOneOutRow = {
  storeCode: string;
  storeName: string;
  actualRevenue: number;
  predictedRevenue: number | null;
  errorAmount: number | null; // 예측 - 실제
  absoluteErrorPct: number | null;
};

export type LeaveOneOutResult = {
  rows: LeaveOneOutRow[];
  sampleCount: number;
  meanAbsoluteErrorPct: number | null;
  medianAbsoluteErrorPct: number | null;
  within10PctRatio: number | null;
  within20PctRatio: number | null;
};

/**
 * 리브-원-아웃 교차검증: 표본이 작을 때(≈26곳) 학습·검증을 분리하는 대신, 매장마다 "자기
 * 자신을 뺀 나머지"로 학습한 모형으로 자신을 예측한다 — 원본 V61("기존점은 자기 점포를
 * 학습에서 제외")과 동일한 방식이다. 표본이 minSampleCount 미만이면 전부 예측 불가로 남긴다.
 */
export function runLeaveOneOutValidation(
  stores: V61TrainingStore[],
  lambda: number,
  ridgeWeight: number,
  baselineWeight: number,
  minSampleCount: number,
): LeaveOneOutResult {
  const rows: LeaveOneOutRow[] = stores.map((store) => {
    const trainSamples = stores.filter((s) => s.storeCode !== store.storeCode).map(toEmpiricalSample);
    const model = fitEmpiricalRevenueModel(trainSamples, lambda, minSampleCount);
    const prediction = model
      ? predictEmpiricalRevenue(model, empiricalFeaturesFor(store), store.pcCount, ridgeWeight, baselineWeight)
      : null;
    const predictedRevenue = prediction?.monthlyRevenue ?? null;
    const errorAmount = predictedRevenue != null ? predictedRevenue - store.actualMonthlyRevenueAvg : null;
    const absoluteErrorPct =
      predictedRevenue != null ? Math.abs(predictedRevenue - store.actualMonthlyRevenueAvg) / store.actualMonthlyRevenueAvg : null;
    return {
      storeCode: store.storeCode,
      storeName: store.storeName,
      actualRevenue: store.actualMonthlyRevenueAvg,
      predictedRevenue,
      errorAmount,
      absoluteErrorPct,
    };
  });

  const errors = rows.map((r) => r.absoluteErrorPct).filter((e): e is number => e != null);
  const n = errors.length;
  return {
    rows,
    sampleCount: n,
    meanAbsoluteErrorPct: n ? errors.reduce((a, b) => a + b, 0) / n : null,
    medianAbsoluteErrorPct: n ? median(errors) : null,
    within10PctRatio: n ? errors.filter((e) => e <= 0.1).length / n : null,
    within20PctRatio: n ? errors.filter((e) => e <= 0.2).length / n : null,
  };
}

// ---------------------------------------------------------------------------
// 실측기반 예상월매출 파이프라인 (13_신규후보지판정!V~AB열 그대로 이식)
// 경쟁점 실가동좌석 → 경쟁력격차 룩업(수요확보율/신규수요증가율) → 예상 평균가동좌석
// → 예상 가동률 → 예상 대당일매출 → 실측기반 예상월매출.
// V61(인구·이용률 기반)과는 독립적인 두 번째 예측 경로다 — 서로 대체하지 않고 나란히 보여준다.
// ---------------------------------------------------------------------------

/** normalizeRate_: 1보다 크면 %로 보고 100으로 나눈다 (원본 스프레드시트와 동일 관례). */
function normalizePercentLike(v: number): number {
  return v > 1 ? v / 100 : v;
}

export type CompetitorOccupiedSeatsResult = {
  seats: number | null;
  coverage: {
    measured: number;
    realtimeSnapshotOnly: number;
    assumedLowThreat: number;
    missingData: number;
    excludedNoCompetitor: number;
  };
};

/**
 * 경쟁점 실가동좌석 = Σ(적용대수 × 실측가동률). 실측가동률은 핑봇_가동률(기간 평균)만
 * 인정한다 — 실측착석률(현장 방문 시점의 실시간 가동률 한 컷)은 방문 시각에 따라 크게
 * 흔들려서 "평균 수요"로 환산할 근거가 못 된다(2026-08-21, 사용자 확인 — 신중동점 사례:
 * 경쟁점 3곳 모두 같은 날 같은 시각(16:30) 1회 방문 실측만 있고 핑봇 기간평균이 없어, 이
 * 실시간값을 그대로 평균가동률처럼 곱했더니 예상 가동좌석이 계획 PC대수를 초과했다). 어느
 * 쪽도 없으면 0을 더하되(원본 SUMPRODUCT와 동일), 왜 0인지는 coverage로 구분해 남긴다 —
 * "노후저경쟁력미조사"(업무 판단으로 조사 생략)·"실시간 실측뿐"(핑봇 없음, 참고용)·"값 누락"
 * (조사완료인데 비어 있음)을 같은 0으로 뭉개지 않는다(요청사항 5 + 2026-08-21 갱신).
 */
export function computeCompetitorOccupiedSeats(competitors: Competitor[]): CompetitorOccupiedSeatsResult {
  const coverage = { measured: 0, realtimeSnapshotOnly: 0, assumedLowThreat: 0, missingData: 0, excludedNoCompetitor: 0 };
  let seats = 0;
  let anyMeasured = false;

  for (const c of competitors) {
    if (c.investigationStatus === "경쟁점없음") {
      coverage.excludedNoCompetitor++;
      continue;
    }
    const appliedCount = computeCompetitorAppliedPcCount(c) ?? 0;
    if (c.pingbotUtilization != null) {
      anyMeasured = true;
      coverage.measured++;
      seats += appliedCount * normalizePercentLike(c.pingbotUtilization);
    } else if (c.measuredSeatRate != null) {
      // 핑봇 기간평균이 없고 방문 시점 실시간 착석률뿐이면 좌석수 합산에는 넣지 않는다 -
      // 참고 정보로만 coverage에 남긴다.
      coverage.realtimeSnapshotOnly++;
    } else if (c.investigationStatus === "노후저경쟁력미조사") {
      coverage.assumedLowThreat++;
      // 실측 없이 지어낸 가동률을 곱하지 않는다 - 원본 SUMPRODUCT도 미실측 행은 0으로 더한다.
    } else {
      coverage.missingData++;
    }
  }

  return { seats: anyMeasured ? Math.round(seats * 100) / 100 : null, coverage };
}

export type DemandCaptureLookupResult = { captureRate: number; growthRate: number };

/**
 * LOOKUP(경쟁력격차, gapLowerBound 오름차순, captureRate/growthRate) — 격차보다 작거나 같은
 * 하한값 중 가장 큰 구간을 적용한다(스프레드시트 LOOKUP과 동일 동작).
 */
export function lookupDemandCapture(
  gap: number | null,
  table: { gapLowerBound: number; captureRate: number; growthRate: number }[],
): DemandCaptureLookupResult | null {
  if (gap == null || table.length === 0) return null;
  const sorted = [...table].sort((a, b) => a.gapLowerBound - b.gapLowerBound);
  let picked = sorted[0];
  for (const row of sorted) {
    if (row.gapLowerBound <= gap) picked = row;
    else break;
  }
  return { captureRate: picked.captureRate, growthRate: picked.growthRate };
}

/** 예상 평균가동좌석 = 경쟁점 실가동좌석 × 예상수요확보율 × (1 + 신규수요증가율). */
export function computeExpectedOccupiedSeats(occupiedSeats: number | null, captureRate: number | null, growthRate: number | null): number | null {
  if (occupiedSeats == null || captureRate == null || growthRate == null) return null;
  return Math.round(occupiedSeats * captureRate * (1 + growthRate) * 100) / 100;
}

/** 예상 가동률 = 예상 평균가동좌석 ÷ 예상PC대수. 100%를 넘을 수 있다(수요가 설치 대수를 초과한다는 신호). */
export function computeExpectedUtilization(expectedOccupiedSeats: number | null, pcCount: number | null): number | null {
  if (expectedOccupiedSeats == null || !pcCount) return null;
  return Math.round((expectedOccupiedSeats / pcCount) * 10000) / 10000;
}

export type MeasuredForecastResult = { dailyRevenuePerPc: number; monthlyRevenue: number };

/**
 * 실측기반 예상월매출 = 예상평균가동좌석 × 24시간 × 30일 × 시간당요금 ÷ (1-상품비율).
 * 예상 평균가동좌석은 "동시에 점유된 좌석 수"이므로 24시간 내내 그 수만큼 돌아간다고 보고
 * 계산한다(원본 13_신규후보지판정!AA열 그대로).
 */
export function computeMeasuredForecast(
  expectedOccupiedSeats: number | null,
  hourlyRate: number | null,
  productRatio: number,
  pcCount: number | null,
): MeasuredForecastResult | null {
  if (expectedOccupiedSeats == null || hourlyRate == null || !pcCount) return null;
  const monthlyRevenue = Math.round((expectedOccupiedSeats * 24 * 30 * hourlyRate) / (1 - productRatio));
  return { monthlyRevenue, dailyRevenuePerPc: Math.round(monthlyRevenue / pcCount / 30) };
}

/**
 * 2026-08-27 추가 — computeMeasuredForecast의 역산. "예상매출액이 이미 있는데(V62), 그걸
 * 가동률로 환산하면 안 되냐"는 사용자 질문으로 추가했다. 기존 "예상 가동률"(computeExpectedUtilization)
 * 은 경쟁점 실가동좌석(핑봇 실측) 기반의 별개 경로라 V62와 다른 값이 나올 수 있어 헷갈렸는데,
 * 이 함수는 V62 최종예상월매출 자체를 같은 공식(매출=가동좌석×24×30×요금÷(1-상품비율))으로
 * 거꾸로 풀어 "이 매출이 나오려면 좌석이 몇 개나 돌아가야 하는가"를 구한다 — V62와 완전히
 * 정합적인 값이라 별도 경쟁점 데이터 품질에 영향받지 않는다.
 */
export function computeImpliedUtilizationFromRevenue(
  monthlyRevenue: number | null,
  hourlyRate: number | null,
  productRatio: number,
  pcCount: number | null,
): number | null {
  if (monthlyRevenue == null || !hourlyRate || !pcCount) return null;
  const impliedOccupiedSeats = (monthlyRevenue * (1 - productRatio)) / (24 * 30 * hourlyRate);
  return Math.round((impliedOccupiedSeats / pcCount) * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// 2026-08-21 — "실측기반 예상월매출" 백테스트. evaluate.ts가 후보지에 대해 하는 계산과 완전히
// 같은 조합을 기존 가맹점(ExistingStore)에 그대로 적용한다(새 산식 없음, evaluate.ts:64-158
// 참고).
//
// 처음엔 후보지와 달리 표준값 폴백(applyStandardOwnFacilityDefaults)을 안 쓰기로 했었으나,
// 실데이터로 돌려보니 기존 가맹점 26곳 전부 ownFoodScore/ownInteriorScore/ownMonitorScore가
// 하나도 없어서(0/26) 표본이 0곳이 됐다 — 존종류/VGA는 26곳 전부 실측값이 있는데, 이 3개
// "평가자 직접입력 1~5점" 항목만 애초에 기존 가맹점 마이그레이션 대상이 아니었던 것으로
// 보인다. 이 3개는 원본 시트 자체가 "공백이면 표준값 4(우리 매장이 척도 기준점)"로 정의해둔
// 항목이라(신규후보지와 동일 규칙, 물리적 시설 여부를 추측하는 게 아니라 "특별히 낫지도
// 못하지도 않다"는 평가 기준일 뿐) 후보지와 같은 폴백을 그대로 적용한다. 존종류/VGA는
// 실측값이 없으면(위 26곳은 전부 있었지만, 다른 매장은 없을 수 있음) 여전히 표본에서
// 제외한다 — 그건 "몇 개 지었는지" 같은 물리적 사실이라 추측하지 않는다.
// ---------------------------------------------------------------------------
export type ExistingStoreMeasuredForecastResult = {
  storeCode: string;
  excludedReason: string | null; // null이면 표본에 포함됨
  ownCompetitivenessScore: number | null;
  competitorAvgCompetitiveness: number | null;
  competitivenessGap: number | null;
  competitorOccupiedSeats: number | null;
  competitorOccupiedSeatsCoverage: CompetitorOccupiedSeatsResult["coverage"] | null;
  // 조사된 경쟁점(핑봇 실측+실시간뿐+저경쟁력추정+값누락) 중 핑봇 실측이 있는 비율. 원본
  // measuredDemand_의 "커버율(조회된 경쟁점 IP÷전체 경쟁점 IP)"과 같은 개념 — 원본도 이 값으로
  // 표본을 거르지 않고 참고 신뢰도로만 썼다(2026-08-22, 점포평가.gs 재대조). 웹도 표본 포함
  // 여부를 이 값으로 가르지 않는다 — 낮아도 계산은 그대로 하고, 신뢰도 참고용으로만 노출한다.
  competitorCoverageRatio: number | null;
  isLowCoverageReliability: boolean;
  demandCaptureRate: number | null;
  newDemandGrowthRate: number | null;
  expectedOccupiedSeats: number | null;
  expectedUtilization: number | null;
  measuredForecastMonthlyRevenue: number | null;
};

/** 원본 CONFIG.MODEL.최소커버율(0.70) — 참고 신뢰도 임계값일 뿐 표본 제외 기준이 아니다. */
export const MEASURED_FORECAST_MIN_COVERAGE_RATIO = 0.7;

/** 조사된 경쟁점(핑봇 실측+실시간뿐+저경쟁력추정+값누락) 중 핑봇 실측 비율. 경쟁점없음은 분모에서 뺀다. */
export function computeCompetitorCoverageRatio(coverage: CompetitorOccupiedSeatsResult["coverage"]): number | null {
  const surveyed = coverage.measured + coverage.realtimeSnapshotOnly + coverage.assumedLowThreat + coverage.missingData;
  if (surveyed === 0) return null;
  return coverage.measured / surveyed;
}

export function computeExistingStoreMeasuredForecast(
  store: Pick<
    ExistingStore,
    | "storeCode"
    | "pcCount"
    | "floor"
    | "groundLevel"
    | "hasElevator"
    | "hourlyRate"
    | "ownVgaBase"
    | "ownVgaTop"
    | "ownGameZoneCount"
    | "ownRoom1"
    | "ownRoom2"
    | "ownTeamRoom"
    | "ownCoupleZone"
    | "ownVipZone"
    | "ownFriendsZone"
    | "ownFoodScore"
    | "ownInteriorScore"
    | "ownMonitorScore"
  >,
  competitors: Competitor[],
  settings: Pick<ModelSettings, "specWeights" | "competitivenessWeights" | "demandCaptureTable" | "measuredForecastProductRatio">,
): ExistingStoreMeasuredForecastResult {
  const base: ExistingStoreMeasuredForecastResult = {
    storeCode: store.storeCode,
    excludedReason: null,
    ownCompetitivenessScore: null,
    competitorAvgCompetitiveness: null,
    competitivenessGap: null,
    competitorOccupiedSeats: null,
    competitorOccupiedSeatsCoverage: null,
    competitorCoverageRatio: null,
    isLowCoverageReliability: false,
    demandCaptureRate: null,
    newDemandGrowthRate: null,
    expectedOccupiedSeats: null,
    expectedUtilization: null,
    measuredForecastMonthlyRevenue: null,
  };

  // 존종류/VGA는 물리적 시설 사실이라 없으면 추측하지 않고 제외한다. 먹거리/인테리어/모니터
  // 평가(1~5점, 평가자 직접입력 항목)는 원본 시트에도 "공백이면 표준값 4" 규칙이 있어 후보지와
  // 동일하게 applyStandardOwnFacilityDefaults로 채운다(아래에서 store.ownFoodScore 등 원본이
  // 아니라 facility.* 채워진 값을 쓴다).
  if (store.ownVgaBase == null || store.ownGameZoneCount == null || store.ownTeamRoom == null || store.ownCoupleZone == null || store.ownVipZone == null || store.ownFriendsZone == null) {
    return { ...base, excludedReason: "데이터 부족(자사 존구성/VGA 미완비)" };
  }
  if (competitors.length === 0) {
    return { ...base, excludedReason: "경쟁점 정보 없음" };
  }

  const facility = applyStandardOwnFacilityDefaults(store);
  const { kinds, rooms } = computeZoneComposition(
    [store.ownRoom1, store.ownRoom2, store.ownTeamRoom, store.ownCoupleZone, store.ownVipZone],
    [store.ownFriendsZone],
  );
  const ownSpecScore = computeSpecScore(store.ownVgaBase, store.ownVgaTop, facility.ownGameZoneCount * GAME_ZONE_BONUS, facility.ownMonitorScore, settings);
  const ownSeatScore = computeSeatScore(kinds, rooms);
  const ownLocationScore = computeLocationScoreFromFacts(store.floor, store.groundLevel, store.hasElevator);
  const ownCompetitivenessScore = computeCompetitivenessScore(
    { spec: ownSpecScore, seat: ownSeatScore, food: facility.ownFoodScore, interior: facility.ownInteriorScore, location: ownLocationScore },
    settings,
  );
  const competitorAvgCompetitiveness = computeCompetitorAvgCompetitiveness(competitors, settings);
  const competitivenessGap = computeCompetitivenessGap(ownCompetitivenessScore, competitorAvgCompetitiveness);

  const occupied = computeCompetitorOccupiedSeats(competitors);
  const coverageRatio = computeCompetitorCoverageRatio(occupied.coverage);
  if (occupied.seats == null) {
    return {
      ...base,
      ownCompetitivenessScore,
      competitorAvgCompetitiveness,
      competitivenessGap,
      competitorOccupiedSeatsCoverage: occupied.coverage,
      competitorCoverageRatio: coverageRatio,
      isLowCoverageReliability: coverageRatio != null && coverageRatio < MEASURED_FORECAST_MIN_COVERAGE_RATIO,
      excludedReason: "경쟁점 실측 데이터 부족(핑봇 실측 없음)",
    };
  }

  const capture = lookupDemandCapture(competitivenessGap, settings.demandCaptureTable);
  const expectedOccupiedSeats = computeExpectedOccupiedSeats(occupied.seats, capture?.captureRate ?? null, capture?.growthRate ?? null);
  const expectedUtilization = computeExpectedUtilization(expectedOccupiedSeats, store.pcCount);
  const forecast = computeMeasuredForecast(expectedOccupiedSeats, store.hourlyRate, settings.measuredForecastProductRatio, store.pcCount);

  return {
    storeCode: store.storeCode,
    excludedReason: null,
    ownCompetitivenessScore,
    competitorAvgCompetitiveness,
    competitivenessGap,
    competitorOccupiedSeats: occupied.seats,
    competitorOccupiedSeatsCoverage: occupied.coverage,
    competitorCoverageRatio: coverageRatio,
    isLowCoverageReliability: coverageRatio != null && coverageRatio < MEASURED_FORECAST_MIN_COVERAGE_RATIO,
    demandCaptureRate: capture?.captureRate ?? null,
    newDemandGrowthRate: capture?.growthRate ?? null,
    expectedOccupiedSeats,
    expectedUtilization,
    measuredForecastMonthlyRevenue: forecast?.monthlyRevenue ?? null,
  };
}

// ---------------------------------------------------------------------------
// AA 기준매출 — 예상 오픈월부터 10개월간 "순수익 2,000만원 대당 일매출목표" 평균 (08_계산기준!C54:E65)
// ---------------------------------------------------------------------------

/**
 * AA 기준매출 = MIN(예상PC대수, 100) × average(오픈월부터 연속 10개월의 (일매출목표×일수)).
 * 윤년은 처리하지 않는다(요청사항 4 그대로). 월은 1~12를 순환한다(12월 오픈이면 다음 해 1~9월까지 포함).
 */
export function computeAaBaselineRevenue(
  pcCount: number | null,
  plannedOpenMonth: number | null,
  monthlyTargets: { month: number; dailyRevenuePerPcTarget: number; daysInMonth: number }[],
  maxPcCount: number,
): number | null {
  if (!pcCount || !plannedOpenMonth || monthlyTargets.length !== 12) return null;
  const byMonth = new Map(monthlyTargets.map((t) => [t.month, t]));
  const appliedPc = Math.min(pcCount, maxPcCount);
  let total = 0;
  for (let k = 0; k < 10; k++) {
    const month = ((plannedOpenMonth - 1 + k) % 12) + 1;
    const target = byMonth.get(month);
    if (!target) return null;
    total += target.dailyRevenuePerPcTarget * target.daysInMonth;
  }
  return Math.round(appliedPc * (total / 10));
}

/**
 * 13_신규후보지판정!AC열 "자동평가"를 확장한 것 — 원본은 기준(2,000만원) 이상/미달 2단계뿐이었는데,
 * 2026-08-27 사용자 요청으로 1,000/1,500/2,000만원 3단계 기준매출과 비교해 어느 구간인지 판정한다
 * (실측기반 예상월매출을 그대로 3개 기준선과 비교하는 것뿐 - 산식 자체는 안 바뀜).
 */
export function judgeAaGrade(input: {
  plannedOpenMonth: number | null;
  measuredForecastRevenue: number | null;
  aaBaselineRevenue2000: number | null;
  aaBaselineRevenue1500: number | null;
  aaBaselineRevenue1000: number | null;
  expectedUtilization: number | null;
  maxReviewUtilization: number;
}): "오픈월 입력 필요" | "실측자료 부족" | "데이터 재검토" | "2,000만원 이상" | "1,500만원 이상" | "1,000만원 이상" | "1,000만원 미달" {
  if (input.plannedOpenMonth == null) return "오픈월 입력 필요";
  if (
    input.measuredForecastRevenue == null ||
    input.aaBaselineRevenue2000 == null ||
    input.aaBaselineRevenue1500 == null ||
    input.aaBaselineRevenue1000 == null
  ) {
    return "실측자료 부족";
  }
  if (input.expectedUtilization != null && input.expectedUtilization > input.maxReviewUtilization) return "데이터 재검토";
  const r = input.measuredForecastRevenue;
  if (r >= input.aaBaselineRevenue2000) return "2,000만원 이상";
  if (r >= input.aaBaselineRevenue1500) return "1,500만원 이상";
  if (r >= input.aaBaselineRevenue1000) return "1,000만원 이상";
  return "1,000만원 미달";
}

// ---------------------------------------------------------------------------
// 검증 확장 — 12개월 미완료 매장까지 포함한 다중 재직기간 코호트 검증.
// ⚠️ 이 섹션에는 "계절지수"를 적용하지 않는다 — 원본 스프레드시트 어디에도 월별 계절지수
// 테이블이 없어(08_계산기준·02_월별성과DB 전수 확인) 지어낼 수 없다. 완료된 달의 실제매출
// 평균(누적평균매출 - 오픈 2개월차부터 최신 완료월까지, 원본 그대로)과 모형이 내는 단일 월
// 예측값을 그대로 비교한다. 계절지수가 필요하면 월별 실측 표본이 더 쌓인 뒤 별도로 추정해야
// 한다(추측 금지 — docs 참고).
// ---------------------------------------------------------------------------

export type TenureCohort = "정식 검증군" | "조기 검증 A" | "조기 검증 B" | "조기 검증 C" | "참고용" | "제외";

/** 완료된 월 수(오픈 후 실제매출이 확정된 달의 개수) 기준 코호트 분류. */
export function classifyTenureCohort(completedMonths: number | null): TenureCohort {
  if (completedMonths == null || completedMonths <= 0) return "제외";
  if (completedMonths >= 12) return "정식 검증군";
  if (completedMonths >= 9) return "조기 검증 A";
  if (completedMonths >= 6) return "조기 검증 B";
  if (completedMonths >= 3) return "조기 검증 C";
  return "참고용"; // 1~2개월
}

export type ValidationStoreInput = {
  storeCode: string;
  storeName: string;
  brand: string | null; // null = 브랜드 미확인 (09_입지동선평가에 행 없음)
  openedAt: string | null;
  completedMonths: number; // 실제매출이 확정된 완료월 수
  franchiseStatus: string | null;
  isPostOpenIssue: boolean; // 오픈 후 운영미숙·장기휴업·영업중단·가격덤핑 등 특이사항
  postOpenIssueReason: string | null;
  pcCount: number | null;
  evaluationPcCount?: number | null; // ExistingStore.evaluationPcCount와 동일 — 있으면 pcCount 대신 이걸로 학습/예측
  hourlyRate: number | null;
  ownDemand: number | null;
  competitivenessScore: number | null;
  actualRevenueAvg: number | null; // 완료월 평균 실제매출 (누적평균매출)
  specialDemandType?: string | null; // 09_입지동선평가!특수수요유형 (대학가/군부대/산업단지 등)
  specialDemandIntensity?: string | null; // 특수수요강도 (없음/낮음/보통/높음)
  // 2026-08-20 (5차) 추가 — 외부유입 보정(V62)·데이터 품질·오차원인 추정에 쓰는 입력.
  inflowRestriction?: InflowRestriction | null; // 09_입지동선평가!외부유입제한 — V61→V62 보정률 직결
  hasLocationEvaluation?: boolean; // 09_입지동선평가에 행이 있는지 (데이터 완성도 판정용)
  floor?: number | null;
  groundLevel?: GroundLevel | null;
  hasElevator?: boolean | null;
  competitorSummary?: CompetitorInvestigationSummary; // listCompetitors(storeCode) 집계 결과
  // 2026-08-20 (6차) 추가 — sheetParity 비교용. storeEvalExistingStores!v61Predicted
  // (원본 04_점포평가요약!예측_월매출 캐시값, 재계산 아님)을 그대로 들고 온다.
  sheetV61Predicted?: number | null;
};

export type ValidationStoreRow = ValidationStoreInput & {
  cohort: TenureCohort;
  predictedRevenueAvg: number | null; // V61(외부유입 보정 전, 리브-원-아웃 재학습 결과 — loocvValidation)
  v62Rate: number; // 이번 매장에 적용된 외부유입 보정률(0이면 보정 없음/미평가)
  v62PredictedRevenueAvg: number | null; // V61 × (1+외부유입 보정률) — 실제 오차 계산은 이 값을 쓴다
  errorAmount: number | null; // v62예측 - 실제
  absoluteErrorPct: number | null;
  direction: "과대예측" | "과소예측" | "정확" | null;
  includedInCoreAccuracy: boolean;
  // 요청사항 — 조기검증(완료 3~11개월, 코호트 A/B/C) 포함 여부를 매장 행 단위로 노출한다.
  // 정식검증(includedInCoreAccuracy)과 조기검증은 서로 배타적이다(같은 매장이 둘 다 true일 수 없음).
  includedInEarlyValidation: boolean;
  exclusionReason: string | null;
  operationalStatus: OperationalStatus;
  dataCompleteness: DataCompletenessResult;
  errorCause: ErrorCauseCode;
};

// ---- 경쟁점 조사상태 집계 (요청사항 4) ----
export type CompetitorInvestigationSummaryStatus = "uninvestigated" | "detailed_complete" | "mixed" | "light" | "confirmed_no_competitor";
export type CompetitorDataReliability = "high" | "medium" | "low";
export type CompetitorInvestigationSummary = {
  totalCount: number;
  detailedCount: number; // surveyLevel="상세"로 조사완료된 경쟁점 수
  lightCount: number; // 조사완료됐지만 간략/외관만인 경쟁점 수
  uninvestigatedCount: number; // 경쟁점없음/노후저경쟁력미조사
  status: CompetitorInvestigationSummaryStatus;
  detailedRatio: number | null; // detailedCount / totalCount
  dataReliability: CompetitorDataReliability;
};

/**
 * 경쟁점 조사상태를 후보지/매장 단위로 집계한다. 경쟁점 미조사는 "경쟁력이 낮다"는 뜻이
 * 아니라 노후화 등으로 현장조사 필요성이 낮았을 수도 있다는 뜻이라, 경쟁력 점수 자체에는
 * 영향을 주지 않고 이 신뢰도 필드로만 별도 관리한다(요청사항 4).
 * 상세조사 비율은 조사완료된 것 중이 아니라 전체 경쟁점 수 대비로 계산한다 — 그래야 "경쟁점은
 * 있는데 조사가 안 됨" 상황이 신뢰도를 실제로 낮추기 때문이다.
 */
export function computeCompetitorInvestigationSummary(
  competitors: Pick<Competitor, "investigationStatus" | "surveyLevel">[],
): CompetitorInvestigationSummary {
  const totalCount = competitors.length;
  const investigated = competitors.filter((c) => c.investigationStatus === "조사완료");
  const detailedCount = investigated.filter((c) => c.surveyLevel === "상세").length;
  const lightCount = investigated.length - detailedCount;
  const uninvestigatedCount = totalCount - investigated.length;
  // 경쟁점 문서가 하나 이상 있고 전부 "경쟁점없음"이면, 이건 "조사가 안 됐다(모름)"가 아니라
  // "확인 결과 이 상권엔 경쟁점이 원래 없다(독점상권)"는 뜻이다 - 둘을 같은 "low 신뢰도"로
  // 뭉개면 실제로는 완전히 확인된 사실을 "데이터 부족"으로 오진하게 된다(2026-08-22, 탕정역점·
  // 남악점·광주각화점 실사례에서 확인).
  const confirmedNoCompetitor = totalCount > 0 && competitors.every((c) => c.investigationStatus === "경쟁점없음");

  let status: CompetitorInvestigationSummaryStatus;
  if (confirmedNoCompetitor) status = "confirmed_no_competitor";
  else if (totalCount === 0 || investigated.length === 0) status = "uninvestigated";
  else if (lightCount === 0) status = "detailed_complete";
  else if (detailedCount === 0) status = "light";
  else status = "mixed";

  const detailedRatio = totalCount ? detailedCount / totalCount : null;
  const dataReliability: CompetitorDataReliability = confirmedNoCompetitor
    ? "high"
    : detailedRatio != null && detailedRatio >= 0.7
      ? "high"
      : detailedCount > 0
        ? "medium"
        : "low";

  return { totalCount, detailedCount, lightCount, uninvestigatedCount, status, detailedRatio, dataReliability };
}

// ---- 데이터 완성도 (요청사항 5) ----
export type DataCompletenessGrade = "complete" | "partial" | "excluded";
export type DataCompletenessResult = {
  score: number; // 25점 단위 4항목 합산, 0~100
  grade: DataCompletenessGrade;
  hasCoreInputs: boolean; // 핵심 예측 입력값(요금·자사수요·PC대수·경쟁력점수) 존재
  hasLocationEvaluation: boolean; // 입지동선평가 존재
  hasCompetitorInfo: boolean; // 경쟁점 조사정보 존재
  hasActualPerformance: boolean; // 실제 매출·가동률 등 실적 존재
};

/** 4항목 각 25점, 100점 만점. 100=complete, 75 이상=partial, 미만=excluded (요청사항 5). */
export function computeDataCompleteness(input: {
  hourlyRate: number | null;
  ownDemand: number | null;
  pcCount: number | null;
  competitivenessScore: number | null;
  hasLocationEvaluation: boolean;
  competitorCount: number;
  actualMonthlyRevenueAvg: number | null;
  completedMonths: number | null;
}): DataCompletenessResult {
  const hasCoreInputs =
    input.hourlyRate != null && input.ownDemand != null && input.pcCount != null && input.competitivenessScore != null;
  const hasLocationEvaluation = input.hasLocationEvaluation;
  const hasCompetitorInfo = input.competitorCount > 0;
  const hasActualPerformance = input.actualMonthlyRevenueAvg != null && (input.completedMonths ?? 0) > 0;
  const score = [hasCoreInputs, hasLocationEvaluation, hasCompetitorInfo, hasActualPerformance].filter(Boolean).length * 25;
  const grade: DataCompletenessGrade = score === 100 ? "complete" : score >= 75 ? "partial" : "excluded";
  return { score, grade, hasCoreInputs, hasLocationEvaluation, hasCompetitorInfo, hasActualPerformance };
}

// ---- 운영상태 (요청사항 6) ----
export type OperationalStatus = "normal" | "early" | "post_open_issue" | "abnormal";

/**
 * 송도점(경쟁점 가격전쟁)·동탄북광장점(운영관리 문제)처럼 오픈 후 발생한 요소는 abnormal이
 * 아니라 post_open_issue로 분리한다 - 가맹계약 자체는 정상이라서다. 가맹해지·폐업처럼 계약
 * 상태가 비정상인 경우만 abnormal로 본다(요청사항 6).
 */
export function computeOperationalStatus(input: {
  franchiseStatus: string | null;
  isPostOpenIssue: boolean;
  cohort: TenureCohort;
}): OperationalStatus {
  if (input.franchiseStatus != null && input.franchiseStatus !== "정상") return "abnormal";
  if (input.isPostOpenIssue) return "post_open_issue";
  if (input.cohort !== "정식 검증군") return "early";
  return "normal";
}

// ---- 오차원인 자동분류 (요청사항 7) ----
export type ErrorCauseCode =
  | "within_range"
  | "external_inflow_underreflected"
  | "special_demand_underreflected"
  | "competitor_data_missing"
  | "monopoly_market_unmodeled"
  | "access_overestimated"
  | "demand_share_overestimated"
  | "demand_conversion_underestimated"
  | "not_verifiable";

/**
 * 오차원인 "우선 추정" — 여러 원인이 겹칠 수 있어 단일 확정 진단이 아니라 화면에 참고용
 * "우선 추정 원인"으로만 표시한다(요청사항 7 명시). 우선순위:
 *   1) 비교 불가 → not_verifiable, 2) 이미 목표범위 이내 → within_range,
 *   3) 확인된 독점상권(경쟁점 자체가 없음) → monopoly_market_unmodeled (모델에 경쟁강도 피처가
 *      없어 못 잡는 구조적 한계라는 뜻, "조사 부실"과는 다르다 — 2026-08-22 확인),
 *   4) 경쟁 데이터 신뢰도가 낮음(low, 조사 여부 자체가 불확실) → competitor_data_missing
 *      (경쟁 구도 자체를 못 봤을 가능성이 의심된다), 5) 과소예측+특수수요점수>0 →
 *      special_demand_underreflected(10_오차원인분석 실사례 근거, [[computeSpecialDemandScore]]
 *      참고), 6) 과대예측+외부유입제한 있음 → external_inflow_underreflected(보정을 더 줬어야
 *      했다는 뜻), 7) 과대예측+접근성 좋음(층·엘리베이터) → access_overestimated, 8) 남은
 *      과대예측 → demand_share_overestimated(경쟁력격차 기반 수요확보율 과대평가로 추정), 9) 남은
 *      과소예측 → demand_conversion_underestimated(상권수요→자사수요 전환율 과소평가로 추정).
 *      이 순서는 확정 근거가 아니라 검토 우선순위 휴리스틱이다.
 */
export function classifyErrorCause(input: {
  absoluteErrorPct: number | null;
  direction: "과대예측" | "과소예측" | "정확" | null;
  specialDemandScore: number;
  inflowRestriction: InflowRestriction | null | undefined;
  competitorDataReliability: CompetitorDataReliability | null | undefined;
  competitorConfirmedNoCompetitor?: boolean;
  floor: number | null | undefined;
  groundLevel: GroundLevel | null | undefined;
  hasElevator: boolean | null | undefined;
}): ErrorCauseCode {
  if (input.absoluteErrorPct == null || input.direction == null) return "not_verifiable";
  if (input.absoluteErrorPct <= 0.1) return "within_range";
  if (input.competitorConfirmedNoCompetitor) return "monopoly_market_unmodeled";
  if (input.competitorDataReliability === "low") return "competitor_data_missing";
  if (input.direction === "과소예측" && input.specialDemandScore > 0) return "special_demand_underreflected";
  if (input.direction === "과대예측" && input.inflowRestriction != null && input.inflowRestriction !== "없음") {
    return "external_inflow_underreflected";
  }
  const goodAccess = (computeLocationScoreFromFacts(input.floor ?? null, input.groundLevel ?? null, input.hasElevator ?? null) ?? 0) >= 4;
  if (input.direction === "과대예측" && goodAccess) return "access_overestimated";
  if (input.direction === "과대예측") return "demand_share_overestimated";
  return "demand_conversion_underestimated";
}

/**
 * errorCause가 "not_verifiable"일 때만 쓰는 세분화 사유 — classifyErrorCause의 오차원인 추정
 * 우선순위(오차가 있는 경우)와는 별개로, "왜 오차 자체를 계산할 수 없었는지"를 이미 계산된
 * 필드(exclusionReason/dataCompleteness/brand/franchiseStatus)만 조합해 구분한다. 새 산식은
 * 없다 — 우선순위는 위에서부터 먼저 해당하는 사유 하나만 반환한다.
 */
export function describeNotVerifiableReason(row: {
  actualRevenueAvg: number | null;
  cohort: TenureCohort;
  brand: string | null;
  franchiseStatus: string | null;
  v62PredictedRevenueAvg: number | null;
  dataCompleteness: DataCompletenessResult;
}): string {
  if (row.actualRevenueAvg == null || row.cohort === "제외") return "완료된 실제매출 월 없음";
  if (row.brand == null) return "입지동선평가 미작성";
  if (row.brand !== "블랙라벨") return "타 브랜드";
  if (row.franchiseStatus !== "정상") return "정상영업 아님";
  if (row.dataCompleteness.grade === "excluded") return "데이터 완성도 미달";
  if (!row.dataCompleteness.hasCoreInputs) return "예측 입력값 부족";
  if (row.v62PredictedRevenueAvg == null) return "V62 예측값 없음";
  return "검증 불가(원인 미분류)";
}

export type ErrorBucket = { label: string; max: number | null }; // max=null이면 상한 없음(초과)
export const ERROR_BUCKETS: ErrorBucket[] = [
  { label: "±5% 이내", max: 0.05 },
  { label: "5% 초과~10% 이내", max: 0.1 },
  { label: "10% 초과~15% 이내", max: 0.15 },
  { label: "15% 초과~20% 이내", max: 0.2 },
  { label: "20% 초과~30% 이내", max: 0.3 },
  { label: "30% 초과", max: null },
];

export type ErrorBucketResult = { label: string; count: number; ratio: number; storeNames: string[] };

export function bucketizeErrors(rows: { absoluteErrorPct: number | null; storeName: string }[]): ErrorBucketResult[] {
  const withError = rows.filter((r): r is { absoluteErrorPct: number; storeName: string } => r.absoluteErrorPct != null);
  const n = withError.length;
  let lower = 0;
  return ERROR_BUCKETS.map((b) => {
    const inBucket = withError.filter((r) => r.absoluteErrorPct > lower && (b.max == null || r.absoluteErrorPct <= b.max));
    lower = b.max ?? lower;
    return { label: b.label, count: inBucket.length, ratio: n ? inBucket.length / n : 0, storeNames: inBucket.map((r) => r.storeName) };
  });
}

export type ValidationSummary2 = {
  sampleCount: number;
  meanAbsoluteErrorPct: number | null;
  medianAbsoluteErrorPct: number | null;
  within5PctRatio: number | null;
  within10PctRatio: number | null;
  within15PctRatio: number | null;
  within20PctRatio: number | null;
  over20PctRatio: number | null;
  overPredictedCount: number;
  overPredictedMeanPct: number | null;
  underPredictedCount: number;
  underPredictedMeanPct: number | null;
  meanBiasPct: number | null; // 평균 (예측-실제)/실제, 부호 있음
  buckets: ErrorBucketResult[];
  passed: { mape: boolean; medianAe: boolean; within10: boolean; within20: boolean; bias: boolean };
  targetsMetAll: boolean;
  // 요청사항 8 — ±10% 이내 적중률 80%를 정식 도입의 "핵심 조건"으로 쓴다. 나머지 넷은 충족하는데
  // 이 조건만 못 채우면 "조건부 사용"(부분 활용은 가능), 나머지 지표 자체가 못 미치면(모형이
  // 아직 부정확) "재보정 필요"로 본다.
  overallStatus: "정식 사용 가능" | "조건부 사용" | "재보정 필요";
  statusReason: string;
};

/** 요청사항 6/7/8 — 오차구간·과대과소·편향·목표달성 여부·현재 상태를 한 번에 계산한다. */
export function summarizeValidationRows(
  rows: { storeName: string; absoluteErrorPct: number | null; errorAmount: number | null; actualRevenueAvg: number | null }[],
  targets: { mape: number; medianAe: number; within10: number; within20: number; maxBias: number },
): ValidationSummary2 {
  const errors = rows.filter((r) => r.absoluteErrorPct != null).map((r) => r.absoluteErrorPct as number);
  const n = errors.length;
  const buckets = bucketizeErrors(rows.map((r) => ({ absoluteErrorPct: r.absoluteErrorPct, storeName: r.storeName })));

  const biasRows = rows.filter(
    (r): r is { storeName: string; absoluteErrorPct: number; errorAmount: number; actualRevenueAvg: number } =>
      r.errorAmount != null && r.actualRevenueAvg != null && r.actualRevenueAvg > 0,
  );
  const signedPct = biasRows.map((r) => r.errorAmount / r.actualRevenueAvg);
  const overRows = signedPct.filter((p) => p > 0);
  const underRows = signedPct.filter((p) => p < 0);

  const meanAbsoluteErrorPct = n ? errors.reduce((a, b) => a + b, 0) / n : null;
  const medianAbsoluteErrorPct = n ? median(errors) : null;
  const within = (max: number) => (n ? errors.filter((e) => e <= max).length / n : null);
  const within20 = within(0.2);
  const within10Ratio = within(0.1);
  const meanBiasPct = signedPct.length ? signedPct.reduce((a, b) => a + b, 0) / signedPct.length : null;
  const passed = {
    mape: meanAbsoluteErrorPct != null && meanAbsoluteErrorPct <= targets.mape,
    medianAe: medianAbsoluteErrorPct != null && medianAbsoluteErrorPct <= targets.medianAe,
    within10: (within10Ratio ?? 0) >= targets.within10,
    within20: (within20 ?? 0) >= targets.within20,
    bias: meanBiasPct != null && Math.abs(meanBiasPct) <= targets.maxBias,
  };
  const coreTargetsMet = passed.mape && passed.medianAe && passed.within20 && passed.bias;

  const pct = (v: number | null) => ((v ?? 0) * 100).toFixed(1);
  const pct0 = (v: number) => (v * 100).toFixed(0);

  let overallStatus: ValidationSummary2["overallStatus"];
  let statusReason: string;
  if (coreTargetsMet && passed.within10) {
    overallStatus = "정식 사용 가능";
    statusReason = "5개 목표(평균오차·중앙오차·±10%·±20%·편향)를 모두 충족했다.";
  } else if (coreTargetsMet) {
    overallStatus = "조건부 사용";
    statusReason = `±10% 적중률 목표 미달(${pct(within10Ratio)}% < ${pct0(targets.within10)}%)로 재보정 필요`;
  } else {
    // 요청사항: "재보정 필요" 상태에서도 실패한 지표 이름만 나열하지 않고, ±10%를 포함해 모든
    // 실패 지표의 실제 수치 vs 목표 수치를 그대로 보여준다(정확도가 목표에 도달한 것처럼 보이지
    // 않게, 또한 숨겨지는 지표가 없게).
    const failed: string[] = [];
    if (!passed.mape) failed.push(`평균절대오차 ${pct(meanAbsoluteErrorPct)}%로 목표 ${pct0(targets.mape)}% 초과`);
    if (!passed.medianAe) failed.push(`중앙값절대오차 ${pct(medianAbsoluteErrorPct)}%로 목표 ${pct0(targets.medianAe)}% 초과`);
    if (!passed.within10) failed.push(`±10% 적중률 ${pct(within10Ratio)}%로 목표 ${pct0(targets.within10)}% 미달`);
    if (!passed.within20) failed.push(`±20% 적중률 ${pct(within20)}%로 목표 ${pct0(targets.within20)}% 미달`);
    if (!passed.bias) failed.push(`평균편향 ${pct(meanBiasPct)}%로 허용범위(±${pct0(targets.maxBias)}%) 초과`);
    overallStatus = "재보정 필요";
    statusReason = `${failed.join(", ")} — 모형 자체 재보정 필요`;
  }

  return {
    sampleCount: n,
    meanAbsoluteErrorPct,
    medianAbsoluteErrorPct,
    within5PctRatio: within(0.05),
    within10PctRatio: within10Ratio,
    within15PctRatio: within(0.15),
    within20PctRatio: within20,
    over20PctRatio: within20 != null ? 1 - within20 : null,
    overPredictedCount: overRows.length,
    overPredictedMeanPct: overRows.length ? overRows.reduce((a, b) => a + b, 0) / overRows.length : null,
    underPredictedCount: underRows.length,
    underPredictedMeanPct: underRows.length ? underRows.reduce((a, b) => a + b, 0) / underRows.length : null,
    meanBiasPct,
    buckets,
    passed,
    targetsMetAll: coreTargetsMet && passed.within10,
    overallStatus,
    statusReason,
  };
}

/** V61 학습표본 자격(12개월 완료·블랙라벨·정상영업·산식학습제외 아님·핵심 입력값 존재). */
export function isCoreEligibleForV61Training(s: ValidationStoreInput): boolean {
  // toV61TrainingStore가 실제로 쓰는 값은 evaluationPcCount ?? pcCount이므로 그 해석된 값이
  // 양수인지 확인해야 한다 — 그냥 pcCount != null만 보면 evaluationPcCount:0인 매장이 통과해
  // 대당매출이 Infinity가 되어 학습 전체를 오염시킨다(2026-08-24 확인, isEligibleForV61Training과 동일 이슈).
  const resolvedPcCount = s.evaluationPcCount ?? s.pcCount;
  return (
    s.brand === "블랙라벨" &&
    !s.isPostOpenIssue &&
    s.franchiseStatus === "정상" &&
    s.completedMonths >= 12 &&
    resolvedPcCount != null &&
    resolvedPcCount > 0 &&
    s.hourlyRate != null &&
    s.ownDemand != null &&
    s.competitivenessScore != null &&
    s.actualRevenueAvg != null &&
    s.actualRevenueAvg > 0
  );
}

/** 학습표본 자격이 있는 매장을 V61 학습 입력 형태로 변환한다(runCohortValidation/diagnoseLoocvSensitivity 공용). */
export function toV61TrainingStore(s: ValidationStoreInput): V61TrainingStore {
  return {
    storeCode: s.storeCode,
    storeName: s.storeName,
    pcCount: (s.evaluationPcCount ?? s.pcCount) as number,
    hourlyRate: s.hourlyRate as number,
    ownDemand: s.ownDemand as number,
    competitivenessScore: s.competitivenessScore as number,
    actualMonthlyRevenueAvg: s.actualRevenueAvg as number,
    specialDemandScore: computeSpecialDemandScore(s.specialDemandType, s.specialDemandIntensity),
  };
}

/**
 * 요청사항 1~5 — 12개월 미완료 매장까지 포함한 전체 검증.
 * 데이터 누출 방지(요청사항 4): 학습표본(12개월 완료·블랙라벨·정상영업·산식학습제외 아님)은
 * 리브-원-아웃으로, 그 외 전부(영업기간 미달·브랜드 미확인·사후 운영이슈·가맹해지 등)는
 * "학습에 전혀 쓰이지 않은" 완전 외부 검증군으로 취급해 학습표본 전체로 학습한 모형으로 예측한다.
 */
export function runCohortValidation(
  stores: ValidationStoreInput[],
  settings: Pick<ModelSettings, "v61Training" | "inflowAdjustment">,
): { rows: ValidationStoreRow[] } {
  const { ridgeLambda, ridgeWeight, baselineWeight, minSampleCount } = settings.v61Training;

  const coreStores = stores.filter(isCoreEligibleForV61Training);
  const coreTraining = coreStores.map(toV61TrainingStore);

  // 리브-원-아웃: 핵심 학습표본끼리는 서로를 빼고 학습·예측한다(데이터 누출 방지).
  const loo = runLeaveOneOutValidation(coreTraining, ridgeLambda, ridgeWeight, baselineWeight, minSampleCount);
  const looByCode = new Map(loo.rows.map((r) => [r.storeCode, r.predictedRevenue]));

  // 완전 외부 검증군 예측용 - 핵심 학습표본 전체로 학습한 단일 모형.
  const fullModel = fitEmpiricalRevenueModel(coreTraining.map(toEmpiricalSample), ridgeLambda, minSampleCount);

  const rows: ValidationStoreRow[] = stores.map((s) => {
    const cohort = classifyTenureCohort(s.completedMonths);
    const isCore = isCoreEligibleForV61Training(s);

    let predictedRevenueAvg: number | null = null;
    if (isCore) {
      predictedRevenueAvg = looByCode.get(s.storeCode) ?? null;
    } else if (cohort === "제외") {
      // 완료된 실제매출 월이 0개(오픈 당월이거나 그 이전)인 매장은 예측값도 아예 내지 않는다.
      // 비교할 실적 자체가 없는데 예측 숫자만 표에 떠 있으면 "이 매장도 평가되고 있다"는
      // 오해를 준다(요청사항: 오픈달 매출로 평가하면 안 된다).
      predictedRevenueAvg = null;
    } else if (fullModel && s.pcCount && s.hourlyRate != null && s.ownDemand != null && s.competitivenessScore != null) {
      const pred = predictEmpiricalRevenue(
        fullModel,
        empiricalFeaturesFor({
          hourlyRate: s.hourlyRate,
          ownDemand: s.ownDemand,
          pcCount: s.pcCount,
          competitivenessScore: s.competitivenessScore,
          specialDemandScore: computeSpecialDemandScore(s.specialDemandType, s.specialDemandIntensity),
        }),
        s.pcCount,
        ridgeWeight,
        baselineWeight,
      );
      predictedRevenueAvg = pred?.monthlyRevenue ?? null;
    }

    // 요청사항 2 — 외부유입 제한 보정: V62예측 = V61예측 × (1+보정률). 오차·방향·오차구간은
    // 전부 이 V62 값 기준으로 계산한다(V61 그대로 비교하면 강한 외부유입제한 매장의 오차가
    // 실제보다 부풀려 보인다). inflowRestriction이 없으면(null/undefined) 보정 없이 V61=V62.
    const v62Rate = getV62Rate(s.inflowRestriction ?? null, settings) ?? 0;
    const v62PredictedRevenueAvg = predictedRevenueAvg != null ? computeV62Final(predictedRevenueAvg, v62Rate) : null;

    const errorAmount =
      v62PredictedRevenueAvg != null && s.actualRevenueAvg != null ? v62PredictedRevenueAvg - s.actualRevenueAvg : null;
    const absoluteErrorPct =
      v62PredictedRevenueAvg != null && s.actualRevenueAvg != null && s.actualRevenueAvg > 0
        ? Math.abs(v62PredictedRevenueAvg - s.actualRevenueAvg) / s.actualRevenueAvg
        : null;
    const direction: ValidationStoreRow["direction"] =
      errorAmount == null ? null : errorAmount > 0 ? "과대예측" : errorAmount < 0 ? "과소예측" : "정확";

    let exclusionReason: string | null = null;
    if (cohort === "참고용") exclusionReason = "영업기간 1~2개월 — 참고자료로만 표시(핵심 정확도 제외)";
    else if (cohort === "제외") exclusionReason = "완료된 실제매출 월이 없음";
    else if (s.isPostOpenIssue) exclusionReason = `사후 운영이슈: ${s.postOpenIssueReason ?? "사유 미기재"}`;
    else if (s.franchiseStatus !== "정상") exclusionReason = `정상영업 아님(${s.franchiseStatus ?? "확인필요"})`;
    else if (s.brand == null) exclusionReason = "브랜드 미확인(09_입지동선평가에 행 없음)";
    else if (s.brand !== "블랙라벨") exclusionReason = `브랜드=${s.brand} (블랙라벨 아님)`;
    else if (!isCore) exclusionReason = `영업기간 미달(완료 ${s.completedMonths}개월, ${cohort}) — 완전 외부 검증군으로 예측`;

    const operationalStatus = computeOperationalStatus({ franchiseStatus: s.franchiseStatus, isPostOpenIssue: s.isPostOpenIssue, cohort });
    const dataCompleteness = computeDataCompleteness({
      hourlyRate: s.hourlyRate,
      ownDemand: s.ownDemand,
      pcCount: s.pcCount,
      competitivenessScore: s.competitivenessScore,
      hasLocationEvaluation: s.hasLocationEvaluation ?? false,
      competitorCount: s.competitorSummary?.totalCount ?? 0,
      actualMonthlyRevenueAvg: s.actualRevenueAvg,
      completedMonths: s.completedMonths,
    });
    const errorCause = classifyErrorCause({
      absoluteErrorPct,
      direction,
      specialDemandScore: computeSpecialDemandScore(s.specialDemandType, s.specialDemandIntensity),
      inflowRestriction: s.inflowRestriction,
      competitorDataReliability: s.competitorSummary?.dataReliability,
      competitorConfirmedNoCompetitor: s.competitorSummary?.status === "confirmed_no_competitor",
      floor: s.floor,
      groundLevel: s.groundLevel,
      hasElevator: s.hasElevator,
    });

    // 조기검증 포함조건: 완료개월 3~11개월(코호트 A/B/C) + 실제/예측 존재 + 블랙라벨 +
    // 학습제외 아님(사후 운영이슈 아님) + 정상영업. 정식검증(isCore)과는 배타적이다.
    const includedInEarlyValidation =
      !isCore &&
      (cohort === "조기 검증 A" || cohort === "조기 검증 B" || cohort === "조기 검증 C") &&
      !s.isPostOpenIssue &&
      s.franchiseStatus === "정상" &&
      s.actualRevenueAvg != null &&
      v62PredictedRevenueAvg != null;

    return {
      ...s,
      cohort,
      predictedRevenueAvg,
      v62Rate,
      v62PredictedRevenueAvg,
      errorAmount,
      absoluteErrorPct,
      direction,
      includedInCoreAccuracy: isCore,
      includedInEarlyValidation,
      exclusionReason,
      operationalStatus,
      dataCompleteness,
      errorCause,
    };
  });

  return { rows };
}

// ---------------------------------------------------------------------------
// 2026-08-20 (6차) 추가 — 웹 V62와 구글시트 V62 검증값 불일치 원인 추적.
//
// 두 계산 모드를 절대 섞지 않는다:
//   - sheetParity: 시트에 저장된 V61 예측값(ExistingStore.v61Predicted, 재계산 없이 원본 그대로)
//     + 외부유입 보정만 적용해 "시트가 원래 보여주던 결과"를 재현한다. computeValidationRow/
//     summarizeValidation(기존 golden-data 테스트로 이미 검증됨)을 그대로 재사용한다.
//   - loocvValidation: runCohortValidation의 리브-원-아웃 재학습 결과(predictedRevenueAvg/
//     v62PredictedRevenueAvg) — 매 매장을 학습에서 뺀 뒤 다시 학습해 예측하므로 시트의
//     "전체를 다 넣고 학습한 모형으로 자기 자신을 예측"과는 원천적으로 값이 다를 수 있다.
// ---------------------------------------------------------------------------

export type ParityDiffStage = "V61예측차이" | "외부유입보정률차이" | "반올림차이" | "일치" | "비교불가";

export type ParityComparisonRow = {
  storeCode: string;
  storeName: string;
  actualRevenueAvg: number | null;
  sheetV61Predicted: number | null;
  webV61Predicted: number | null;
  sheetInflowRate: number | null;
  webInflowRate: number | null;
  sheetV62Predicted: number | null;
  webV62Predicted: number | null;
  predictionDiff: number | null; // webV62 - sheetV62
  predictionDiffPct: number | null; // |predictionDiff| / sheetV62Predicted
  sheetAbsoluteErrorPct: number | null;
  webAbsoluteErrorPct: number | null;
  diffStage: ParityDiffStage;
  // V61 예측 단계에서 시트(인샘플)와 웹(리브-원-아웃)의 차이가 유난히 큰 점포 표시용(시흥배곧점
  // 사례 ~55%가 계기). 계산 오류가 아니라 "이 매장을 뺐을 때 모형이 크게 흔들린다"는 신호일 뿐이며,
  // 이 매장의 계수·입력값을 임의로 조정하지 않는다 — diagnoseLoocvSensitivity로 원인만 들여다본다.
  isLoocvHighVariance: boolean;
};

/** V61예측차이 단계에서 |웹-시트|/시트 비율이 이 값을 넘으면 "LOOCV 고변동 점포"로 표시한다. */
export const LOOCV_HIGH_VARIANCE_THRESHOLD = 0.3;

/**
 * sheetParity(캐시된 시트 V61 + 보정률) vs loocvValidation(리브-원-아웃 재학습) 매장별 비교표.
 * loocvRows는 runCohortValidation의 결과를 그대로 받는다(재계산하지 않음 - 단일 출처 유지).
 */
export function buildParityComparisonRows(
  stores: ValidationStoreInput[],
  loocvRows: ValidationStoreRow[],
  settings: Pick<ModelSettings, "inflowAdjustment">,
): ParityComparisonRow[] {
  const loocvByCode = new Map(loocvRows.map((r) => [r.storeCode, r]));
  return stores
    .filter((s) => s.brand === "블랙라벨" && s.sheetV61Predicted != null && s.actualRevenueAvg != null)
    .map((s) => {
      const loocv = loocvByCode.get(s.storeCode);
      const sheetRate = getV62Rate(s.inflowRestriction ?? null, settings);
      const sheetV62Predicted = computeV62Final(s.sheetV61Predicted ?? null, sheetRate);
      const webV61Predicted = loocv?.predictedRevenueAvg ?? null;
      const webV62Predicted = loocv?.v62PredictedRevenueAvg ?? null;
      const webInflowRate = loocv?.v62Rate ?? null;
      const actual = s.actualRevenueAvg as number;

      const sheetAbsoluteErrorPct = sheetV62Predicted != null ? Math.abs(sheetV62Predicted - actual) / actual : null;
      const webAbsoluteErrorPct = loocv?.absoluteErrorPct ?? null;
      const predictionDiff = webV62Predicted != null && sheetV62Predicted != null ? webV62Predicted - sheetV62Predicted : null;

      let diffStage: ParityDiffStage = "비교불가";
      if (webV61Predicted != null && s.sheetV61Predicted != null) {
        const v61RelDiff = Math.abs(webV61Predicted - s.sheetV61Predicted) / Math.max(1, s.sheetV61Predicted);
        if (v61RelDiff > 0.001) {
          diffStage = "V61예측차이";
        } else if (sheetRate != null && webInflowRate != null && Math.abs(sheetRate - webInflowRate) > 0.0001) {
          diffStage = "외부유입보정률차이";
        } else if (sheetV62Predicted !== webV62Predicted) {
          diffStage = "반올림차이";
        } else {
          diffStage = "일치";
        }
      }

      const predictionDiffPct =
        predictionDiff != null && sheetV62Predicted ? Math.abs(predictionDiff) / sheetV62Predicted : null;
      const isLoocvHighVariance =
        diffStage === "V61예측차이" && predictionDiffPct != null && predictionDiffPct > LOOCV_HIGH_VARIANCE_THRESHOLD;

      return {
        storeCode: s.storeCode,
        storeName: s.storeName,
        actualRevenueAvg: s.actualRevenueAvg,
        sheetV61Predicted: s.sheetV61Predicted ?? null,
        webV61Predicted,
        sheetInflowRate: sheetRate,
        webInflowRate,
        sheetV62Predicted,
        webV62Predicted,
        predictionDiff,
        predictionDiffPct,
        sheetAbsoluteErrorPct,
        webAbsoluteErrorPct,
        diffStage,
        isLoocvHighVariance,
      };
    });
}

export type LoocvSensitivityDiagnostic = {
  storeCode: string;
  storeName: string;
  featuresRaw: number[]; // [log(요금), log(자사수요/PC), 경쟁력점수] — empiricalFeaturesFor와 동일 순서
  sampleCountWith: number; // 대상 매장을 포함한 학습표본 수
  sampleCountWithout: number; // 대상 매장을 제외한 학습표본 수(= sampleCountWith - 1)
  featureMeansWith: number[] | null;
  featureSdsWith: number[] | null;
  coefficientsWith: number[] | null;
  featureMeansWithout: number[] | null;
  featureSdsWithout: number[] | null;
  coefficientsWithout: number[] | null;
  ridgeOnlyPrediction: number | null; // 대상 매장 제외 학습모형, ridgeWeight=1/baselineWeight=0
  baselineOnlyPrediction: number | null; // 대상 매장 제외 학습모형, ridgeWeight=0/baselineWeight=1
  blendedPrediction: number | null; // 대상 매장 제외 학습모형, 실제 설정된 ridgeWeight/baselineWeight
  isOutOfTrainingRange: boolean; // 대상 매장의 특징값이 나머지 학습표본의 범위(min~max) 밖인지
};

/**
 * 특정 매장을 학습에서 뺐을 때(LOOCV) 예측이 왜 크게 흔들리는지 들여다보는 읽기전용 진단.
 * fitEmpiricalRevenueModel/predictEmpiricalRevenue를 그대로 재사용하며, 계수나 입력값을
 * 수정하지 않는다 — 시흥배곧점처럼 LOOCV_HIGH_VARIANCE_THRESHOLD를 넘는 점포의 원인을
 * 화면에 투명하게 보여주기 위한 것이다(scripts/diagnoseBaegotLOOCV.mjs의 1회성 진단을
 * 재사용 가능한 형태로 앱에 편입).
 */
export function diagnoseLoocvSensitivity(
  storeCode: string,
  stores: ValidationStoreInput[],
  settings: Pick<ModelSettings, "v61Training">,
): LoocvSensitivityDiagnostic | null {
  const { ridgeLambda, ridgeWeight, baselineWeight, minSampleCount } = settings.v61Training;
  const coreTraining = stores.filter(isCoreEligibleForV61Training).map(toV61TrainingStore);
  const target = coreTraining.find((s) => s.storeCode === storeCode);
  if (!target) return null;

  const withoutTraining = coreTraining.filter((s) => s.storeCode !== storeCode);
  const featuresRaw = empiricalFeaturesFor(target);

  const withModel = fitEmpiricalRevenueModel(coreTraining.map(toEmpiricalSample), ridgeLambda, minSampleCount);
  const withoutModel = fitEmpiricalRevenueModel(withoutTraining.map(toEmpiricalSample), ridgeLambda, minSampleCount);

  const ridgeOnly = withoutModel ? predictEmpiricalRevenue(withoutModel, featuresRaw, target.pcCount, 1, 0) : null;
  const baselineOnly = withoutModel ? predictEmpiricalRevenue(withoutModel, featuresRaw, target.pcCount, 0, 1) : null;
  const blended = withoutModel
    ? predictEmpiricalRevenue(withoutModel, featuresRaw, target.pcCount, ridgeWeight, baselineWeight)
    : null;

  const withoutFeatureCols = withoutTraining.map(toEmpiricalSample).map((s) => s.featuresRaw);
  const isOutOfTrainingRange = featuresRaw.some((v, j) => {
    const col = withoutFeatureCols.map((f) => f[j]);
    if (!col.length) return false;
    return v < Math.min(...col) || v > Math.max(...col);
  });

  return {
    storeCode: target.storeCode,
    storeName: target.storeName,
    featuresRaw,
    sampleCountWith: coreTraining.length,
    sampleCountWithout: withoutTraining.length,
    featureMeansWith: withModel?.featureMeans ?? null,
    featureSdsWith: withModel?.featureSds ?? null,
    coefficientsWith: withModel?.coefficients ?? null,
    featureMeansWithout: withoutModel?.featureMeans ?? null,
    featureSdsWithout: withoutModel?.featureSds ?? null,
    coefficientsWithout: withoutModel?.coefficients ?? null,
    ridgeOnlyPrediction: ridgeOnly?.monthlyRevenue ?? null,
    baselineOnlyPrediction: baselineOnly?.monthlyRevenue ?? null,
    blendedPrediction: blended?.monthlyRevenue ?? null,
    isOutOfTrainingRange,
  };
}
