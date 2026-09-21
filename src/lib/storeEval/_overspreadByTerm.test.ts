// 가동률 과장(1.42배)은 **어느 항이** 만드나 (2026-09-21)
//
// ── 사용자 지시 ───────────────────────────────────────────────────────────
// *"다음 작업 — 과장 줄이기. 아스트라 지금 멈췄으니까 알아서 해라 너가"*
//
// ── 무엇이 밝혀져 있나 ────────────────────────────────────────────────────
// 교과서식 가동률 예측은 실측보다 **1.42배 넓게 퍼진다**(예측 SD 8.15%p vs 실측 5.72%p).
// 순서는 맞힌다(r=0.516, 유의). 그래서 MAE가 '전부 평균'(4.26%p)보다 나쁘다.
// 이론 수축 k*=0.362를 **출력에 통째로** 걸면 3.94%p로 평균을 이긴다.
//
// ⚠️ 그런데 출력에 수축을 거는 건 **계수를 하나 더 만드는 일**이고, 왜 과장되는지를
//    설명하지 못한다. 어느 항이 범인인지 알면 그 항을 고칠 수 있다. 그게 이 파일이다.
//
// ── 분해 ──────────────────────────────────────────────────────────────────
//   가동률 = min( 총수요시간 x min(1, 날점유율 x 입지배율) ÷ (자사PC x 월시간), 상한 )
// 상한에 안 걸리면 로그에서 **덧셈**이 된다:
//   log(가동률) = log(총수요시간÷자사PC) + log(날점유율) + log(입지배율) − log(월시간)
//                 └───── D(수요) ─────┘   └── S(경쟁) ──┘  └── L(입지) ──┘
//
//   Var(log 가동률) = Var(D)+Var(S)+Var(L) + 2Cov(D,S)+2Cov(D,L)+2Cov(S,L)
//
// 항마다 두 가지를 본다:
//   1. **분산 기여** — 이 항이 퍼짐을 얼마나 만드나
//   2. **실측과의 공분산** — 그 퍼짐이 **쓸모 있는 퍼짐**인가(신호), 그냥 흔들림인가(잡음)
// 둘을 나누면 항별 이론 수축계수가 나온다: k*_T = Cov(T, 실측) ÷ Var(T).
//
// ── Astra와 겹치지 않는다 ─────────────────────────────────────────────────
// Astra `_utilizationAblation`은 항을 **켜고 끄며 MAE**를 본다(2^3 조합).
// 여기는 **퍼짐의 출처**를 본다. 둘은 다른 물음이고 답도 다르게 나온다 —
// 켜고 끄기는 "그 항이 있는 게 나은가"를, 이건 "그 항이 얼마나 과한가"를 묻는다.
//
// ⚠️ 측정만 한다. 본체 무수정. 계수는 사용자가 고른다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_overspreadByTerm.test.ts --disable-console-intercept
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
const cov = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  return mean(a.map((_, i) => (a[i] - ma) * (b[i] - mb)));
};
const sdOf = (a: number[]) => Math.sqrt(varOf(a));
const corr = (a: number[], b: number[]) => cov(a, b) / (sdOf(a) * sdOf(b));
const pp = (v: number, d = 2) => `${(v * 100).toFixed(d)}%p`;
const MONTH_HOURS = 24 * 30;
/** n=38 단일 유의선. ⚠️ 여러 개를 훑으면 ±0.41까지 우연히 나온다(`_schoolInflow` 4절). */
const SIG = 0.32;

