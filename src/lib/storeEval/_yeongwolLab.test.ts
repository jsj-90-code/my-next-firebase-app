// 영월점 실험실 값 분해 + "작은 시장에서 실험실이 낮게 보나" 기존점 검사 (2026-09-27, 사용자 "영월점 예상매출이 좀 낮은데 올릴 수 있는 개선안").
// 규칙: 한 매장에 맞추지 않는다 — 올릴 근거는 기존점에서 같은 방향 편향이 보일 때만(storeeval rules-must-generalize).
// 조립은 dailyRecompute(크론)·결과 탭과 같다(prepareRecomputeInputs → labCandidateBreakdown과 같은 단계).
// 실행: npx vitest run src/lib/storeEval/_yeongwolLab.test.ts --disable-console-intercept
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot, recomputeSourceFromSnapshot } from "./validationSnapshot";
import { prepareRecomputeInputs } from "./dailyRecompute";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { buildLabCandidateRows, buildLabRows, franchiseManagementFromRows, productUnitPriceEraByStore, utilizationByStore } from "./labInput";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor, LocationEvaluation } from "./types";
import { buildQuickCandidate, buildQuickLocationEvaluation, type QuickEvalPlanInput } from "./quickEval/buildQuickCandidate";
import { floatingPatchFromSbiz } from "./floatingPopulationFromSbiz";

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

    // ── 주소만 초기평가에서는 왜 1,672만인가 — 같은 실험실 식에 주소만 입력을 넣고, 정밀 쪽 사실을 하나씩 얹는다 ──
    const qc = JSON.parse(readFileSync(".local-tools/candidate-quick-eval.json", "utf8"))[TARGET];
    if (!qc) return;
    const plan: QuickEvalPlanInput = { name: candidate.name, address: candidate.address ?? "", expectedPcCount: candidate.expectedPcCount ?? 100, hourlyRate: candidate.hourlyRate ?? 1200, floor: candidate.floor ?? null, groundLevel: candidate.groundLevel ?? null, hasElevator: candidate.hasElevator ?? null, ownFoodBrand: null, plannedOpenMonth: null };
    const built = buildQuickCandidate(plan, { geocode: qc.geocode, sgis: qc.sgis ?? null, floating: qc.floating?.[500] ?? null, pcBangs: qc.pcBangs ?? [], pcBangsPossiblyTruncated: false });
    const quickCand = { ...built.candidate, ...floatingPatchFromSbiz(qc.floating ?? {}).patch };
    const quickLoc = buildQuickLocationEvaluation(plan, qc.locationDraft ?? null);
    const Q = quickCand.code;
    const remap = <V,>(m: Map<string, V> | undefined): Map<string, V> | undefined => {
      if (!m) return m; const out = new Map(m); const v = m.get(TARGET) ?? m.get(`candidate:${TARGET}`); if (v !== undefined) { out.set(Q, v); out.set(`candidate:${Q}`, v); } return out;
    };
    const variants: { label: string; cand: typeof quickCand; comps: Competitor[]; loc: typeof quickLoc; ex: boolean }[] = [
      { label: "주소만 그대로(화면)", cand: quickCand, comps: built.competitors, loc: quickLoc, ex: false },
      { label: "+ 주거 반경 2km 사실(사람 확인)", cand: quickCand, comps: built.competitors, loc: quickLoc, ex: true },
      { label: "+ 2km + 조사 경쟁점", cand: quickCand, comps: (compsByCode.get(TARGET) ?? []).map((c) => ({ ...c, candidateCode: Q })), loc: quickLoc, ex: true },
      { label: "+ 2km + 조사 경쟁점 + 사람 입지평가", cand: quickCand, comps: (compsByCode.get(TARGET) ?? []).map((c) => ({ ...c, candidateCode: Q })), loc: { ...(src.locationEvaluations.find((l) => l.candidateCode === TARGET) as LocationEvaluation), candidateCode: Q }, ex: true },
    ];
    console.log(`\n[${TARGET} 주소만 → 정밀 사실 하나씩] (주소만 카카오 PC방 500m ${built.competitors.length}곳, 조사 경쟁점 ${(compsByCode.get(TARGET) ?? []).length}곳)`);
    for (const v of variants) {
      const cm = new Map(compsByCode); cm.set(Q, v.comps);
      const [row] = buildLabCandidateRows({
        candidates: [v.cand], compsByCode: cm, locByCode: new Map([...src.locationEvaluations, ...(v.loc ? [v.loc] : [])].map((l) => [l.candidateCode, l])), settings,
        roadviewByKey: v.ex ? remap(x?.roadviewByKey) : undefined, residentRingsByCode: v.ex ? remap(x?.residentRingsByCode) : undefined,
        ringBlockedByCode: v.ex ? remap(x?.ringBlockedByCode) : undefined, residentRadiusByCode: v.ex ? remap(x?.residentRadiusByCode) : undefined,
        franchiseManagement: franchiseManagementFromRows(rows),
      });
      const t = computeTextbook(row.input, P);
      void 0;
      console.log(`  ${v.label.padEnd(28)} 이용자 ${r0(t.totalDemandUsers)}(주거 ${r0(t.residentDemandUsers)}·반경 ${t.residentRadiusM}m) · 몫 ${r0((t.share ?? 0) * 100, 1)}% · 입지 ${r0(t.locationMultiplier, 2)} · 가동률 ${r0((t.utilization ?? 0) * 100, 1)}% · 단가 ${r0(t.unitPrice)} · ${r0((t.monthlyRevenue ?? 0) / 1e4)}만${t.missing.length ? ` · 빠짐: ${t.missing.join("/")}` : ""}`);
    }
  });
});

