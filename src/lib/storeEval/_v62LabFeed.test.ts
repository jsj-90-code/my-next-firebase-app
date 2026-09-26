// 2단계 — 실험실 자료를 V62에 대입하면 나아지나 (2026-09-26 밤, 사용자 "2단계 시작해"). 읽기전용·측정만.
//
// V62 피처(calc.ts empiricalFeaturesFor): log(요금) · log(상권수요 ÷ (자사PC + 경쟁IP)) · 경쟁력 · 경쟁력×log격차 · 배후수요 더미 · log(가시성×선점)
// 실험실 자료가 들어갈 자리는 **상권수요 칸**과 **경쟁IP 칸**이다. 변형(전부 넣거나 전부 빼기 — 표본마다 섞지 않는다):
//   A 수요 ← 실험실 총수요(사람수: 주거 1km+고리+반경 사실 · 유동 400m 연령가중 · 흡인·밀집 · 특수수요 배수 포함)
//   B 수요 ← 실험실 총수요, 특수수요 배수 **뺌**(V62 배후수요 더미와 이중계산 방지)
//   C 경쟁IP ← 실험실 경쟁 무게(Σ 경쟁점 PC × 거리 감쇠, 2km 경쟁점 포함)
//   D = B + C
//   E 수요 ← B × 실험실 입지배율(중심도·접근성)
// ⚠️ 넘침 이용시간(computeOverflowPcHours)은 **원래 V62 상권수요**로 계산한다 — 단위가 달라 바꾸면 뜻이 깨진다.
// ⚠️ 후보지에서도 같은 값을 낼 수 있어야 채택 후보다(buildLabCandidateRows가 같은 항목을 만든다 — 학습에만 있는 피처 금지, 09-14 교훈).
// ⚠️ 실험실 값(축척·몫 상한·배수)은 전 표본에서 정했다 — 컷오프 되짚기에서 실험실 쪽에 유리한 누출이 남는다.
// 채택 기준(09-10·09-25와 같음, 결과 전 적음): 세 잣대(전 표본 · 컷오프 2024-12 이후 · 2024-06 이후) 모두 나빠지지 않고 둘 이상에서 뚜렷이 좋아질 때만.
//
// 실행: npx vitest run src/lib/storeEval/_v62LabFeed.test.ts --disable-console-intercept
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
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, rivalDistanceWeight, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };

