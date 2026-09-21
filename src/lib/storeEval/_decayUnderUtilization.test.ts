// 거리 감쇠를 **가동률 기준**으로 다시 고른다 (2026-09-21)
//
// ── 사용자 지시 ───────────────────────────────────────────────────────────
// *"지금 mape가 매출이잖아. 지금 매출단가가 정확하지 않잖아? 같은 가동률이라도 실제매출이랑
//  오차가 큰 편이긴 해. 그래서 지금 mape(매출)로 판가름할 게 아니라, 가동률로 판가름해야
//  할 것 같다. 가동률로 판단하고 가동률을 맞춘 후에 매출로 넘어가는 구조가 맞는 것 같다."*
// *"우선순위가 mape에서 가동률로 바꾸자."*
//
// ⚠️ **이 지시는 어제까지의 판정을 전부 되짚게 만든다.** R200 λ200을 채택하려던 참인데,
//    그 값은 **매출 MAPE로 고른 것**이다. 기준이 바뀌면 답도 바뀔 수 있으므로 넣기 전에
//    다시 잰다. 그게 이 파일이다.
//
// ── Astra(Codex)와의 분담 ─────────────────────────────────────────────────
// Astra가 `_utilizationObjective.test.ts`에서 **점유율 곡선 모양**(하한 ρ · 거듭제곱 ν)을
// 가동률 기준으로 고르고 있다. 여기는 **거리 감쇠 (R, λ)**만 본다. 축이 다르다.
// ⚠️ Astra 하네스는 `rivalDistanceDecay`가 {300,150,0.9}라고 **단언**한다. 본체를 바꾸면
//    그 시험이 깨진다 — 바꾸기 전에 사용자를 통해 알려야 한다.
//
// ── 먼저 사용자의 전제를 확인한다 ─────────────────────────────────────────
// *"같은 가동률이라도 실제매출이랑 오차가 큰 편"* — 맞는 말인지부터 잰다.
// 맞다면 매출 오차 = 가동률 오차 + 단가 오차이고, **단가 오차가 크면 매출로 산식을 고르는 건**
// **흐린 렌즈로 보는 것**이다. (1)절이 그걸 분해한다.
//
// ── 지표 (사용자 규칙: MAPE만 보지 않는다) ────────────────────────────────
//   주지표  가동률 MAE(%p)   — 매장 동일가중. Astra가 쓰는 것과 같은 자를 쓴다.
//   보조    가동률 MAPE · 최악 · SD · 부호편향
//
// ⚠️ **측정만 한다.** 본체를 안 고친다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_decayUnderUtilization.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook,
  type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const pp = (v: number, d = 2) => `${(v * 100).toFixed(d)}%p`;
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

