// 사용자 착상 — 수요를 100%로 놓고 몫만 보면? (2026-09-21)
//
// ── 사용자 말 ─────────────────────────────────────────────────────────────
// *"수요를 퍼센트로 잡아서 100%. 수요가 3천일 수도 5천일 수도 있지 상권마다,
//  여기서 경쟁점수를 통해 100중의 우리가 가져가는 %를 구하면
//  **수요가 2배라고 가동률 2배로 읽지 않는 거 아냐?**"*
//
// ── 먼저 확인 — 지금 산식이 이미 그 구조다 ────────────────────────────────
//   가동률 = 총수요 x 점유율 ÷ (자사PC x 720),  점유율 = 자사PC ÷ (자사PC + 경쟁가중)
//          = 총수요 ÷ ((자사PC + 경쟁가중) x 720)        ← 자사PC가 약분된다
// 그래서 "수요가 2배라도 경쟁도 2배면 가동률은 그대로"가 **이미 성립한다.**
//
// ── 그런데 자료에서는 안 상쇄된다 ─────────────────────────────────────────
// 수요 1→4분위에서 수요 2.6배 · 경쟁IP 3.6배로 **경쟁이 더 빨리 는다.**
// 그래서 log(수요÷총공급)의 퍼짐 SD 0.405가 실측 0.189의 **2.1배**다.
//
// ── 그래서 이 파일이 묻는 것 ──────────────────────────────────────────────
// 지금 산식은 수요와 공급의 지수를 **+1과 −1로 못 박았다.** 둘이 정확히 반대라는
// 가정을 한 번도 안 재봤다. 풀어서 물어본다:
//
//   log(가동률) = a + p x log(수요) + q x log(총공급) + c x log(입지)
//   지금 산식은 p=+1 · q=−1 · c=+1 을 강제한다.
//
//   묻기 1  p와 q가 정말 크기가 같고 부호만 반대인가? (p = −q 인가)
//   묻기 2  사용자 착상의 극단형 — **수요를 아예 안 보면**(p=0) 어떻게 되나?
//           "상권마다 수요가 3천이든 5천이든 상관없고, 몫만 본다"가 이 형태다.
//   묻기 3  반대로 **공급을 안 보면**(q=0)?
//   묻기 4  ⚠️ 어느 쪽이든 최악·SD를 같이 본다. 그리고 '전부 평균'을 넘나?
//
// ⚠️ 측정만 한다. 계수는 사용자가 정한다. 본체 무수정.
//
// 실행:
//   npx vitest run src/lib/storeEval/_demandSupplyExponents.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, rivalDistanceWeight, computeQualityScore, fittedParams, scoreTextbook } from "./textbookModel";
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

