// 유료게임 과금을 정가에 더하면 (2026-09-25 저녁, 사용자 "유료과금 추가 적용") — 전후 재고 표. 읽기전용.
// 정가 + 과금은 계수가 아니라 자료(원장 실측: 게임 켜면 거의 전원이 냄 — _ledgerSurcharge). 여기서는 무엇이 얼마나 움직이나만 찍는다.
//   (1) 단가층: 실측 PC단가(2~12개월차 Σ÷Σ) vs 산식 PC몫 — 과금 없이 / 과금 더해. 과금 있는 매장(9곳)만 따로.
//   (2) 가동률 성적(_layerSplit (6) 잣대) 전후 — 정가가 점유율에도 들어가므로 가동률도 조금 움직인다.
// 실행: npx vitest run src/lib/storeEval/_paidGameSurcharge.test.ts --disable-console-intercept

import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { LAB_UPSIDE_STORE_CODES, buildLabRows, paidGameSurchargeByStoreFromTariff, productUnitPriceEraByStore, qscInWindowAverage, residentRadiusByCodeFromDocs, utilizationByStore, utilizationWindowMonths, type QscRecord } from "./labInput";
import { residentRingsByCodeFromDocs, type LabResidentRingsDoc } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, type TextbookParams } from "./textbookModel";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const MONTH_HOURS = 720;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const pp = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}`;
const pad = (s: string, n: number) => { const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e7f ? 2 : 1), 0); return s + " ".repeat(Math.max(0, n - w)); };

describeIf("유료게임 과금 — 정가에 더하면 전후", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  type QscSite = { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] };
  const qscByStoreCode = new Map<string, number>();
  for (const doc of (snap.labQscScores ?? []) as QscSite[]) { const code = doc.storeCode ?? doc.id; const avg = qscInWindowAverage(doc.records ?? [], doc.openedAt ?? null); if (code && avg != null) qscByStoreCode.set(code, avg); }
  const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
  const residentRingsByCode = ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined;
  const ringBlockedByCode = new Map<string, number>();
  for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) { const c = j.ringCutCount ?? j.blockedCount; if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c); }
  const residentRadiusByCode = residentRadiusByCodeFromDocs(snap.labResidentRadius ?? []);
  const productUnitPriceByStore = productUnitPriceEraByStore(snap.sales ?? [], snap.existingStores);
  const paid = paidGameSurchargeByStoreFromTariff();
  const common = { stores, compsByCode, utilByStore, productUnitPriceByStore, settings, qscByStoreCode, residentRingsByCode, ringBlockedByCode, residentRadiusByCode };
  // 2026-09-25 밤부터 prepare가 과금을 더해 온다 — "과금 없이"는 기본요금으로 되돌린 매장으로 만든다
  const rows0 = buildLabRows({ ...common, stores: stores.map((s) => ({ ...s, hourlyRate: s.hourlyRateBase ?? s.hourlyRate })) });
  const rows1 = buildLabRows({ ...common });
  const P: TextbookParams = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(rows0, DEFAULT_TEXTBOOK_PARAMS));

  it("(1) 단가층 — 실측 PC단가 vs 산식 PC몫, 과금 전후", () => {
    type Sale = { storeCode: string; yearMonth: string; pcSales?: number | null; utilizationRate?: number | null };
    const by = new Map<string, Sale[]>(); for (const s of (snap.sales ?? []) as Sale[]) by.set(s.storeCode, [...(by.get(s.storeCode) ?? []), s]);
    const out: { name: string; rate: number; sur: number; act: number; m0: number; m1: number }[] = [];
    for (const s of snap.existingStores as { storeCode: string; storeName: string; openedAt: string | null; pcCount?: number | null; evaluationPcCount?: number | null; hourlyRate?: number | null; excludedFromModel?: boolean | null }[]) {
      if (s.excludedFromModel) continue; const pc = s.evaluationPcCount ?? s.pcCount; const rate = s.hourlyRate; if (!pc || !rate) continue;
      const sum = (ms: string[]) => { const w = new Set(ms); let p = 0, h = 0; for (const m of by.get(s.storeCode) ?? []) { if (!w.has(m.yearMonth) || !(m.utilizationRate && m.utilizationRate > 0) || !((m.pcSales ?? 0) > 0)) continue; p += m.pcSales ?? 0; h += pc * MONTH_HOURS * m.utilizationRate; } return h > 0 ? p / h : null; };
      const act = sum(utilizationWindowMonths(s.openedAt)) ?? sum(evaluationMonths(s.openedAt)); if (act == null) continue;
      const sur = paid.get(s.storeCode) ?? 0;
      const m = (r: number) => P.referenceHourlyRate * Math.pow(r / P.referenceHourlyRate, P.rateElasticity);
      out.push({ name: s.storeName, rate, sur, act, m0: m(rate), m1: m(rate + sur) });
    }
    const rep = (label: string, xs: typeof out, k: "m0" | "m1") => { const e = xs.map((r) => r[k] / r.act - 1); return `${pad(label, 26)} n=${xs.length} |오차| ${(100 * mean(e.map(Math.abs))).toFixed(1)}% · 편향 ${pp(mean(e))}% · ±10% 안 ${e.filter((x) => Math.abs(x) <= 0.1).length}/${xs.length}`; };
    const withSur = out.filter((r) => r.sur > 0);
    console.log(`\n[단가층 — 산식 PC몫 ÷ 실측 PC단가 − 1] 과금 있는 매장 ${withSur.length}곳: ${withSur.map((r) => `${r.name.replace(/점$/, "")} +${r.sur}`).join(" · ")}`);
    console.log("  " + rep("전체 · 과금 없이", out, "m0")); console.log("  " + rep("전체 · 과금 더해", out, "m1"));
    console.log("  " + rep("과금 있는 곳만 · 없이", withSur, "m0")); console.log("  " + rep("과금 있는 곳만 · 더해", withSur, "m1"));
    for (const r of withSur) console.log(`     ${pad(r.name, 12)} 정가 ${r.rate} + ${r.sur} | 실측 ${Math.round(r.act)} | 산식 ${Math.round(r.m0)} → ${Math.round(r.m1)} | 오차 ${pp(r.m0 / r.act - 1)} → ${pp(r.m1 / r.act - 1)}`);
    expect(out.length).toBeGreaterThan(30);
  });

  it("(2) 가동률 성적 전후 (_layerSplit (6) 잣대)", () => {
    const isUp = (code: string) => LAB_UPSIDE_STORE_CODES.has(code);
    const errs = (rows: ReturnType<typeof buildLabRows>) => rows.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0)
      .map((r) => ({ code: r.input.storeCode, name: r.input.storeName ?? "", e: (computeTextbook(r.input, P).utilization ?? NaN) - (r.input.actualUtilization as number), rev: (computeTextbook(r.input, P).monthlyRevenue ?? NaN) / r.actualRevenue - 1 })).filter((x) => Number.isFinite(x.e));
    const okErr = (x: { code: string; e: number }) => (isUp(x.code) && x.e < 0 ? 0 : Math.abs(x.e));
    const line = (l: string, xs: ReturnType<typeof errs>) => console.log(`  ${pad(l, 12)} 전체 MAE ${(100 * mean(xs.map((x) => Math.abs(x.e)))).toFixed(2)} · 이해 ${(100 * mean(xs.map(okErr))).toFixed(2)} · ±5%p ${xs.filter((x) => okErr(x) <= 0.05).length}/${xs.length} · 33곳 편향 ${pp(mean(xs.filter((x) => !isUp(x.code)).map((x) => x.e)), 2)} | 매출 MAPE ${(100 * mean(xs.map((x) => Math.abs(x.rev)))).toFixed(1)}% · 편향 ${pp(mean(xs.map((x) => x.rev)))}%`);
    const e0 = errs(rows0), e1 = errs(rows1);
    console.log(`\n[가동률 성적·매출 환산 — 과금 전후]`); line("과금 없이", e0); line("과금 더해", e1);
    const moved = e1.map((x, i) => ({ name: x.name, d: x.e - e0[i].e, dr: x.rev - e0[i].rev })).filter((x) => Math.abs(x.d) > 0.0005 || Math.abs(x.dr) > 0.005);
    console.log(`  움직인 매장 ${moved.length}곳: ` + moved.map((x) => `${x.name.replace(/점$/, "")} 가동률 ${pp(x.d)}p · 매출 ${pp(x.dr)}%`).join(" · "));
    expect(e0.length).toBe(e1.length);
  });
});
