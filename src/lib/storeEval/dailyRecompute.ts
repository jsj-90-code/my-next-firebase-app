// 매일 크론이 다시 계산해 저장하는 두 가지 (2026-09-26, 사용자 "자동화 — 2+1 한 번에").
//
//   1. V62 적중률 요약(storeEvalSystemStatus/accuracy) — 검증 화면(validation/page.tsx computed)과 같은 계산
//   2. 후보지 평가 결과(storeEvalResults/{코드})       — 후보지 결과 탭(ResultTab.tsx run)과 같은 계산
//
// 예전에는 둘 다 **화면을 열 때만** 저장됐다. 설정·경쟁점·매출이 바뀐 뒤 아무도 그 화면을 안 열면
// 대시보드와 후보지 화면이 옛 숫자를 사실처럼 보여줬다(storedAccuracyParity 빨강의 원인).
//
// 이 파일은 **순수 계산만** 한다(Firestore 모름). 읽기·쓰기는 dailyRecomputeRun.ts(크론)가,
// 스냅샷 대조는 storedAccuracyParity.test.ts / _recomputeCandidates.test.ts가 같은 함수를 부른다 —
// 크론·시험·하네스가 각자 조립하면 한 인자만 빠져도 조용히 다른 모형을 잰다(2026-09-20 preemptionScore 사고).
//
// ⚠️ **화면 코드와 나란히 놓고 diff할 것.** 화면 쪽 조립을 바꾸면 여기도 같이 바꾼다.
import {
  computeCompetitorInvestigationSummary,
  summarizeValidationRows,
  type ValidationStoreInput,
} from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { chooseEstimate, inputGapsFor, labCandidateRevenue, rangeFlagsFor, v62TrainingRange, type LabExtras } from "./dualEstimate";
import { evaluateCandidate } from "./evaluate";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { qscInWindowAverage, residentRadiusByCodeFromDocs, type LabResidentRadiusDoc, type QscRecord } from "./labInput";
import { residentRingsByCodeFromDocs, type LabResidentRingsDoc } from "./labResidentRings";
import { resultFreshness } from "./resultFreshness";
import { mergeModelSettings } from "./settings";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import type {
  CandidateInput,
  Competitor,
  EvaluationResult,
  ExistingStore,
  ExistingStoreMonthlySales,
  LocationEvaluation,
  ModelAccuracySummary,
  ModelSettings,
} from "./types";

export type QscDoc = { storeCode?: string; openedAt?: string | null; records?: QscRecord[] };
export type TradeAreaDoc = { code?: string; ringCutCount?: number | null; blockedCount?: number | null };
export type RoadviewDoc = { key?: string; flowBlock?: number | null; visibility?: number | null };

/** 크론(admin SDK)과 스냅샷이 같은 모양으로 넘기는 원자료. 컬렉션 문서를 그대로 담는다. */
export type RecomputeSource = {
  settingsDoc: Record<string, unknown> | null;
  candidates: CandidateInput[];
  results: EvaluationResult[];
  existingStores: ExistingStore[];
  competitors: Record<string, unknown>[];
  locationEvaluations: LocationEvaluation[];
  /** 월매출 전체. 화면처럼 평가구간(evaluationSalesIds)만 여기서 골라 쓴다. */
  sales: ExistingStoreMonthlySales[];
  /** 운영 QSC(storeEvalQscScores) — 화면 listQscScores와 같은 원자료. */
  qscDocs: QscDoc[];
  labResidentRings?: LabResidentRingsDoc[];
  labTradeAreaJudgments?: TradeAreaDoc[];
  labResidentRadius?: LabResidentRadiusDoc[];
  labRoadviewJudgments?: RoadviewDoc[];
};

/** 원자료 -> 화면이 쓰는 모양. store.ts의 list* 함수들과 같은 변환이다. */
export function prepareRecomputeInputs(src: RecomputeSource) {
  const settings: ModelSettings = mergeModelSettings(src.settingsDoc as Partial<ModelSettings> | null);
  const competitors: Competitor[] = src.competitors.map(migrateCompetitorInvestigationStatus);
  const wanted = new Set(evaluationSalesIds(src.existingStores));
  const evaluationSales = src.sales.filter((s) => wanted.has(`${s.storeCode}_${s.yearMonth}`));

  // store.ts readQscScores와 같은 규칙 — 저장된 평균이 아니라 원본 기록에서 계산한다.
  const qscByStoreCode = new Map<string, number>();
  for (const d of src.qscDocs) {
    if (!d.storeCode) continue;
    const avg = qscInWindowAverage(d.records ?? [], d.openedAt ?? null);
    if (avg != null && avg > 0) qscByStoreCode.set(d.storeCode, avg);
  }

  // store.ts listLabTradeAreaJudgments · listLabRoadviewJudgments와 같은 변환.
  const ringBlockedByCode = new Map<string, number>();
  for (const j of src.labTradeAreaJudgments ?? []) {
    const c = j.ringCutCount ?? j.blockedCount;
    if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c);
  }
  const roadviewByKey = new Map<string, { flowBlock: number | null; visibility: number | null }>();
  for (const v of src.labRoadviewJudgments ?? []) {
    if (!v.key) continue;
    roadviewByKey.set(v.key, { flowBlock: v.flowBlock ?? null, visibility: v.visibility ?? null });
  }
  const labExtras: LabExtras = {
    residentRingsByCode: residentRingsByCodeFromDocs(src.labResidentRings ?? []),
    ringBlockedByCode,
    residentRadiusByCode: residentRadiusByCodeFromDocs(src.labResidentRadius ?? []),
    roadviewByKey,
  };

  return { settings, usedDefaultSettings: src.settingsDoc == null, competitors, evaluationSales, qscByStoreCode, labExtras };
}

