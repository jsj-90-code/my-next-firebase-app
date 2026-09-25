// 실험실 교과서식 vs 운영 V62 — **같은 매장끼리** 월매출 오차를 나란히 (2026-09-25 밤, 사용자 "실험실 꽤 좋아졌는데 V62랑 비교하면?"). 읽기전용.
// V62는 매장마다 그 매장을 뺀 나머지로 학습해 예측(LOOCV) — storedAccuracyParity와 같은 조립(검증 화면과 같음).
// 실험실은 학습 계수가 거의 없다(축척·상품몫·몫 상한·배수는 실측·사실에서 정함). 단 그 값들을 이 매장들로 쟀으므로 완전한 홀드아웃은 아니다.
// 실행: npx vitest run src/lib/storeEval/_labVsV62.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { computeCompetitorInvestigationSummary, type ValidationStoreInput } from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { LAB_UPSIDE_STORE_CODES, buildLabRows, paidGameSurchargeByStoreFromTariff, productUnitPriceEraByStore, qscInWindowAverage, residentRadiusByCodeFromDocs, utilizationByStore, type QscRecord } from "./labInput";
import { residentRingsByCodeFromDocs, type LabResidentRingsDoc } from "./labResidentRings";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const sgn = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}`;
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < a.length; i++) { sxy += (a[i] - ma) * (b[i] - mb); sxx += (a[i] - ma) ** 2; syy += (b[i] - mb) ** 2; } return sxy / Math.sqrt(sxx * syy); };

describeIf("실험실 vs V62 — 같은 매장 월매출 오차", () => {
  it("매장별 표 + 요약", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = loadValidationSnapshot<any>();
    const settings = mergeModelSettings(snap.settings);
    const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
    // ── V62 (storedAccuracyParity와 같은 조립) ──
    const wanted = new Set(evaluationSalesIds(snap.existingStores));
    const sales = snap.sales.filter((s: { storeCode: string; yearMonth: string }) => wanted.has(`${s.storeCode}_${s.yearMonth}`));
    const qsc = new Map<string, number>();
    for (const d of (snap.labQscScores ?? []) as { storeCode?: string; openedAt?: string; records?: QscRecord[] }[]) { if (!d.storeCode) continue; const a = qscInWindowAverage(d.records ?? [], d.openedAt ?? null); if (a != null && a > 0) qsc.set(d.storeCode, a); }
    const storesV = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings, qsc);
    const compsByLookup = new Map<string, Competitor[]>(); for (const c of allCompetitors) compsByLookup.set(c.candidateCode, [...(compsByLookup.get(c.candidateCode) ?? []), c]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const locByLookup = new Map((snap.locationEvaluations as any[]).map((l) => [l.candidateCode, l]));
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
    const { rows: vRows } = runUsageCohortValidation(inputs, sales, settings);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = (vRows as any[]).filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy);
    const v62 = new Map(core.map((r) => [r.storeCode as string, { pred: r.v62PredictedRevenueAvg as number, act: r.actualRevenueAvg as number, name: r.storeName as string }]));
    // ── 실험실 (화면과 같은 조립) ──
    const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
    const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
    const ringBlockedByCode = new Map<string, number>();
    for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) { const c = j.ringCutCount ?? j.blockedCount; if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c); }
    const rows = buildLabRows({
      stores, compsByCode: compsByLookup, utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores), settings, qscByStoreCode: qsc,
      productUnitPriceByStore: productUnitPriceEraByStore(snap.sales ?? [], snap.existingStores), paidGameSurchargeByStore: paidGameSurchargeByStoreFromTariff(),
      residentRingsByCode: ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined, ringBlockedByCode, residentRadiusByCode: residentRadiusByCodeFromDocs(snap.labResidentRadius ?? []),
    });
    const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS));
    const both: { name: string; up: boolean; eL: number; eV: number }[] = [];
    for (const r of rows) {
      const v = v62.get(r.input.storeCode); const lab = computeTextbook(r.input, P).monthlyRevenue;
      if (!v || lab == null || !(v.act > 0)) continue;
      both.push({ name: v.name, up: LAB_UPSIDE_STORE_CODES.has(r.input.storeCode), eL: lab / v.act - 1, eV: v.pred / v.act - 1 });
    }
    both.sort((a, b) => Math.abs(b.eL) - Math.abs(a.eL));
    console.log(`\n[같은 매장 ${both.length}곳 — 월매출 오차 = 예측 ÷ 실측 − 1] V62 ${core.length}곳 중 실험실에도 있는 곳. ★ = 상향 이탈 7곳`);
    console.log(`  ${pad("매장", 16)} ${"실험실".padStart(7)} ${"V62".padStart(7)}  더 가까운 쪽`);
    for (const x of both) console.log(`  ${pad(x.name + (x.up ? "★" : ""), 16)} ${sgn(x.eL).padStart(7)} ${sgn(x.eV).padStart(7)}  ${Math.abs(x.eL) < Math.abs(x.eV) ? "실험실" : "V62"}`);
    const s = (k: "eL" | "eV") => { const e = both.map((x) => x[k]); return `MAPE ${pct(mean(e.map(Math.abs)))} · 중앙 ${pct(median(e.map(Math.abs)))} · 편향 ${sgn(mean(e))}% · ±10% ${e.filter((v) => Math.abs(v) <= 0.1).length} · ±20% ${e.filter((v) => Math.abs(v) <= 0.2).length}/${e.length} · 최악 ${pct(Math.max(...e.map(Math.abs)))}`; };
    console.log(`\n  실험실  ${s("eL")}`); console.log(`  V62     ${s("eV")}`);
    console.log(`  실험실이 더 가까운 매장 ${both.filter((x) => Math.abs(x.eL) < Math.abs(x.eV)).length}/${both.length} · 두 오차 상관 r=${corr(both.map((x) => x.eL), both.map((x) => x.eV)).toFixed(2)}`);
    const avg = both.map((x) => (x.eL + x.eV) / 2); console.log(`  (참고) 두 산식 평균  MAPE ${pct(mean(avg.map(Math.abs)))} · 최악 ${pct(Math.max(...avg.map(Math.abs)))}`);
    expect(both.length).toBeGreaterThan(30);
  });
});
