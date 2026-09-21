// 재정립 2단계 — 산식이 강제하는 지수 1이 맞나 (2026-09-21)
//
// ── 1단계에서 나온 것 ─────────────────────────────────────────────────────
// 실험실 가동률은 대수적으로 **한 덩어리**다(운영 V62의 computeIpPerDemand와 같은 형태):
//
//   가동률 = 수요시간 ÷ ((자사PC + 경쟁가중IP) x 720) x 입지배율
//          = (수요÷총공급)^1 x 입지^1 x 상수
//
// **지수 1이 두 군데 박혀 있다.** 그런데 자료에 물어보면:
//
//   log(실측) = a + b x log(수요÷총공급)              b = 0.241  (r=0.516)
//   log(실측) = a + b x log(수요÷총공급) + c x log(입지)  b = 0.304 · c = 0.134  (R²=0.285)
//
// **b가 1이 아니라 0.24~0.30이다.** 산식이 그 비에 4배 과하게 반응한다.
// 이게 "예측이 실측보다 1.55배 넓게 퍼진다"의 구조적 정체다.
//
// ⚠️ 출력에 수축계수를 거는 것과 수학적으로는 비슷하지만 **자리가 다르다.**
//    수축은 "왜"를 설명 못 하는 땜질이고, 지수는 **뜻이 있는 자리**다 —
//    "동네 수요가 두 배라고 손님이 두 배 오지는 않는다"는 말이 된다.
//
// ── 이 파일이 재는 것 ─────────────────────────────────────────────────────
//   관문 1  b를 풀면 **처음 보는 매장**에서도 좋아지나 (LOO)
//   관문 2  ⚠️ 평균만 보지 않는다 — 최악·SD가 어떻게 되나
//   관문 3  b가 겹마다 흔들리나 (38번 다시 적합해서 분포를 본다)
//   관문 4  이득이 **지수 때문인가, 기준점을 바꿔서인가** — 둘을 갈라 잰다
//           (지금은 축척을 독점 3곳에 걸지만, 회귀는 훈련 전체 평균에 건다)
//   관문 5  짝지은 부트스트랩 — 상수 기준선과 현 산식 대비
//
// ⚠️ **채택하지 않는다.** 계수를 늘리는 일이라 사용자가 정한다. 재고 표만 만든다.
// ⚠️ 이 b는 38곳에서 잰 값이다. 표본이 늘면 다시 잰다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_ratioExponent.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const varOf = (a: number[]) => { const m = mean(a); return mean(a.map((x) => (x - m) ** 2)); };
const sdOf = (a: number[]) => Math.sqrt(varOf(a));
const cov = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  return mean(a.map((_, i) => (a[i] - ma) * (b[i] - mb)));
};
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const pp = (v: number, d = 2) => `${(v * 100).toFixed(d)}%p`;
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const MONTH_HOURS = 24 * 30;

