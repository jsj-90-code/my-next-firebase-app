// 경쟁력 가중치 후보를 **고정해 두고** 다시 검정하기 위한 도구.
//
// **다음 착수 시점: 학습표본이 45~50곳이 됐을 때.** 2026-09-11에 이 후보가 38곳에서
// 전 지표 개선을 보였지만, 같은 표본에서 다섯 번째 재조정이라 "진짜 개선인지 더 잘 맞춘
// 것인지" 구분할 수 없어 **적용을 보류**했다(사용자 확정).
// 신규점이 12개월을 채워 표본이 늘면 그 새 점포들이 독립 평가 자료가 되므로,
// **이 파일의 CANDIDATE를 바꾸지 말고 그대로** 다시 돌려서 판정한다.
// 후보를 다시 탐색해서 고르면 같은 함정에 또 빠진다.
//
// 돌리는 법:
//   node .local-tools/dump-validation-snapshot.mjs
//   npx vitest run src/lib/storeEval/weightsCandidateParity.test.ts
// 스냅샷이 없으면 건너뛴다(운영 자료라 git에 없다).
//
// 2026-09-11 기준값: MAPE 9.8807→9.7274% · ±10% 20→23곳 · ±20% 34곳 유지 · 최악 26.02→23.90%
//
// 제안: spec 0.1 / food 1/6 / interior 1-0.1-1/6-0.2 / location 0.2
// 현재: spec 0.1852 / food 0.1667 / interior 0.4630 / location 0.1852
// → 하드웨어를 18.52%에서 10%로 줄이고 시설(53.33%)·입지(20%)로 옮기는 안이다.
//
// Codex 보고: MAPE 9.8807→9.7274%, ±10% 20→23곳, ±20% 34곳 유지, 최악 26.0227→23.9038%.
// 여기서는 **현재 HEAD의 운영 검증 경로**로 같은 수치가 나오는지만 본다.
// 가중치를 바꾸면 경쟁력점수·격차가 전부 다시 계산되므로 prepareExistingStoresForEvaluation부터
// 다시 태운다.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeCompetitorInvestigationSummary, summarizeValidationRows, type ValidationStoreInput } from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import type { Competitor, ExistingStore, ExistingStoreMonthlySales, LocationEvaluation, ModelSettings } from "./types";

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const d = existsSync(SNAPSHOT) ? describe : describe.skip;