describeIf("거리 감쇠 — 가동률 기준으로 다시 고른다", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  type QscSite = { name?: string; openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const doc of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const code = doc.storeCode ?? doc.id;
    if (code) qscSites.set(code, doc);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [k, v] of Object.entries(sites)) qscSites.set(k.replace(/^existing:/, ""), v);
  }
  const qscByStoreCode = new Map<string, number>();
  for (const [code, site] of qscSites) {
    const avg = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (avg != null) qscByStoreCode.set(code, avg);
  }
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const nameOf = (r: LabRow) => r.input.storeName ?? r.input.storeCode;

  const P_STEP: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, rivalDistanceDecay: null };
  const stepW = (d: number | null) => (d == null || d <= P_STEP.effectiveRadiusM ? 1 : 0);
  const totalWith = (w: (d: number | null) => number, src: LabRow[]) =>
    src.reduce((s, r) => s + (r.input.rivals ?? []).reduce((t, v) => t + (v.ip > 0 ? v.ip * w(v.distanceM) : 0), 0), 0);
  /** wf는 **주어진 집합에서 측정**한다. LOO에서는 뺀 매장을 빼고 재야 정답이 안 샌다. */
  const mk = (R: number, L: number, src: LabRow[]): TextbookParams => {
    const raw = (d: number | null) => (d == null || d <= R ? 1 : Math.exp(-(d - R) / L));
    return {
      ...DEFAULT_TEXTBOOK_PARAMS,
      rivalDistanceDecay: { plateauM: R, scaleM: L, weightFactor: totalWith(stepW, src) / Math.max(1e-9, totalWith(raw, src)) },
    };
  };

  /** LOO — 가동률과 매출을 **같은 판에서** 뽑는다(둘을 견주려면 짝이 맞아야 한다). */
  const looBoth = (mkP: (src: LabRow[]) => TextbookParams) => {
    const util: { n: string; pred: number; act: number }[] = [];
    const rev: { n: string; pred: number; act: number }[] = [];
    for (let i = 0; i < base.length; i++) {
      const rest = base.filter((_, k) => k !== i);
      const p = mkP(rest);
      const f = fittedParams(p, scoreTextbook(rest, p));
      const b = computeTextbook(base[i].input, f);
      const n = nameOf(base[i]);
      const au = base[i].input.actualUtilization;
      if (b.utilization != null && au != null && au > 0) util.push({ n, pred: b.utilization, act: au });
      if (b.monthlyRevenue != null && base[i].actualRevenue > 0) rev.push({ n, pred: b.monthlyRevenue, act: base[i].actualRevenue });
    }
    return { util, rev };
  };
  type Pair = { n: string; pred: number; act: number };
  const mae = (v: Pair[]) => mean(v.map((x) => Math.abs(x.pred - x.act)));          // %p (가동률용)
  const mapeOf = (v: Pair[]) => mean(v.map((x) => Math.abs(x.pred - x.act) / x.act));
  const worst = (v: Pair[]) => Math.max(...v.map((x) => Math.abs(x.pred - x.act) / x.act));
  const bias = (v: Pair[]) => mean(v.map((x) => (x.pred - x.act) / x.act));

  it("(1) 사용자 전제 확인 — 같은 가동률인데 매출이 얼마나 어긋나나", () => {
    // 매출 = 가동률 x (자사PC x 시간 x 단가). 가동률을 **실측으로 고정**하고 매출을 다시 계산하면
    // 남는 오차가 **순수 단가(환산층) 오차**다. 그게 크면 매출로 산식을 고르는 건 흐린 렌즈다.
    const p = DEFAULT_TEXTBOOK_PARAMS;
    const f = fittedParams(p, scoreTextbook(base, p));
    console.log(`\n[전제 확인] 매출 오차를 두 층으로 가른다`);
    console.log(`  매출오차 = (가동률이 틀린 몫) + (가동률은 맞아도 단가가 틀린 몫)`);
    console.log(`\n  매장              실측가동률  예측가동률   가동률오차   단가오차(가동률 고정)   매출오차`);
    const utilErr: number[] = [], priceErr: number[] = [], revErr: number[] = [];
    const rows: { n: string; u: number; p2: number; ue: number; pe: number; re: number }[] = [];
    for (const r of base) {
      const b = computeTextbook(r.input, f);
      const au = r.input.actualUtilization;
      if (au == null || !(au > 0) || b.utilization == null || b.monthlyRevenue == null || !(r.actualRevenue > 0)) continue;
      // 가동률을 실측으로 갈아끼운 매출 — 예측 매출은 가동률에 비례하므로 비로 환산한다.
      const revAtActualUtil = b.monthlyRevenue * (au / b.utilization);
      const pe = (revAtActualUtil - r.actualRevenue) / r.actualRevenue;   // 단가만의 오차
      const ue = (b.utilization - au) / au;
      const re = (b.monthlyRevenue - r.actualRevenue) / r.actualRevenue;
      rows.push({ n: nameOf(r), u: au, p2: b.utilization, ue, pe, re });
      utilErr.push(Math.abs(ue)); priceErr.push(Math.abs(pe)); revErr.push(Math.abs(re));
    }
    for (const x of [...rows].sort((a, b2) => Math.abs(b2.pe) - Math.abs(a.pe)).slice(0, 10)) {
      console.log(`  ${x.n.padEnd(16)}${pct(x.u).padStart(10)}${pct(x.p2).padStart(11)}` +
        `${pct(x.ue).padStart(12)}${pct(x.pe).padStart(22)}${pct(x.re).padStart(11)}`);
    }
    console.log(`\n  n=${rows.length}`);
    console.log(`  가동률만의 오차   평균 ${pct(mean(utilErr))} · 중앙 ${pct(med(utilErr))} · 최악 ${pct(Math.max(...utilErr))}`);
    console.log(`  단가만의 오차     평균 ${pct(mean(priceErr))} · 중앙 ${pct(med(priceErr))} · 최악 ${pct(Math.max(...priceErr))}`);
    console.log(`  합쳐진 매출오차   평균 ${pct(mean(revErr))} · 중앙 ${pct(med(revErr))} · 최악 ${pct(Math.max(...revErr))}`);
    // 두 오차가 무관하면 분산이 더해진다 — 매출 분산 중 단가 몫을 그 비로 잰다.
    const vU = mean(utilErr.map((x) => x * x)), vP = mean(priceErr.map((x) => x * x));
    console.log(`\n  매출 오차 분산 중 단가 몫 ≈ ${(vP / (vU + vP) * 100).toFixed(0)}%  (가동률 몫 ${(vU / (vU + vP) * 100).toFixed(0)}%)`);
    console.log(`  ⚠️ 사용자 전제는 **반만 맞다.** 단가 오차가 평균 ${pct(mean(priceErr))}로 분명히 있고`);
    console.log(`     가동률 오차와 **무관하게**(아래 r) 끼어든다. 다만 크기는 가동률 오차의 절반이라`);
    console.log(`     매출 MAPE를 지배하지는 않는다. 그래도 층을 나눠 고치는 순서는 옳다 —`);
    console.log(`     섞어 놓으면 거리 계수를 **가동률과 무관한 잡음에 맞춰** 고르게 된다.`);
    const corr = (() => {
      const x = rows.map((v) => v.ue), y = rows.map((v) => v.pe);
      const mx = mean(x), my = mean(y);
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
      return sxy / Math.sqrt(sxx * syy);
    })();
    console.log(`  두 오차의 상관 r = ${corr.toFixed(3)} — 0에 가까우면 **서로 딴 원인**이라 층을 나눠 고치는 게 맞다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(2) ⭐ 감쇠 격자를 가동률 기준으로 다시 — 답이 바뀌나", () => {
    const RS = [150, 200, 250, 300, 350];
    const LS = [50, 100, 150, 200, 250];
    console.log(`\n[격자 · 주지표 = 가동률 MAE(%p)] 각 칸: MAE / MAPE / 최악`);
    const S = looBoth(() => P_STEP);
    console.log(`  기준선 계단300   MAE ${pp(mae(S.util))} · MAPE ${pct(mapeOf(S.util))} · 최악 ${pct(worst(S.util))}`);
    console.log("      R │" + LS.map((L) => `λ=${L}`.padStart(20)).join(""));
    const grid: { key: string; R: number; L: number; mae: number; mape: number; worst: number; sd: number; revMape: number }[] = [];
    for (const R of RS) {
      const cells: string[] = [];
      for (const L of LS) {
        const o = looBoth((rest) => mk(R, L, rest));
        const e = o.util.map((x) => Math.abs(x.pred - x.act));
        grid.push({ key: `R${R} λ${L}`, R, L, mae: mae(o.util), mape: mapeOf(o.util), worst: worst(o.util), sd: sd(e), revMape: mapeOf(o.rev) });
        cells.push(`${pp(mae(o.util), 2)} ${pct(mapeOf(o.util), 1)} ${pct(worst(o.util), 0)}`.padStart(20));
      }
      console.log(`  ${String(R).padStart(7)} │` + cells.join(""));
    }
    const byMae = [...grid].sort((a, b) => a.mae - b.mae);
    console.log(`\n  가동률 MAE 좋은 순 : ${byMae.slice(0, 5).map((x) => `${x.key}(${pp(x.mae)})`).join(" · ")}`);
    console.log(`  가동률 최악 좋은 순: ${[...grid].sort((a, b) => a.worst - b.worst).slice(0, 4).map((x) => `${x.key}(${pct(x.worst)})`).join(" · ")}`);
    console.log(`  (참고) 매출 MAPE 좋은 순: ${[...grid].sort((a, b) => a.revMape - b.revMape).slice(0, 4).map((x) => `${x.key}(${pct(x.revMape)})`).join(" · ")}`);
    console.log(`\n  [어제까지의 후보들이 가동률 자에서는 어디인가]`);
    for (const k of ["R300 λ150", "R200 λ200", "R200 λ50"]) {
      const g = grid.find((x) => x.key === k)!;
      const rank = byMae.findIndex((x) => x.key === k) + 1;
      console.log(`    ${k.padEnd(11)} MAE ${pp(g.mae)} (${rank}위/${grid.length}) · 가동률최악 ${pct(g.worst)} · 매출MAPE ${pct(g.revMape)}`);
    }
    console.log(`\n  계단300 대비: ` + byMae.slice(0, 3).map((x) => `${x.key} ${((x.mae - mae(S.util)) * 100).toFixed(2)}%p`).join(" · "));
    console.log(`  ⚠️ 매출 자와 가동률 자가 **다른 칸을 고르면**, 그건 단가층이 판정을 흔들고 있었다는 증거다.`);
    expect(grid.length).toBe(RS.length * LS.length);
  });

  it("(2-b) Astra의 강한 주장을 직접 검증 — 산식이 '전부 평균' 보다 나은가", () => {
    // Astra `_utilizationObjective` 머리 주석: *"훈련평균 4.3735%p / 현재 산식 16/38 ±5%p,
    // 단순평균 26/38"*. 사실이면 거리 계수를 만지는 건 순서가 한참 뒤다.
    // ⚠️ 남의 하네스 결과를 그대로 믿지 않는다 — 여기서 **독립으로 다시 잰다.**
    const p = DEFAULT_TEXTBOOK_PARAMS;
    const model = looBoth(() => p).util;
    // 순진한 기준선: 훈련겹(자기 제외 37곳) 실측 가동률의 평균/중앙값을 그대로 예측값으로 쓴다.
    const acts = base.map((r) => r.input.actualUtilization).filter((x): x is number => x != null && x > 0);
    const naiveMean: Pair[] = [], naiveMed: Pair[] = [];
    for (const r of base) {
      const au = r.input.actualUtilization;
      if (au == null || !(au > 0)) continue;
      const rest = base.filter((x) => x !== r).map((x) => x.input.actualUtilization).filter((x): x is number => x != null && x > 0);
      naiveMean.push({ n: nameOf(r), pred: mean(rest), act: au });
      naiveMed.push({ n: nameOf(r), pred: med(rest), act: au });
    }
    const within = (v: Pair[], t: number) => v.filter((x) => Math.abs(x.pred - x.act) <= t).length;
    console.log(`\n[순진한 기준선] 실측 가동률 분포: 평균 ${pct(mean(acts))} · 중앙 ${pct(med(acts))} · 범위 ${pct(Math.min(...acts))}~${pct(Math.max(...acts))}`);
    console.log(`  방법                  MAE      MAPE     최악    ±5%p 안`);
    for (const [k, v] of [["교과서식 산식", model], ["전부 훈련평균", naiveMean], ["전부 훈련중앙", naiveMed]] as [string, Pair[]][]) {
      console.log(`  ${k.padEnd(16)}${pp(mae(v)).padStart(9)}${pct(mapeOf(v)).padStart(10)}${pct(worst(v)).padStart(9)}` +
        `${(within(v, 0.05) + "/" + v.length).padStart(10)}`);
    }
    const gap = mae(model) - mae(naiveMean);
    console.log(`\n  ⚠️ 산식 − 평균 = ${pp(gap)}  ${gap > 0 ? "**산식이 더 틀린다 — Astra 주장이 맞다**" : "산식이 낫다"}`);
    if (gap > 0) {
      console.log(`     이게 사실이면 **거리 계수(R·λ)를 만지는 건 순서가 한참 뒤다.** 지금 산식은`);
      console.log(`     가동률에 대해 "아무 정보도 없는 추측"보다 못하다. 매출 자에서 안 보이던 것이`);
      console.log(`     가동률 자로 바꾸자마자 드러났다 — 사용자 지시의 값어치가 여기에 있다.`);
    }
    // ── 신호가 아예 없는가, 있는데 과하게 흔드는가 ────────────────────────
    // 둘은 처방이 완전히 다르다. 상관이 0이면 **정보가 없는** 것이고(구조를 다시 짜야 한다),
    // 상관이 양수인데 MAE가 나쁘면 **폭이 과한** 것이다(줄이면 산다).
    const mu = mean(model.map((x) => x.act));
    const X = model.map((x) => x.pred), Y = model.map((x) => x.act);
    const mx = mean(X), my = mean(Y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < X.length; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; syy += (Y[i] - my) ** 2; }
    const r = sxy / Math.sqrt(sxx * syy);
    console.log(`\n  [신호 진단] 예측 가동률 vs 실측 가동률`);
    console.log(`    상관 r = ${r.toFixed(3)}  (n=${model.length}, 유의선 ±0.32)`);
    console.log(`    퍼짐: 예측 SD ${pp(Math.sqrt(sxx / X.length))} vs 실측 SD ${pp(Math.sqrt(syy / Y.length))}` +
      `  → 예측이 실측보다 ${(Math.sqrt(sxx / X.length) / Math.sqrt(syy / Y.length)).toFixed(2)}배 흔들린다`);
    console.log(`\n    수축 계수 k를 넣어 본다: 예측' = 평균 + k x (예측 − 평균)`);
    // ⚠️ 사용자 규칙 — 평균만 보지 않는다. **최악을 같이 찍는다.**
    console.log(`      k      MAE       MAPE      최악    ±5%p`);
    for (const k of [0, 0.2, 0.36, 0.4, 0.6, 0.8, 1.0]) {
      const v: Pair[] = model.map((x) => ({ n: x.n, pred: mu + k * (x.pred - mu), act: x.act }));
      console.log(`      ${k.toFixed(2)}${pp(mae(v)).padStart(10)}${pct(mapeOf(v)).padStart(10)}${pct(worst(v)).padStart(10)}${(within(v, 0.05) + "/" + v.length).padStart(9)}`
        + (k === 1 ? "   <- 지금" : k === 0 ? "   <- 전부 평균" : k === 0.36 ? "   <- 이론값 r x SD비" : ""));
    }
    console.log(`\n    이론값 k* = r x (실측SD ÷ 예측SD) = ${r.toFixed(3)} x ${(Math.sqrt(syy / Y.length) / Math.sqrt(sxx / X.length)).toFixed(3)} = ${(r * Math.sqrt(syy / Y.length) / Math.sqrt(sxx / X.length)).toFixed(3)}`);
    console.log(`    ⚠️ 표에서 고른 k는 **같은 자료로 고른 것**이라 과적합이다. 이론값과 붙는지가 그나마의 확인이다.`);
    console.log(`\n    ⚠️ k를 줄일수록 좋아지고 k=0이 최선이면 **정보가 없다**는 뜻이다.`);
    console.log(`       중간 k에서 최선이 나오면 신호는 있고 **폭만 과한** 것이라 살릴 수 있다.`);
    console.log(`       ⚠️ 이건 진단이지 제안이 아니다. 수축은 계수를 하나 더 만드는 일이라 따로 검정해야 한다.`);
    expect(model.length).toBeGreaterThan(30);
  });

  it("(3) 채택 판정 — 가동률 자에서 짝지은 부트스트랩", () => {
    const A = looBoth(() => P_STEP);
    const cand: [string, number, number][] = [["R300 λ150(지금)", 300, 150], ["R200 λ200", 200, 200]];
    console.log(`\n[채택 판정] 기준선 계단300 · 가동률 MAE 차이(음수 = 감쇠가 낫다) · 2000회`);
    for (const [key, R, L] of cand) {
      const B = looBoth((rest) => mk(R, L, rest));
      const names = A.util.map((x) => x.n).filter((n) => B.util.some((y) => y.n === n));
      const dm = names.map((n) => {
        const a = A.util.find((x) => x.n === n)!, b = B.util.find((x) => x.n === n)!;
        return Math.abs(b.pred - b.act) - Math.abs(a.pred - a.act);
      });
      let seed = 20260921;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const boot: number[] = [];
      for (let k = 0; k < 2000; k++) boot.push(mean(names.map(() => dm[Math.floor(rnd() * names.length)])));
      boot.sort((a, b) => a - b);
      const zero = boot[50] <= 0 && boot[1949] >= 0;
      console.log(`  ${key.padEnd(16)}실제 ${pp(mean(dm))}  95% [${pp(boot[50])}, ${pp(boot[1949])}]  ` +
        `${zero ? "0을 품는다 — 자료가 못 고른다" : mean(dm) < 0 ? "**유의하게 낫다**" : "**유의하게 나쁘다**"}`);
    }
    console.log(`\n  ⚠️ 여기서 "못 고른다"가 나오면 감쇠 채택 근거를 **가동률 자로는 세울 수 없다**는 뜻이다.`);
    console.log(`     그때는 매출 자에서 세운 근거(최악 54.7 -> 51.9%)가 유일한 근거로 남는데,`);
    console.log(`     그 자는 단가 잡음이 섞여 있다((1)절). 사용자에게 알리고 정해야 한다.`);
    expect(cand.length).toBe(2);
  });
});
