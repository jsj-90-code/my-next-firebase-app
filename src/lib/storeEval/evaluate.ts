// 07/05/09 입력값을 모아 13_신규후보지판정 한 행(EvaluationResult)을 만드는 오케스트레이션 함수.
// calc.ts의 순수 함수들을 model-spec.md §6(13_신규후보지판정 전체 21열 명세) 순서 그대로 조합한다.
// 화면(2/3/4/5)에서는 이 함수 하나만 호출하면 된다 - 개별 calc 함수를 화면에서 직접 조합하지 않는다.
//
// 2026-08-20: V61을 더 이상 무조건 computeV61Fallback(폴백 회귀식)로 계산하지 않는다. 기존
// 가맹점(existingStores)에서 학습 가능한 표본을 뽑아 fitEmpiricalRevenueModel로 실제 학습하고,
// 표본이 v61Training.minSampleCount 이상이면 그 모형("V61 실측 학습모형")을 쓴다. 표본이
// 모자랄 때만 폴백을 쓰고, 그 사실을 result.v61IsFallback/v61ModelLabel로 화면에 명시한다.

import {
  applyCapacityCeiling,
  applyStandardOwnFacilityDefaults,
  buildMinCoefficients,
  buildV61TrainingStores,
  computeAaBaselineRevenue,
  computeBoundedSales,
  computeCapacityOverflowRevenueBonus,
  computeCompetitivenessGap,
  computeCompetitorAppliedPcCount,
  computeCompetitorAvgCompetitiveness,
  computeCompetitorIp,
  computeCompetitivenessScore,
  computeCompetitorOccupiedSeats,
  computeCompetitorScores,
  computeCompletionStatus,
  computeExpectedOccupiedSeats,
  computeExpectedOwnDemand,
  computeExpectedUtilization,
  computeFacilityScore,
  computeFinalJudgement,
  computeFoodScore,
  computeIpPerDemand,
  computeLocationCompositeScore,
  computeMarketDemand,
  computeMarketGrade,
  computeImpliedUtilizationFromRevenue,
  computeMeasuredForecast,
  computeOwnLocationScore,
  computeOwnZoneComposition,
  redistributeCapacityConstrainedDemand,
  resolveZoneCompositionScore,
  computeSpecScore,
  computeV61Fallback,
  computeV62Final,
  empiricalFeaturesFor,
  fitEmpiricalRevenueModel,
  isBackingDemandMarket,
  getV62Rate,
  judgeAaGrade,
  lookupDemandCapture,
  predictEmpiricalRevenue,
  toEmpiricalSample,
} from "./calc";
import { defaultModelSettings } from "./settings";
import type {
  CandidateInput,
  Competitor,
  EvaluationResult,
  ExistingStore,
  LocationEvaluation,
  ModelSettings,
  V61TrainedModelExplain,
} from "./types";

export type EvaluateContext = {
  candidate: CandidateInput;
  competitors: Competitor[];
  locationEvaluation: LocationEvaluation | null;
  settings: ModelSettings;
  /** V61 실측 학습모형의 학습표본 원천 - 블랙라벨·산식학습제외 아닌 기존 가맹점 전체를 넘긴다. */
  existingStores: ExistingStore[];
};

