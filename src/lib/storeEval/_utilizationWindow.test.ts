// 가동률 창 재고 표 — 실측 가동률 평균을 개점 2~12개월차로 맞추면 성적표가 어떻게 움직이나 (2026-09-25). 읽기전용.
// 본체/운영/Firestore 미변경. **계수를 고르지 않는다. 채택도 여기서 안 한다** — 사용자 결정용 Δ 표.
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 인계(docs/handoff-20260929.md 최종 블록) 다음 할 일 3번.
//   저장 실매출 `actualMonthlyRevenueAvg`는 **개점 2~12개월차**(평가창 12달 중 첫 달을 오픈 효과로 뺀 11달)인데
//   실험실 실측 가동률 `utilizationByStore`(labInput)는 **1~12개월차** 12달 전부를 쓴다. 창이 한 달 다르다.
//   첫 달 가동률이 낮은 매장(송도 첫 달 −14%)은 그만큼 실측 가동률이 낮게 잡혀 산식이 "과대"로 보인다.
//
// ── 사전 설계 (결과 확인 전에 고정) ───────────────────────────────────────
// 1. 예측은 안 움직인다. 축척 8.20h·상품몫 1,493이 고정(hoursPerUserFixed·productUnitPriceFixed)이라 fittedParams가 창에 안 걸리고,
//    computeTextbook은 실측 가동률을 안 본다. 그래서 **움직이는 건 실측 쪽 한 열뿐**이고, 오차 Δ = −(실측 Δ)다. 이걸 표에서 확인한다.
// 2. 새 창 = evaluationMonths(openedAt).slice(1). 2개월차 이후 가동률이 하나도 없으면 옛 창 그대로(저장 로직 computeStabilizedPerformance와 같은 폴백).
// 3. 잣대는 `_layerSplit` (6)과 같은 정의 — 전체 MAE · 상향 이탈 뺌(33곳) · 이해되는 오차(7곳 과소=0) · ±5%p · ±3%p · 33곳 편향 · |오차| ≥ 10%p 수.
// 4. 경쟁점 1:1·후보지 13곳은 실측 가동률을 안 쓰므로 안 움직인다 — 여기서 다시 안 찍는다.
// 5. 판정 잣대는 두지 않는다. "맞추면 어디가 얼마나 움직이나"만.
//
// 실행:
//   npx vitest run src/lib/storeEval/_utilizationWindow.test.ts --disable-console-intercept