describeIf("수요와 공급의 지수를 따로 풀면", () => {
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
  const full = fittedParams(P, scoreTextbook(base, P));

  /**
   * 세 변수를 **산식이 쓰는 그대로** 뽑는다.
   *   H = log(총수요시간)
   *   S = log(자사PC + 경쟁가중IP)      ← 총공급. 경쟁가중은 품질비^θ x 거리무게까지 먹인 값
   *   L = log(입지배율)
   * ⚠️ 경쟁가중을 여기서 새로 짜면 산식과 어긋난다 — `rivalDistanceWeight`와 같은 품질식을 쓴다.
   */
  type Rec = { n: string; H: number; S: number; L: number; act: number; ownPc: number; rivalW: number; modelU: number };
  const R: Rec[] = [];
  for (const r of base) {
    const b = computeTextbook(r.input, full);
    const act = r.input.actualUtilization, pc = r.input.pcCount;
    if (act == null || !(act > 0) || !pc || b.totalDemandHours == null || !(b.totalDemandHours > 0)) continue;
    if (b.capped || b.locationMultiplier == null) continue;
    const oq = r.input.ownQualityParts ? computeQualityScore(r.input.ownQualityParts, P.qualityWeights) : null;
    let rivalW = 0;
    for (const v of r.input.rivals ?? []) {
      if (!(v.ip > 0)) continue;
      const q = v.parts ? computeQualityScore(v.parts, P.qualityWeights) : null;
      const ratio = oq != null && oq > 0 && q != null && q > 0 ? q / oq : 1;
      rivalW += v.ip * Math.pow(ratio, P.qualityExponent) * rivalDistanceWeight(v.distanceM, P);
    }
    // ⚠️ **점유율 상한(min(1, ...))에 걸린 매장은 로그 덧셈이 깨진다.** 반드시 빼야 한다.
    //    2026-09-21에 이걸 놓쳐 되맞춤이 40% 어긋났고, 관문이 잡아 줬다.
    //    ⚠️ 상한 검사를 `b.share ÷ 입지배율`로 하면 **순환이라 영영 안 걸린다**(잘린 뒤 값을
    //       되나누면 정확히 1이 된다). 경쟁점에서 **직접** 날점유율을 만들어 봐야 한다.
    const rawShare = pc / (pc + rivalW + P.outsideOptionIp);
    if (rawShare * b.locationMultiplier > 1 - 1e-12) continue;
    R.push({
      n: r.input.storeName ?? r.input.storeCode,
      H: Math.log(b.totalDemandHours), S: Math.log(pc + rivalW + P.outsideOptionIp),
      L: Math.log(b.locationMultiplier), act, ownPc: pc, rivalW,
      // ⚠️ 산식이 실제로 낸 값을 **같은 줄에** 담는다. 2026-09-21에 이걸 따로 모았다가
      //    거르는 조건이 달라 배열 순서가 어긋났고, 되맞춤 관문이 40% 차이로 걸렸다.
      modelU: b.utilization ?? NaN,
    });
  }
  const A = R.map((x) => Math.log(x.act));

  it("(0) 되맞춤 확인 — 뽑은 변수가 산식과 같은가", () => {
    const gaps = R.map((x) =>
      Math.abs(Math.exp(x.H - x.S - Math.log(MONTH_HOURS) + x.L) - x.modelU) / x.modelU);
    const gap = Math.max(...gaps);
    // 어긋나면 **어디서** 어긋나는지 바로 보여준다 — 관문이 "틀렸다"만 말하면 쓸모가 적다.
    if (gap > 1e-9) {
      console.log(`\n  [어긋난 곳 상위 5] 내가 뽑은 경쟁가중 vs 산식이 실제로 쓴 값`);
      const worst5 = R.map((x, i) => ({ x, g: gaps[i] })).sort((a, b) => b.g - a.g).slice(0, 5);
      for (const { x, g } of worst5) {
        // 산식이 쓴 경쟁가중을 역산한다: rawShare = 자사PC ÷ (자사PC + 경쟁가중 + 바깥선택지)
        const supplyModel = Math.exp(x.H) * Math.exp(x.L) / (x.modelU * MONTH_HOURS);
        console.log(`    ${x.n.padEnd(14)}어긋남 ${(g * 100).toFixed(1)}%` +
          ` · 내 총공급 ${Math.exp(x.S).toFixed(1)} · 산식 총공급 ${supplyModel.toFixed(1)}` +
          ` (자사 ${x.ownPc} + 내 경쟁가중 ${x.rivalW.toFixed(1)} vs 산식 경쟁가중 ${(supplyModel - x.ownPc).toFixed(1)})`);
      }
    }
    console.log(`\n[되맞춤] 가동률 = 수요 ÷ 총공급 ÷ 720 x 입지  ·  n=${R.length}`);
    console.log(`  최대 어긋남 ${(gap * 100).toExponential(2)}%  ${gap < 1e-9 ? "**산식과 같다**" : "❌ 어긋난다 — 아래를 믿지 말 것"}`);
    console.log(`  총공급 = 자사PC + 경쟁가중 · 중앙 ${med(R.map((x) => Math.exp(x.S))).toFixed(0)} (자사 ${med(R.map((x) => x.ownPc)).toFixed(0)}대 + 경쟁 ${med(R.map((x) => x.rivalW)).toFixed(0)})`);

    // ── ⭐ 상한에 걸려 빠진 매장이 누구인가 — 이게 그냥 넘길 일이 아니다 ────
    // 점유율은 min(1, 날점유율 x 입지배율)로 잘린다. 잘리면 **입지배율이 통째로 버려진다.**
    // 그리고 수요 축척(hoursPerUserPerMonth)은 하필 **독점매장**에서 잡는다.
    // 축척을 잡는 바로 그 자리에서 입지항이 무시되고 있다면, 축척이 그 왜곡을 흡수한다.
    console.log(`\n  [점유율 상한에 걸린 매장] — 입지배율이 통째로 잘려나간다`);
    let nCap = 0;
    for (const r of base) {
      const b = computeTextbook(r.input, full);
      const pc = r.input.pcCount;
      const act = r.input.actualUtilization;
      if (!pc || act == null || !(act > 0) || b.locationMultiplier == null || b.totalDemandHours == null) continue;
      const oq = r.input.ownQualityParts ? computeQualityScore(r.input.ownQualityParts, P.qualityWeights) : null;
      let rw = 0;
      for (const v of r.input.rivals ?? []) {
        if (!(v.ip > 0)) continue;
        const q = v.parts ? computeQualityScore(v.parts, P.qualityWeights) : null;
        const ratio = oq != null && oq > 0 && q != null && q > 0 ? q / oq : 1;
        rw += v.ip * Math.pow(ratio, P.qualityExponent) * rivalDistanceWeight(v.distanceM, P);
      }
      const raw = pc / (pc + rw + P.outsideOptionIp);
      if (raw * b.locationMultiplier > 1 - 1e-12) {
        nCap++;
        console.log(`    ${(r.input.storeName ?? "").padEnd(14)}날점유율 ${(raw * 100).toFixed(1)}% x 입지 ${b.locationMultiplier.toFixed(3)}` +
          ` = ${(raw * b.locationMultiplier * 100).toFixed(1)}% → **100%로 잘림**` +
          `  (입지 ${((b.locationMultiplier - 1) * 100).toFixed(0)}%p가 버려진다)`);
      }
    }
    console.log(`    합계 ${nCap}곳`);
    console.log(`  ⚠️ 수요 축척은 **독점매장에서** 잡는다. 그 자리에서 입지항이 버려지면`);
    console.log(`     축척이 그 왜곡을 흡수한다 — 전 매장 수준이 그만큼 틀어진다.`);
    expect(gap).toBeLessThan(1e-9);
  });

  /** 다변수 최소제곱 — 고정할 계수는 fix로 박는다(null이면 자유). */
  const fit = (tr: Rec[], fix: { p?: number | null; q?: number | null; c?: number | null }) => {
    const cols: ((x: Rec) => number)[] = [];
    const keys: ("p" | "q" | "c")[] = [];
    if (fix.p == null) { cols.push((x) => x.H); keys.push("p"); }
    if (fix.q == null) { cols.push((x) => x.S); keys.push("q"); }
    if (fix.c == null) { cols.push((x) => x.L); keys.push("c"); }
    const y = tr.map((x) => Math.log(x.act) - (fix.p ?? 0) * x.H - (fix.q ?? 0) * x.S - (fix.c ?? 0) * x.L);
    const m = cols.length;
    if (m === 0) return { p: fix.p ?? 0, q: fix.q ?? 0, c: fix.c ?? 0, a: mean(y) };
    const means = cols.map((f) => mean(tr.map(f)));
    const my = mean(y);
    const M: number[][] = Array.from({ length: m }, () => Array(m + 1).fill(0));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) M[i][j] = mean(tr.map((x, k) => (cols[i](x) - means[i]) * (cols[j](tr[k]) - means[j])));
      M[i][m] = mean(tr.map((x, k) => (cols[i](x) - means[i]) * (y[k] - my)));
    }
    for (let i = 0; i < m; i++) {
      let piv = i;
      for (let k = i + 1; k < m; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
      [M[i], M[piv]] = [M[piv], M[i]];
      if (Math.abs(M[i][i]) < 1e-12) continue;
      for (let k = i + 1; k < m; k++) {
        const f = M[k][i] / M[i][i];
        for (let s = i; s <= m; s++) M[k][s] -= f * M[i][s];
      }
    }
    const beta = Array(m).fill(0);
    for (let i = m - 1; i >= 0; i--) {
      let s = M[i][m];
      for (let k = i + 1; k < m; k++) s -= M[i][k] * beta[k];
      beta[i] = Math.abs(M[i][i]) < 1e-12 ? 0 : s / M[i][i];
    }
    const out = { p: fix.p ?? 0, q: fix.q ?? 0, c: fix.c ?? 0, a: 0 };
    keys.forEach((k, i) => { out[k] = beta[i]; });
    out.a = my - beta.reduce((s, b, i) => s + b * means[i], 0);
    return out;
  };

  const loo = (fix: { p?: number | null; q?: number | null; c?: number | null }) => {
    const out: { n: string; pred: number; act: number; p: number; q: number; c: number }[] = [];
    for (let i = 0; i < R.length; i++) {
      const f = fit(R.filter((_, k) => k !== i), fix);
      out.push({ n: R[i].n, pred: Math.exp(f.a + f.p * R[i].H + f.q * R[i].S + f.c * R[i].L), act: R[i].act, p: f.p, q: f.q, c: f.c });
    }
    return out;
  };
  type Out = ReturnType<typeof loo>;
  const mae = (v: Out) => mean(v.map((x) => Math.abs(x.pred - x.act)));
  const sdE = (v: Out) => sdOf(v.map((x) => Math.abs(x.pred - x.act)));
  const wst = (v: Out) => Math.max(...v.map((x) => Math.abs(x.pred - x.act) / x.act));
  const w5 = (v: Out) => v.filter((x) => Math.abs(x.pred - x.act) <= 0.05).length;
  const constBase: Out = R.map((x, i) => ({
    n: x.n, pred: mean(R.filter((_, k) => k !== i).map((y) => y.act)), act: x.act, p: 0, q: 0, c: 0,
  }));

  it("(1) ⭐ 지수를 전부 풀면 — p = −q 인가", () => {
    const f = fit(R, {});
    console.log(`\n[전 표본 적합] log(가동률) = a + p·log(수요) + q·log(총공급) + c·log(입지)`);
    console.log(`  p = ${f.p.toFixed(3)}  (산식 +1)`);
    console.log(`  q = ${f.q.toFixed(3)}  (산식 −1)`);
    console.log(`  c = ${f.c.toFixed(3)}  (산식 +1)`);
    console.log(`\n  p + q = ${(f.p + f.q).toFixed(3)}  — 0이면 "수요와 공급이 정확히 반대"(산식 가정이 맞다)`);
    console.log(`  |p| vs |q| = ${Math.abs(f.p).toFixed(3)} vs ${Math.abs(f.q).toFixed(3)}` +
      `  → ${Math.abs(f.q) > Math.abs(f.p) ? "**공급이 더 세게 작용한다**" : "**수요가 더 세게 작용한다**"}`);
    console.log(`\n  ⚠️ 사용자 착상("수요가 2배라고 가동률 2배로 읽지 않는다")은 p가 1보다 **한참 작으면** 맞다.`);
    console.log(`     p ≈ 0이면 **수요 크기를 아예 안 보는 게 맞다**는 뜻이 된다.`);
    expect(R.length).toBeGreaterThan(30);
  });

  it("(2)(3) 사용자 착상의 극단형들 — 수요를 빼면? 공급을 빼면?", () => {
    console.log(`\n[LOO 견주기] 판정 기준은 가동률 · ⚠️ 최악·SD를 항상 같이 본다`);
    console.log(`  모형                                    MAE      SD      최악     ±5%p`);
    const rows: [string, Out][] = [
      ["전부 훈련평균 (아무것도 안 봄)", constBase],
      ["지금 산식 (p=1, q=−1, c=1)", loo({ p: 1, q: -1, c: 1 })],
      ["⭐ 수요 안 봄 (p=0, q·c 자유)", loo({ p: 0 })],
      ["공급 안 봄 (q=0, p·c 자유)", loo({ q: 0 })],
      ["입지 안 봄 (c=0, p·q 자유)", loo({ c: 0 })],
      ["비만 봄 (p=−q, c 자유)", (() => {
        // p=−q 제약 = log(수요÷총공급) 한 변수로 묶는 것과 같다.
        const out: Out = [];
        for (let i = 0; i < R.length; i++) {
          const tr = R.filter((_, k) => k !== i);
          const X = tr.map((x) => x.H - x.S), L = tr.map((x) => x.L), y = tr.map((x) => Math.log(x.act));
          const sxx = varOf(X), sll = varOf(L), sxl = cov(X, L);
          const det = sxx * sll - sxl * sxl;
          const b = (sll * cov(X, y) - sxl * cov(L, y)) / det;
          const c = (sxx * cov(L, y) - sxl * cov(X, y)) / det;
          const a = mean(y) - b * mean(X) - c * mean(L);
          out.push({ n: R[i].n, pred: Math.exp(a + b * (R[i].H - R[i].S) + c * R[i].L), act: R[i].act, p: b, q: -b, c });
        }
        return out;
      })()],
      ["전부 자유 (p·q·c)", loo({})],
    ];
    for (const [k, v] of rows) {
      console.log(`  ${k.padEnd(36)}${pp(mae(v)).padStart(9)}${pp(sdE(v)).padStart(9)}${pct(wst(v)).padStart(9)}${(w5(v) + "/" + v.length).padStart(9)}`);
    }
    console.log(`\n  ⚠️ '수요 안 봄'이 '지금 산식'을 이기면 — **상권 크기를 재는 일 자체가 값을 못 한다**는 뜻이다.`);
    console.log(`     사용자 착상이 자료로 지지되는지가 이 한 줄에서 갈린다.`);
    expect(rows.length).toBe(7);
  });

  it("(4) 계수가 겹마다 흔들리나 + 대조군", () => {
    const f = loo({});
    const ps = f.map((x) => x.p), qs = f.map((x) => x.q), cs = f.map((x) => x.c);
    console.log(`\n[계수 안정성] 38겹 재적합`);
    console.log(`  p  중앙 ${med(ps).toFixed(3)} · 범위 ${Math.min(...ps).toFixed(3)}~${Math.max(...ps).toFixed(3)}  (산식 +1 · 0을 ${Math.min(...ps) <= 0 && Math.max(...ps) >= 0 ? "**품는다**" : "안 품는다"})`);
    console.log(`  q  중앙 ${med(qs).toFixed(3)} · 범위 ${Math.min(...qs).toFixed(3)}~${Math.max(...qs).toFixed(3)}  (산식 −1 · 0을 ${Math.min(...qs) <= 0 && Math.max(...qs) >= 0 ? "**품는다**" : "안 품는다"})`);
    console.log(`  c  중앙 ${med(cs).toFixed(3)} · 범위 ${Math.min(...cs).toFixed(3)}~${Math.max(...cs).toFixed(3)}`);
    console.log(`\n  ⚠️ p가 0을 품으면 — **수요 항이 있으나 마나**라는 뜻이다(사용자 착상 지지).`);
    // 짝지은 부트스트랩: '수요 안 봄' vs '지금 산식', 그리고 vs '전부 평균'
    const cand = loo({ p: 0 });
    for (const [refName, ref] of [["지금 산식", loo({ p: 1, q: -1, c: 1 })], ["전부 훈련평균", constBase]] as [string, Out][]) {
      const d = R.map((_, i) => Math.abs(cand[i].pred - cand[i].act) - Math.abs(ref[i].pred - ref[i].act));
      let seed = 20260921;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const boot: number[] = [];
      for (let t = 0; t < 2000; t++) boot.push(mean(d.map(() => d[Math.floor(rnd() * d.length)])));
      boot.sort((a, b) => a - b);
      const zero = boot[50] <= 0 && boot[1949] >= 0;
      console.log(`  [부트스트랩] '수요 안 봄' vs ${refName}: 실제 ${pp(mean(d))} · 95% [${pp(boot[50])}, ${pp(boot[1949])}]` +
        `  ${zero ? "0을 품는다" : mean(d) < 0 ? "**유의하게 낫다**" : "유의하게 나쁘다"}`);
    }
    expect(ps.length).toBe(R.length);
  });
});
