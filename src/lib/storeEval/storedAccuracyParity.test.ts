// 검증화면이 Firestore(storeEvalSystemStatus/accuracy)에 저장해둔 적중률이, **지금 운영
// 데이터와 지금 코드로 그대로 재현되는지** 확인한다. 후보지 화면이 그 저장값을 그대로 보여주기
// 때문에, 설정이 바뀐 뒤 검증화면을 아무도 안 열면 옛 숫자가 계속 사실처럼 표시된다.
//
// 화면 코드(validation/page.tsx loadValidationData + computed)를 그대로 따라 한다 —
// 새 산식을 만들지 않는다. 데이터만 admin SDK로 미리 떠둔 스냅샷에서 읽는다:
//   node .local-tools/dump-validation-snapshot.mjs
// 스냅샷은 운영 자료라 git에 올라가지 않는다 — 없으면 이 블록 전체를 건너뛴다.
// 그래서 평소 `npm test`에서는 아무 일도 안 하고, 확인이 필요할 때 스냅샷을 떠서 돌린다.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CORE_VALIDATION_MIN_MONTHS,
  computeCompetitorInvestigationSummary,
  summarizeValidationRows,
  type ValidationStoreInput,
} from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import type { Competitor, ExistingStore, ExistingStoreMonthlySales, LocationEvaluation } from "./types";

const SNAPSHOT = ".local-tools/validation-snapshot.json";

type Snapshot = {
  fetchedAt: string;
  existingStores: ExistingStore[];
  competitors: Record<string, unknown>[];
  locationEvaluations: LocationEvaluation[];
  sales: ExistingStoreMonthlySales[];
  settings: Record<string, unknown> | null;
  storedAccuracy: {
    sampleCount: number;
    meanAbsoluteErrorPct: number;
    medianAbsoluteErrorPct: number;
    within10PctRatio: number;
    within15PctRatio: number;
    within20PctRatio: number;
    modelVersion: string;
    updatedAt: number;
  } | null;
};

const describeIfSnapshot = existsSync(SNAPSHOT) ? describe : describe.skip;

describeIfSnapshot("저장된 적중률이 현재 데이터·코드로 재현되는가", () => {
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);

  // 화면은 12개월 평가구간 매출만 읽는다(listEvaluationSales). 전체를 넣으면 실제 평균이
  // 달라지므로 같은 필터를 여기서도 건다.
  const wantedSalesIds = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wantedSalesIds.has(`${s.storeCode}_${s.yearMonth}`));

  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);

  const competitorsByLookup = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    competitorsByLookup.set(c.candidateCode, [...(competitorsByLookup.get(c.candidateCode) ?? []), c]);
  }
  const locByLookup = new Map(snap.locationEvaluations.map((l) => [l.candidateCode, l]));

  const inputs: ValidationStoreInput[] = stores.map((s) => {
    const lookupCode = existingStoreSourceCode(s);
    const loc = locByLookup.get(lookupCode) ?? null;
    const competitors = competitorsByLookup.get(lookupCode) ?? [];
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
        competitors,
        settings,
      ),
      competitivenessScore: s.competitivenessScore,
      competitivenessGap: s.competitivenessGap,
      actualRevenueAvg: s.actualMonthlyRevenueAvg,
      specialDemandType: s.specialDemandType,
      specialDemandIntensity: s.specialDemandIntensity,
      inflowRestriction: loc?.inflowRestriction ?? null,
      visibilityScore: loc?.visibilityScore ?? null,
      hasLocationEvaluation: loc != null,
      floor: s.floor,
      groundLevel: s.groundLevel,
      hasElevator: s.hasElevator,
      competitorSummary: computeCompetitorInvestigationSummary(competitors),
      sheetV61Predicted: s.v61Predicted,
    };
  });

  const { rows } = runUsageCohortValidation(inputs, sales, settings);
  const coreRows = rows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy);
  const summary = summarizeValidationRows(coreRows, {
    mape: settings.targetMAE,
    medianAe: settings.targetMedianAE,
    within10: settings.target10pctRatio,
    within20: settings.target20pctRatio,
    maxBias: settings.maxAvgBias,
  });

  const stored = snap.storedAccuracy;

  it("재계산 결과를 남긴다", () => {
    const pct = (v: number | null) => (v == null ? "-" : `${(v * 100).toFixed(2)}%`);
    console.log(
      [
        `스냅샷 ${snap.fetchedAt}`,
        `정식검증군 ${summary.sampleCount}곳 (최소 완료월 ${CORE_VALIDATION_MIN_MONTHS})`,
        `MAPE ${pct(summary.meanAbsoluteErrorPct)} · 중앙값 ${pct(summary.medianAbsoluteErrorPct)}`,
        `±10% ${pct(summary.within10PctRatio)} · ±15% ${pct(summary.within15PctRatio)} · ±20% ${pct(summary.within20PctRatio)}`,
        stored
          ? `저장값: n=${stored.sampleCount} MAPE ${pct(stored.meanAbsoluteErrorPct)} ±10% ${pct(stored.within10PctRatio)} ±20% ${pct(stored.within20PctRatio)} (${new Date(stored.updatedAt).toISOString()}, ${stored.modelVersion})`
          : "저장값 없음",
      ].join("\n"),
    );
    expect(summary.sampleCount).toBeGreaterThan(0);
  });

  it("표본 수가 저장값과 같다", () => {
    expect(stored).not.toBeNull();
    expect(summary.sampleCount).toBe(stored!.sampleCount);
  });

  // 반올림 오차만 허용한다. 이보다 벌어지면 저장값이 옛 설정·옛 데이터로 계산된 것이다.
  const close = (a: number | null, b: number) => Math.abs((a ?? Number.NaN) - b) < 1e-6;

  it("MAPE·중앙값이 저장값과 같다", () => {
    expect(close(summary.meanAbsoluteErrorPct, stored!.meanAbsoluteErrorPct)).toBe(true);
    expect(close(summary.medianAbsoluteErrorPct, stored!.medianAbsoluteErrorPct)).toBe(true);
  });

  it("±10 / ±15 / ±20% 적중률이 저장값과 같다", () => {
    expect(close(summary.within10PctRatio, stored!.within10PctRatio)).toBe(true);
    expect(close(summary.within15PctRatio, stored!.within15PctRatio)).toBe(true);
    expect(close(summary.within20PctRatio, stored!.within20PctRatio)).toBe(true);
  });

  it("모형 버전 표기가 저장값과 같다", () => {
    expect(`${settings.modelVersion}-usage-v1`).toBe(stored!.modelVersion);
  });
});
