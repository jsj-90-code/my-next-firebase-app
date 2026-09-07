import { describe, expect, it } from "vitest";
import { buildV61TrainingStores, diagnoseLoocvSensitivity, empiricalFeaturesFor, fitEmpiricalRevenueModel, predictEmpiricalRevenue, runCohortValidation, toEmpiricalSample, toV61TrainingStore, type ValidationStoreInput } from "./calc";
import { mergeModelSettings } from "./settings";
import type { ExistingStore, LocationEvaluation } from "./types";

const settings = mergeModelSettings({});
settings.v61Training = { ...settings.v61Training, modelVariant: "visibility-inflow", minVisibilityCoef: .05, ridgeLambda: 10, ridgeWeight: 1, baselineWeight: 0 };
function row(index: number): ValidationStoreInput {
  return {
    storeCode: `S${index}`, storeName: `매장${index}`, brand: "블랙라벨", openedAt: "2024-01-01", completedMonths: 12,
    franchiseStatus: "정상", isPostOpenIssue: false, postOpenIssueReason: null,
    pcCount: 100 + index, hourlyRate: 1000 + index * 30, ownDemand: 1000,
    marketDemand: 2000 + index * 60, competitorIp: 200, competitivenessScore: 3 + index / 20,
    competitivenessGap: 1.1, actualRevenueAvg: 40000000 + index * 1000000,
    specialDemandType: "없음", inflowRestriction: index % 3 === 0 ? "강함" : "없음", visibilityScore: index % 5 + 1,
  };
}
const rows = Array.from({length:16}, (_,i) => row(i));

describe("가시성 모형의 학습·검증 경로", () => {
  it("실매출은 보존하고 학습 목표에서만 외부유입 차감을 분리한다", () => {
    const source = row(0);
    const sample = toEmpiricalSample(toV61TrainingStore(source, settings));
    expect(sample.revenuePerPc).toBe(source.actualRevenueAvg! / source.pcCount! / .8);
    expect(sample.featuresRaw).toHaveLength(6);
    expect(source.actualRevenueAvg).toBe(40000000);
    expect(toEmpiricalSample(toV61TrainingStore(source)).featuresRaw).toHaveLength(5);
  });

  it("검증 대상 실매출을 바꿔도 해당 점포의 제외 학습 예측은 바뀌지 않는다", () => {
    const before = runCohortValidation(rows, settings).rows[0];
    const after = runCohortValidation(rows.map((r,i) => i === 0 ? {...r, actualRevenueAvg: r.actualRevenueAvg! * 2} : r), settings).rows[0];
    expect(before.predictedRevenueAvg).not.toBeNull();
    expect(after.predictedRevenueAvg).toBe(before.predictedRevenueAvg);
    expect(after.errorAmount).not.toBe(before.errorAmount);
    expect(before.v62PredictedRevenueAvg).toBeCloseTo(before.predictedRevenueAvg! * .8, 0);
  });

  it("가시성이 없으면 점수를 지어내거나 정식 정확도에 포함하지 않는다", () => {
    const incomplete = rows.map((r,i) => i === 0 ? {...r, visibilityScore: null} : r);
    const result = runCohortValidation(incomplete, settings).rows[0];
    expect(result.predictedRevenueAvg).toBeNull();
    expect(result.includedInCoreAccuracy).toBe(false);
    expect(result.exclusionReason).toContain("접근가시성 미평가");
    expect(diagnoseLoocvSensitivity("S0", incomplete, settings)).toBeNull();
  });

  it("진단 화면이 본 검증과 같은 6개 특징과 정규화 목표를 사용한다", () => {
    const result = runCohortValidation(rows, settings).rows[0];
    const diagnostic = diagnoseLoocvSensitivity("S0", rows, settings)!;
    expect(diagnostic.featuresRaw).toHaveLength(6);
    expect(diagnostic.blendedPrediction).toBe(result.predictedRevenueAvg);
  });

  it("기존점의 원본 후보지코드로 가시성을 연결하고 미평가·미완료월 표본을 제외한다", () => {
    // This fixture contains only fields read by the training adapter.
    const store = {storeCode:"S1", storeName:"매장", originCandidateCode:"N1", brandType:"블랙라벨", excludedFromModel:false, completedMonths:12,
      pcCount:100, hourlyRate:1200, marketDemand:3000, competitorIp:200, competitivenessScore:3, actualMonthlyRevenueAvg:40000000} as ExistingStore;
    const locations = [{candidateCode:"N1", visibilityScore:4, inflowRestriction:"강함"}] as LocationEvaluation[];
    const trained = buildV61TrainingStores([store], locations, settings);
    expect(trained[0].visibilityScore).toBe(4);
    expect(toEmpiricalSample(trained[0]).revenuePerPc).toBe(500000);
    expect(buildV61TrainingStores([store], [], settings)).toEqual([]);
    expect(buildV61TrainingStores([{...store, completedMonths:0}], locations, settings)).toEqual([]);
    expect(buildV61TrainingStores([store])).toHaveLength(1);
  });

  it("서로 다른 특징 개수나 유효하지 않은 학습 목표로 숫자를 생성하지 않는다", () => {
    const samples = rows.map(r => toEmpiricalSample(toV61TrainingStore(r, settings)));
    const model = fitEmpiricalRevenueModel(samples, 10, 12)!;
    expect(predictEmpiricalRevenue(model, empiricalFeaturesFor(toV61TrainingStore(rows[0])), 100, 1, 0)).toBeNull();
    expect(fitEmpiricalRevenueModel([{...samples[0], revenuePerPc:Infinity}, ...samples.slice(1)], 10, 12)).toBeNull();
  });
});
