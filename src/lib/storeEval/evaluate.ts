// 07/05/09 입력값을 모아 13_신규후보지판정 한 행(EvaluationResult)을 만드는 오케스트레이션 함수.
// calc.ts의 순수 함수들을 model-spec.md §6(13_신규후보지판정 전체 21열 명세) 순서 그대로 조합한다.
// 화면(2/3/4/5)에서는 이 함수 하나만 호출하면 된다 - 개별 calc 함수를 화면에서 직접 조합하지 않는다.

import {
  computeBoundedSales,
  computeCompetitivenessGap,
  computeCompetitorAvgCompetitiveness,
  computeCompetitorIp,
  computeCompetitivenessScore,
  computeCompletionStatus,
  computeFinalJudgement,
  computeIpPerDemand,
  computeLocationCompositeScore,
  computeMarketDemand,
  computeMarketGrade,
  computeV61Fallback,
  computeV62Final,
  getV62Rate,
} from "./calc";
import type { CandidateInput, Competitor, EvaluationResult, LocationEvaluation, ModelSettings } from "./types";

export type EvaluateContext = {
  candidate: CandidateInput;
  competitors: Competitor[];
  locationEvaluation: LocationEvaluation | null;
  settings: ModelSettings;
  /** 상권등급(SS/S/A/B) 백분위 계산용 - 기존 검증대상 점포들의 상권수요 목록 (model-spec.md §3.1). */
  existingMarketDemands: number[];
};

export function evaluateCandidate(ctx: EvaluateContext): EvaluationResult {
  const { candidate: c, competitors, locationEvaluation: loc, settings, existingMarketDemands } = ctx;

  const { marketCharacter, marketDemand } = computeMarketDemand(c, settings);
  const marketGrade = computeMarketGrade(marketDemand, existingMarketDemands, settings);
  const competitorIp = computeCompetitorIp(competitors, c.operatingPcStores500m);
  const ipPerDemand = computeIpPerDemand(marketDemand, c.expectedPcCount, competitorIp);

  const ownCompetitivenessScore = computeCompetitivenessScore(
    { spec: c.ownSpecScore, seat: c.ownSeatScore, food: c.ownFoodScore, interior: c.ownInteriorScore, location: c.ownLocationScore },
    settings,
  );
  const competitorAvgCompetitiveness = computeCompetitorAvgCompetitiveness(competitors, settings);
  const competitivenessGap = computeCompetitivenessGap(ownCompetitivenessScore, competitorAvgCompetitiveness);

  const v61Baseline = computeV61Fallback(
    {
      expectedPcCount: c.expectedPcCount,
      hourlyRate: c.hourlyRate,
      marketDemand,
      competitivenessGap,
      competitorIp,
      ownCompetitivenessScore,
    },
    settings,
  );

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

  const result: EvaluationResult = {
    candidateCode: c.code,
    candidateName: c.name,
    address: c.address,
    reviewStatus: c.reviewStatus,
    expectedPcCount: c.expectedPcCount,
    hourlyRate: c.hourlyRate,
    v61Baseline,
    v61IsFallback: true, // 07 Apps Script 계산열을 이식할 수 없어(docs/data-issues.md #1) 폴백식만 사용
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
  };

  return result;
}
