// 개점 시기로 자르는 되짚기 — "신규 후보지를 맞히는 능력"에 가장 가까운 시험 (2026-09-25 밤, 사용자 "응 해봐"). 읽기전용.
//
// 컷오프 이전에 연 매장만으로 두 산식을 만들고, 컷오프 이후에 연 매장(=그때 기준 "신규 후보지")을 맞힌다.
//   V62: runUsageCohortValidation(trainingSubset = 컷오프 이전 개점) — 이후 매장은 학습에 한 번도 안 들어간 모형으로 예측된다.
//   실험실: 상품몫은 컷오프 시점 규칙값(그때까지의 매출DB로 "직전 18개월 개점 중앙"), 매장별 세대 값(override)은 안 쓴다(후보지처럼).
//     ⚠️ 나머지 실험실 값(축척 8.20h·몫 상한 k0.18·배수·θ3)은 전 표본에서 정했다 — 실험실 쪽에 유리한 누출이 남는다. 결과를 읽을 때 감안.
// 함께 V62 개선 후보(이번 세션에 확인한 사실)를 같은 두 잣대(전 표본 LOOCV · 시간 되짚기)로 잰다:
//   V62+과금: hourlyRate에 유료게임 과금을 더한다(실험실과 같은 정의, 후보지는 이미 합산해 넣음 — 사용자 2026-09-25).
// 실행: npx vitest run src/lib/storeEval/_timeSplitBacktest.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { computeCompetitorInvestigationSummary, type ValidationStoreInput } from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { buildLabRows, paidGameSurchargeByStoreFromTariff, productUnitPriceByRule, qscInWindowAverage, residentRadiusByCodeFromDocs, utilizationByStore, type QscRecord } from "./labInput";
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
const summary = (e: number[]) => `n=${e.length} · MAPE ${pct(mean(e.map(Math.abs)))} · 중앙 ${pct(median(e.map(Math.abs)))} · 편향 ${sgn(mean(e))}% · ±10% ${e.filter((v) => Math.abs(v) <= 0.1).length} · ±20% ${e.filter((v) => Math.abs(v) <= 0.2).length} · 최악 ${pct(Math.max(...e.map(Math.abs)))}`;