import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { LAB_UPSIDE_STORE_CODES, buildLabRows, qscInWindowAverage, residentRadiusByCodeFromDocs, utilizationByStore, type QscRecord } from "./labInput";
import { residentRingsByCodeFromDocs, type LabResidentRingsDoc } from "./labResidentRings";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, type TextbookParams } from "./textbookModel";
import type { Competitor } from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const pp = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}`;
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const padL = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);

type Sale = { storeCode: string; yearMonth: string; utilizationRate?: number | null };

/** 2~12개월차 평균 — utilizationByStore와 같은 단순평균, 창만 첫 달을 뺀다. 2개월차 이후가 없으면 옛 창 폴백. */
function utilizationFrom2(sales: Sale[], stores: { storeCode: string; openedAt: string | null }[]): Map<string, { u: number; n: number; first: number | null }> {
  const out = new Map<string, { u: number; n: number; first: number | null }>();
  for (const s of stores) {
    const months = evaluationMonths(s.openedAt);
    const firstYm = months[0];
    const from2 = new Set(months.slice(1));
    const all = sales.filter((x) => x.storeCode === s.storeCode && x.utilizationRate != null && (x.utilizationRate as number) > 0);
    const first = all.find((x) => x.yearMonth === firstYm)?.utilizationRate ?? null;
    let vs = all.filter((x) => from2.has(x.yearMonth)).map((x) => x.utilizationRate as number);
    if (!vs.length) { const w = new Set(months); vs = all.filter((x) => w.has(x.yearMonth)).map((x) => x.utilizationRate as number); }
    if (vs.length) out.set(s.storeCode, { u: mean(vs), n: vs.length, first });
  }
  return out;
}

describeIf("가동률 창 재고 표 — 1~12개월차 → 2~12개월차", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const util1 = utilizationByStore(snap.sales ?? [], snap.existingStores);
  const util2full = utilizationFrom2(snap.sales ?? [], snap.existingStores);
  const util2 = new Map([...util2full].map(([k, v]) => [k, v.u]));

  type QscSite = { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] };
  const qscByStoreCode = new Map<string, number>();
  for (const doc of (snap.labQscScores ?? []) as QscSite[]) {
    const code = doc.storeCode ?? doc.id;
    const avg = qscInWindowAverage(doc.records ?? [], doc.openedAt ?? null);
    if (code && avg != null) qscByStoreCode.set(code, avg);
  }
  const ringDocs = (snap.labResidentRings ?? []) as LabResidentRingsDoc[];
  const residentRingsByCode = ringDocs.length ? residentRingsByCodeFromDocs(ringDocs) : undefined;
  const ringBlockedByCode = new Map<string, number>();
  for (const j of (snap.labTradeAreaJudgments ?? []) as { code?: string; ringCutCount?: number | null; blockedCount?: number | null }[]) {
    const c = j.ringCutCount ?? j.blockedCount;
    if (j.code && typeof c === "number") ringBlockedByCode.set(String(j.code), c);
  }
  const residentRadiusByCode = residentRadiusByCodeFromDocs(snap.labResidentRadius ?? []);
  const common = { stores, compsByCode, settings, qscByStoreCode, residentRingsByCode, ringBlockedByCode, residentRadiusByCode };
  const rows1 = buildLabRows({ ...common, utilByStore: util1 });
  const rows2 = buildLabRows({ ...common, utilByStore: util2 });
  const P1: TextbookParams = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(rows1, DEFAULT_TEXTBOOK_PARAMS));
  const P2: TextbookParams = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(rows2, DEFAULT_TEXTBOOK_PARAMS));

  const isUp = (code: string) => LAB_UPSIDE_STORE_CODES.has(code);
  type E = { code: string; name: string; act: number; pred: number; e: number };
  const errsOf = (rows: ReturnType<typeof buildLabRows>, p: TextbookParams): E[] =>
    rows.filter((r) => r.input.actualUtilization != null && (r.input.actualUtilization as number) > 0)
      .map((r) => { const act = r.input.actualUtilization as number; const pred = computeTextbook(r.input, p).utilization ?? NaN; return { code: r.input.storeCode, name: r.input.storeName ?? "", act, pred, e: pred - act }; })
      .filter((x) => Number.isFinite(x.e));
  const okErr = (x: E) => (isUp(x.code) && x.e < 0 ? 0 : Math.abs(x.e));
  const summary = (xs: E[]) => ({
    n: xs.length, maeAll: mean(xs.map((x) => Math.abs(x.e))), maeEx: mean(xs.filter((x) => !isUp(x.code)).map((x) => Math.abs(x.e))),
    maeOk: mean(xs.map(okErr)), biasEx: mean(xs.filter((x) => !isUp(x.code)).map((x) => x.e)),
    w5: xs.filter((x) => okErr(x) <= 0.05).length, w3: xs.filter((x) => okErr(x) <= 0.03).length, over10: xs.filter((x) => Math.round(Math.abs(x.e) * 1000) >= 100).map((x) => `${x.name} ${pp(x.e)}`), // 날 |오차| 10.0%p↑(인계문 셈법 — 상향 이탈 포함)
  });
  const e1 = errsOf(rows1, P1), e2 = errsOf(rows2, P2);
  const byCode2 = new Map(e2.map((x) => [x.code, x]));

  it("(0) 예측이 안 움직이는지 — 축척·상품몫 고정이라 창은 실측 열만 바꾼다", () => {
    console.log(`\n[검산] P1 축척 ${P1.hoursPerUserPerMonth}h · 상품몫 ${P1.productUnitPrice} | P2 축척 ${P2.hoursPerUserPerMonth}h · 상품몫 ${P2.productUnitPrice}`);
    const predMoved = e1.filter((x) => { const y = byCode2.get(x.code); return y && Math.abs(y.pred - x.pred) > 1e-9; });
    console.log(`  예측이 움직인 매장 ${predMoved.length}곳 (0이어야 한다)`);
    expect(P1.hoursPerUserPerMonth).toBe(P2.hoursPerUserPerMonth);
    expect(predMoved.length).toBe(0);
  });

  it("(1) 매장별 Δ 표 — 실측 1~12 → 2~12, 오차가 어디로 가나", () => {
    const rowsOut = e1.map((x) => { const y = byCode2.get(x.code); const w = util2full.get(x.code); return { x, y, w }; }).filter((r) => r.y && r.w);
    rowsOut.sort((a, b) => Math.abs(b.y!.act - b.x.act) - Math.abs(a.y!.act - a.x.act));
    console.log(`\n[매장별] 실측 = 평가창 평균 가동률 %. 오차 = 예측 − 실측 %p. Δ = 새 창 − 옛 창. ★ = 상향 이탈 7곳(과소는 이해되는 오차)`);
    console.log(`  ${pad("매장", 12)} ${padL("첫달", 6)} ${padL("실측1~12", 8)} ${padL("실측2~12", 8)} ${padL("Δ실측", 6)} | ${padL("예측", 6)} ${padL("오차(옛)", 8)} ${padL("오차(새)", 8)} ${padL("Δ|오차|", 7)}  비고`);
    for (const { x, y, w } of rowsOut) {
      const dAct = y!.act - x.act, dAbs = okErr(y!) - okErr(x);
      const note = [isUp(x.code) ? "★" : "", w!.first == null ? "첫달 자료 없음" : "", Math.abs(dAct) >= 0.02 ? "≥2%p" : "", Math.abs(y!.e) >= 0.10 && Math.abs(x.e) < 0.10 ? "10%p↑ 진입" : Math.abs(y!.e) < 0.10 && Math.abs(x.e) >= 0.10 ? "10%p↑ 탈출" : ""].filter(Boolean).join(" ");
      console.log(`  ${pad(x.name, 12)} ${padL(w!.first == null ? "-" : (w!.first * 100).toFixed(1), 6)} ${padL((x.act * 100).toFixed(1), 8)} ${padL((y!.act * 100).toFixed(1), 8)} ${padL(pp(dAct), 6)} | ${padL((x.pred * 100).toFixed(1), 6)} ${padL(pp(x.e), 8)} ${padL(pp(y!.e), 8)} ${padL(pp(dAbs), 7)}  ${note}`);
    }
    const dActs = rowsOut.map((r) => r.y!.act - r.x.act);
    console.log(`  Δ실측 평균 ${pp(mean(dActs), 2)}%p · 오른 곳 ${dActs.filter((d) => d > 0.0005).length} · 내린 곳 ${dActs.filter((d) => d < -0.0005).length} · 안 움직인 곳 ${dActs.filter((d) => Math.abs(d) <= 0.0005).length}  (첫 달이 평균보다 낮았던 매장은 오른다)`);
    expect(rowsOut.length).toBeGreaterThan(30);
  });

  it("(2) 성적표 요약 — 옛 창 vs 새 창 (_layerSplit (6) 잣대)", () => {
    const s1 = summary(e1), s2 = summary(e2);
    const line = (l: string, s: ReturnType<typeof summary>) => `  ${pad(l, 14)} n ${s.n} · 전체 MAE ${(s.maeAll * 100).toFixed(2)} · 뺌(33곳) ${(s.maeEx * 100).toFixed(2)} · 이해되는 오차 ${(s.maeOk * 100).toFixed(2)}%p · ±5%p ${s.w5}/${s.n} · ±3%p ${s.w3} · 33곳 편향 ${pp(s.biasEx, 2)}%p · 10%p↑ ${s.over10.length}곳(${s.over10.join(", ") || "-"})`;
    console.log(`\n[성적표]`);
    console.log(line("옛 창 1~12", s1));
    console.log(line("새 창 2~12", s2));
    console.log(`  Δ  전체 MAE ${pp(s2.maeAll - s1.maeAll, 2)} · 이해되는 오차 ${pp(s2.maeOk - s1.maeOk, 2)} · ±5%p ${s2.w5 - s1.w5 >= 0 ? "+" : ""}${s2.w5 - s1.w5} · 33곳 편향 ${pp(s2.biasEx - s1.biasEx, 2)}`);
    console.log(`  ⭐ 읽는 법 — 예측은 그대로고 실측만 움직였다. 편향이 0 쪽으로 오면 "첫 달 오픈 효과가 실측을 낮게 끌고 있었다"는 뜻이고, 멀어지면 첫 달이 오히려 평균을 떠받치던 매장이 많았다는 뜻.`);
    console.log(`     창을 맞추는 건 계수가 아니라 정의(실매출과 같은 달)라 성적으로 고르지 않는다 — 다만 성적표 전체가 움직이므로 사용자 결정.`);
    expect(s1.n).toBe(s2.n);
  });
});
