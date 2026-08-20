// 07/05/09 입력값을 모아 13_신규후보지판정 한 행(EvaluationResult)을 만드는 오케스트레이션 함수.
// calc.ts의 순수 함수들을 model-spec.md §6(13_신규후보지판정 전체 21열 명세) 순서 그대로 조합한다.
// 화면(2/3/4/5)에서는 이 함수 하나만 호출하면 된다 - 개별 calc 함수를 화면에서 직접 조합하지 않는다.
//
// 2026-08-20: V61을 더 이상 무조건 computeV61Fallback(폴백 회귀식)로 계산하지 않는다. 기존
// 가맹점(existingStores)에서 학습 가능한 표본을 뽑아 fitEmpiricalRevenueModel로 실제 학습하고,
// 표본이 v61Training.minSampleCount 이상이면 그 모형("V61 실측 학습모형")을 쓴다. 표본이
// 모자랄 때만 폴백을 쓰고, 그 사실을 result.v61IsFallback/v61ModelLabel로 화면에 명시한다.

import {
  buildV61TrainingStores,
  computeAaBaselineRevenue,
  computeBoundedSales,
  computeCompetitivenessGap,
  computeCompetitorAvgCompetitiveness,
  computeCompetitorIp,
  computeCompetitivenessScore,
  computeCompetitorOccupiedSeats,
  computeCompletionStatus,
  computeExpectedOccupiedSeats,
  computeExpectedOwnDemand,
  computeExpectedUtilization,
  computeFinalJudgement,
  computeIpPerDemand,
  computeLocationCompositeScore,
  computeLocationScoreFromFacts,
  computeMarketDemand,
  computeMarketGrade,
  computeMeasuredForecast,
  computeSeatScore,
  computeSpecScore,
  computeV61Fallback,
  computeV62Final,
  computeZoneComposition,
  empiricalFeaturesFor,
  fitEmpiricalRevenueModel,
  GAME_ZONE_BONUS,
  getV62Rate,
  judgeAaGrade,
  lookupDemandCapture,
  predictEmpiricalRevenue,
  toEmpiricalSample,
} from "./calc";
import type { CandidateInput, Competitor, EvaluationResult, ExistingStore, LocationEvaluation, ModelSettings } from "./types";

export type EvaluateContext = {
  candidate: CandidateInput;
  competitors: Competitor[];
  locationEvaluation: LocationEvaluation | null;
  settings: ModelSettings;
  /** 상권등급(SS/S/A/B) 백분위 계산용 - 기존 검증대상 점포들의 상권수요 목록 (model-spec.md §3.1). */
  existingMarketDemands: number[];
  /** V61 실측 학습모형의 학습표본 원천 - 블랙라벨·정상영업·산식학습제외 아닌 기존 가맹점 전체를 넘긴다. */
  existingStores: ExistingStore[];
};

