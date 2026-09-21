// 감쇠 모양을 **성적으로 고르는 게 정당한가** (2026-09-21)
//
// ── 사용자 말 ─────────────────────────────────────────────────────────────
// *"R200 λ200으로 할까? 뭐 이부분은 검증이안되니 결과로 식완성하는 수밖예없을거같긴하네"*
//
// 맞는 말이다 — 경쟁점이 몇 m부터 덜 위협적인지를 **직접 관측한 자료가 없다.** 그래서
// 성적으로 고를 수밖에 없다. 다만 그게 사장님이 예전에 경고한 **결과맞추기**
// (`_catchment.test.ts` 머리 주석)가 되는 자리라서, 고르기 전에 이걸 재야 한다:
//
//   ⚠️ R200 λ200은 **38곳 성적을 다 보고 제일 좋은 칸을 집은 것**이다.
//      그 38곳에서 좋은 건 당연하다. 물어야 할 것은 **처음 보는 매장에서도 좋은가**다.
//
// ── 관문 (먼저 박는다) ────────────────────────────────────────────────────
//   관문 1  **짝지은 부트스트랩** — R300 λ150 대비 R200 λ200의 이득이 0을 안 품나.
//           품으면 자료가 둘을 못 가른다 = 오늘의 1.07%p는 잡음일 수 있다.
//   관문 2  **격자가 안정적인가** — 최적 칸이 뾰족한 봉우리 하나면 그건 잡음이고,
//           너른 고원이면 신호다. 이웃 칸과의 차이로 본다.
//   관문 3  ⭐ **중첩 LOO(고르는 행위까지 검증)** — 이게 본 관문이다.
//           매장 하나를 빼고 **나머지 37곳에서 최적 (R,λ)를 고른 뒤**, 그 값으로
//           뺀 매장을 맞힌다. 38번 반복한다. "성적으로 고르기"가 일반화되면
//           이 중첩 MAPE가 고정값(계단300 · R300λ150)을 이겨야 한다.
//           **못 이기면 고르는 행위 자체가 과적합**이고, 그때는 자료가 아니라
//           개념으로 골라야 한다.
//   관문 4  고른 칸이 매번 같은가 — 38번 중 R200 λ200이 몇 번 뽑히나.
//           매번 딴 게 뽑히면 "최적값"이라는 말 자체가 성립을 안 한다.
//
// ⚠️ **측정만 한다.** `textbookModel.ts`를 안 건드린다. 사용자가 고른다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_decayShapeSelection.test.ts --disable-console-intercept
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
const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;