describeIf("개점 시기 되짚기 — V62 vs 실험실, 그리고 V62 개선 후보", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wanted = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s: { storeCode: string; yearMonth: string }) => wanted.has(`${s.storeCode}_${s.yearMonth}`));
  const qsc = new Map<string, number>();
  for (const d of (snap.labQscScores ?? []) as { storeCode?: string; openedAt?: string; records?: QscRecord[] }[]) { if (!d.storeCode) continue; const a = qscInWindowAverage(d.records ?? [], d.openedAt ?? null); if (a != null && a > 0) qsc.set(d.storeCode, a); }
  const storesV = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings, qsc);
  const compsByLookup = new Map<string, Competitor[]>(); for (const c of allCompetitors) compsByLookup.set(c.candidateCode, [...(compsByLookup.get(c.candidateCode) ?? []), c]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const locByLookup = new Map((snap.locationEvaluations as any[]).map((l) => [l.candidateCode, l]));
  const paid = paidGameSurchargeByStoreFromTariff();
  const openedOf = new Map((snap.existingStores as { storeCode: string; openedAt: string | null }[]).map((s) => [s.storeCode, s.openedAt ?? ""]));
  const makeInputs = (withPaid: boolean) => storesV.map((s) => {
    const lk = existingStoreSourceCode(s); const loc = locByLookup.get(lk) ?? null; const competitors = compsByLookup.get(lk) ?? [];
    // 2026-09-25 밤부터 prepare가 과금을 더해 온다 — 과금 없는 비교는 기본요금(hourlyRateBase)으로
    const rate = withPaid ? s.hourlyRate : (s.hourlyRateBase ?? s.hourlyRate);
    return {
      storeCode: s.storeCode, storeName: s.storeName, brand: s.brandType ?? loc?.brandType ?? null, openedAt: s.openedAt, completedMonths: s.completedMonths ?? 0,
      franchiseStatus: s.franchiseStatus, isPostOpenIssue: s.excludedFromModel, postOpenIssueReason: s.excludedReason, pcCount: s.pcCount, evaluationPcCount: s.evaluationPcCount,
      hourlyRate: rate, ownDemand: s.ownDemand, marketDemand: s.marketDemand, competitorIp: s.competitorIp,
      extraPcHours: computeOverflowPcHours(s.marketDemand, { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore }, competitors, settings),
      competitivenessScore: s.competitivenessScore, competitivenessGap: s.competitivenessGap, actualRevenueAvg: s.actualMonthlyRevenueAvg,
      specialDemandType: s.specialDemandType, specialDemandIntensity: s.specialDemandIntensity, inflowRestriction: loc?.inflowRestriction ?? null,
      visibilityScore: loc?.visibilityScore ?? null, preemptionScore: loc?.preemptionScore ?? null, hasLocationEvaluation: loc != null,
      floor: s.floor, groundLevel: s.groundLevel, hasElevator: s.hasElevator, competitorSummary: computeCompetitorInvestigationSummary(competitors), sheetV61Predicted: s.v61Predicted,
    } as ValidationStoreInput;
  });
  type VRow = { storeCode: string; storeName: string; brand: string; includedInCoreAccuracy: boolean; v62PredictedRevenueAvg: number | null; actualRevenueAvg: number | null };
  type Opt = { tariff?: false | "usage" | "both"; perHour?: boolean };
  const runV62 = (withPaid: boolean, subset?: Set<string>, opt: Opt = {}) => {
    const { rows } = runUsageCohortValidation(makeInputs(withPaid), sales, settings, new Date(), opt.tariff ?? undefined, opt.perHour ?? undefined, 1, undefined, subset);
    return new Map((rows as unknown as VRow[]).filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy && r.v62PredictedRevenueAvg != null && (r.actualRevenueAvg ?? 0) > 0)
      .map((r) => [r.storeCode, { name: r.storeName, e: (r.v62PredictedRevenueAvg as number) / (r.actualRevenueAvg as number) - 1, act: r.actualRevenueAvg as number }]));
  };

  // 실험실 조립(세대 override 없음 — 후보지처럼 상수 하나)
  const storesL = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
  const ringBlockedByCode = new Map<string, number>();
  for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) { const c = j.ringCutCount ?? j.blockedCount; if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c); }
  const labRows = buildLabRows({
    stores: storesL, compsByCode: compsByLookup, utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores), settings, qscByStoreCode: qsc,
    paidGameSurchargeByStore: paid, residentRingsByCode: ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined, ringBlockedByCode,
    residentRadiusByCode: residentRadiusByCodeFromDocs(snap.labResidentRadius ?? []),
  });
  const P0 = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(labRows, DEFAULT_TEXTBOOK_PARAMS));
  const labErr = (code: string, act: number, productUnitPrice: number) => {
    const r = labRows.find((x) => x.input.storeCode === code); if (!r) return null;
    const rev = computeTextbook(r.input, { ...P0, productUnitPrice }).monthlyRevenue; return rev == null ? null : rev / act - 1;
  };

  it("(1) 전 표본(매장 하나씩 빼고) — V62 · V62+과금 · 실험실(규칙값 1,721 상수)", () => {
    const v = runV62(false), vp = runV62(true);
    const codes = [...v.keys()];
    const lab = codes.map((c) => labErr(c, v.get(c)!.act, P0.productUnitPrice)).filter((x): x is number => x != null);
    console.log(`\n[전 표본 ${codes.length}곳]`);
    console.log(`  V62          ${summary(codes.map((c) => v.get(c)!.e))}`);
    console.log(`  V62+과금     ${summary(codes.map((c) => vp.get(c)!.e))}`);
    console.log(`  실험실(상수) ${summary(lab)}   ← 세대 override 없이(후보지 조건)`);
    expect(codes.length).toBeGreaterThan(30);
  });

  it("(3) V62 설정 후보 — 과금 포함 기준에서 먹거리 이용시간당 · 요금 피처, 세 잣대(전 표본 · 컷오프 2024-12 · 2024-06)", () => {
    const opts: { label: string; opt: Opt }[] = [
      { label: "V62+과금(지금 채택)", opt: {} },
      { label: "+ 먹거리 이용시간당", opt: { perHour: true } },
      { label: "+ 요금 피처(usage)", opt: { tariff: "usage" } },
      { label: "+ 요금 피처(both)", opt: { tariff: "both" } },
    ];
    console.log(`\n[V62 설정 후보 — MAPE: 전 표본 / 컷오프 2024-12 이후 / 2024-06 이후]`);
    for (const o of opts) {
      const cells: string[] = [];
      for (const cutoff of [null, "2024-12", "2024-06"]) {
        const before = cutoff ? new Set([...openedOf].filter(([, op]) => op && op.slice(0, 7) <= cutoff).map(([c]) => c)) : undefined;
        const v = runV62(true, before, o.opt);
        const es = [...v.entries()].filter(([c]) => !before || !before.has(c)).map(([, x]) => x.e);
        cells.push(`${pct(mean(es.map(Math.abs)))}(±20% ${es.filter((e) => Math.abs(e) <= 0.2).length}/${es.length})`);
      }
      console.log(`  ${pad(o.label, 22)} ${cells.join("  ")}`);
    }
    console.log(`  ⭐ 채택 기준(09-10과 같음): 세 잣대 모두 나빠지지 않고 둘 이상에서 뚜렷이 좋아질 때만.`);
    expect(opts.length).toBe(4);
  });

  it("(4) 동탄북광장·송도를 V62 표본에 넣으면 (사용자 2026-09-25 밤) — 원래 38곳 성적 · 두 매장 자체 오차 · 시간 되짚기", () => {
    // 사용자: "동탄은 관리점수가 반영됐고, 송도는 요금 1,000원으로 적용했다 — 문제를 데이터로 바꿨다." 확인 결과: 송도 요금 1,000은 맞다(원인이 입력에 있음).
    // 동탄은 QSC 기록이 **없어** 관리 점수가 가맹점 평균으로 들어간다 — 운영관리 문제가 입력에 없다. 그래서 송도만 넣는 줄도 같이 본다.
    const ONLY = (process.env.INCLUDE_ONLY ?? "").split(",").filter(Boolean);
    const INCLUDE = new Set(ONLY.length ? ONLY : ["20250124421", "20260515431"]); // 동탄북광장(운영관리 문제) · 송도(경쟁점 500원 가격전쟁)
    const run = (include: boolean, subset?: Set<string>) => {
      const inputs = makeInputs(true).map((s) => (include && INCLUDE.has(s.storeCode) ? { ...s, isPostOpenIssue: false } : s));
      const { rows } = runUsageCohortValidation(inputs, sales, settings, new Date(), undefined, undefined, 1, undefined, subset);
      return new Map((rows as unknown as VRow[]).filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy && r.v62PredictedRevenueAvg != null && (r.actualRevenueAvg ?? 0) > 0)
        .map((r) => [r.storeCode, { name: r.storeName, e: (r.v62PredictedRevenueAvg as number) / (r.actualRevenueAvg as number) - 1 }]));
    };
    const a = run(false), b = run(true);
    const base = [...a.keys()];
    console.log(`\n[동탄북광장·송도 포함 — V62+과금 기준]`);
    console.log(`  지금(뺌)        원래 ${base.length}곳 ${summary(base.map((c) => a.get(c)!.e))}`);
    console.log(`  넣음            원래 ${base.length}곳 ${summary(base.map((c) => b.get(c)!.e))}   ← 두 매장이 학습에 들어가 다른 매장이 어떻게 움직이나`);
    console.log(`  넣음            전체 ${b.size}곳 ${summary([...b.values()].map((x) => x.e))}`);
    for (const c of INCLUDE) { const x = b.get(c); console.log(`     ${x ? `${pad(x.name, 12)} 자기 오차 ${sgn(x.e)}%(자기 빼고 학습한 모형)` : `${c} 표본에 안 들어감(완료월·자료 부족?)`}`); }
    const moved = base.map((c) => ({ n: a.get(c)!.name, d: Math.abs(b.get(c)!.e) - Math.abs(a.get(c)!.e) })).filter((x) => Math.abs(x.d) > 0.01).sort((p, q) => q.d - p.d);
    console.log(`  |오차| 1%p 넘게 움직인 매장: ${moved.map((x) => `${x.n.replace(/점$/, "")} ${sgn(x.d)}`).join(" · ") || "없음"}`);
    for (const cutoff of ["2024-12", "2024-06"]) {
      const before = new Set([...openedOf].filter(([, op]) => op && op.slice(0, 7) <= cutoff).map(([c]) => c));
      const ta = run(false, before), tb = run(true, before);
      const la = [...ta.keys()].filter((c) => !before.has(c)), lb = [...tb.keys()].filter((c) => !before.has(c));
      console.log(`  컷오프 ${cutoff} 이후   뺌 ${summary(la.map((c) => ta.get(c)!.e))}\n                      넣음 ${summary(lb.map((c) => tb.get(c)!.e))}   (넣음은 두 매장이 평가 대상에도 들어감 — 동탄 2025-01 개점은 컷오프 뒤)`);
    }
    expect(b.size).toBeGreaterThanOrEqual(a.size);
  });

  for (const cutoff of ["2024-12", "2024-06"]) {
    it(`(2) 컷오프 ${cutoff} — 그 전에 연 매장으로 만들고 그 뒤에 연 매장을 맞힌다`, () => {
      const before = new Set([...openedOf].filter(([, o]) => o && o.slice(0, 7) <= cutoff).map(([c]) => c));
      const v = runV62(false, before), vp = runV62(true, before);
      const later = [...v.keys()].filter((c) => !before.has(c));
      // 실험실 상품몫 — 컷오프까지의 매출DB로 규칙을 돌린 값(그때 알 수 있던 것)
      const salesTo = (snap.sales as { yearMonth: string }[]).filter((s) => s.yearMonth <= cutoff);
      const rule = productUnitPriceByRule(salesTo as never, (snap.existingStores as never[]));
      const pu = rule.value ?? P0.productUnitPrice;
      const rows = later.map((c) => ({ c, name: v.get(c)!.name, eV: v.get(c)!.e, eVp: vp.get(c)!.e, eL: labErr(c, v.get(c)!.act, pu) })).filter((x) => x.eL != null) as { c: string; name: string; eV: number; eVp: number; eL: number }[];
      console.log(`\n[컷오프 ${cutoff}] 학습 ${before.size}곳 → 이후 개점 ${rows.length}곳 예측. 실험실 상품몫 = 그 시점 규칙값 ${Math.round(pu)}원(직전 ${rule.windowMonths}개월 ${rule.stores.length}곳)`);
      console.log(`  ${pad("매장", 16)} ${"개점".padStart(8)} ${"V62".padStart(7)} ${"V62+과금".padStart(9)} ${"실험실".padStart(7)}`);
      for (const x of rows.sort((a, b) => (openedOf.get(a.c) ?? "").localeCompare(openedOf.get(b.c) ?? ""))) console.log(`  ${pad(x.name, 16)} ${(openedOf.get(x.c) ?? "").slice(0, 7).padStart(8)} ${sgn(x.eV).padStart(7)} ${sgn(x.eVp).padStart(9)} ${sgn(x.eL).padStart(7)}`);
      console.log(`  V62          ${summary(rows.map((x) => x.eV))}`);
      console.log(`  V62+과금     ${summary(rows.map((x) => x.eVp))}`);
      console.log(`  실험실       ${summary(rows.map((x) => x.eL))}`);
      console.log(`  실험실이 더 가까운 매장 ${rows.filter((x) => Math.abs(x.eL) < Math.abs(x.eV)).length}/${rows.length} · 두 산식 평균 ${summary(rows.map((x) => (x.eL + x.eV) / 2))}`);
      expect(rows.length).toBeGreaterThan(5);
    });
  }
});