// ── 주거 반경 2km를 **카카오 PC방 수**로 정할 수 있나 — 기존점 되짚기 (2026-09-27) ──
// 지금 2km는 사람이 "2km 안에 다른 PC방 상권 없음"을 확인한 매장만(진주혁신·양주덕정·영월). 주소만 화면은 사람 확인이 없어
// 늘 1km라 영월이 1,672만으로 떨어진다. 물리 사실 규칙 "카카오 PC방이 1~2km 고리에 k곳 이하면 2km"가 기존점 성적을
// 나쁘게 하지 않는지 본다(판정 잣대: 실험실 가동률 MAE, 참고 매출 MAPE).
describeIf("주거 반경 2km 카카오 규칙 되짚기", () => {
  it("k별 성적", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = loadValidationSnapshot<any>();
    const src = recomputeSourceFromSnapshot(snap);
    const prep = prepareRecomputeInputs(src);
    const { settings, competitors, evaluationSales: sales, qscByStoreCode, labExtras: extras } = prep;
    const stores = prepareExistingStoresForEvaluation(src.existingStores, competitors, src.locationEvaluations, settings);
    const compsByCode = new Map<string, Competitor[]>();
    for (const c of competitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
    const x = extras as unknown as Record<string, never>;
    const human = x.residentRadiusByCode as unknown as Map<string, number>;
    const kakao = JSON.parse(readFileSync(".local-tools/kakao-neighborhood.json", "utf8")).sites as Record<string, { pcRooms: { docs: { name: string; distanceM: number }[] } }>;
    const ring = (key: string) => (kakao[key]?.pcRooms?.docs ?? []).filter((d) => d.distanceM > 1000 && d.distanceM <= 2000 && !/블랙라벨/.test(d.name)).length;
    const score = (radius: Map<string, number>) => {
      const rows = buildLabRows({
        stores, compsByCode, utilByStore: utilizationByStore(sales, src.existingStores), settings, qscByStoreCode,
        productUnitPriceByStore: productUnitPriceEraByStore(sales, src.existingStores),
        roadviewByKey: x?.roadviewByKey, residentRingsByCode: x?.residentRingsByCode, ringBlockedByCode: x?.ringBlockedByCode, residentRadiusByCode: radius,
      });
      return scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS);
    };
    const base = score(human);
    const byName = new Map(base.rows.map((r) => [r.storeCode, r]));
    const f = (v: number | null, d = 2) => (v == null ? "-" : v.toFixed(d));
    console.log(`\n[주거 반경 규칙] 기존점 · 실험실 가동률 MAE(%p) · 매출 MAPE`);
    const variants: [string, Map<string, number>][] = [["사람 확인(지금)", human], ["전부 1km", new Map()]];
    for (const k of [0, 1, 2]) {
      const m = new Map<string, number>();
      for (const s of stores) if (kakao[`existing:${s.storeCode}`] && ring(`existing:${s.storeCode}`) <= k) m.set(s.storeCode, 2000);
      variants.push([`카카오 1~2km ${k}곳 이하 → 2km`, m]);
    }
    for (const [label, m] of variants) {
      const sc = score(m);
      const changed = [...m.keys()].filter((c) => !human.has(c)).concat([...human.keys()].filter((c) => !m.has(c) && stores.some((s) => s.storeCode === c)));
      const detail = changed.map((c) => { const a = byName.get(c); const b2 = sc.rows.find((r) => r.storeCode === c); return `${a?.storeName ?? c} 가동률 ${f((a?.utilization ?? 0) * 100, 1)}→${f((b2?.utilization ?? 0) * 100, 1)}(실측 ${f((a?.actualUtilization ?? 0) * 100, 1)})`; }).join(" · ");
      console.log(`  ${label.padEnd(24)} 가동률 MAE ${f(sc.utilizationMaePoints)} · 최악 ${f(sc.utilizationMaxAePoints, 1)} · 매출 MAPE ${f((sc.mape ?? 0) * 100, 1)}%${detail ? ` · 바뀐 곳: ${detail}` : ""}`);
    }
    expect(base.sampleCount).toBeGreaterThan(30);
  });
});