describeIf("감쇠 모양을 성적으로 고르는 게 정당한가", () => {
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

  /**
   * 정규화된 감쇠 파라미터. wf는 **주어진 매장 집합에서 측정**한다(손으로 안 고른다).
   * ⚠️ 집합을 넘기는 게 중요하다 — 중첩 LOO에서는 **뺀 매장을 빼고** 재야 한다.
   * 안 그러면 고르는 단계에 정답이 새어 들어간다.
   */
  const totalWith = (w: (d: number | null) => number, src: LabRow[]) =>
    src.reduce((s, r) => s + (r.input.rivals ?? []).reduce((t, v) => t + (v.ip > 0 ? v.ip * w(v.distanceM) : 0), 0), 0);
  const mk = (R: number, L: number, src: LabRow[]): TextbookParams => {
    const raw = (d: number | null) => (d == null || d <= R ? 1 : Math.exp(-(d - R) / L));
    const wf = totalWith(stepW, src) / Math.max(1e-9, totalWith(raw, src));
    return { ...DEFAULT_TEXTBOOK_PARAMS, rivalDistanceDecay: { plateauM: R, scaleM: L, weightFactor: wf } };
  };

  /** 격자 — 채택 때 쓴 범위에 R200·R150을 더했다. */
  const RS = [150, 200, 250, 300, 350];
  const LS = [50, 100, 150, 200, 250];
  const CELLS = RS.flatMap((R) => LS.map((L) => ({ R, L, key: `R${R} λ${L}` })));

  /** LOO 오차(절대값). p를 만드는 데 쓸 집합을 따로 받는다. */
  const looErrors = (mkP: (src: LabRow[]) => TextbookParams) => {
    const out = new Map<string, number>();
    for (let i = 0; i < base.length; i++) {
      const rest = base.filter((_, k) => k !== i);
      const p = mkP(rest);
      const full = fittedParams(p, scoreTextbook(rest, p));
      const b = computeTextbook(base[i].input, full);
      const a = base[i].actualRevenue;
      if (b.monthlyRevenue != null && a > 0) out.set(nameOf(base[i]), Math.abs(b.monthlyRevenue - a) / a);
    }
    return out;
  };
  /** 고정 파라미터의 LOO — wf도 나머지 37곳에서 잰다(정직하게). */
  const looFixed = (R: number | null, L: number) =>
    looErrors((rest) => (R == null ? P_STEP : mk(R, L, rest)));

  const A = looFixed(300, 150);  // 지금 채택된 값
  const B = looFixed(200, 200);  // 사장님이 물은 값
  const S = looFixed(null, 0);   // 계단300 (채택 전)
  const names = [...A.keys()].filter((n) => B.has(n) && S.has(n));
  const M = (m: Map<string, number>) => mean(names.map((n) => m.get(n)!));
  const W = (m: Map<string, number>) => Math.max(...names.map((n) => m.get(n)!));
  const SD = (m: Map<string, number>) => sd(names.map((n) => m.get(n)!));

  it("(1) 관문 1 — R200 λ200의 이득이 잡음인가 (짝지은 부트스트랩)", () => {
    // 채택할 때 산식에 박을 값이다 — 소수 넷째 자리까지 찍는다(전 매장에서 잰 정규화 상수).
    for (const [R, L] of [[300, 150], [200, 200]] as [number, number][]) {
      console.log(`  [wf] R${R} λ${L} → weightFactor ${mk(R, L, base).rivalDistanceDecay!.weightFactor!.toFixed(4)}`);
    }
    console.log(`\n[출발점] n=${names.length}`);
    for (const [k, m] of [["계단300", S], ["R300 λ150(지금)", A], ["R200 λ200", B]] as [string, Map<string, number>][]) {
      console.log(`  ${k.padEnd(16)}MAPE ${pct(M(m))} · 최악 ${pct(W(m), 1)} · SD ${(SD(m) * 100).toFixed(1)}%p`);
    }
    const d = names.map((n) => B.get(n)! - A.get(n)!); // 음수 = R200이 덜 틀림
    let seed = 20260921;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const bm: number[] = [], bw: number[] = [];
    for (let k = 0; k < 2000; k++) {
      const idx = names.map(() => Math.floor(rnd() * names.length));
      bm.push(mean(idx.map((i) => d[i])));
      bw.push(Math.max(...idx.map((i) => B.get(names[i])!)) - Math.max(...idx.map((i) => A.get(names[i])!)));
    }
    bm.sort((a, b) => a - b); bw.sort((a, b) => a - b);
    const zero = bm[50] <= 0 && bm[1949] >= 0;
    console.log(`\n[관문 1] R300 λ150 -> R200 λ200 · 짝지은 부트스트랩 2000회`);
    console.log(`  MAPE 차이  실제 ${pct(mean(d))} (음수 = R200이 낫다)  95% 구간 [${pct(bm[50])}, ${pct(bm[1949])}]`);
    console.log(`  ${zero ? "**0을 품는다 — 자료가 둘을 못 고른다**" : "**0을 안 품는다 — 자료가 골랐다**"}`);
    console.log(`  최악 차이  실제 ${pct(W(B) - W(A), 1)}  95% 구간 [${pct(bw[50], 1)}, ${pct(bw[1949], 1)}]`);
    // 장산점 하나가 이 차이를 만드는지도 같이 본다
    const noJ = names.filter((n) => n !== "장산점");
    console.log(`  장산 빼면  MAPE ${pct(mean(noJ.map((n) => A.get(n)!)))} -> ${pct(mean(noJ.map((n) => B.get(n)!)))}` +
      `  (차이 ${pct(mean(noJ.map((n) => B.get(n)! - A.get(n)!)))})`);
    expect(bm.length).toBe(2000);
  });

  it("(2) 관문 2 — 최적 칸이 뾰족한 봉우리인가 너른 고원인가", () => {
    // ⚠️ 사용자 규칙 — MAPE만 보면 안 된다. 칸마다 **MAPE / 최악 / SD**를 같이 찍는다.
    console.log(`\n[격자] 각 칸 = LOO MAPE · 최악 · SD (wf는 칸마다 다시 잼)`);
    console.log(`  기준선 계단300  MAPE ${pct(M(S))} · 최악 ${pct(W(S), 1)} · SD ${(SD(S) * 100).toFixed(1)}%p`);
    console.log("      R │" + LS.map((L) => `λ=${L}`.padStart(21)).join(""));
    const grid: { key: string; R: number; L: number; mape: number; worst: number; sd: number; w302: number; w342: number }[] = [];
    for (const R of RS) {
      const cells: string[] = [];
      for (const L of LS) {
        const m = looFixed(R, L);
        const w = (d: number) => (d <= R ? 1 : Math.exp(-(d - R) / L));
        grid.push({ key: `R${R} λ${L}`, R, L, mape: M(m), worst: W(m), sd: SD(m), w302: w(302), w342: w(342) });
        cells.push(`${pct(M(m), 1)} ${pct(W(m), 0)} ${(SD(m) * 100).toFixed(1)}`.padStart(21));
      }
      console.log(`  ${String(R).padStart(7)} │` + cells.join(""));
    }
    console.log(`\n  최악 낮은 순 ${[...grid].sort((a, b) => a.worst - b.worst).slice(0, 4).map((x) => `${x.key}(${pct(x.worst, 1)})`).join(" · ")}`);
    console.log(`  SD 낮은 순   ${[...grid].sort((a, b) => a.sd - b.sd).slice(0, 4).map((x) => `${x.key}(${(x.sd * 100).toFixed(1)}%p)`).join(" · ")}`);
    console.log(`\n  [그 칸이 실제 경쟁점을 몇 %로 세나] 정규화 전 날무게`);
    for (const k of ["R200 λ50", "R200 λ200", "R300 λ150", "R150 λ100"]) {
      const g = grid.find((x) => x.key === k)!;
      console.log(`    ${k.padEnd(10)} 장산 로엘PC 302m ${(g.w302 * 100).toFixed(0)}%  ·  오송 팀플PC 342m ${(g.w342 * 100).toFixed(0)}%`);
    }
    const best = [...grid].sort((a, b) => a.mape - b.mape);
    console.log(`\n  좋은 순 5칸: ${best.slice(0, 5).map((x) => `${x.key}(${pct(x.mape)})`).join(" · ")}`);
    const top = best[0];
    const neigh = grid.filter((x) => x.key !== top.key
      && Math.abs(RS.indexOf(x.R) - RS.indexOf(top.R)) <= 1 && Math.abs(LS.indexOf(x.L) - LS.indexOf(top.L)) <= 1);
    console.log(`  최적 ${top.key} ${pct(top.mape)} · 이웃 ${neigh.length}칸 평균 ${pct(mean(neigh.map((x) => x.mape)))}` +
      ` · 이웃 최악 ${pct(Math.max(...neigh.map((x) => x.mape)))}`);
    console.log(`  격자 전체 퍼짐: 최소 ${pct(best[0].mape)} ~ 최대 ${pct(best[best.length - 1].mape)}` +
      ` (폭 ${pct(best[best.length - 1].mape - best[0].mape)})`);
    console.log(`\n  ⚠️ 이웃과 차이가 크면 **뾰족한 봉우리 = 잡음**이다. 비슷하면 너른 고원 = 신호다.`);
    expect(grid.length).toBe(RS.length * LS.length);
  });

  it("(3) ⭐ 관문 3 — 고르는 행위까지 검증한다 (중첩 LOO)", () => {
    // 매장 i를 빼고 → 나머지 37곳에서 격자를 훑어 최적 (R,λ)를 고르고 → 그 값으로 i를 맞힌다.
    // "성적으로 고르기"가 일반화되는지를 재는 **유일하게 정직한 방법**이다.
    const picked: string[] = [];
    const errs: number[] = [];
    const used: string[] = [];
    for (let i = 0; i < base.length; i++) {
      const rest = base.filter((_, k) => k !== i);
      // 안쪽 루프 — rest 안에서 다시 LOO로 각 칸을 평가한다(rest만 쓴다. i는 절대 안 본다).
      let bestKey = "", bestM = Infinity, bestR = 0, bestL = 0;
      for (const c of CELLS) {
        const inner: number[] = [];
        for (let j = 0; j < rest.length; j++) {
          const rest2 = rest.filter((_, k) => k !== j);
          const p = mk(c.R, c.L, rest2);
          const full = fittedParams(p, scoreTextbook(rest2, p));
          const b = computeTextbook(rest[j].input, full);
          const a = rest[j].actualRevenue;
          if (b.monthlyRevenue != null && a > 0) inner.push(Math.abs(b.monthlyRevenue - a) / a);
        }
        const m = mean(inner);
        if (m < bestM) { bestM = m; bestKey = c.key; bestR = c.R; bestL = c.L; }
      }
      // 고른 값으로 뺀 매장을 맞힌다
      const p = mk(bestR, bestL, rest);
      const full = fittedParams(p, scoreTextbook(rest, p));
      const b = computeTextbook(base[i].input, full);
      const a = base[i].actualRevenue;
      if (b.monthlyRevenue != null && a > 0) { errs.push(Math.abs(b.monthlyRevenue - a) / a); used.push(nameOf(base[i])); }
      picked.push(bestKey);
    }
    const nested = mean(errs), nestedWorst = Math.max(...errs);
    console.log(`\n[관문 3] 중첩 LOO — "38곳 보고 고르기"가 처음 보는 매장에서도 통하나`);
    console.log(`  고정 계단300        MAPE ${pct(M(S))} · 최악 ${pct(W(S), 1)}`);
    console.log(`  고정 R300 λ150(지금) MAPE ${pct(M(A))} · 최악 ${pct(W(A), 1)}`);
    console.log(`  고정 R200 λ200      MAPE ${pct(M(B))} · 최악 ${pct(W(B), 1)}`);
    console.log(`  **매번 새로 고름**   MAPE ${pct(nested)} · 최악 ${pct(nestedWorst, 1)}  <- 이게 정직한 성적이다`);
    const wins = nested < M(B);
    console.log(`\n  ${wins ? "고르기가 R200 고정을 이긴다 — 성적으로 고르는 게 일반화된다"
      : "**고르기가 R200 고정을 못 이긴다 — 38곳에 맞춘 값이라는 뜻이다**"}`);
    console.log(`\n[관문 4] 38번 중 어느 칸이 뽑혔나`);
    const tally = new Map<string, number>();
    for (const k of picked) tally.set(k, (tally.get(k) ?? 0) + 1);
    for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(12)}${String(v).padStart(3)}번 / ${picked.length}` + (v === picked.length ? "  <- 항상 같다" : ""));
    }
    console.log(`\n  ⚠️ 한 칸이 38번 다 뽑히면 그 최적값은 **한 매장에 휘둘리지 않는다**는 뜻이다.`);
    console.log(`     여러 칸으로 갈리면 "최적값"이 표본에 따라 움직인다 = 못 믿는다.`);
    expect(used.length).toBeGreaterThan(30);
  });
});
