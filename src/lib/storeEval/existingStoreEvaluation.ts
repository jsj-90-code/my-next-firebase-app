import { computeExistingStoreDemandEvaluation } from "./calc";
import type { Competitor, ExistingStore, LocationEvaluation, ModelSettings } from "./types";

/** Conversion keeps related documents under the original candidate code (store.ts). */
export function existingStoreSourceCode(store: Pick<ExistingStore, "originCandidateCode" | "storeCode">): string {
  return store.originCandidateCode ?? store.storeCode;
}

/** Derived fields are caches, not historical observations. Rebuild before training. */
export function existingStoreEvaluationPatch(
  store: ExistingStore,
  competitors: Competitor[],
  location: LocationEvaluation | null,
  settings: ModelSettings,
) {
  const result = computeExistingStoreDemandEvaluation(store, competitors, location, settings);
  return {
    competitivenessScore: result.ownCompetitivenessScore,
    competitivenessGap: result.competitivenessGap,
    ownDemand: result.ownDemand,
    marketDemand: result.marketDemand,
    competitorIp: result.competitorIp,
  };
}

export function prepareExistingStoresForEvaluation(
  stores: ExistingStore[],
  competitors: Competitor[],
  locations: LocationEvaluation[],
  settings: ModelSettings,
): ExistingStore[] {
  const byCode = new Map<string, Competitor[]>();
  for (const competitor of competitors) {
    const group = byCode.get(competitor.candidateCode) ?? [];
    group.push(competitor);
    byCode.set(competitor.candidateCode, group);
  }
  const locationByCode = new Map(locations.map(location => [location.candidateCode, location]));
  return stores.map(store => {
    const code = existingStoreSourceCode(store);
    return {...store, ...existingStoreEvaluationPatch(store, byCode.get(code) ?? [], locationByCode.get(code) ?? null, settings)};
  });
}