describeIf("가동률 과장은 어느 항이 만드나", () => {
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
  const P = DEFAULT_TEXTBOOK_PARAMS;

  /** LOO로 세 항을 뽑는다 — 축척은 자기를 뺀 37곳에서 맞춘다. */
  type Term = { n: string; D: number; S: number; L: number; pred: number; act: number; capped: boolean; shareCapped: boolean };
  const T: Term[] = [];
  for (let i = 0; i < base.length; i++) {
    const rest = base.filter((_, k) => k !== i);
    const f = fittedParams(P, scoreTextbook(rest, P));
    const b = computeTextbook(base[i].input, f);
    const act = base[i].input.actualUtilization;
    const pc = base[i].input.pcCount;
    if (act == null || !(act > 0) || b.utilization == null || !(b.utilization > 0)) continue;
    if (b.totalDemandHours == null || b.share == null || !pc || b.locationMultiplier == null) continue;
    // 날점유율 = share ÷ 입지배율 (share는 입지를 이미 곱하고 1로 자른 값이다)
    const locMul = b.locationMultiplier;
    const rawShare = b.share / locMul;
    T.push({
      n: nameOf(base[i]),
      D: Math.log(b.totalDemandHours / (pc * MONTH_HOURS)),
      S: Math.log(rawShare),
      L: Math.log(locMul),
      pred: b.utilization, act,
      capped: b.capped,
      shareCapped: rawShare * locMul > 1 + 1e-12,
    });
  }

  it("(0) 분해가 성립하나 — 상한에 걸린 매장이 있으면 로그 덧셈이 깨진다", () => {
    const capped = T.filter((x) => x.capped || x.shareCapped);
    console.log(`\n[분해 확인] n=${T.length}`);
    console.log(`  가동률 상한(${(P.maxUtilization * 100).toFixed(0)}%)에 걸린 곳 ${T.filter((x) => x.capped).length}곳` +
      ` · 점유율이 1로 잘린 곳 ${T.filter((x) => x.shareCapped).length}곳`);
    const gap = T.filter((x) => !x.capped && !x.shareCapped)
      .map((x) => Math.abs((x.D + x.S + x.L) - Math.log(x.pred)));
    console.log(`  안 걸린 ${gap.length}곳에서 log(가동률) = D+S+L 어긋남 최대 ${Math.max(...gap).toExponential(2)}` +
      `  ${Math.max(...gap) < 1e-9 ? "**성립**" : "❌"}`);
    if (capped.length) console.log(`  ⚠️ 걸린 곳(${capped.map((x) => x.n).join(", ")})은 아래 분산 분해에서 뺀다 — 덧셈이 안 맞는다.`);
    expect(Math.max(...gap)).toBeLessThan(1e-9);
  });

  it("(1) ⭐ 분산 분해 — 퍼짐을 누가 만드나, 그 퍼짐은 쓸모 있나", () => {
    const U = T.filter((x) => !x.capped && !x.shareCapped);
    const D = U.map((x) => x.D), S = U.map((x) => x.S), L = U.map((x) => x.L);
    const A = U.map((x) => Math.log(x.act));
    const Pl = U.map((x) => Math.log(x.pred));
    console.log(`\n[분산 분해] 로그 눈금 · 상한 안 걸린 ${U.length}곳`);
    console.log(`  예측 SD(log) ${sdOf(Pl).toFixed(4)}  ·  실측 SD(log) ${sdOf(A).toFixed(4)}` +
      `  →  **${(sdOf(Pl) / sdOf(A)).toFixed(2)}배 넓다**`);
    const vP = varOf(Pl);
    console.log(`\n  항        분산      전체 대비   실측과 공분산   항별 이론수축 k*=Cov÷Var   해석`);
    const terms: [string, number[]][] = [["D 수요/PC", D], ["S 경쟁(날점유율)", S], ["L 입지배율", L]];
    for (const [k, v] of terms) {
      const kv = cov(v, A) / varOf(v);
      const tag = kv < 0 ? "**반대로 움직인다**" : kv < 0.3 ? "거의 잡음" : kv < 0.8 ? "신호 있으나 과함" : "적정";
      console.log(`  ${k.padEnd(16)}${varOf(v).toFixed(4)}${(varOf(v) / vP * 100).toFixed(0).padStart(9)}%` +
        `${cov(v, A).toFixed(4).padStart(15)}${kv.toFixed(3).padStart(24)}   ${tag}`);
    }
    console.log(`\n  공분산 항 (음수면 서로 상쇄하며 퍼짐을 줄인다)`);
    console.log(`    2Cov(D,S) ${(2 * cov(D, S)).toFixed(4)}  ·  2Cov(D,L) ${(2 * cov(D, L)).toFixed(4)}  ·  2Cov(S,L) ${(2 * cov(S, L)).toFixed(4)}`);
    const sum = varOf(D) + varOf(S) + varOf(L) + 2 * cov(D, S) + 2 * cov(D, L) + 2 * cov(S, L);
    console.log(`    합계 ${sum.toFixed(4)} vs Var(log 예측) ${vP.toFixed(4)}  ${Math.abs(sum - vP) < 1e-9 ? "**일치**" : "❌"}`);
    console.log(`\n  전체 이론수축 k* = Cov(log예측, log실측) ÷ Var(log예측) = ${(cov(Pl, A) / vP).toFixed(3)}`);
    console.log(`\n  ⚠️ 읽는 법 — 분산 기여가 크면서 k*가 작은 항이 **범인**이다.`);
    console.log(`     (퍼짐은 많이 만드는데 실측을 설명하지는 못한다는 뜻)`);
    expect(Math.abs(sum - vP)).toBeLessThan(1e-9);
  });

  it("(2) 항별 수축 — 한 항씩만 눌러 본다", () => {
    // 한 항 T만 mean + k(T−mean)으로 누르고 나머지는 그대로. 수준은 **예측 기하평균에 고정**한다
    // (실측 평균에 맞추면 답을 보고 맞추는 꼴이다). 그래서 편향은 그대로 남는다.
    const U = T.filter((x) => !x.capped && !x.shareCapped);
    const A = U.map((x) => x.act);
    const Pl = U.map((x) => Math.log(x.pred));
    const gmP = mean(Pl);
    const mk = (which: "D" | "S" | "L" | "전부", k: number) =>
      U.map((x, i) => {
        const d = { D: x.D, S: x.S, L: x.L };
        const m = { D: mean(U.map((y) => y.D)), S: mean(U.map((y) => y.S)), L: mean(U.map((y) => y.L)) };
        const adj = which === "전부"
          ? gmP + k * (Pl[i] - gmP)
          : (["D", "S", "L"] as const).reduce((s, t) => s + (t === which ? m[t] + k * (d[t] - m[t]) : d[t]), 0);
        return Math.exp(adj);
      });
    const mae = (v: number[]) => mean(v.map((x, i) => Math.abs(x - A[i])));
    const sdErr = (v: number[]) => sdOf(v.map((x, i) => Math.abs(x - A[i])));
    const worst = (v: number[]) => Math.max(...v.map((x, i) => Math.abs(x - A[i]) / A[i]));
    console.log(`\n[항별 수축] 한 항만 k배로 누른다. 수준은 예측 기하평균에 고정(답을 안 본다).`);
    console.log(`  기준선: 전부 훈련평균 MAE ${pp(mean(A.map((a) => Math.abs(a - mean(A)))))}`);
    console.log(`\n  누른 항        k=0        k=0.25     k=0.5      k=0.75     k=1(지금)`);
    for (const which of ["D", "S", "L", "전부"] as const) {
      const cells = [0, 0.25, 0.5, 0.75, 1].map((k) => pp(mae(mk(which, k))).padStart(11));
      console.log(`  ${which.padEnd(12)}${cells.join("")}`);
    }
    console.log(`\n  같은 표, **최악 오차**로 (사용자 규칙: 평균만 보지 않는다)`);
    console.log(`  누른 항        k=0        k=0.25     k=0.5      k=0.75     k=1(지금)`);
    for (const which of ["D", "S", "L", "전부"] as const) {
      const cells = [0, 0.25, 0.5, 0.75, 1].map((k) => `${(worst(mk(which, k)) * 100).toFixed(0)}%`.padStart(11));
      console.log(`  ${which.padEnd(12)}${cells.join("")}`);
    }
    console.log(`\n  오차 SD도 같이`);
    for (const which of ["D", "S", "L", "전부"] as const) {
      const cells = [0, 0.25, 0.5, 0.75, 1].map((k) => pp(sdErr(mk(which, k))).padStart(11));
      console.log(`  ${which.padEnd(12)}${cells.join("")}`);
    }
    console.log(`\n  ⚠️ 한 항만 눌러서 전부 누른 것만큼 좋아지면 **그 항이 과장의 주범**이다.`);
    console.log(`     아무 항도 혼자서 못 따라가면 과장은 **특정 항이 아니라 구조**에서 온다.`);
    expect(U.length).toBeGreaterThan(25);
  });

  // ── ⚠️ (1)(2)의 분해에 결함이 있었다 (2026-09-21, 같은 세션에서 발견) ──────
  //
  // D = log(수요시간 ÷ (자사PC x 720)) 와 S = log(자사PC ÷ (자사PC + 경쟁가중)) 에는
  // **자사PC가 양쪽에 들어가 서로 약분된다:**
  //
  //   D + S = log(수요시간) − log(자사PC x 720) + log(자사PC) − log(자사PC + 경쟁가중)
  //         = log(수요시간) − log(자사PC + 경쟁가중) − log(720)
  //
  // 그래서 2Cov(D,S)=−0.169라는 "상쇄"의 상당 부분이 **쪼개는 방식이 만든 가짜**다.
  // Var(D)=229%·Var(S)=165% 같은 숫자도 그 때문에 부풀려졌다.
  // "두 큰 수를 빼서 작은 잔차를 만든다"는 내 앞선 진단은 **이 인공물을 보고 한 말**이다.
  //
  // 겸사겸사 알게 된 것 하나 — 실험실 산식은 이미 운영 V62의 `computeIpPerDemand`와
  // **같은 형태**다(수요 ÷ 총IP). 두 단계로 쪼개 보일 뿐 대수적으로 하나다.
  // 그래서 "합치면 어떻게 되나"는 물을 필요가 없다. 이미 합쳐져 있다.
  //
  // 겹치지 않는 올바른 분해는 이것이다:
  //   log(가동률) = log(수요시간) − log(자사PC + 경쟁가중) + log(입지배율) − log(720)
  //                 └─ H 수요 ─┘   └──── T 공급 ────┘   └── L 입지 ──┘
  it("(4) ⭐ 분해를 다시 한다 — 수요(H) vs 공급(T) vs 입지(L)", () => {
    const U = T.filter((x) => !x.capped && !x.shareCapped);
    // D = log(수요시간) − log(pc x 720) · S = log(pc) − log(pc+경쟁) 이므로
    //   H = log(수요시간) = D + log(pc x 720)
    //   T항 = log(pc + 경쟁가중) = log(pc) − S
    // pc를 되살리려면 원본이 필요하다 — base에서 다시 읽는다.
    const pcOf = new Map(base.map((r) => [r.input.storeName ?? r.input.storeCode, r.input.pcCount ?? 0]));
    const H: number[] = [], Tsup: number[] = [], L: number[] = [], A: number[] = [], Pl: number[] = [];
    for (const x of U) {
      const pc = pcOf.get(x.n) ?? 0;
      if (!(pc > 0)) continue;
      H.push(x.D + Math.log(pc * MONTH_HOURS));
      Tsup.push(Math.log(pc) - x.S);
      L.push(x.L);
      A.push(Math.log(x.act));
      Pl.push(Math.log(x.pred));
    }
    const vP = varOf(Pl);
    console.log(`\n[올바른 분해] log(가동률) = H − T + L − log(720)   n=${H.length}`);
    const recomposed = H.map((_, i) => H[i] - Tsup[i] + L[i] - Math.log(MONTH_HOURS));
    console.log(`  되맞춤 확인: 최대 어긋남 ${Math.max(...recomposed.map((v, i) => Math.abs(v - Pl[i]))).toExponential(2)}`);
    console.log(`\n  항            SD(log)    분산    전체 대비   실측과 상관   k*=Cov÷Var`);
    for (const [k, v, sign] of [["H 수요", H, +1], ["T 공급(자사+경쟁)", Tsup, -1], ["L 입지", L, +1]] as [string, number[], number][]) {
      // 부호를 반영한 기여도로 봐야 한다 — T는 빼는 항이다.
      const eff = v.map((x) => sign * x);
      console.log(`  ${k.padEnd(16)}${sdOf(v).toFixed(4)}${varOf(v).toFixed(4).padStart(9)}${(varOf(v) / vP * 100).toFixed(0).padStart(11)}%` +
        `${corr(eff, A).toFixed(3).padStart(14)}${(cov(eff, A) / varOf(eff)).toFixed(3).padStart(13)}`);
    }
    const negT = Tsup.map((x) => -x);
    console.log(`\n  공분산(부호 반영): 2Cov(H,−T) ${(2 * cov(H, negT)).toFixed(4)} · 2Cov(H,L) ${(2 * cov(H, L)).toFixed(4)} · 2Cov(−T,L) ${(2 * cov(negT, L)).toFixed(4)}`);
    const sum = varOf(H) + varOf(Tsup) + varOf(L) + 2 * cov(H, negT) + 2 * cov(H, L) + 2 * cov(negT, L);
    console.log(`  합계 ${sum.toFixed(4)} vs Var(log 예측) ${vP.toFixed(4)}  ${Math.abs(sum - vP) < 1e-9 ? "**일치**" : "❌"}`);
    console.log(`\n  H와 T의 상관 r = ${corr(H, Tsup).toFixed(3)} — 양수면 **수요 많은 곳에 공급도 많다**(시장이 스스로 맞춘다).`);
    console.log(`  ⚠️ 앞의 (1)절 숫자(Var 229%/165%, 2Cov(D,S)=−0.169)는 자사PC가 양쪽에 들어간`);
    console.log(`     **인공물**이다. 이 표가 맞는 그림이다.`);
    expect(Math.abs(sum - vP)).toBeLessThan(1e-9);
  });

  it("(5) ⭐ 산식이 강제하는 지수 1이 맞나 — 자료가 원하는 지수", () => {
    // 지금 산식은 가동률 ∝ (수요 ÷ 총공급)^1 을 **강제**한다. 지수를 자유롭게 두면?
    //   log(실측) = a + b x log(수요 ÷ 총공급) + c x log(입지)
    // b < 1이면 산식이 그 비에 **과하게 반응**하는 것이다. 그게 과장의 정체다.
    // ⚠️ 이건 계수를 고르자는 제안이 아니라 **진단**이다. b가 1에서 얼마나 먼지를 잰다.
    const U = T.filter((x) => !x.capped && !x.shareCapped);
    const pcOf = new Map(base.map((r) => [r.input.storeName ?? r.input.storeCode, r.input.pcCount ?? 0]));
    const X: number[] = [], Lx: number[] = [], A: number[] = [];
    for (const x of U) {
      const pc = pcOf.get(x.n) ?? 0;
      if (!(pc > 0)) continue;
      X.push(x.D + x.S);            // = log(수요시간 ÷ 총공급) − log(720)
      Lx.push(x.L);
      A.push(Math.log(x.act));
    }
    const b1 = cov(X, A) / varOf(X);
    console.log(`\n[강제된 지수 검사] 지금 산식은 b=1, c=1을 강제한다`);
    console.log(`  단순회귀  log(실측) = a + b x log(수요÷총공급)`);
    console.log(`    b = ${b1.toFixed(3)}   (산식은 1을 쓴다)  ·  r = ${corr(X, A).toFixed(3)}${Math.abs(corr(X, A)) > SIG ? " *" : ""}`);
    console.log(`    → 산식이 이 비에 **${(1 / Math.max(1e-6, b1)).toFixed(1)}배 과하게 반응**한다`);
    // 입지를 같이 넣은 2변수 회귀 (정규방정식)
    const n = X.length;
    const mX = mean(X), mL = mean(Lx), mA = mean(A);
    const sxx = mean(X.map((v) => (v - mX) ** 2)), sll = mean(Lx.map((v) => (v - mL) ** 2));
    const sxl = cov(X, Lx), sxa = cov(X, A), sla = cov(Lx, A);
    const det = sxx * sll - sxl * sxl;
    const b = (sll * sxa - sxl * sla) / det;
    const c = (sxx * sla - sxl * sxa) / det;
    console.log(`\n  2변수회귀  log(실측) = a + b x log(수요÷총공급) + c x log(입지배율)`);
    console.log(`    b = ${b.toFixed(3)} (산식 1) · c = ${c.toFixed(3)} (산식 1) · n = ${n}`);
    const pred = X.map((v, i) => mA + b * (v - mX) + c * (Lx[i] - mL));
    const ss = 1 - mean(pred.map((v, i) => (v - A[i]) ** 2)) / varOf(A);
    console.log(`    설명력 R² = ${ss.toFixed(3)}`);
    console.log(`\n  ⚠️ b가 1보다 훨씬 작으면 — **지금 산식은 수요÷공급 비를 과하게 믿는다.**`);
    console.log(`     그게 1.55배 과장의 구조적 정체다. 출력에 수축을 거는 것과 같은 효과지만,`);
    console.log(`     **뜻이 있는 자리**(비에 대한 반응 강도)에 걸리므로 설명할 수 있다.`);
    console.log(`  ⚠️ 다만 b를 자료로 고르는 건 계수 추가다 — 사용자 확인 없이 안 넣는다.`);
    console.log(`     그리고 이 b는 같은 38곳에서 잰 값이라 홀드아웃이 따로 필요하다.`);
    expect(n).toBeGreaterThan(25);
  });

  it("(3) 상한에 걸리는 게 문제 아닌가 — 수요층 단독의 크기", () => {
    // Astra 분해에서 '수요' 단독은 20곳이 상한(55%)에 걸렸다. 수요층이 통째로 과대하다는 뜻이다.
    // 경쟁층이 그걸 내리누르는 구조라, 두 큰 오차가 상쇄하며 남는 잔차가 넓게 퍼질 수 있다.
    const U = T.filter((x) => !x.capped && !x.shareCapped);
    const noComp = U.map((x) => Math.exp(x.D + x.L)); // 경쟁 항만 뺀 가동률(=점유율 1)
    const A = U.map((x) => x.act);
    console.log(`\n[수요층 단독 크기] 경쟁을 빼면 가동률이 얼마로 나오나`);
    console.log(`  경쟁 뺀 예측 가동률: 중앙 ${(([...noComp].sort((a, b) => a - b)[Math.floor(noComp.length / 2)]) * 100).toFixed(1)}%` +
      ` · 최대 ${(Math.max(...noComp) * 100).toFixed(1)}% · ${noComp.filter((x) => x > P.maxUtilization).length}곳이 상한 초과`);
    console.log(`  실측 가동률:        중앙 ${(([...A].sort((a, b) => a - b)[Math.floor(A.length / 2)]) * 100).toFixed(1)}%` +
      ` · 최대 ${(Math.max(...A) * 100).toFixed(1)}%`);
    const need = U.map((x, i) => A[i] / noComp[i]); // 필요 점유율
    console.log(`  필요 점유율(실측 ÷ 경쟁뺀예측): 중앙 ${(([...need].sort((a, b) => a - b)[Math.floor(need.length / 2)]) * 100).toFixed(1)}%` +
      ` · 범위 ${(Math.min(...need) * 100).toFixed(1)}~${(Math.max(...need) * 100).toFixed(1)}%`);
    const S = U.map((x) => Math.exp(x.S));
    console.log(`  산식 점유율:                    중앙 ${(([...S].sort((a, b) => a - b)[Math.floor(S.length / 2)]) * 100).toFixed(1)}%` +
      ` · 범위 ${(Math.min(...S) * 100).toFixed(1)}~${(Math.max(...S) * 100).toFixed(1)}%`);
    console.log(`\n  퍼짐 견주기: 필요 점유율 SD(log) ${sdOf(need.map(Math.log)).toFixed(4)} vs 산식 점유율 SD(log) ${sdOf(U.map((x) => x.S)).toFixed(4)}`);
    console.log(`  ⚠️ 산식 점유율이 필요 점유율보다 넓으면 — **경쟁 항이 과하게 벌린다**는 직접 증거다.`);
    expect(U.length).toBeGreaterThan(25);
  });
});