describeIf("재정립 2단계 — 수요÷공급 비의 지수", () => {
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
  const P = DEFAULT_TEXTBOOK_PARAMS;

  /**
   * 각 매장의 **두 설명변수**를 뽑는다. ⚠️ 산식이 쓰는 것과 **똑같은 값**이어야 한다 —
   * 여기서 따로 계산하면 딴 걸 재게 된다. computeTextbook 출력에서 역산한다.
   *   X = log(수요시간 ÷ 총공급)   (= log(가동률) − log(입지배율), 720 제외)
   *   Lx = log(입지배율)
   * ⚠️ 축척(hoursPerUserPerMonth)은 X를 **평행이동만** 시킨다. 회귀의 절편이 흡수하므로
   *    독점 3곳 축척을 쓰든 말든 b는 안 변한다. 그래서 여기서는 전체 적합값을 써도 된다.
   */
  type Rec = { n: string; X: number; L: number; act: number };
  const R: Rec[] = [];
  {
    const full = fittedParams(P, scoreTextbook(base, P));
    for (const r of base) {
      const b = computeTextbook(r.input, full);
      const act = r.input.actualUtilization;
      if (act == null || !(act > 0) || b.utilization == null || !(b.utilization > 0)) continue;
      if (b.capped || b.locationMultiplier == null) continue;
      R.push({
        n: r.input.storeName ?? r.input.storeCode,
        X: Math.log(b.utilization) - Math.log(b.locationMultiplier),
        L: Math.log(b.locationMultiplier),
        act,
      });
    }
  }

  /** 훈련집합에서 a,b,c를 적합한다. 고정할 계수는 fixB/fixC로 박는다. */
  const fit = (tr: Rec[], fixB?: number, fixC?: number) => {
    const A = tr.map((x) => Math.log(x.act));
    const X = tr.map((x) => x.X), L = tr.map((x) => x.L);
    if (fixB != null && fixC != null) {
      return { a: mean(A.map((v, i) => v - fixB * X[i] - fixC * L[i])), b: fixB, c: fixC };
    }
    if (fixC != null) {
      const y = A.map((v, i) => v - fixC * L[i]);
      const b = cov(X, y) / varOf(X);
      return { a: mean(y) - b * mean(X), b, c: fixC };
    }
    const mX = mean(X), mL = mean(L), mA = mean(A);
    const sxx = varOf(X), sll = varOf(L), sxl = cov(X, L);
    const det = sxx * sll - sxl * sxl;
    const b = (sll * cov(X, A) - sxl * cov(L, A)) / det;
    const c = (sxx * cov(L, A) - sxl * cov(X, A)) / det;
    return { a: mA - b * mX - c * mL, b, c };
  };

  /** LOO — 훈련 37곳에서 적합해 남은 1곳을 맞힌다. */
  const loo = (fixB?: number, fixC?: number) => {
    const out: { n: string; pred: number; act: number; b: number; c: number }[] = [];
    for (let i = 0; i < R.length; i++) {
      const tr = R.filter((_, k) => k !== i);
      const f = fit(tr, fixB, fixC);
      out.push({ n: R[i].n, pred: Math.exp(f.a + f.b * R[i].X + f.c * R[i].L), act: R[i].act, b: f.b, c: f.c });
    }
    return out;
  };
  type Out = ReturnType<typeof loo>;
  const mae = (v: Out) => mean(v.map((x) => Math.abs(x.pred - x.act)));
  const sdE = (v: Out) => sdOf(v.map((x) => Math.abs(x.pred - x.act)));
  const worst = (v: Out) => Math.max(...v.map((x) => Math.abs(x.pred - x.act) / x.act));
  const bias = (v: Out) => mean(v.map((x) => x.pred - x.act));
  const w5 = (v: Out) => v.filter((x) => Math.abs(x.pred - x.act) <= 0.05).length;

  /** 지금 산식 그대로(축척은 독점 3곳). 견줄 기준선이다. */
  const nowModel: Out = (() => {
    const out: Out = [];
    for (let i = 0; i < base.length; i++) {
      const rest = base.filter((_, k) => k !== i);
      const f = fittedParams(P, scoreTextbook(rest, P));
      const b = computeTextbook(base[i].input, f);
      const act = base[i].input.actualUtilization;
      const n = base[i].input.storeName ?? base[i].input.storeCode;
      if (act != null && act > 0 && b.utilization != null && R.some((x) => x.n === n)) {
        out.push({ n, pred: b.utilization, act, b: 1, c: 1 });
      }
    }
    return out;
  })();
  /** 전부 훈련평균 — 넘어야 할 진짜 기준선. */
  const constBaseline: Out = R.map((x, i) => ({
    n: x.n, pred: mean(R.filter((_, k) => k !== i).map((y) => y.act)), act: x.act, b: 0, c: 0,
  }));

  it("(1)(2) 관문 1·2 — LOO 성적과 오차폭", () => {
    console.log(`\n[LOO 성적] n=${R.length} · 판정 기준은 가동률(2026-09-21 사용자 결정)`);
    console.log(`  모형                              MAE       SD      최악     편향     ±5%p`);
    const rows: [string, Out][] = [
      ["전부 훈련평균 (b=0,c=0)", constBaseline],
      ["지금 산식 (b=1,c=1, 독점축척)", nowModel],
      ["b=1,c=1 · 기준점만 전체평균", loo(1, 1)],
      ["b 자유, c=1", loo(undefined, 1)],
      ["b 자유, c 자유", loo()],
      ["b=0.3, c=0.15 (고정)", loo(0.3, 0.15)],
    ];
    for (const [k, v] of rows) {
      console.log(`  ${k.padEnd(32)}${pp(mae(v)).padStart(9)}${pp(sdE(v)).padStart(9)}${pct(worst(v)).padStart(9)}` +
        `${pp(bias(v)).padStart(9)}${(w5(v) + "/" + v.length).padStart(9)}`);
    }
    console.log(`\n  ⚠️ 평균만 보지 않는다 — 최악·SD를 같이 본다(사용자 규칙).`);
    expect(R.length).toBeGreaterThan(30);
  });

  it("(3) 관문 3 — b가 겹마다 흔들리나", () => {
    const f1 = loo(undefined, 1), f2 = loo();
    const bs1 = f1.map((x) => x.b), bs2 = f2.map((x) => x.b), cs2 = f2.map((x) => x.c);
    console.log(`\n[계수 안정성] 38겹에서 다시 적합한 값의 분포`);
    console.log(`  b (c=1 고정)   중앙 ${med(bs1).toFixed(3)} · 범위 ${Math.min(...bs1).toFixed(3)}~${Math.max(...bs1).toFixed(3)} · SD ${sdOf(bs1).toFixed(3)}`);
    console.log(`  b (c도 자유)   중앙 ${med(bs2).toFixed(3)} · 범위 ${Math.min(...bs2).toFixed(3)}~${Math.max(...bs2).toFixed(3)} · SD ${sdOf(bs2).toFixed(3)}`);
    console.log(`  c (자유)       중앙 ${med(cs2).toFixed(3)} · 범위 ${Math.min(...cs2).toFixed(3)}~${Math.max(...cs2).toFixed(3)} · SD ${sdOf(cs2).toFixed(3)}`);
    console.log(`\n  1이 범위 안에 드나: b ${Math.max(...bs2) >= 1 ? "든다" : "**안 든다 — 자료가 1을 거부한다**"}` +
      ` · c ${Math.max(...cs2) >= 1 ? "든다" : "**안 든다**"}`);
    console.log(`  ⚠️ 범위가 좁고 1을 안 품으면 "지수 1은 틀렸다"가 자료의 말이다.`);
    expect(bs1.length).toBe(R.length);
  });

  it("(4) 관문 4 — 이득이 지수 때문인가 기준점 때문인가", () => {
    const A = nowModel, B = loo(1, 1), C = loo(undefined, 1);
    console.log(`\n[갈라 재기] 지금 산식에서 두 가지가 동시에 바뀐다 — 따로 잰다`);
    console.log(`  1) 지금 산식 (독점 3곳 축척 · b=c=1)        MAE ${pp(mae(A))}`);
    console.log(`  2) 기준점만 전체평균으로 (b=c=1 유지)        MAE ${pp(mae(B))}   차이 ${pp(mae(B) - mae(A))}`);
    console.log(`  3) 거기에 b까지 풀면                        MAE ${pp(mae(C))}   차이 ${pp(mae(C) - mae(B))}`);
    console.log(`\n  기준점 바꿔서 얻은 몫 ${pp(mae(A) - mae(B))} · 지수 풀어서 얻은 몫 ${pp(mae(B) - mae(C))}`);
    console.log(`  ⚠️ 기준점 몫이 크면 — 진짜 문제는 **독점 3곳에 축척을 거는 구조**다.`);
    console.log(`     지수 몫이 크면 — 진짜 문제는 **비에 과하게 반응하는 것**이다.`);
    expect(A.length).toBeGreaterThan(30);
  });

  it("(5) 관문 5 — 짝지은 부트스트랩", () => {
    const cands: [string, Out][] = [["b 자유·c=1", loo(undefined, 1)], ["b·c 자유", loo()], ["b=0.3·c=0.15", loo(0.3, 0.15)]];
    for (const [refName, ref] of [["지금 산식", nowModel], ["전부 훈련평균", constBaseline]] as [string, Out][]) {
      console.log(`\n[부트스트랩] 기준선 = ${refName} · 가동률 오차 차이(음수 = 후보가 낫다) · 2000회`);
      for (const [k, v] of cands) {
        const ns = ref.map((x) => x.n).filter((n) => v.some((y) => y.n === n));
        const d = ns.map((n) => {
          const a = ref.find((x) => x.n === n)!, b2 = v.find((x) => x.n === n)!;
          return Math.abs(b2.pred - b2.act) - Math.abs(a.pred - a.act);
        });
        let seed = 20260921;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        const boot: number[] = [];
        for (let t = 0; t < 2000; t++) boot.push(mean(ns.map(() => d[Math.floor(rnd() * ns.length)])));
        boot.sort((x, y) => x - y);
        const zero = boot[50] <= 0 && boot[1949] >= 0;
        console.log(`  ${k.padEnd(14)}실제 ${pp(mean(d))}  95% [${pp(boot[50])}, ${pp(boot[1949])}]  ` +
          `${zero ? "0을 품는다 — 못 고른다" : mean(d) < 0 ? "**유의하게 낫다**" : "유의하게 나쁘다"}`);
      }
    }
    console.log(`\n  ⚠️ '전부 훈련평균'을 **유의하게** 이기지 못하면, 산식의 복잡도가 아직 값을 못 하는 것이다.`);
    expect(cands.length).toBe(3);
  });
});
