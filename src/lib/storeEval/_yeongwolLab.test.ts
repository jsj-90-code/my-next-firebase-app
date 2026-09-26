// 영월점 실험실 값 분해 + "작은 시장에서 실험실이 낮게 보나" 기존점 검사 (2026-09-27, 사용자 "영월점 예상매출이 좀 낮은데 올릴 수 있는 개선안").
// 규칙: 한 매장에 맞추지 않는다 — 올릴 근거는 기존점에서 같은 방향 편향이 보일 때만(storeeval rules-must-generalize).
// 조립은 dailyRecompute(크론)·결과 탭과 같다(prepareRecomputeInputs → labCandidateBreakdown과 같은 단계).
// 실행: npx vitest run src/lib/storeEval/_yeongwolLab.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot, recomputeSourceFromSnapshot } from "./validationSnapshot";
import { prepareRecomputeInputs } from "./dailyRecompute";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { buildLabCandidateRows, buildLabRows, franchiseManagementFromRows, productUnitPriceEraByStore, utilizationByStore } from "./labInput";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const TARGET = process.env.TARGET ?? "N014";

describeIf("영월 실험실 분해", () => {
  it("분해 + 기존점 수요 규모별 편향", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = loadValidationSnapshot<any>();
    const src = recomputeSourceFromSnapshot(snap);
    const prep = prepareRecomputeInputs(src);
    const { settings, competitors, evaluationSales: sales, qscByStoreCode, labExtras: extras } = prep;
    const stores = prepareExistingStoresForEvaluation(src.existingStores, competitors, src.locationEvaluations, settings);
    const compsByCode = new Map<string, Competitor[]>();
    for (const c of competitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
    const x = extras as unknown as Record<string, never>;
    const rows = buildLabRows({
      stores, compsByCode, utilByStore: utilizationByStore(sales, src.existingStores), settings, qscByStoreCode,
      productUnitPriceByStore: productUnitPriceEraByStore(sales, src.existingStores),
      roadviewByKey: x?.roadviewByKey, residentRingsByCode: x?.residentRingsByCode, ringBlockedByCode: x?.ringBlockedByCode, residentRadiusByCode: x?.residentRadiusByCode,
    });
    const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS));
    const candidate = src.candidates.find((c) => c.code === TARGET)!;
    const [cand] = buildLabCandidateRows({
      candidates: [candidate], compsByCode, locByCode: new Map(src.locationEvaluations.map((l) => [l.candidateCode, l])), settings,
      roadviewByKey: x?.roadviewByKey, residentRingsByCode: x?.residentRingsByCode, ringBlockedByCode: x?.ringBlockedByCode, residentRadiusByCode: x?.residentRadiusByCode,
      franchiseManagement: franchiseManagementFromRows(rows),
    });
    const b = computeTextbook(cand.input, P);
    const r0 = (v: number | null | undefined, d = 0) => (v == null ? "-" : v.toFixed(d));
    console.log(`\n[${TARGET} ${candidate.name} 실험실 분해]`);
    console.log(`  주거 이용자 ${r0(b.residentDemandUsers)} (반경 ${b.residentRadiusM}m, 고리 ${r0(b.residentRingUsers)}) · 유동 이용자 ${r0(b.floatingDemandUsers)} · 합 ${r0(b.totalDemandUsers)}명 · 수요시간 ${r0(b.totalDemandHours)}h`);
    console.log(`  점유율 ${r0((b.share ?? 0) * 100, 1)}% · 입지배율 ${r0(b.locationMultiplier, 3)} (${b.locationFactors.map((f) => `${f.key} ${f.value.toFixed(3)}`).join(", ")})`);
    console.log(`  우리 시간 ${r0(b.ownDemandHours)}h · 가동률 ${r0((b.utilization ?? 0) * 100, 1)}%${b.capped ? " (상한)" : ""} · 단가 ${r0(b.unitPrice)}원(PC ${r0(b.pcUnitPrice)} + 상품) · PC매출 ${r0((b.pcRevenue ?? 0) / 1e4)}만 · 상품 ${r0((b.productRevenue ?? 0) / 1e4)}만 · 합 ${r0((b.monthlyRevenue ?? 0) / 1e4)}만`);
    if (b.missing.length) console.log(`  빠진 것: ${b.missing.join(" / ")}`);

    // 기존점: 수요 규모별로 예측/실측 편향
    const scored = rows.filter((r) => !r.excluded).map((r) => {
      const t = computeTextbook(r.input, P);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inp = r.input as any;
      return { name: String(inp.name ?? inp.storeName ?? inp.code ?? "?"), users: t.totalDemandUsers ?? 0, share: t.share ?? 0, util: t.utilization, actualUtil: inp.actualUtilization ?? null, pred: t.monthlyRevenue ?? 0, actual: r.actualRevenue, pc: inp.pcCount ?? inp.ownPcCount ?? null };
    }).sort((a, b2) => a.users - b2.users);
    console.log(`\n[기존점 ${scored.length}곳 — 수요 이용자 적은 순] 예측÷실측`);
    for (const s of scored) console.log(`  ${s.name.padEnd(14)} 이용자 ${String(Math.round(s.users)).padStart(6)} · 몫 ${(s.share * 100).toFixed(1).padStart(5)}% · 예측 ${String(Math.round(s.pred / 1e4)).padStart(5)}만 · 실측 ${String(Math.round(s.actual / 1e4)).padStart(5)}만 · ${(s.pred / s.actual).toFixed(2)}`);
    const q = Math.ceil(scored.length / 4);
    for (let i = 0; i < 4; i++) {
      const g = scored.slice(i * q, (i + 1) * q);
      const ratios = g.map((s) => s.pred / s.actual).sort((a, b2) => a - b2);
      console.log(`  수요 ${i + 1}분위(${g.length}곳, 이용자 ${Math.round(g[0].users)}~${Math.round(g[g.length - 1].users)}): 예측÷실측 중앙 ${ratios[Math.floor(ratios.length / 2)].toFixed(2)} · 평균 ${(ratios.reduce((a, c) => a + c, 0) / ratios.length).toFixed(2)}`);
    }
    expect(b.monthlyRevenue).not.toBeNull();
  });
});
