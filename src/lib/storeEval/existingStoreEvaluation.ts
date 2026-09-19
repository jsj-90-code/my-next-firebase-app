import { computeExistingStoreDemandEvaluation, resolveManagementScores } from "./calc";
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
  /**
   * QSC에서 환산한 관리 점수 (2026-09-20). 주면 저장된 `ownManagementScore`(전부 4.00) 대신
   * 이 값으로 경쟁력점수를 계산한다.
   *
   * ⚠️ **안 주면(null/undefined) 2026-09-19까지와 완전히 같게 동작한다.** 자료가 없어도
   *    예상매출이 사라지면 안 된다 — 이게 안전장치다.
   * ⚠️ 저장된 `ownManagementScore`는 **안 덮어쓴다.** 그건 입력 자료이고 이건 파생값이다.
   *    (cronSync가 이 패치만 Firestore에 쓰므로, 여기서 덮으면 입력이 오염된다.)
   */
  managementScore?: number | null,
) {
  const target = managementScore == null ? store : { ...store, ownManagementScore: managementScore };
  const result = computeExistingStoreDemandEvaluation(target, competitors, location, settings);
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
  /**
   * 매장코드 -> 본사 QSC 점검 평균 (2026-09-20). 주면 자사 **관리 점수를 QSC 환산값으로
   * 갈아끼운다**(QSC가 없는 매장에는 가맹점 평균 — `resolveManagementScores`).
   *
   * ⚠️ **여기가 주입 지점 한 곳이다.** 관리 점수는 여기서 출발해
   *    `computeExistingStoreDemandEvaluation` -> `computeFacilityScore`로 흐르므로, 매장 객체의
   *    `ownManagementScore`만 갈아끼우면 하류는 손댈 게 없다. 검증 화면·후보지 평가·파리티
   *    시험·실험실 화면이 전부 이 함수를 지난다. **밖에 있는 건 cronSync 하나뿐이고, 거기는
   *    `existingStoreEvaluationPatch`를 직접 부르므로 따로 챙겨야 한다** — 빠뜨리면 캐시가
   *    화면과 갈라진다.
   * ⚠️ **안 주면 2026-09-19까지와 완전히 같게 동작한다**(안전장치).
   * ⚠️ 실험실 화면은 **일부러 안 준다** — 거기는 `buildLabRows`가 바닥 60으로 따로 환산한다.
   */
  qscByStoreCode?: ReadonlyMap<string, number> | null,
): ExistingStore[] {
  const byCode = new Map<string, Competitor[]>();
  for (const competitor of competitors) {
    const group = byCode.get(competitor.candidateCode) ?? [];
    group.push(competitor);
    byCode.set(competitor.candidateCode, group);
  }
  const locationByCode = new Map(locations.map(location => [location.candidateCode, location]));
  // 가맹점 평균을 내는 자리는 여기 하나다(resolveManagementScores 주석 참고).
  const management = resolveManagementScores(stores.map(s => s.storeCode), qscByStoreCode);
  return stores.map(store => {
    const code = existingStoreSourceCode(store);
    const managementScore = management.scoreFor(store.storeCode);
    // 하류가 다시 계산할 때도 같은 값을 보게 매장 객체에 실어 보낸다.
    const withManagement = managementScore == null ? store : {...store, ownManagementScore: managementScore};
    return {...withManagement, ...existingStoreEvaluationPatch(withManagement, byCode.get(code) ?? [], locationByCode.get(code) ?? null, settings)};
  });
}
