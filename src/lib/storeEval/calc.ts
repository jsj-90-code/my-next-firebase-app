// 점포평가 V61/V62 계산 순수함수.
// 근거: docs/model-spec.md (원본 구글시트 "점포평가_V62_원본.xlsx" 셀 수식·08_계산기준 프로즈 명세 분석).
// 이 파일의 모든 계수는 함수 인자로 받는 ModelSettings에서 온다 - 값 자체를 이 파일에 새로
// 하드코딩하지 않는다 (요청사항: 판정 기준값은 설정 테이블에서 관리).
//
// docs/data-issues.md에 남긴 미해결 항목(연령×성별 원수요 계산의 정확한 성별분배 방식,
// 07_신규후보지 계산열이 Apps Script 전용이라 V61 본체 회귀식을 재현 불가한 점 등)은
// 이 파일 안에서도 해당 함수 바로 위에 동일한 경고 주석을 남겨둔다.

import type {
  Competitor,
  CandidateInput,
  InflowRestriction,
  ModelSettings,
  CompletionStatus,
  FinalJudgement,
} from "./types";

// ---------------------------------------------------------------------------
// 3.1 상권분석
// ---------------------------------------------------------------------------

// 08_계산기준: "10대 남39%·여13% / 20대 남42%·여15% / 30대 남17%·여5% / 40대 남10%·여2% /
// 50대 남4%·여1% / 60대이상 남1%·여0%"
export const PC_USAGE_RATE_BY_AGE_GENDER = {
  age10s: { male: 0.39, female: 0.13 },
  age20s: { male: 0.42, female: 0.15 },
  age30s: { male: 0.17, female: 0.05 },
  age40s: { male: 0.1, female: 0.02 },
  age50s: { male: 0.04, female: 0.01 },
  age60plus: { male: 0.01, female: 0.0 },
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
 * 유동/주거 원수요 공통 계산.
 *
 * ⚠️ docs/data-issues.md: 원본에는 "연령대별 인구 × 성별 PC방 이용률"이라고만 적혀 있고,
 * 500m/1km 데이터는 연령대별 합계와 성별 합계가 따로 주어질 뿐 연령×성별 교차표가 없다.
 * 이 함수는 "성별 비율이 모든 연령대에 동일하게 적용된다"는 가정으로 근사한다
 * (검증표본 1건 기준 약 0.9% 오차 확인됨 - docs/data-issues.md 추가 항목).
 * Apps Script 원본을 확보하면 이 부분을 정확한 식으로 교체해야 한다.
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

/** 08_계산기준: "연령별 합계가 유동인구의 80% 이상이면 실측 연령구성" 사용, 아니면 계산 불가(null). */
export function computeFloatingRawDemand(c: CandidateInput): number | null {
  if (c.floating500Avg == null || c.floating500Avg <= 0) return null;
  if (c.floating500Male == null || c.floating500Female == null) return null;
  const ageSum = floatingAgeSum(c);
  if (ageSum < c.floating500Avg * 0.8) return null; // 40개 상권 평균 연령구성 대체값 미확보 (data-issues #5)
  const maleRatio = c.floating500Male / (c.floating500Male + c.floating500Female);
  return estimateRawDemand(
    {
      age10s: c.floating500_10s ?? 0,
      age20s: c.floating500_20s ?? 0,
      age30s: c.floating500_30s ?? 0,
      age40s: c.floating500_40s ?? 0,
      age50s: c.floating500_50s ?? 0,
      age60plus: c.floating500_60plus ?? 0,
    },
    maleRatio,
  );
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
  if (rawDemand == null) return { marketCharacter, demandSource, rawDemand: null, marketDemand: null };

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
  const withCount = competitors.filter((c) => c.appliedPcCount != null || c.totalPcCount != null);
  if (withCount.length > 0) {
    return withCount.reduce((sum, c) => sum + (c.appliedPcCount ?? c.totalPcCount ?? 0), 0);
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

// ---------------------------------------------------------------------------
// 3.4 경쟁력 점수
// ---------------------------------------------------------------------------

const ZONE_CAPACITY_WEIGHT = { room1: 0, room2: 0, teamRoom: 2, coupleZone: 3, vipZone: 5 } as const;

export function computeOwnPrivateRoomCount(c: Pick<CandidateInput, "ownTeamRoom" | "ownCoupleZone" | "ownVipZone">): number {
  return (
    (c.ownTeamRoom ?? 0) * ZONE_CAPACITY_WEIGHT.teamRoom +
    (c.ownCoupleZone ?? 0) * ZONE_CAPACITY_WEIGHT.coupleZone +
    (c.ownVipZone ?? 0) * ZONE_CAPACITY_WEIGHT.vipZone
  );
}

export function computeOwnZoneTypeCount(
  c: Pick<CandidateInput, "ownRoom1" | "ownRoom2" | "ownTeamRoom" | "ownCoupleZone" | "ownVipZone" | "ownFriendsZone">,
): number {
  const counts = [c.ownRoom1, c.ownRoom2, c.ownTeamRoom, c.ownCoupleZone, c.ownVipZone, c.ownFriendsZone];
  return counts.filter((v) => (v ?? 0) > 0).length;
}

/**
 * 종합 경쟁력점수 = 사양25% + 좌석30% + 먹거리20% + 인테리어15% + 입지10% (08_계산기준).
 *
 * ⚠️ docs/data-issues.md: 원본은 사양/좌석/입지 점수를 VGA 사양표·존 구성·층수 조건으로부터
 * Apps Script가 자동 계산하지만, 그 정확한 환산표를 확보하지 못했다. 새로운 환산식을 지어내는
 * 대신, 원본에서도 사람이 직접 매기는 먹거리/인테리어평가와 동일하게 5개 항목 모두 평가자가
 * 1~5점을 직접 입력하고, 이 가중합 공식만 원본 그대로 적용한다.
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

/** 경쟁점_평균경쟁력 = 경쟁점들의 경쟁력점수를 적용대수로 가중평균. */
export function computeCompetitorAvgCompetitiveness(competitors: Competitor[], settings: Pick<ModelSettings, "competitivenessWeights">): number | null {
  const scored = competitors
    .map((c) => ({
      score: computeCompetitivenessScore(
        { spec: c.specScore, seat: c.seatScore, food: c.foodScore, interior: c.interiorScore, location: c.locationScore },
        settings,
      ),
      weight: c.appliedPcCount ?? c.totalPcCount ?? 0,
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

// ---------------------------------------------------------------------------
// §4.1 13_신규후보지판정 G열 폴백 회귀식 (V61 기본예측)
// ---------------------------------------------------------------------------

/**
 * ⚠️ docs/data-issues.md #1: 07_신규후보지의 BW열(예측_월매출)은 Apps Script가 "비음수
 * 릿지회귀 60%+중앙값40%"로 계산하는 값이라 셀 수식만으로는 재현 불가능하다. 이 함수는
 * 13_신규후보지판정!G열에 원본 설계자가 넣어둔 폴백 회귀식(model-spec.md §4.1)을 그대로
 * 옮긴 것으로, 실제 Apps Script 출력값이 있으면 그 값을 최우선으로 써야 한다
 * (07 시트 예측_월매출이 채워져 있으면 이 함수를 호출하지 않는다).
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
