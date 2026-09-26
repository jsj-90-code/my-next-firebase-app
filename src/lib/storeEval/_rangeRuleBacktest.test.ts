// "V62 학습 범위 밖이면 실험실을 주 값으로" 규칙(dualEstimate) 자체를 기존점으로 되짚는다 (2026-09-26 밤). 읽기전용·측정만.
//
// 왜: 거리 가중 경쟁IP를 켜면 후보지 3곳(춘천·창원상남·오송) 주 값이 실험실로 넘어간다. 사용자: "실험실로 바뀌는 값이 정확하지 않다는
//     생각이 드는데, 그 실무 감각은 정확성이 낮다 — 뭐가 정답일까." 규칙은 영월(상권수요가 범위의 1/3) 하나를 보고 세웠고,
//     기존점으로 검증한 적이 없다. 그래서 **규칙을 시험한다**:
//   매장 하나를 빼고 나머지로 범위(dualEstimate.v62TrainingRange와 같은 다섯 칸)를 잡는다 → 빠진 매장이 범위 밖이면
//   그 매장에서 V62(그 매장 뺀 LOO 예측)와 실험실 중 누가 실측에 가까웠나.
// 사전 등록(결과 전): 범위 밖 매장에서 실험실이 V62보다 |오차|가 작은 곳이 더 많고 평균도 작아야 규칙이 맞다. 아니면 규칙이 틀렸다.
// ⚠️ 표본이 작다(범위 밖 매장은 몇 곳뿐). 결론은 "방향"까지만.
// 실행: npx vitest run src/lib/storeEval/_rangeRuleBacktest.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { computeCompetitorInvestigationSummary, type ValidationStoreInput } from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { buildLabRows, paidGameSurchargeByStoreFromTariff, qscInWindowAverage, residentRadiusByCodeFromDocs, utilizationByStore, type QscRecord } from "./labInput";
import { residentRingsByCodeFromDocs, type LabResidentRingsDoc } from "./labResidentRings";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import { v62TrainingRange, rangeFlagsFor } from "./dualEstimate";
import type { Competitor, ModelSettings } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : NaN);
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };
const sg = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

