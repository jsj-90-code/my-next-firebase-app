// 독점상권에서 수요 수준을 보정하고, 경쟁 쏠림을 검정한다 (2026-09-16). 일회성 분석용.
//
// 사용자 방향(2026-09-16):
//   "일단 공통산식으로 가는 개념이 맞는지 개념적으로 확인해주고. 맞다면 독점상권부터 수요를
//    맞춰보고. 매출 높은 매장이 평가가 낮아진다면 거기는 경쟁력 + 입지 평가로 올리는 구조로
//    해보자고. 상권에 5개 매장 있다 치면 경쟁력에 따라 비슷하게 점유되는 게 아니라 우위가
//    있으면 한쪽에 쏠리는 경향이 있기도 하기 때문에."
//
// ── 왜 독점상권에서 수요를 맞추나 ────────────────────────────────────────
// 독점상권은 점유율이 1이다. 그래서 가동률 = 수요계수 x (수요 ÷ 자사PC)가 되어, 경쟁 항의
// 간섭 없이 **수요 수준(계수 A)만** 정해진다. 여기서 A를 정하고 나머지 매장에 그대로 적용하면,
// 어긋나는 몫이 곧 "경쟁·경쟁력·입지가 설명해야 할 양"이다. 층을 순서대로 세우는 방식이다.
//
// 독점매장은 3곳뿐이다(탕정역·광주각화·남악, 전부 경쟁점 0곳). 3곳으로 정한 계수는 당연히
// 불안정하므로, **한 곳씩 빼보며(leave-one-out) 얼마나 흔들리는지**를 같이 낸다.
//
// ── 쏠림 가설 ───────────────────────────────────────────────────────────
// "경쟁력에 따라 비슷하게 점유되는 게 아니라 우위가 있으면 한쪽에 쏠린다."
// 지금 구조는 점유율 = 자사PC x 격차^gamma / (자사PC x 격차^gamma + 경쟁IP)로 gamma=1이다.
// gamma가 1이면 비례 배분, 1보다 크면 우위 매장으로 쏠린다. 사용자 주장이 맞다면 gamma > 1에서
// 실측 가동률이 더 잘 맞아야 한다. 가동률로 직접 검정한다(매출은 요금·상품이 섞여 흐려진다).
//
//   npx vitest run src/lib/storeEval/_monopolyCalibration.test.ts --reporter=verbose
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { computeCompetitorIp } from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import type { Competitor } from "./types";

const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const ready = hasValidationSnapshot() && existsSync(FLOAT_FILE) && existsSync(RESI_FILE);
const describeIf = ready ? describe : describe.skip;