type Prepared = ReturnType<typeof prepareRecomputeInputs>;

/**
 * 검증 화면의 정식검증군(블랙라벨·includedInCoreAccuracy) 요약. validation/page.tsx가
 * upsertModelAccuracySummary에 넘기는 것과 같은 모양이다.
 * 운영설정 문서가 없으면(기본 계수로 계산) null — 화면도 그때는 저장하지 않는다.
 */
export function computeAccuracySummary(src: RecomputeSource, prepared: Prepared = prepareRecomputeInputs(src), now = Date.now(), actor: string | null = null): ModelAccuracySummary | null {
  const { settings, usedDefaultSettings, competitors, evaluationSales, qscByStoreCode } = prepared;
  if (usedDefaultSettings) return null;
  const stores = prepareExistingStoresForEvaluation(src.existingStores, competitors, src.locationEvaluations, settings, qscByStoreCode);

  const competitorsByLookup = new Map<string, Competitor[]>();
  for (const c of competitors) competitorsByLookup.set(c.candidateCode, [...(competitorsByLookup.get(c.candidateCode) ?? []), c]);
  const locByLookup = new Map(src.locationEvaluations.map((l) => [l.candidateCode, l]));

  const inputs: ValidationStoreInput[] = stores.map((s) => {
    const lookupCode = existingStoreSourceCode(s);
    const loc = locByLookup.get(lookupCode) ?? null;
    const comps = competitorsByLookup.get(lookupCode) ?? [];
    return {
      storeCode: s.storeCode,
      storeName: s.storeName,
      brand: s.brandType ?? loc?.brandType ?? null,
      openedAt: s.openedAt,
      completedMonths: s.completedMonths ?? 0,
      franchiseStatus: s.franchiseStatus,
      isPostOpenIssue: s.excludedFromModel,
      postOpenIssueReason: s.excludedReason,
      pcCount: s.pcCount,
      evaluationPcCount: s.evaluationPcCount,
      hourlyRate: s.hourlyRate,
      ownDemand: s.ownDemand,
      marketDemand: s.marketDemand,
      competitorIp: s.competitorIp,
      extraPcHours: computeOverflowPcHours(
        s.marketDemand,
        { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore },
        comps,
        settings,
      ),
      competitivenessScore: s.competitivenessScore,
      competitivenessGap: s.competitivenessGap,
      actualRevenueAvg: s.actualMonthlyRevenueAvg,
      specialDemandType: s.specialDemandType,
      specialDemandIntensity: s.specialDemandIntensity,
      inflowRestriction: loc?.inflowRestriction ?? null,
      visibilityScore: loc?.visibilityScore ?? null,
      preemptionScore: loc?.preemptionScore ?? null,
      hasLocationEvaluation: loc != null,
      floor: s.floor,
      groundLevel: s.groundLevel,
      hasElevator: s.hasElevator,
      competitorSummary: computeCompetitorInvestigationSummary(comps),
      sheetV61Predicted: s.v61Predicted,
    };
  });

  const { rows } = runUsageCohortValidation(inputs, evaluationSales, settings);
  const coreRows = rows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy);
  const s = summarizeValidationRows(coreRows, {
    mape: settings.targetMAE,
    medianAe: settings.targetMedianAE,
    within10: settings.target10pctRatio,
    within20: settings.target20pctRatio,
    maxBias: settings.maxAvgBias,
  });
  if (s.sampleCount === 0) return null;
  return {
    updatedAt: now,
    updatedBy: actor,
    modelVersion: `${settings.modelVersion}-usage-v1`,
    sampleCount: s.sampleCount,
    meanAbsoluteErrorPct: s.meanAbsoluteErrorPct,
    medianAbsoluteErrorPct: s.medianAbsoluteErrorPct,
    within10PctRatio: s.within10PctRatio,
    within15PctRatio: s.within15PctRatio,
    within20PctRatio: s.within20PctRatio,
  };
}