describeIf("범위 규칙 되짚기 — 범위 밖에서 V62 vs 실험실", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const base = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wanted = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s: { storeCode: string; yearMonth: string }) => wanted.has(`${s.storeCode}_${s.yearMonth}`));
  const qsc = new Map<string, number>();
  for (const d of (snap.labQscScores ?? []) as { storeCode?: string; openedAt?: string; records?: QscRecord[] }[]) { if (!d.storeCode) continue; const a = qscInWindowAverage(d.records ?? [], d.openedAt ?? null); if (a != null && a > 0) qsc.set(d.storeCode, a); }
  const compsByLookup = new Map<string, Competitor[]>(); for (const c of allCompetitors) compsByLookup.set(c.candidateCode, [...(compsByLookup.get(c.candidateCode) ?? []), c]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const locByLookup = new Map((snap.locationEvaluations as any[]).map((l) => [l.candidateCode, l]));

  // 실험실 — 후보지 조건(상품몫 규칙값 상수, 세대 override 없음). 스위치와 무관하다(실험실은 computeCompetitorIp를 그대로 씀).
  const storesL = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, base);
  const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
  const ringBlockedByCode = new Map<string, number>();
  for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) { const c = j.ringCutCount ?? j.blockedCount; if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c); }
  const labArgs = {
    stores: storesL, compsByCode: compsByLookup, utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores), settings: base, qscByStoreCode: qsc,
    paidGameSurchargeByStore: paidGameSurchargeByStoreFromTariff(), residentRingsByCode: ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined, ringBlockedByCode,
    residentRadiusByCode: residentRadiusByCodeFromDocs(snap.labResidentRadius ?? []),
  };
  const labRows = buildLabRows(labArgs);
  const P0 = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(labRows, DEFAULT_TEXTBOOK_PARAMS));
  const labRev = new Map<string, number>();
  for (const r of [...labRows, ...buildLabRows({ ...labArgs, which: "excluded" })]) {
    const rev = computeTextbook(r.input, { ...P0, productUnitPrice: P0.productUnitPrice }).monthlyRevenue;
    if (rev != null) labRev.set(r.input.storeCode, rev);
  }

  const measure = (settings: ModelSettings) => {
    const storesV = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings, qsc);
    const inputs = storesV.map((s) => {
      const lk = existingStoreSourceCode(s); const loc = locByLookup.get(lk) ?? null; const competitors = compsByLookup.get(lk) ?? [];
      return {
        storeCode: s.storeCode, storeName: s.storeName, brand: s.brandType ?? loc?.brandType ?? null, openedAt: s.openedAt, completedMonths: s.completedMonths ?? 0,
        franchiseStatus: s.franchiseStatus, isPostOpenIssue: s.excludedFromModel, postOpenIssueReason: s.excludedReason, pcCount: s.pcCount, evaluationPcCount: s.evaluationPcCount,
        hourlyRate: s.hourlyRate, ownDemand: s.ownDemand, marketDemand: s.marketDemand, competitorIp: s.competitorIp,
        extraPcHours: computeOverflowPcHours(s.marketDemand, { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore }, competitors, settings),
        competitivenessScore: s.competitivenessScore, competitivenessGap: s.competitivenessGap, actualRevenueAvg: s.actualMonthlyRevenueAvg,
        specialDemandType: s.specialDemandType, specialDemandIntensity: s.specialDemandIntensity, inflowRestriction: loc?.inflowRestriction ?? null,
        visibilityScore: loc?.visibilityScore ?? null, preemptionScore: loc?.preemptionScore ?? null, hasLocationEvaluation: loc != null,
        floor: s.floor, groundLevel: s.groundLevel, hasElevator: s.hasElevator, competitorSummary: computeCompetitorInvestigationSummary(competitors), sheetV61Predicted: s.v61Predicted,
      } as ValidationStoreInput;
    });
    const { rows } = runUsageCohortValidation(inputs, sales, settings, new Date());
    type VRow = { storeCode: string; storeName: string; brand: string; includedInCoreAccuracy: boolean; v62PredictedRevenueAvg: number | null; actualRevenueAvg: number | null };
    const v = (rows as unknown as VRow[]).filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy && r.v62PredictedRevenueAvg != null && (r.actualRevenueAvg ?? 0) > 0);
    const out: { name: string; flags: string; eV: number; eL: number | null }[] = [];
    for (const r of v) {
      const others = storesV.filter((s) => s.storeCode !== r.storeCode);
      const range = v62TrainingRange(others);
      const me = storesV.find((s) => s.storeCode === r.storeCode)!;
      if (!range) continue;
      const flags = rangeFlagsFor({ marketDemand: me.marketDemand, competitorIp: me.competitorIp, hourlyRate: me.hourlyRate, expectedPcCount: me.evaluationPcCount ?? me.pcCount }, range);
      const act = r.actualRevenueAvg as number;
      const lr = labRev.get(r.storeCode);
      out.push({ name: r.storeName, flags: flags.map((f) => `${f.field} ${f.side}`).join(", "), eV: (r.v62PredictedRevenueAvg as number) / act - 1, eL: lr == null ? null : lr / act - 1 });
    }
    return out;
  };

  it("범위 밖으로 걸린 기존점 — 누가 더 가까웠나 (스위치 끔 / 켬)", () => {
    for (const [label, settings] of [["끔(지금)", base], ["켬(거리 가중 경쟁IP)", mergeModelSettings({ ...snap.settings, v61Training: { ...(snap.settings?.v61Training ?? {}), competitorIpDistanceWeighted: true } })]] as const) {
      const out = measure(settings);
      const flagged = out.filter((o) => o.flags && o.eL != null);
      console.log(`\n[${label}] 기존점 ${out.length}곳 중 자기 빼고 잡은 범위 밖 ${flagged.length}곳`);
      console.log(`  ${pad("매장", 14)} ${"V62".padStart(7)} ${"실험실".padStart(7)}  더 가까운 쪽   걸린 칸`);
      for (const o of flagged) console.log(`  ${pad(o.name, 14)} ${sg(o.eV).padStart(7)} ${sg(o.eL!).padStart(7)}  ${Math.abs(o.eL!) < Math.abs(o.eV) ? "실험실" : "V62   "}        ${o.flags}`);
      const labWins = flagged.filter((o) => Math.abs(o.eL!) < Math.abs(o.eV)).length;
      console.log(`  범위 밖: 실험실이 가까운 곳 ${labWins}/${flagged.length} · |오차| 평균 V62 ${(mean(flagged.map((o) => Math.abs(o.eV))) * 100).toFixed(1)}% vs 실험실 ${(mean(flagged.map((o) => Math.abs(o.eL!))) * 100).toFixed(1)}%`);
      const inside = out.filter((o) => !o.flags && o.eL != null);
      console.log(`  범위 안(참고): |오차| 평균 V62 ${(mean(inside.map((o) => Math.abs(o.eV))) * 100).toFixed(1)}% vs 실험실 ${(mean(inside.map((o) => Math.abs(o.eL!))) * 100).toFixed(1)}% (n=${inside.length})`);
    }
    expect(labRows.length).toBeGreaterThan(30);
  });
});