describeIf("2단계 — 실험실 자료를 V62 피처에 대입", () => {
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
  const openedOf = new Map((snap.existingStores as { storeCode: string; openedAt: string | null }[]).map((s) => [s.storeCode, s.openedAt ?? ""]));

  // 실험실 조립 — _timeSplitBacktest와 같다
  const storesL = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
  const ringBlockedByCode = new Map<string, number>();
  for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) { const c = j.ringCutCount ?? j.blockedCount; if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c); }
  const labRows = buildLabRows({
    stores: storesL, compsByCode: compsByLookup, utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores), settings, qscByStoreCode: qsc,
    paidGameSurchargeByStore: paidGameSurchargeByStoreFromTariff(), residentRingsByCode: ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined, ringBlockedByCode,
    residentRadiusByCode: residentRadiusByCodeFromDocs(snap.labResidentRadius ?? []),
  });
  const P0 = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(labRows, DEFAULT_TEXTBOOK_PARAMS));
  // 실험실 표본에서 빠진 매장(V62에는 있음)도 **같은 자**로 값을 내야 공정하다 — 같은 조립의 "excluded" 쪽을 더한다(채점엔 안 씀, 값만 씀).
  labRows.push(...buildLabRows({
    stores: storesL, compsByCode: compsByLookup, utilByStore: utilizationByStore(snap.sales ?? [], snap.existingStores), settings, qscByStoreCode: qsc,
    paidGameSurchargeByStore: paidGameSurchargeByStoreFromTariff(), residentRingsByCode: ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined, ringBlockedByCode,
    residentRadiusByCode: residentRadiusByCodeFromDocs(snap.labResidentRadius ?? []), which: "excluded",
  }));
  const P_noSd = { ...P0, specialDemandMultipliers: {} };
  type LabVals = { demand: number | null; demandNoSd: number | null; rivalW: number | null; rivalW500: number | null; rivalFlat2km: number | null; loc: number | null };
  const lab = new Map<string, LabVals>();
  for (const r of labRows) {
    const b = computeTextbook(r.input, P0), b2 = computeTextbook(r.input, P_noSd);
    const rv = r.input.rivals;
    // 2km 경쟁점은 이름 없이(parts null) 500m 밖 거리로 들어온다 — 500m 안(조사)과 밖(2km)을 거리로 가른다.
    const inner = rv?.filter((x) => (x.distanceM ?? 0) <= 500) ?? null;
    const rivalW = rv ? rv.reduce((s, x) => s + x.ip * rivalDistanceWeight(x.distanceM, P0), 0) : null;
    const rivalW500 = inner ? inner.reduce((s, x) => s + x.ip * rivalDistanceWeight(x.distanceM, P0), 0) : null;
    const rivalFlat2km = rv ? rv.reduce((s, x) => s + x.ip, 0) : null;
    lab.set(r.input.storeCode, { demand: b.totalDemandUsers, demandNoSd: b2.totalDemandUsers, rivalW, rivalW500, rivalFlat2km, loc: b.locationMultiplier });
  }

  type Variant = { label: string; demand?: (v: LabVals) => number | null; ip?: (v: LabVals) => number | null };
  const variants: Variant[] = [
    { label: "V62+과금(지금)" },
    { label: "A 수요←실험실", demand: (v) => v.demand },
    { label: "B 수요←실험실(배수 뺌)", demand: (v) => v.demandNoSd },
    { label: "C 경쟁←실험실 거리감쇠", ip: (v) => v.rivalW },
    { label: "C1 거리감쇠·500m 안만", ip: (v) => v.rivalW500 },
    { label: "C2 감쇠 없이·2km까지 합", ip: (v) => v.rivalFlat2km },
    { label: "D = B + C", demand: (v) => v.demandNoSd, ip: (v) => v.rivalW },
    { label: "E 수요←B×입지배율", demand: (v) => (v.demandNoSd != null && v.loc != null ? v.demandNoSd * v.loc : null) },
  ];

  const makeInputs = (vr: Variant) => storesV.map((s) => {
    const lk = existingStoreSourceCode(s); const loc = locByLookup.get(lk) ?? null; const competitors = compsByLookup.get(lk) ?? [];
    const lv = lab.get(s.storeCode);
    // 실험실 값이 없는 매장은 대입하지 않고 표본에서 빼야 공정하다 — 여기선 null이면 V62 값 유지 후 아래에서 개수를 센다.
    const md = vr.demand && lv ? vr.demand(lv) : null;
    const ip = vr.ip && lv ? vr.ip(lv) : null;
    return {
      storeCode: s.storeCode, storeName: s.storeName, brand: s.brandType ?? loc?.brandType ?? null, openedAt: s.openedAt, completedMonths: s.completedMonths ?? 0,
      franchiseStatus: s.franchiseStatus, isPostOpenIssue: s.excludedFromModel, postOpenIssueReason: s.excludedReason, pcCount: s.pcCount, evaluationPcCount: s.evaluationPcCount,
      hourlyRate: s.hourlyRate, ownDemand: s.ownDemand, marketDemand: md ?? s.marketDemand, competitorIp: ip ?? s.competitorIp,
      extraPcHours: computeOverflowPcHours(s.marketDemand, { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore }, competitors, settings),
      competitivenessScore: s.competitivenessScore, competitivenessGap: s.competitivenessGap, actualRevenueAvg: s.actualMonthlyRevenueAvg,
      specialDemandType: s.specialDemandType, specialDemandIntensity: s.specialDemandIntensity, inflowRestriction: loc?.inflowRestriction ?? null,
      visibilityScore: loc?.visibilityScore ?? null, preemptionScore: loc?.preemptionScore ?? null, hasLocationEvaluation: loc != null,
      floor: s.floor, groundLevel: s.groundLevel, hasElevator: s.hasElevator, competitorSummary: computeCompetitorInvestigationSummary(competitors), sheetV61Predicted: s.v61Predicted,
      _subbed: (vr.demand ? md != null : true) && (vr.ip ? ip != null : true),
    } as ValidationStoreInput & { _subbed: boolean };
  });
  type VRow = { storeCode: string; storeName: string; brand: string; includedInCoreAccuracy: boolean; v62PredictedRevenueAvg: number | null; actualRevenueAvg: number | null };
  const run = (vr: Variant, subset?: Set<string>) => {
    const inputs = makeInputs(vr);
    const missing = inputs.filter((x) => !x._subbed).map((x) => x.storeName);
    const { rows } = runUsageCohortValidation(inputs, sales, settings, new Date(), undefined, undefined, 1, undefined, subset);
    const m = new Map((rows as unknown as VRow[]).filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy && r.v62PredictedRevenueAvg != null && (r.actualRevenueAvg ?? 0) > 0)
      .map((r) => [r.storeCode, (r.v62PredictedRevenueAvg as number) / (r.actualRevenueAvg as number) - 1]));
    return { m, missing };
  };

  it("(1) 변형별 세 잣대 — MAPE(±20% 적중/표본)", () => {
    console.log(`\n[V62 피처에 실험실 자료 대입] MAPE(±20% 적중/n) · 전 표본은 매장 하나씩 빼고, 컷오프는 그 전 개점으로 학습해 이후 개점을 맞힘`);
    console.log(`  ${pad("변형", 26)} ${"전 표본".padEnd(20)} ${"컷오프 2024-12 이후".padEnd(20)} ${"컷오프 2024-06 이후".padEnd(20)} 중앙(전 표본)`);
    for (const vr of variants) {
      const cells: string[] = [];
      let med = "";
      let miss: string[] = [];
      for (const cutoff of [null, "2024-12", "2024-06"]) {
        const before = cutoff ? new Set([...openedOf].filter(([, op]) => op && op.slice(0, 7) <= cutoff).map(([c]) => c)) : undefined;
        const { m, missing } = run(vr, before);
        miss = missing;
        const es = [...m.entries()].filter(([c]) => !before || !before.has(c)).map(([, e]) => e);
        cells.push(`${pct(mean(es.map(Math.abs)))}(${es.filter((e) => Math.abs(e) <= 0.2).length}/${es.length})`.padEnd(20));
        if (!cutoff) med = pct(median(es.map(Math.abs)));
      }
      console.log(`  ${pad(vr.label, 26)} ${cells.join(" ")} ${med}${miss.length ? `  · 실험실 값 없어 V62 값 유지 ${miss.length}곳` : ""}`);
    }
    console.log(`  ⭐ 채택 기준: 세 잣대 모두 나빠지지 않고 둘 이상에서 뚜렷이 좋아질 때만(09-10·09-25와 같음).`);
    expect(variants.length).toBe(8);
  });

  it("(2) C 뜯어보기 — 빠진 매장 · 매장별 이동 · 두 경쟁 자의 차이", () => {
    const C = variants.find((v) => v.label.startsWith("C "))!;
    const base = run(variants[0]).m, c = run(C);
    console.log(`\n[C 경쟁←실험실 거리감쇠] 실험실 값 없어 V62 값 유지: ${c.missing.join(" · ") || "없음"}`);
    const nameOf = new Map(storesV.map((s) => [s.storeCode, s.storeName]));
    const ipOf = new Map(storesV.map((s) => [s.storeCode, s.competitorIp]));
    const rows = [...base.keys()].map((k) => ({ k, n: nameOf.get(k) ?? k, e0: base.get(k)!, e1: c.m.get(k) ?? NaN, ip0: ipOf.get(k) ?? 0, ip1: lab.get(k)?.rivalW ?? NaN }))
      .sort((a, b) => (Math.abs(b.e1) - Math.abs(b.e0)) - (Math.abs(a.e1) - Math.abs(a.e0)));
    console.log(`  ${pad("매장", 14)} ${"V62 오차".padStart(8)} ${"C 오차".padStart(8)}  |변화|   V62 경쟁IP  실험실 경쟁무게`);
    for (const r of rows.filter((r) => Math.abs(Math.abs(r.e1) - Math.abs(r.e0)) > 0.02)) {
      console.log(`  ${pad(r.n, 14)} ${(r.e0 * 100).toFixed(1).padStart(8)} ${(r.e1 * 100).toFixed(1).padStart(8)}  ${((Math.abs(r.e1) - Math.abs(r.e0)) * 100).toFixed(1).padStart(5)}   ${Math.round(r.ip0).toString().padStart(8)}  ${Math.round(r.ip1).toString().padStart(8)}`);
    }
    const out = rows.filter((r) => Math.abs(r.e0) <= 0.2 && Math.abs(r.e1) > 0.2).map((r) => r.n);
    const inn = rows.filter((r) => Math.abs(r.e0) > 0.2 && Math.abs(r.e1) <= 0.2).map((r) => r.n);
    console.log(`  ±20% 밖으로 나감: ${out.join(" · ") || "없음"} · 안으로 들어옴: ${inn.join(" · ") || "없음"}`);
    const both = rows.filter((r) => Number.isFinite(r.ip1));
    const lr = (v: number) => Math.log(1 + v);
    const x = both.map((r) => lr(r.ip0)), y = both.map((r) => lr(r.ip1));
    const mx = mean(x), my = mean(y);
    const rr = mean(x.map((v, i) => (v - mx) * (y[i] - my))) / Math.sqrt(mean(x.map((v) => (v - mx) ** 2)) * mean(y.map((v) => (v - my) ** 2)));
    console.log(`  두 경쟁 자의 log 상관 r=${rr.toFixed(3)} · 매장이 이긴 수 ${rows.filter((r) => Math.abs(r.e1) < Math.abs(r.e0) - 0.005).length} / 진 수 ${rows.filter((r) => Math.abs(r.e1) > Math.abs(r.e0) + 0.005).length}`);
    expect(rows.length).toBeGreaterThan(30);
  });
});