export type CandidateRecompute = {
  code: string;
  name: string;
  before: EvaluationResult | null;
  after: EvaluationResult;
  /** 저장이 필요한 이유. 비었으면 저장값이 지금 계산과 같다. */
  reasons: string[];
};

/** 저장을 건너뛰어도 되는 차이 폭 — storedAccuracyParity "0.5% 이내"와 같은 잣대. */
export const RESULT_TOLERANCE = 0.005;

const relDiff = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? (a == null && b == null ? 0 : Number.POSITIVE_INFINITY) : b === 0 ? (a === 0 ? 0 : Number.POSITIVE_INFINITY) : Math.abs(a / b - 1);
const effRate = (r: EvaluationResult | null) =>
  r?.revenueBreakdown && r.revenueBreakdown.pcHours > 0 ? r.revenueBreakdown.pcRevenue / r.revenueBreakdown.pcHours : null;

/**
 * 후보지마다 결과 탭과 같은 계산을 하고, 저장값과 비교해 저장이 필요한 이유를 붙인다.
 * 이유: 저장값 없음 · 입력이 계산 뒤에 바뀜(배지) · V62 0.5%↑ · 실효단가 1원↑(계산법 화면이 읽는 내부값) · 실험실 값/주 값 0.5%↑ · 주 값 산식이 바뀜.
 */
export function recomputeCandidates(src: RecomputeSource, prepared: Prepared = prepareRecomputeInputs(src)): CandidateRecompute[] {
  const { settings, competitors, evaluationSales, qscByStoreCode, labExtras } = prepared;
  // 결과 탭(ResultTab.tsx run)과 같다 — 실험실 쪽 prepare에는 QSC를 넘기지 않는다.
  const preparedStores = prepareExistingStoresForEvaluation(src.existingStores, competitors, src.locationEvaluations, settings);
  const range = v62TrainingRange(preparedStores);

  return src.candidates.map((candidate) => {
    const ownCompetitors = competitors.filter((c) => c.candidateCode === candidate.code);
    const locationEvaluation = src.locationEvaluations.find((l) => l.candidateCode === candidate.code) ?? null;
    const after = evaluateCandidate({
      candidate,
      competitors: ownCompetitors,
      locationEvaluation,
      settings,
      existingStores: src.existingStores,
      trainingLocationEvaluations: src.locationEvaluations,
      trainingCompetitors: competitors,
      trainingSales: evaluationSales,
      trainingQscScores: qscByStoreCode,
    });
    try {
      const lab = labCandidateRevenue({
        candidate, preparedStores, rawStores: src.existingStores, competitors, locations: src.locationEvaluations,
        sales: evaluationSales, settings, qscByStoreCode, extras: labExtras,
      });
      after.dualEstimate = chooseEstimate(after.v62Final, lab, range ? rangeFlagsFor(after, range) : [], after.competitorIpRaw ?? after.competitorIp ?? null, range?.sampleCount ?? null, inputGapsFor(candidate, locationEvaluation, competitors));
    } catch {
      after.dualEstimate = null; // 결과 탭과 같다 — 실험실 값이 안 나와도 V62 결과는 저장한다
    }

    const before = src.results.find((r) => r.candidateCode === candidate.code) ?? null;
    const reasons: string[] = [];
    if (!before) reasons.push("저장값 없음");
    else {
      // 목록·대시보드의 "재계산 필요" 배지(resultFreshness)와 같은 판정. 입력이 계산 뒤에 바뀌었으면
      // 값 차이가 0.5% 안이어도 다시 쓴다 — 안 쓰면 calculatedAt이 그대로라 배지가 영영 안 꺼진다.
      const fresh = resultFreshness({
        calculatedAt: before.calculatedAt,
        candidateUpdatedAt: candidate.updatedAt,
        competitorUpdatedAts: ownCompetitors.map((c) => c.updatedAt),
        locationEvaluationUpdatedAt: locationEvaluation?.updatedAt,
        settingsUpdatedAt: (src.settingsDoc?.updatedAt as number | undefined) ?? null,
      });
      if (fresh.state === "재계산필요") reasons.push(`입력 바뀜(${fresh.reasons.join("·")})`);
      if (relDiff(after.v62Final, before.v62Final) > RESULT_TOLERANCE) reasons.push("V62 값");
      const rb = effRate(before), ra = effRate(after);
      if (rb != null && ra != null && Math.abs(rb - ra) > 1) reasons.push("실효단가");
      const db = before.dualEstimate ?? null, da = after.dualEstimate ?? null;
      if ((db == null) !== (da == null)) reasons.push("두 산식 표시");
      else if (db && da) {
        if (relDiff(da.lab, db.lab) > RESULT_TOLERANCE) reasons.push("실험실 값");
        if (da.primary !== db.primary || relDiff(da.primaryValue, db.primaryValue) > RESULT_TOLERANCE) reasons.push("주 값");
      }
    }
    return { code: candidate.code, name: candidate.name ?? "", before, after, reasons };
  });
}
