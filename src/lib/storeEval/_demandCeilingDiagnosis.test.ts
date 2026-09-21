// Astra 2026-09-21: 점유율100%에서도 매출이 모자라는 이유를 분해한다. 계수 탐색/본체 수정 없음.
// 사전 정의: H=산식 총수요시간, O=자사 실측 사용시간(PC*720*가동률), U=시간당 총매출.
// O/H>1은 수요 부족의 하한 증거(사용시간 관측/기간/대수의 정확성을 전제).
// O/H<=1은 수요식 검증 통과가 아니다: O=시장총수요*실제점유율이라 둘을 식별 못 한다.
// 매출 부족=수요 부족이라고 단정하지 않는다: 시간당 단가, 입지, 상한을 각각 확인한다.
// 본체 가동률 창(+1~12)과 매출 창(+2~12, 없으면+1~12)을 그대로 비교하고,
// 같은 매출월의 가동률로 재적합한 진단도 병기한다. 결측월을 임의 보간하지 않는다.
// 분해 항등식: 예측/실제 = (H/O)*예측점유율*상한배율*(예측U/관측U).
// 이는 원인별 인과 기여도가 아니다. O/H와 예측점유율 차이에는 수요 오차도 섞인다.
// 실행: npx vitest run src/lib/storeEval/_demandCeilingDiagnosis.test.ts --disable-console-intercept
//
// 첫 결과 2026-09-21T02:17:08.861Z 스냅샷:
// 기간 정렬/재적합 후에도 문경 O/H=1.882662, 양주덕정=1.229658.
// 두 곳 모두 11/11개월 자사 사용시간만으로 추정 시장수요를 초과. 상한 탓 아님.
// 강릉교동 O/H=.900154인데 100% 매출8317만원 < 실제9230만원:
// 총단가 -18.888% (상품몫 예상1450원 vs 관측1890원)도 분리해서 봐야 한다.
// 광주첨단 예측몫20.05% vs 필요몫38.30%는 '수요가 맞다'는 조건부 경쟁 의심.
// 기간정렬 LOO MAPE21.0861%, 현재21.1084%: 기간 차이는 큰 오차의 주원인 아님.
// 현재 38점 중 과소21점, -20% 이하12점, +20% 초과5점; 기간정렬해도 동일.
// 인구 부족/방문 빈도/체류시간 중 무엇인지는 자사 가동률만으로 식별 불가.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor, ExistingStoreMonthlySales } from "./types";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (v: number) => Math.round(v * 10000) / 10000;
it("수요 하한·단가·경쟁/입지·상한·평균기간을 분리한다", () => {
  expect(hasValidationSnapshot()).toBe(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const P = structuredClone(DEFAULT_TEXTBOOK_PARAMS);
  const settings = mergeModelSettings(snap.settings);
  const competitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of competitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, competitors, snap.locationEvaluations, settings);
  const qscByStoreCode = new Map<string, number>();
  for (const site of snap.labQscScores as { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] }[]) {
    const code = site.storeCode ?? site.id;
    const value = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (code && value != null) qscByStoreCode.set(code, value);
  }
  const util = utilizationByStore(snap.sales ?? [], snap.existingStores);
  const rows = buildLabRows({ stores, compsByCode, settings, qscByStoreCode, utilByStore: util });
  const metadata = new Map<string, { months: number; coverage: number; pairedUtil: number; revenueMismatch: number; monthlyUtils: number[]; pcRevenue: number; productRevenue: number }>();
  const sales: ExistingStoreMonthlySales[] = snap.sales;
  for (const row of rows) {
    const store = stores.find((s) => s.storeCode === row.input.storeCode)!;
    const window = evaluationMonths(store.openedAt);
    const complete = sales.filter((s) => s.storeCode === store.storeCode && window.includes(s.yearMonth)
      && (s.pcSales ?? 0) + (s.productSales ?? 0) > 0);
    const from2 = complete.filter((s) => window.indexOf(s.yearMonth) >= 1);
    const target = from2.length ? from2 : complete;
    const observed = target.filter((s) => s.utilizationRate != null && s.utilizationRate > 0);
    const revenue = mean(target.map((s) => (s.pcSales ?? 0) + (s.productSales ?? 0)));
    metadata.set(store.storeCode, { months: target.length, coverage: observed.length / target.length,
      pairedUtil: mean(observed.map((s) => s.utilizationRate!)), revenueMismatch: revenue / row.actualRevenue - 1,
      monthlyUtils: observed.map((s) => s.utilizationRate!),
      pcRevenue: mean(target.map((s) => s.pcSales ?? 0)), productRevenue: mean(target.map((s) => s.productSales ?? 0)) });
    expect(Math.abs(revenue / row.actualRevenue - 1)).toBeLessThan(.005);
  }
  expect([...metadata.values()].every((v) => v.coverage === 1), "같은 월 전체에 가동률이 있어야 시간과 매출 분해 가능").toBe(true);
  const aligned = rows.map((row) => ({ ...row, input: { ...row.input, actualUtilization: metadata.get(row.input.storeCode)!.pairedUtil } }));
  const diagnose = (source: LabRow[], loo = false) => source.map((row, index) => {
    const fit = fittedParams(P, scoreTextbook(loo ? source.filter((_, i) => i !== index) : source, P));
    const b = computeTextbook(row.input, fit);
    const free = computeTextbook(row.input, { ...fit, shareMode: "off", maxUtilization: Infinity });
    const freeCapped = computeTextbook(row.input, { ...fit, shareMode: "off" });
    const noRival = computeTextbook({ ...row.input, rivals: [], competitorIp: 0 }, fit);
    const O = row.input.pcCount! * 720 * row.input.actualUtilization!;
    const H = free.totalDemandHours!;
    const unitObserved = row.actualRevenue / O;
    const capFactor = b.ownDemandHours! / (H * b.share!);
    const ratio = b.monthlyRevenue! / row.actualRevenue;
    expect((H / O) * b.share! * capFactor * (b.unitPrice! / unitObserved)).toBeCloseTo(ratio, 12);
    const meta = metadata.get(row.input.storeCode)!;
    return { name: row.input.storeName, code: row.input.storeCode,
      actualMan: row.actualRevenue / 10000, predictedMan: b.monthlyRevenue! / 10000,
      errPct: (ratio - 1) * 100, needSharePct: O / H * 100, predictedSharePct: b.share! * 100,
      unitErrPct: (b.unitPrice! / unitObserved - 1) * 100, unitObserved, unitPredicted: b.unitPrice!,
      pcUnitObserved: meta.pcRevenue / O, pcUnitPredicted: b.pcUnitPrice!,
      productUnitObserved: meta.productRevenue / O, productUnitPredicted: fit.productUnitPrice,
      freeRevenueMan: free.monthlyRevenue! / 10000, freeCappedMan: freeCapped.monthlyRevenue! / 10000,
      noRivalMan: noRival.monthlyRevenue! / 10000, capped: b.capped,
      location: b.locationMultiplier!, actualUtilPct: row.input.actualUtilization! * 100,
      H, O, requiredHoursPerUser: O / free.totalDemandUsers!, fittedHoursPerUser: fit.hoursPerUserPerMonth,
      resident: free.residentDemandUsers!, floating: free.floatingDemandUsers!,
      special: row.input.specialDemandType, targetMonths: meta.months,
      overDemandMonthCount: meta.monthlyUtils.filter((u) => row.input.pcCount! * 720 * u > H).length };
  });
  const original = diagnose(rows), paired = diagnose(aligned), loo = diagnose(aligned, true);
  const summarize = (label: string, data: typeof original) => ({ label, n: data.length,
    under: data.filter((d) => d.errPct < 0).length, under20: data.filter((d) => d.errPct < -20).length,
    over20: data.filter((d) => d.errPct > 20).length, MAPE: mean(data.map((d) => Math.abs(d.errPct))),
    signedError: mean(data.map((d) => d.errPct)), demandOver100: data.filter((d) => d.needSharePct > 100).length,
    demandOver105: data.filter((d) => d.needSharePct > 105).length,
    revenueBeyond100: data.filter((d) => d.actualMan > d.freeRevenueMan).length,
    capped: data.filter((d) => d.capped).length });
  const compact = (d: (typeof original)[number]) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "number" ? round(v) : v]));
  console.log("[재현]", JSON.stringify({ fetchedAt: snap.fetchedAt,
    hash: createHash("sha256").update(readFileSync(".local-tools/validation-snapshot.json")).digest("hex"), params: P }));
  console.log("[집계]", JSON.stringify([summarize("현재", original), summarize("기간정렬 재적합", paired), summarize("기간정렬 LOO", loo)]));
  console.log("[현재 큰오차/수요초과]", JSON.stringify(original.filter((d) => Math.abs(d.errPct) > 20 || d.needSharePct > 100).sort((a, b) => a.errPct - b.errPct).map(compact)));
  console.log("[정렬 수요초과]", JSON.stringify(paired.filter((d) => d.needSharePct > 100).map(compact)));
  console.log("[정렬 큰오차]", JSON.stringify(paired.filter((d) => Math.abs(d.errPct) > 20).sort((a, b) => a.errPct - b.errPct).map(compact)));
  console.log("[정렬 LOO 수요초과]", JSON.stringify(loo.filter((d) => d.needSharePct > 100).map(compact)));
  console.log("[기간차 영향]", JSON.stringify(original.map((d, i) => ({ name: d.name,
    oldNeed: round(d.needSharePct), pairedNeed: round(paired[i].needSharePct),
    oldUtil: round(d.actualUtilPct), pairedUtil: round(paired[i].actualUtilPct) }))));
  console.log("[독점]", JSON.stringify(paired.filter((_, i) => !(aligned[i].input.competitorIp ?? 0)).map(compact)));
});