export function evaluateCandidate(ctx: EvaluateContext): EvaluationResult {
  const { candidate: c, competitors, locationEvaluation: loc, settings, existingStores } = ctx;

  const { marketCharacter, marketDemand } = computeMarketDemand(c, settings);
  const marketGrade = computeMarketGrade(marketDemand, settings);
  const competitorIp = computeCompetitorIp(competitors, c.operatingPcStores500m);
  const ipPerDemand = computeIpPerDemand(marketDemand, c.expectedPcCount, competitorIp);

  // 자사 시설 입력값이 비어 있으면 회사 표준 존 구성으로 간주한다(07_신규후보지 헤더 메모
  // "비우면 표준 N개 적용" 근거, docs/data-issues.md 2026-08-21 갱신). 1인룸/2인룸은 표준값이
  // 없어(비우면 그대로 0) 대상이 아니다.
  const ownFacility = applyStandardOwnFacilityDefaults(c);
  const ownSpecScore = computeSpecScore(
    {
      vgaBase: c.ownVgaBase,
      vgaTop: c.ownVgaTop,
      vgaTop2: c.ownVgaTop2,
      cpu: c.ownCpu,
      cpuTop1: c.ownCpuTop1,
      cpuTop2: c.ownCpuTop2,
      ram: c.ownRam,
      ramTop: c.ownRamTop,
      monitorBase: c.ownMonitorBase,
      monitorTop: c.ownMonitorTop,
    },
    settings,
  );
  // 2026-08-30(경쟁력 평가 기준 최종본 §12) — 자사/후보지의 입지10% 컴포넌트는 09_입지동선평가
  // (4요소 조합)가 있으면 그걸 쓰고, 없으면 층수+엘리베이터 자동계산으로 폴백한다(경쟁점은 기존
  // 방식 유지 — computeCompetitorScores 참고).
  const ownLocationScore = computeOwnLocationScore(loc, c, settings);
  const ownFoodScore = computeFoodScore({ brand: c.ownFoodBrand, legacyScore: ownFacility.ownFoodScore }, settings);
  // 2026-08-31 — 존구성/인테리어/관리 3항목 결합(computeFacilityScore)으로 전면 교체(§ 시설평가
  // 산식 개편). 존구성은 새 공식(computeOwnZoneComposition)으로 자동계산하고, 전혀 조사 안 됐으면
  // 기존 종합평가 직접입력(ownSeatZoneScore)으로 폴백한다.
  const ownZoneComposition = resolveZoneCompositionScore(
    computeOwnZoneComposition({
      counts: {
        singleSeatCount: ownFacility.ownSingleSeatCount,
        room1: ownFacility.ownRoom1,
        room2: ownFacility.ownRoom2,
        teamRoom: ownFacility.ownTeamRoom,
        coupleZone: ownFacility.ownCoupleZone,
        vipZone: ownFacility.ownVipZone,
        friendsZone: ownFacility.ownFriendsZone,
        firstClassZone: ownFacility.ownFirstClassZone,
      },
      teamRoomTotalSeats: c.ownTeamRoomTotalSeats,
      totalPcCount: c.expectedPcCount,
    }).composition,
    c.ownSeatZoneScore,
  );
  const ownInteriorScore = computeFacilityScore(
    {
      zoneComposition: ownZoneComposition,
      interiorScore: ownFacility.ownInteriorScore,
      managementScore: ownFacility.ownManagementScore,
    },
    settings,
  );

  const ownCompetitivenessScore = computeCompetitivenessScore(
    { spec: ownSpecScore, food: ownFoodScore, interior: ownInteriorScore, location: ownLocationScore },
    settings,
  );
  const competitorAvgCompetitiveness = computeCompetitorAvgCompetitiveness(competitors, settings);
  const competitivenessGap = computeCompetitivenessGap(ownCompetitivenessScore, competitorAvgCompetitiveness);

  // ---- V61: 실측 학습모형 우선, 표본 부족 시에만 폴백 ----
  const trainingStores = buildV61TrainingStores(existingStores);
  const trainingSamples = trainingStores.map(toEmpiricalSample);
  const trainedModel = fitEmpiricalRevenueModel(
    trainingSamples,
    settings.v61Training.ridgeLambda,
    settings.v61Training.minSampleCount,
    buildMinCoefficients(settings.v61Training),
  );

  const expectedOwnDemand = computeExpectedOwnDemand(marketDemand, c.expectedPcCount, competitivenessGap, competitorIp);

  let v61Baseline: number | null = null;
  let v61IsFallback = true;
  let v61TrainedModelExplain: V61TrainedModelExplain | null = null;
  if (trainedModel && c.expectedPcCount && c.hourlyRate != null && marketDemand != null && ownCompetitivenessScore != null) {
    const featuresRaw = empiricalFeaturesFor({
      hourlyRate: c.hourlyRate,
      marketDemand,
      competitorIp,
      pcCount: c.expectedPcCount,
      competitivenessScore: ownCompetitivenessScore,
      competitivenessGap,
      // 특수수요는 CandidateInput이 아니라 09_입지동선평가(LocationEvaluation)에 있다 —
      // 이미 입지동선평가 탭에서 입력받는 값이라 새 입력 필드가 필요 없다.
      specialDemandType: loc?.specialDemandType ?? null,
    });
    const prediction = predictEmpiricalRevenue(
      trainedModel,
      featuresRaw,
      c.expectedPcCount,
      settings.v61Training.ridgeWeight,
      settings.v61Training.baselineWeight,
    );
    if (prediction) {
      v61Baseline = prediction.monthlyRevenue;
      v61IsFallback = false;
      v61TrainedModelExplain = {
        sampleCount: trainedModel.sampleCount,
        // 2026-09-03 — 2번째 피처가 "상권수요/자사PC"에서 "IP당수요(상권수요/(자사PC+경쟁IP))"로
        // 바뀌었다(calc.ts empiricalFeaturesFor 주석 참고). 라벨과 실제값 둘 다 같이 고쳐야 한다 —
        // 예전에 이 배열이 실제 피처 구성과 어긋난 채 몇 달간 방치된 적이 있다.
        featureLabels: [
          "시간당요금",
          "IP당수요(상권수요/(자사PC+경쟁IP))",
          "경쟁력점수",
          "경쟁력점수×경쟁력격차",
          "배후수요상권(군부대·산업단지)",
        ],
        featureRealValues: [
          c.hourlyRate,
          marketDemand / (c.expectedPcCount + competitorIp),
          ownCompetitivenessScore,
          competitivenessGap ?? 1,
          isBackingDemandMarket(loc?.specialDemandType) ? 1 : 0,
        ],
        featureModelValues: featuresRaw,
        featureMeans: trainedModel.featureMeans,
        featureSds: trainedModel.featureSds,
        featureZValues: prediction.explain.z,
        coefficients: trainedModel.coefficients,
        yMean: trainedModel.yMean,
        logPerPc: prediction.explain.logPerPc,
        ridgeRevenue: prediction.explain.ridgeRevenue,
        perPcMedian: trainedModel.perPcMedian,
        baselineRevenue: prediction.explain.baselineRevenue,
        ridgeWeight: settings.v61Training.ridgeWeight,
        baselineWeight: settings.v61Training.baselineWeight,
        pcCount: c.expectedPcCount,
      };
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
        { marketPositionFlow: loc.locationScore, preemption: loc.preemptionScore, visibility: loc.visibilityScore },
        settings,
      )
    : null;
  const inflowRestriction = loc?.inflowRestriction ?? null;
  const brandType = loc?.brandType ?? null;

  const v62Rate = getV62Rate(inflowRestriction, settings);
  const v62RegressionOnly = computeV62Final(v61Baseline, v62Rate);

  // 2026-08-30(사용자 확인: "경쟁점도 상한 넘는 경우 있을 거 아냐, 그럼 그 초과분은 자사로
  // 와야지") — 경쟁점별로 PC대수×경쟁력점수 비례배분 후, 개별 경쟁점이 자기 물리적 상한을
  // 넘겨 못 받는 수요를 자사로 재배분한다. redistributeCapacityConstrainedDemand 주석 참고.
  const competitorCapacityInputs = competitors.map((comp) => ({
    pcCount: computeCompetitorAppliedPcCount(comp),
    competitivenessScore: computeCompetitorScores(comp, settings).total,
  }));
  const demandRedistribution = redistributeCapacityConstrainedDemand(
    marketDemand,
    { pcCount: c.expectedPcCount, competitivenessScore: ownCompetitivenessScore },
    competitorCapacityInputs,
    settings,
  );
  const extraCustomersFromCompetitorOverflow =
    demandRedistribution.ownDemandAfterRedistribution != null && demandRedistribution.ownDemandBeforeRedistribution != null
      ? demandRedistribution.ownDemandAfterRedistribution - demandRedistribution.ownDemandBeforeRedistribution
      : 0;
  const competitorOverflowRevenueBonus = computeCapacityOverflowRevenueBonus(extraCustomersFromCompetitorOverflow, c.hourlyRate, settings);
  const v62FinalBeforeCap = v62RegressionOnly != null ? v62RegressionOnly + competitorOverflowRevenueBonus : null;

  // 2026-08-30(사용자 확인) — 물리적 가동률 상한(기본 55%). applyCapacityCeiling 주석 참고.
  // 위 보너스를 더한 뒤에도 자사 상한은 다시 확인한다(이중 안전장치).
  const capacity = applyCapacityCeiling(v62FinalBeforeCap, c.hourlyRate, c.expectedPcCount, settings);
  const v62Final = capacity.cappedRevenue;
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
  // 2026-08-27 — V62 최종예상월매출(v62Final, 위에서 이미 계산됨)을 같은 공식으로 거꾸로 풀어 "이
  // 매출이 나오려면 가동률이 몇%여야 하는가"를 구한다. 경쟁점 실측(핑봇) 데이터 품질과 무관하게
  // V62 자체와 항상 정합적이다(사용자 질문: "예상매출액 있으니 그걸로 가동률 환산하면 되잖아").
  const v62ImpliedUtilization = computeImpliedUtilizationFromRevenue(
    v62Final,
    c.hourlyRate,
    settings.measuredForecastProductRatio,
    c.expectedPcCount,
  );

  // ---- AA 기준매출 (요청사항 4) — 2,000/1,500/1,000만원 3단계, 전부 같은 산식(PC대수 100대 상한
  // 포함)이고 월별기준표만 다르다. 1,500만원표는 defaultModelSettings에 없을 수 있는 옛 저장값
  // 대비 폴백을 둔다(신규 필드라 기존 Firestore 문서엔 없을 수 있음).
  const aaBaselineRevenue = computeAaBaselineRevenue(c.expectedPcCount, c.plannedOpenMonth, settings.aaMonthlyTargets, settings.aaMaxPcCount);
  const aaBaselineRevenue1500 = computeAaBaselineRevenue(
    c.expectedPcCount,
    c.plannedOpenMonth,
    settings.aaMonthlyTargets1500 ?? defaultModelSettings().aaMonthlyTargets1500,
    settings.aaMaxPcCount,
  );
  const aaBaselineRevenue1000 = computeAaBaselineRevenue(
    c.expectedPcCount,
    c.plannedOpenMonth,
    settings.aaMonthlyTargets1000 ?? defaultModelSettings().aaMonthlyTargets1000,
    settings.aaMaxPcCount,
  );
  const aaJudgement = judgeAaGrade({
    plannedOpenMonth: c.plannedOpenMonth,
    forecastRevenue: v62Final,
    aaBaselineRevenue2000: aaBaselineRevenue,
    aaBaselineRevenue1500,
    aaBaselineRevenue1000,
  });
  // "데이터 재검토"는 이제 aaJudgement가 아니라 AA경로 자체의 가동률 초과 여부로 직접 판단한다
  // (judgeAaGrade는 더 이상 AA경로를 안 봄 — 위 주석 참고).
  const measuredForecastNeedsReview = expectedUtilization != null && expectedUtilization > settings.measuredForecastMaxReviewUtilization;

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
    v61TrainedModelExplain,
    locationScore,
    inflowRestriction,
    v62Rate,
    v62Final,
    v62FinalBeforeCap,
    capacityCapped: capacity.capacityCapped,
    competitorOverflowRevenueBonus,
    conservativeSales,
    upperSales,
    marketDemand,
    marketGrade,
    marketCharacter,
    competitorIp,
    ipPerDemand,
    competitivenessGap,
    ownCompetitivenessScore,
    competitorAvgCompetitiveness,
    expectedOwnDemand,
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
    measuredForecastNeedsReview,
    v62ImpliedUtilization,

    aaBaselineRevenue,
    aaBaselineRevenue1500,
    aaBaselineRevenue1000,
    aaJudgement,
  };

  return result;
}