d("경쟁력 가중치 단독 변경 후보", () => {
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as {
    existingStores: ExistingStore[]; competitors: Record<string, unknown>[];
    locationEvaluations: LocationEvaluation[]; sales: ExistingStoreMonthlySales[];
    settings: Record<string, unknown> | null;
  };
  const baseSettings = mergeModelSettings(snap.settings);
  const comps: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wanted = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wanted.has(`${s.storeCode}_${s.yearMonth}`));
  const locBy = new Map(snap.locationEvaluations.map((l) => [l.candidateCode, l]));
  const byLookup = new Map<string, Competitor[]>();
  for (const c of comps) byLookup.set(c.candidateCode, [...(byLookup.get(c.candidateCode) ?? []), c]);

  function evaluateWith(settings: ModelSettings) {
    // 가중치가 바뀌면 자사 경쟁력점수·경쟁점 평균·격차가 전부 달라진다 — 여기서부터 다시 태운다.
    const stores = prepareExistingStoresForEvaluation(snap.existingStores, comps, snap.locationEvaluations, settings);
    const inputs: ValidationStoreInput[] = stores.map((s) => {
      const lookup = existingStoreSourceCode(s);
      const loc = locBy.get(lookup) ?? null;
      const cs = byLookup.get(lookup) ?? [];
      return {
        storeCode: s.storeCode, storeName: s.storeName, brand: s.brandType ?? loc?.brandType ?? null,
        openedAt: s.openedAt, completedMonths: s.completedMonths ?? 0, franchiseStatus: s.franchiseStatus,
        isPostOpenIssue: s.excludedFromModel, postOpenIssueReason: s.excludedReason,
        pcCount: s.pcCount, evaluationPcCount: s.evaluationPcCount, hourlyRate: s.hourlyRate,
        ownDemand: s.ownDemand, marketDemand: s.marketDemand, competitorIp: s.competitorIp,
        extraPcHours: computeOverflowPcHours(s.marketDemand, { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore }, cs, settings),
        competitivenessScore: s.competitivenessScore, competitivenessGap: s.competitivenessGap,
        actualRevenueAvg: s.actualMonthlyRevenueAvg, specialDemandType: s.specialDemandType,
        specialDemandIntensity: s.specialDemandIntensity, inflowRestriction: loc?.inflowRestriction ?? null,
        visibilityScore: loc?.visibilityScore ?? null, hasLocationEvaluation: loc != null,
        floor: s.floor, groundLevel: s.groundLevel, hasElevator: s.hasElevator,
        competitorSummary: computeCompetitorInvestigationSummary(cs), sheetV61Predicted: s.v61Predicted,
      };
    });
    const { rows } = runUsageCohortValidation(inputs, sales, settings);
    const core = rows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy);
    const summary = summarizeValidationRows(core, {
      mape: settings.targetMAE, medianAe: settings.targetMedianAE,
      within10: settings.target10pctRatio, within20: settings.target20pctRatio, maxBias: settings.maxAvgBias,
    });
    const worst = core.reduce((m, r) => Math.max(m, r.absoluteErrorPct ?? 0), 0);
    return { summary, worst, core };
  }

  const CANDIDATE: ModelSettings["competitivenessWeights"] = {
    spec: 0.1, food: 1 / 6, interior: 1 - 0.1 - 1 / 6 - 0.2, location: 0.2,
  };

  it("현재 코드·현재 자료로 재현되는가", () => {
    const before = evaluateWith(baseSettings);
    const after = evaluateWith({ ...baseSettings, competitivenessWeights: CANDIDATE });
    const pct = (v: number | null) => (v == null ? "-" : `${(v * 100).toFixed(4)}%`);
    const cnt = (v: number | null, n: number) => (v == null ? "-" : `${Math.round(v * n)}/${n}`);

    console.log(`\n가중치  현재 spec ${(baseSettings.competitivenessWeights.spec * 100).toFixed(2)}% / food ${(baseSettings.competitivenessWeights.food * 100).toFixed(2)}% / interior ${(baseSettings.competitivenessWeights.interior * 100).toFixed(2)}% / location ${(baseSettings.competitivenessWeights.location * 100).toFixed(2)}%`);
    console.log(`        제안 spec ${(CANDIDATE.spec * 100).toFixed(2)}% / food ${(CANDIDATE.food * 100).toFixed(2)}% / interior ${(CANDIDATE.interior * 100).toFixed(2)}% / location ${(CANDIDATE.location * 100).toFixed(2)}%`);
    console.log(`\n지표            현재            제안`);
    console.log(`표본            ${before.summary.sampleCount}곳            ${after.summary.sampleCount}곳`);
    console.log(`MAPE            ${pct(before.summary.meanAbsoluteErrorPct)}        ${pct(after.summary.meanAbsoluteErrorPct)}`);
    console.log(`중앙값          ${pct(before.summary.medianAbsoluteErrorPct)}        ${pct(after.summary.medianAbsoluteErrorPct)}`);
    console.log(`±10%            ${cnt(before.summary.within10PctRatio, before.summary.sampleCount)}           ${cnt(after.summary.within10PctRatio, after.summary.sampleCount)}`);
    console.log(`±20%            ${cnt(before.summary.within20PctRatio, before.summary.sampleCount)}           ${cnt(after.summary.within20PctRatio, after.summary.sampleCount)}`);
    console.log(`최악 절대오차   ${pct(before.worst)}        ${pct(after.worst)}`);
    console.log(`\nCodex 보고값: MAPE 9.8807→9.7274% · ±10% 20→23곳 · ±20% 34곳 유지 · 최악 26.0227→23.9038%`);

    expect(before.summary.sampleCount).toBe(after.summary.sampleCount);
  });
});
