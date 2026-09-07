import { describe, expect, it } from "vitest";
import { buildV61TrainingStores, computeExistingStoreDemandEvaluation } from "./calc";
import { existingStoreEvaluationPatch, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { evaluateCandidate } from "./evaluate";
import type { CandidateInput, Competitor, ExistingStore, LocationEvaluation } from "./types";

const settings = mergeModelSettings({});
settings.v61Training.modelVariant = "visibility-inflow";
// Only fields consumed by the calculation are populated; cached values are deliberately stale.
const store = {
  storeCode:"S1", originCandidateCode:"N1", storeName:"매장", brandType:"블랙라벨",
  excludedFromModel:false, completedMonths:12, pcCount:100, hourlyRate:1400,
  actualMonthlyRevenueAvg:40000000, competitivenessScore:99, competitivenessGap:99,
  ownDemand:99, marketDemand:99, competitorIp:99, floor:2, groundLevel:"지상", hasElevator:true,
  ownVgaBase:"RTX 5060", ownTeamRoom:2, ownCoupleZone:3, ownVipZone:5, ownFriendsZone:15,
  ownFoodScore:4, ownInteriorScore:4, ownMonitorBase:"240Hz", floating500Avg:50000,
  pop500m:3000, floating500Male:27500,
} as ExistingStore;
const location = {candidateCode:"N1", locationScore:4, preemptionScore:4, visibilityScore:4, inflowRestriction:"강함"} as LocationEvaluation;
const competitor = {
  id:"c1", candidateCode:"N1", name:"경쟁점", totalPcCount:100, appliedPcCount:100,
  monitorBase:"200Hz", foodScore:3, interiorScore:3, managementScore:3,
  surveyLevel:"간략", investigationStatus:"조사완료", floor:2, groundLevel:"지상", hasElevator:true,
} as Competitor;

describe("기존점 파생 입력 갱신", () => {
  it("입지 저장 후 다음 동기화 전에도 학습 점수와 격차가 달라진다", () => {
    const before = prepareExistingStoresForEvaluation([store], [competitor], [location], settings)[0];
    const after = prepareExistingStoresForEvaluation([store], [competitor], [{...location,locationScore:2,preemptionScore:2}], settings)[0];
    expect(after.competitivenessScore).not.toBeNull();
    expect(after.competitivenessScore!).toBeLessThan(before.competitivenessScore!);
    expect(after.competitivenessGap!).toBeLessThan(before.competitivenessGap!);
    expect(buildV61TrainingStores([after], [location], settings)[0].competitivenessScore).toBe(after.competitivenessScore);
    expect(store.competitivenessScore).toBe(99);
    expect(after.actualMonthlyRevenueAvg).toBe(store.actualMonthlyRevenueAvg);
  });

  it("전환 점포는 원본 후보지 자료를 사용하고 가맹점 코드 사본은 합산하지 않는다", () => {
    const prepared = prepareExistingStoresForEvaluation([store], [competitor,{...competitor,id:"other",candidateCode:"S1",appliedPcCount:10000}], [location], settings)[0];
    expect(prepared.competitorIp).toBe(computeExistingStoreDemandEvaluation(store,[competitor],location,settings).competitorIp);
    expect(prepared).toEqual({...store,...existingStoreEvaluationPatch(store,[competitor],location,settings)});
  });

  it("직접 등록한 기존점은 가맹점 코드의 경쟁점과 입지를 사용한다", () => {
    const direct = {...store, originCandidateCode:null};
    const directCompetitor = {...competitor,candidateCode:store.storeCode};
    const directLocation = {...location,candidateCode:store.storeCode};
    const [prepared] = prepareExistingStoresForEvaluation([direct], [competitor,directCompetitor], [location,directLocation], settings);
    expect(prepared).toEqual({...direct,...existingStoreEvaluationPatch(direct,[directCompetitor],directLocation,settings)});
  });

  it("불완전한 원본은 오래된 유효 점수로 되돌리지 않는다", () => {
    const [prepared] = prepareExistingStoresForEvaluation([{...store,ownVgaBase:null}], [competitor], [location], settings);
    expect(prepared.competitivenessScore).toBeNull();
    expect(buildV61TrainingStores([prepared], [location], settings)).toEqual([]);
  });

  it("저장 캐시나 실매출을 바꿔도 파생 입력은 바뀌지 않는다", () => {
    const a = existingStoreEvaluationPatch(store,[competitor],location,settings);
    const b = existingStoreEvaluationPatch({...store,competitivenessScore:1,actualMonthlyRevenueAvg:1},[competitor],location,settings);
    expect(b).toEqual(a);
  });

  it("후보지 예측도 오래된 학습 캐시를 무시하고 최신 입지로 학습한다", () => {
    const stores = Array.from({length:16}, (_, i) => ({...store,storeCode:`S${i}`,originCandidateCode:`N${i}`,pcCount:100+i,hourlyRate:1400+i*10,actualMonthlyRevenueAvg:40000000+i*1000000}));
    const locations = stores.map((s,i) => ({...location,candidateCode:s.originCandidateCode!,visibilityScore:(i%5+1) as LocationEvaluation["visibilityScore"]}));
    const competitors = stores.map(s => ({...competitor,id:s.storeCode,candidateCode:s.originCandidateCode!}));
    const candidate = {...store,code:"NEW",name:"신규",address:"주소",expectedPcCount:100,reviewStatus:"진행"} as unknown as CandidateInput;
    const context = {candidate,competitors:[competitor],locationEvaluation:location,settings,existingStores:stores,trainingCompetitors:competitors,trainingLocationEvaluations:locations};
    const before = evaluateCandidate(context);
    const staleCacheChanged = evaluateCandidate({...context,existingStores:stores.map(s => ({...s,competitivenessScore:500,competitivenessGap:500,marketDemand:1,competitorIp:1}))});
    expect(before.v61IsFallback).toBe(false);
    expect(before.v61TrainingSampleCount).toBe(16);
    expect(staleCacheChanged.v61Baseline).toBe(before.v61Baseline);
    const changed = evaluateCandidate({...context,trainingLocationEvaluations:locations.map(l => ({...l,locationScore:1,preemptionScore:1}))});
    expect(changed.v61TrainedModelExplain!.featureMeans[2]).toBeLessThan(before.v61TrainedModelExplain!.featureMeans[2]);
  });
});