const RING = [100, 200, 300, 400, 500] as const;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("독점 보정과 쏠림", () => {
  const fl = JSON.parse(readFileSync(FLOAT_FILE, "utf8"));
  const re = JSON.parse(readFileSync(RESI_FILE, "utf8"));
  const floSites = fl.sites ?? fl;
  const resSites = re.sites ?? re;

  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const locByCode = new Map((snap.locationEvaluations as any[]).map((l) => [l.candidateCode, l]));

  type Row = {
    name: string | null; pc: number; util: number;
    rivalIp: number; gap: number; competitorCount: number;
    demand: number;              // 공통 수요식: 주거1000 + 유동300 x alpha
    locationScore: number | null;
    competitivenessScore: number | null;
  };

  const ALPHA = 0.3; // "주거 기본 + 유동 +@" — 사용자 설계를 지키는 값(유동 비중 약 37%)
  const rows: Row[] = [];
  for (const st of stores as any[]) {
    if (st.excludedFromModel) continue;
    const pc = st.evaluationPcCount ?? st.pcCount;
    if (!pc) continue;
    const want = new Set(evaluationMonths(st.openedAt));
    const ur = (snap.sales as any[])
      .filter((s) => s.storeCode === st.storeCode && want.has(s.yearMonth) && s.utilizationRate != null)
      .map((s) => Number(s.utilizationRate));
    if (ur.length < 6) continue;

    const key = `existing:${st.storeCode}`;
    const fv = floSites[key], rv = resSites[key];
    if (!fv || !rv) continue;
    const f300 = fv.radii?.["300"]?.selected;
    const r1k = rv.radii?.["1000"]?.totalPopulation;
    if (!f300?.length || r1k == null) continue;

    const cs = compsByCode.get(existingStoreSourceCode(st)) ?? [];
    const loc = locByCode.get(existingStoreSourceCode(st));
    rows.push({
      name: st.storeName, pc, util: mean(ur),
      rivalIp: computeCompetitorIp(cs, st.operatingPcStores500m ?? null) ?? 0,
      gap: st.competitivenessGap ?? 1,
      competitorCount: cs.filter((c) => c.investigationStatus !== "경쟁점없음").length,
      demand: Number(r1k) + Math.round(mean(f300.slice(-12))) * ALPHA,
      locationScore: loc?.locationScore ?? null,
      competitivenessScore: st.competitivenessScore ?? null,
    });
  }

  /** 점유율 — gamma가 클수록 우위 매장으로 쏠린다. gamma=1이면 비례 배분. */
  function share(r: Row, gamma: number): number {
    const own = r.pc * Math.pow(r.gap, gamma);
    const denom = own + r.rivalIp;
    return denom > 0 ? own / denom : 1;
  }

  it("독점 3곳으로 수요 계수를 정한다", () => {
    const mono = rows.filter((r) => r.rivalIp === 0);
    console.log(`\n독점매장 ${mono.length}곳 (경쟁IP=0) · 전체 ${rows.length}곳`);
    console.log(`수요식: 주거1000m + 유동300m x ${ALPHA}`);
    console.log(`${"이름".padEnd(14)} 실제가동률  수요÷자사PC   필요계수 A`);
    const As: number[] = [];
    for (const r of mono) {
      const perPc = r.demand / r.pc;
      const A = r.util / perPc;
      As.push(A);
      console.log(`${(r.name ?? "").padEnd(14)} ${(r.util * 100).toFixed(1).padStart(8)}% ${perPc.toFixed(0).padStart(12)} ${A.toExponential(3).padStart(12)}`);
    }
    const A = median(As);
    console.log(`\n독점 3곳 중앙 계수 A = ${A.toExponential(3)}`);
    console.log(`  한 곳씩 빼면: ${mono.map((_, i) => median(As.filter((_, j) => j !== i)).toExponential(2)).join(" · ")}`);
    const spread = (Math.max(...As) - Math.min(...As)) / median(As);
    console.log(`  계수 폭 ${(spread * 100).toFixed(0)}% — 3곳뿐이라 이만큼 흔들린다.`);

    // 이 A를 전체에 적용하면 어떻게 되나 (점유율 gamma=1)
    const errs: number[] = [];
    const over: { name: string | null; pred: number; act: number }[] = [];
    for (const r of rows) {
      const pred = A * (r.demand / r.pc) * share(r, 1);
      errs.push(Math.abs(pred - r.util) / r.util);
      over.push({ name: r.name, pred, act: r.util });
    }
    console.log(`\n독점에서 정한 A를 전체 ${rows.length}곳에 적용 (점유율 gamma=1)`);
    console.log(`  가동률 MAPE ${(mean(errs) * 100).toFixed(1)}%`);
    over.sort((a, b) => (b.pred / b.act) - (a.pred / a.act));
    console.log(`  과대예측 상위 3곳: ${over.slice(0, 3).map((o) => `${o.name} ${(o.pred / o.act).toFixed(2)}배`).join(" · ")}`);
    console.log(`  과소예측 상위 3곳: ${over.slice(-3).map((o) => `${o.name} ${(o.pred / o.act).toFixed(2)}배`).join(" · ")}`);
    expect(mono.length).toBeGreaterThan(0);
  });

  it("쏠림 — gamma를 올리면 더 잘 맞는가", () => {
    // 사용자 주장: 우위가 있으면 한쪽에 쏠린다 -> gamma > 1이어야 한다.
    console.log(`\n점유율 지수 gamma별 (목표: 실제 가동률, n=${rows.length})`);
    console.log(`${"gamma".padEnd(8)} ${"가동률 MAPE".padStart(12)} ${"상관 r".padStart(10)}`);
    for (const gamma of [0.5, 1, 1.5, 2, 3, 4, 6]) {
      const xs = rows.map((r) => (r.demand / r.pc) * share(r, gamma));
      // 수준 A는 로그 공간 평균으로 맞춘다 — gamma끼리 공정하게 비교하려면 필요하다.
      const logs = rows.map((r, i) => Math.log(r.util / xs[i]));
      const A = Math.exp(mean(logs));
      const errs = rows.map((r, i) => Math.abs(A * xs[i] - r.util) / r.util);
      console.log(`${String(gamma).padEnd(8)} ${(mean(errs) * 100).toFixed(2).padStart(11)}% ${pearson(xs, rows.map((r) => r.util)).toFixed(3).padStart(10)}`);
    }
    console.log(`  gamma=1은 비례 배분, gamma>1은 우위 매장 쏠림.`);
    console.log(`  경쟁력격차 분포: ${Math.min(...rows.map((r) => r.gap)).toFixed(2)} ~ ${Math.max(...rows.map((r) => r.gap)).toFixed(2)} (중앙 ${median(rows.map((r) => r.gap)).toFixed(2)})`);
    expect(rows.length).toBeGreaterThan(20);
  });

  it("쏠림 — 무작위 대조군 검정", () => {
    // 표본 31곳에서 자유 파라미터(gamma) 하나를 최적화한 것이므로 잡음에도 맞을 수 있다.
    // 이 저장소는 정확히 그렇게 한 번 속았다(2026-09-15 밀집도 보정, r=0.660인데 MAPE 악화).
    //
    // 대조군: 경쟁력격차 값을 매장끼리 섞는다. 분포는 그대로고 매장과의 대응만 깨진다.
    // 섞은 격차로도 같은 개선이 나온다면 그 개선은 "격차"가 아니라 "자유도 하나"가 만든 것이다.
    const GAMMAS = [0.5, 1, 1.5, 2, 3, 4, 6, 8];
    const utils = rows.map((r) => r.util);

    function bestMape(gaps: number[]): { mape: number; gamma: number } {
      let best = Infinity, bestG = 1;
      for (const gamma of GAMMAS) {
        const xs = rows.map((r, i) => {
          const own = r.pc * Math.pow(gaps[i], gamma);
          const denom = own + r.rivalIp;
          return (r.demand / r.pc) * (denom > 0 ? own / denom : 1);
        });
        const logs = rows.map((r, i) => Math.log(r.util / xs[i]));
        const A = Math.exp(mean(logs));
        const m = mean(rows.map((r, i) => Math.abs(A * xs[i] - r.util) / r.util));
        if (m < best) { best = m; bestG = gamma; }
      }
      return { mape: best, gamma: bestG };
    }

    const real = bestMape(rows.map((r) => r.gap));
    const baseline = (() => {
      // gamma=1 고정일 때의 MAPE — 개선폭의 기준선
      const xs = rows.map((r) => (r.demand / r.pc) * share(r, 1));
      const logs = rows.map((r, i) => Math.log(r.util / xs[i]));
      const A = Math.exp(mean(logs));
      return mean(rows.map((r, i) => Math.abs(A * xs[i] - r.util) / r.util));
    })();
    const realGain = baseline - real.mape;

    // 재현 가능한 난수 — 검정을 돌릴 때마다 결론이 흔들리면 안 된다.
    let seed = 20260916 >>> 0;
    const rng = () => {
      seed += 0x6d2b79f5;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const gains: number[] = [];
    for (let iter = 0; iter < 500; iter++) {
      const perm = rows.map((r) => r.gap);
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      gains.push(baseline - bestMape(perm).mape);
    }
    gains.sort((a, b) => a - b);
    const p95 = gains[Math.floor(gains.length * 0.95)];
    const pValue = (gains.filter((g) => g >= realGain).length + 1) / (gains.length + 1);

    console.log(`\n[쏠림 gamma] 무작위 대조군 ${gains.length}회`);
    console.log(`  gamma=1 기준선 MAPE ${(baseline * 100).toFixed(2)}% → 최적 gamma=${real.gamma}에서 ${(real.mape * 100).toFixed(2)}% (개선 ${(realGain * 100).toFixed(2)}%p)`);
    console.log(`  격차를 섞었을 때: 중앙 개선 ${(median(gains) * 100).toFixed(2)}%p · 95퍼센타일 ${(p95 * 100).toFixed(2)}%p`);
    console.log(`  p = ${pValue.toFixed(3)} → ${pValue < 0.05 ? "✅ 잡음으로 설명 안 됨" : "❌ 잡음과 구별 안 됨 — 채택하지 않는다"}`);
    console.log(`  (섞어도 개선이 나오는 건 gamma 자체가 자유도이기 때문이다 — 그 몫을 빼고 봐야 한다)`);
    expect(gains.length).toBeGreaterThan(100);
  });

  it("남는 오차를 경쟁력·입지가 설명하는가", () => {
    // 사용자 설계: "매출 높은 매장이 평가가 낮아진다면 거기는 경쟁력 + 입지 평가로 올리는 구조."
    // 수요층만으로 예측한 뒤 남는 오차(실제÷예측)가 경쟁력·입지와 붙는지 본다.
    // 붙는다면 그 두 층이 올려야 할 몫이 실제로 거기 있다는 뜻이다.
    const xs = rows.map((r) => (r.demand / r.pc) * share(r, 1));
    const logs = rows.map((r, i) => Math.log(r.util / xs[i]));
    const A = Math.exp(mean(logs));
    const residual = rows.map((r, i) => r.util / (A * xs[i])); // 1보다 크면 수요층이 과소평가한 매장

    const n = rows.length;
    const sigLine = 2 / Math.sqrt(n);
    console.log(`\n수요층이 남긴 오차(실제÷예측) vs 매장 평가 (n=${n}, 유의선 ${sigLine.toFixed(3)})`);
    for (const [label, get] of [
      ["입지동선종합", (r: Row) => r.locationScore],
      ["경쟁력점수", (r: Row) => r.competitivenessScore],
      ["경쟁력격차", (r: Row) => r.gap],
    ] as const) {
      const a: number[] = [], b: number[] = [];
      rows.forEach((r, i) => {
        const v = get(r);
        if (v == null) return;
        a.push(v); b.push(residual[i]);
      });
      if (a.length < 15) continue;
      const rr = pearson(a, b);
      console.log(`  ${label.padEnd(14)} r = ${rr.toFixed(3)}${Math.abs(rr) > sigLine ? " *" : ""}  n=${a.length}`);
    }
    console.log(`  양수면 "평가가 높은 매장을 수요층이 과소평가하고 있다"는 뜻 — 그 몫을 두 층이 올리면 된다.`);
    const spread = [...residual].sort((a, b) => a - b);
    console.log(`  남는 오차 분포: ${spread[0].toFixed(2)} ~ ${spread[spread.length - 1].toFixed(2)} (중앙 ${median(residual).toFixed(2)})`);
    expect(rows.length).toBeGreaterThan(20);
  });
});