export function evaluateCandidate(ctx: EvaluateContext): EvaluationResult {
  const { candidate: c, competitors, locationEvaluation: loc, settings, existingMarketDemands, existingStores } = ctx;

  const { marketCharacter, marketDemand } = computeMarketDemand(c, settings);
  const marketGrade = computeMarketGrade(marketDemand, existingMarketDemands, settings);
  const competitorIp = computeCompetitorIp(competitors, c.operatingPcStores500m);
  const ipPerDemand = computeIpPerDemand(marketDemand, c.expectedPcCount, competitorIp);

  const { kinds: ownKinds, rooms: ownRooms } = computeZoneComposition(
    [c.ownRoom1, c.ownRoom2, c.ownTeamRoom, c.ownCoupleZone, c.ownVipZone],
    [c.ownFriendsZone],
  );
  const ownSpecScore = computeSpecScore(
    c.ownVgaBase,
    c.ownVgaTop,
    (c.ownGameZoneCount ?? 0) * GAME_ZONE_BONUS,
    c.ownMonitorScore,
    settings,
  );
  const ownSeatScore = computeSeatScore(ownKinds, ownRooms);
  const ownLocationScore = computeLocationScoreFromFacts(c.floor, c.groundLevel, c.hasElevator);

  const ownCompetitivenessScore = computeCompetitivenessScore(
    { spec: ownSpecScore, seat: ownSeatScore, food: c.ownFoodScore, interior: c.ownInteriorScore, location: ownLocationScore },
    settings,
  );
  const competitorAvgCompetitiveness = computeCompetitorAvgCompetitiveness(competitors, settings);
  const competitivenessGap = computeCompetitivenessGap(ownCompetitivenessScore, competitorAvgCompetitiveness);

  // ---- V61: 실측 학습모형 우선, 표본 부족 시에만 폴백 ----
  const trainingStores = buildV61TrainingStores(existingStores);
  const trainingSamples = trainingStores.map(toEmpiricalSample);
  const trainedModel = fitEmpiricalRevenueModel(trainingSamples, settings.v61Training.ridgeLambda, settings.v61Training.minSampleCount);

  const expectedOwnDemand = computeExpectedOwnDemand(marketDemand, c.expectedPcCount, competitivenessGap, competitorIp);

  let v61Baseline: number | null = null;
  let v61IsFallback = true;
  if (trainedModel && c.expectedPcCount && c.hourlyRate != null && expectedOwnDemand != null && ownCompetitivenessScore != null) {
    const prediction = predictEmpiricalRevenue(
      trainedModel,
      empiricalFeaturesFor({
        hourlyRate: c.hourlyRate,
        ownDemand: expectedOwnDemand,
        pcCount: c.expectedPcCount,
        competitivenessScore: ownCompetitivenessScore,
      }),
      c.expectedPcCount,
      settings.v61Training.ridgeWeight,
      settings.v61Training.baselineWeight,
    );
    if (prediction) {
      v61Baseline = prediction.monthlyRevenue;
      v61IsFallback = false;
    }
  }
  if (v61Baseline == null) {
    v61Baseline = computeV61Fallback(
      { expectedPcCount: c.expectedPcCount, hourlyRate: c.hourlyRate, marketDemand, competitivenessGap, competitorIp, ownCompetitivenessScore },
      settings,
    );
    v61IsFallback = true;
  }

  const locationScore = loc
    ? computeLocationCompositeScore(
        { withinMarket: loc.locationScore, flow: loc.flowScore, preemption: loc.preemptionScore, visibility: loc.visibilityScore },
        settings,
      )
    : null;
  const inflowRestriction = loc?.inflowRestriction ?? null;
  const brandType = loc?.brandType ?? null;

  const v62Rate = getV62Rate(inflowRestriction, settings);
  const v62Final = computeV62Final(v61Baseline, v62Rate);
  const { conservativeSales, upperSales } = computeBoundedSales(v62Final, settings);

  const completionStatus = computeCompletionStatus({
    v61: v61Baseline,
    locationScore,
    inflowRestriction,
    brandType,
    brandFilter: settings.brandFilter,
  });
  const finalJudgement = computeFinalJudgement({
    completionStatus,
    v62Final,
    ipPerDemand,
    inflowRestriction,
    saturationThreshold: settings.saturationThreshold,
  });

  // ---- 실측기반 예상월매출 파이프라인 (요청사항 3) ----
  const occupied = computeCompetitorOccupiedSeats(competitors);
  const capture = lookupDemandCapture(competitivenessGap, settings.demandCaptureTable);
  const expectedOccupiedSeats = computeExpectedOccupiedSeats(occupied.seats, capture?.captureRate ?? null, capture?.growthRate ?? null);
  const expectedUtilization = computeExpectedUtilization(expectedOccupiedSeats, c.expectedPcCount);
  const measuredForecast = computeMeasuredForecast(expectedOccupiedSeats, c.hourlyRate, settings.measuredForecastProductRatio, c.expectedPcCount);

  // ---- AA 기준매출 (요청사항 4) ----
  const aaBaselineRevenue = computeAaBaselineRevenue(c.expectedPcCount, c.plannedOpenMonth, settings.aaMonthlyTargets, settings.aaMaxPcCount);
  const aaJudgement = judgeAaGrade({
    plannedOpenMonth: c.plannedOpenMonth,
    measuredForecastRevenue: measuredForecast?.monthlyRevenue ?? null,
    aaBaselineRevenue,
    expectedUtilization,
    maxReviewUtilization: settings.measuredForecastMaxReviewUtilization,
  });

  const result: EvaluationResult = {
    candidateCode: c.code,
    candidateName: c.name,
    address: c.address,
    reviewStatus: c.reviewStatus,
    expectedPcCount: c.expectedPcCount,
    hourlyRate: c.hourlyRate,
    v61Baseline,
    v61IsFallback,
    v61ModelLabel: v61IsFallback ? "임시 근사치·검증 전" : "V61 실측 학습모형",
    v61TrainingSampleCount: trainingStores.length,
    v61ValidationMeanAbsError: null, // 후보지 평가 화면에서는 채우지 않는다 - 검증 화면(validation/page.tsx)에서 별도 계산
    locationScore,
    inflowRestriction,
    v62Rate,
    v62Final,
    conservativeSales,
    upperSales,
    marketDemand,
    marketGrade,
    marketCharacter,
    competitorIp,
    ipPerDemand,
    competitivenessGap,
    completionStatus,
    finalJudgement,
    modelVersion: settings.modelVersion,
    settingsSnapshotId: settings.id,
    calculatedAt: Date.now(),

    competitorOccupiedSeats: occupied.seats,
    competitorOccupiedSeatsCoverage: occupied.coverage,
    demandCaptureRate: capture?.captureRate ?? null,
    newDemandGrowthRate: capture?.growthRate ?? null,
    expectedOccupiedSeats,
    expectedUtilization,
    expectedDailyRevenuePerPc: measuredForecast?.dailyRevenuePerPc ?? null,
    measuredForecastMonthlyRevenue: measuredForecast?.monthlyRevenue ?? null,
    measuredForecastNeedsReview: aaJudgement === "데이터 재검토",

    aaBaselineRevenue,
    aaJudgement,
  };

  return result;
}
