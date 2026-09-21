// 점유율 곡선 — 경쟁이 셀수록 과소예측되는 걸 무엇으로 고치나 (2026-09-21)
//
// ── 어디서 나왔나 ─────────────────────────────────────────────────────────
// `_demandRebuild`에서 수요식은 맞다는 게 나왔다. 틀린 건 점유율이다:
//
//   log(필요 점유율) = a + b x log(예측 점유율)   **b = 0.765**
//
//   예측 점유율 4분위    필요÷예측
//     1분위  31%(경쟁 센 곳)  1.49      <- 49% 과소예측
//     2분위  45%             1.18
//     3분위  62%             1.12
//     4분위 100%(독점)        1.01      <- 거의 완벽
//
// **독점에서는 정확하고 경쟁이 셀수록 틀린다.** 완벽하게 단조롭다.
//
// ⚠️ **b가 이 파일의 과녁이다.** 축척(hoursPerUserPerMonth)은 a만 움직이고 b는 못 바꾼다.
//    그래서 "MAPE가 좋아졌다"는 수준이 맞은 것일 수 있지만, **b가 1로 갔다면 구조가 맞은
//    것이다.** textbookModel의 θ 주석이 경고하는 바로 그 구분이다 —
//    *"θ가 줄인 건 수준이고, 남긴 건 순서다."*
//
// ── 무엇을 재나 ───────────────────────────────────────────────────────────
// (가) **품질 지수 θ** — 사용자 제안: *"경쟁력점수의 편차를 키워야되나? 점수에따른 점유율을
//      기존보다 더 크게해석하는구조?"* 지금 3. 올리면 자사 품질이 높은 매장의 경쟁무게가
//      더 깎인다. 다만 θ가 수준만 움직이면 b는 안 변한다 — 그걸 가른다.
//
// (나) **점유율 지수 ν** — 날 점유율에 지수를 건다.  rawShare' = rawShare^ν
//      ν=1이면 지금과 동일(중첩 모형). ν<1이면 **낮은 점유율이 더 많이 올라간다** =
//      b를 1 쪽으로 민다. 뜻은 "경쟁이 아무리 세도 위치·습관 때문에 오는 손님이 있다"다.
//      지금 식은 경쟁이 커지면 점유율이 0으로 가는데, 바닥이 없는 게 이상하다.
//
//      구현: pcCount는 가동률 분모라 못 건드린다. 경쟁무게만 바꿔 같은 값을 만든다 —
//        rawShare = pc/(pc+W)  ->  목표 rawShare^ν 를 만들려면
//        W' = pc x (rawShare^(-ν) − 1),  경쟁점 ip를 전부 W'/W 배로 스케일.
//
// ── 사전 등록 ─────────────────────────────────────────────────────────────
//   관문 0  중첩 확인 — θ=3 / ν=1이 지금 값과 소수점까지 같아야 한다.
//   관문 1  **b가 1로 가나.** 이게 본 과녁이다. 수준(MAPE)은 축척이 흡수하니 증거가 약하다.
//   관문 2  LOO 홀드아웃에서 이기나 (축척·상품몫까지 훈련겹에서만).
//   관문 3  ⚠️ **가운데가 무너지지 않나.** 오차 4분위로 갈라 1·2분위가 나빠지면 트레이드오프다
//           (2026-09-20에 한 번, 오늘 δ에서 또 한 번 이걸로 닫혔다).
//   관문 4  무작위 대조군 — (가)는 품질 점수를 매장 안에서 섞고, (나)는 ν를 쓴 이득이
//           **b를 회귀로 구해 되먹인 순환**이 아닌지 홀드아웃으로 본다.
//
// ⚠️ **측정만 한다.** θ도 본체도 이 파일이 안 고친다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_shareCurve.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, computeQualityScore, fittedParams, scoreTextbook, type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };

describeIf("점유율 곡선", () => {
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
  const P0 = DEFAULT_TEXTBOOK_PARAMS;
  const nameOf = (r: LabRow) => r.input.storeName ?? r.input.storeCode;

  /** 그 설정에서의 경쟁무게 합 (textbookModel 품질 모드와 같은 식). */
  const rivalWeight = (r: LabRow, p: TextbookParams) => {
    const i = r.input;
    const oq = i.ownQualityParts ? computeQualityScore(i.ownQualityParts, p.qualityWeights) : null;
    let w = 0;
    for (const v of i.rivals ?? []) {
      if (!(v.ip > 0)) continue;
      if (v.distanceM != null && v.distanceM > p.effectiveRadiusM) continue;
      const q = v.parts ? computeQualityScore(v.parts, p.qualityWeights) : null;
      const ratio = oq == null || !(oq > 0) || q == null || !(q > 0) ? 1 : q / oq;
      w += v.ip * Math.pow(ratio, p.qualityExponent);
    }
    return w;
  };

  /** ν를 먹인 판 — 경쟁점 ip를 통째로 스케일해 rawShare^ν를 만든다. */
  const withNu = (nu: number, p: TextbookParams, src: LabRow[] = base): LabRow[] => {
    if (nu === 1) return src;
    return src.map((r) => {
      const pc = r.input.pcCount;
      const W = rivalWeight(r, p);
      if (!pc || pc <= 0 || !(W > 0)) return r;
      const raw = pc / (pc + W + p.outsideOptionIp);
      const Wnew = pc * (Math.pow(raw, -nu) - 1) - p.outsideOptionIp;
      if (!(Wnew > 0)) return r;
      const k = Wnew / W;
      return { ...r, input: { ...r.input, rivals: (r.input.rivals ?? []).map((v) => (v.ip > 0 ? { ...v, ip: v.ip * k } : v)) } };
    });
  };

  /** 기울기 b와 r — 축척 불변 지표. */
  const slope = (rows: LabRow[], p: TextbookParams) => {
    const sc = scoreTextbook(rows, p);
    const X: number[] = [], Y: number[] = [];
    const q: { share: number; req: number }[] = [];
    for (const x of sc.rows) {
      if (x.share == null || !(x.share > 0) || x.requiredShare == null || !(x.requiredShare > 0)) continue;
      X.push(Math.log(x.share)); Y.push(Math.log(x.requiredShare));
      q.push({ share: x.share, req: x.requiredShare });
    }
    const mx = mean(X), my = mean(Y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < X.length; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; syy += (Y[i] - my) ** 2; }
    return { b: sxx > 0 ? sxy / sxx : NaN, r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN, q, n: X.length };
  };

  /** LOO — 축척·상품몫까지 훈련겹에서만. 매장별 절대오차. */
  const loo = (rows: LabRow[], p: TextbookParams) => {
    const out = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const full = fittedParams(p, scoreTextbook(rows.filter((_, k) => k !== i), p));
      const b = computeTextbook(rows[i].input, full);
      const a = rows[i].actualRevenue;
      if (b.monthlyRevenue != null && a > 0) out.set(nameOf(rows[i]), Math.abs(b.monthlyRevenue - a) / a);
    }
    return out;
  };
  const mape = (m: Map<string, number>) => mean([...m.values()]);
  const quart = (s: ReturnType<typeof slope>) => {
    const sorted = [...s.q].sort((a, b) => a.share - b.share);
    const k = Math.ceil(sorted.length / 4);
    return [0, 1, 2, 3].map((i) => {
      const g = sorted.slice(i * k, (i + 1) * k);
      return g.length ? med(g.map((x) => x.req / x.share)) : NaN;
    });
  };

  it("(0) 중첩 확인", () => {
    const a = slope(base, P0), b = slope(withNu(1, P0), P0);
    console.log(`\n[관문 0] ν=1 vs 지금 — b ${a.b.toFixed(6)} vs ${b.b.toFixed(6)}  ${Math.abs(a.b - b.b) < 1e-9 ? "**같다**" : "❌"}`);
    console.log(`  지금 b = ${a.b.toFixed(3)} · r = ${a.r.toFixed(3)} · n=${a.n}`);
    expect(Math.abs(a.b - b.b)).toBeLessThan(1e-9);
  });

  it("(가) 품질 지수 θ — 사용자 제안. b가 움직이나", () => {
    console.log(`\n[θ 훑기] 사용자: "경쟁력점수의 편차를 키워야되나?"  ·  θ=3이 지금`);
    console.log("     θ  │    b       r    │  4분위 필요÷예측 (경쟁 센 쪽 -> 독점)  │  LOO MAPE");
    for (const th of [1, 2, 3, 4, 5, 6, 8]) {
      const p = { ...P0, qualityExponent: th };
      const s = slope(base, p);
      const qq = quart(s).map((x) => x.toFixed(2).padStart(5)).join(" ");
      console.log(`  ${String(th).padStart(5)}  │ ${s.b.toFixed(3).padStart(6)} ${s.r.toFixed(3).padStart(7)} │  ${qq}  │  ${(mape(loo(base, p)) * 100).toFixed(2).padStart(6)}%${th === 3 ? "  <- 지금" : ""}`);
    }
    console.log(`\n  ⚠️ **b를 본다.** MAPE가 좋아져도 b가 그대로면 수준만 맞춘 것이다(θ 주석의 경고).`);
    expect(true).toBe(true);
  });

  it("(나) 점유율 지수 ν — b를 직접 겨냥한다", () => {
    console.log(`\n[ν 훑기] rawShare^ν · ν=1이 지금 · ν<1이면 낮은 점유율이 더 올라간다`);
    console.log("     ν  │    b       r    │  4분위 필요÷예측                      │  LOO MAPE");
    for (const nu of [1.0, 0.9, 0.8, 0.765, 0.7, 0.6, 0.5]) {
      const rows = withNu(nu, P0);
      const s = slope(rows, P0);
      const qq = quart(s).map((x) => x.toFixed(2).padStart(5)).join(" ");
      console.log(`  ${nu.toFixed(3).padStart(5)}  │ ${s.b.toFixed(3).padStart(6)} ${s.r.toFixed(3).padStart(7)} │  ${qq}  │  ${(mape(loo(rows, P0)) * 100).toFixed(2).padStart(6)}%${nu === 1 ? "  <- 지금" : ""}`);
    }
    console.log(`\n  ⚠️ ν=0.765는 **b를 회귀로 구해 되먹인 값**이다. b가 1로 가는 건 당연하다.`);
    console.log(`     증거는 LOO와 (다)의 분위표다 — 거기서도 이겨야 한다.`);
    expect(true).toBe(true);
  });

  it("(다) 가운데가 무너지나 + 짝지은 부트스트랩", () => {
    const l0 = loo(base, P0);
    const ranked = [...l0.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    const q = Math.ceil(ranked.length / 4);
    const gs = [0, 1, 2, 3].map((i) => new Set(ranked.slice(i * q, (i + 1) * q)));
    const show = (label: string, L: Map<string, number>) => {
      const gm = gs.map((g) => mean([...L.entries()].filter(([k]) => g.has(k)).map(([, x]) => x)));
      console.log(`  ${label.padEnd(16)}${(mape(L) * 100).toFixed(2).padStart(7)}%  │ ` + gm.map((x) => (x * 100).toFixed(1).padStart(7) + "%").join(" "));
    };
    console.log(`\n[관문 3] 오차 4분위 — **지금 기준**으로 가른다(판이 움직이면 비교가 안 된다)`);
    console.log("   설정             LOO MAPE  │ 1분위(가운데) 2분위    3분위   4분위(꼬리)");
    show("지금", l0);
    for (const th of [4, 5]) show(`θ=${th}`, loo(base, { ...P0, qualityExponent: th }));
    for (const nu of [0.9, 0.8, 0.765]) show(`ν=${nu}`, loo(withNu(nu, P0), P0));

    // 짝지은 부트스트랩 — 제일 나아 보인 하나만
    const cand = loo(withNu(0.8, P0), P0);
    const names = [...l0.keys()].filter((n) => cand.has(n));
    const diff = names.map((n) => l0.get(n)! - cand.get(n)!);
    let seed = 20260921;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const boot: number[] = [];
    for (let k = 0; k < 2000; k++) {
      let s = 0;
      for (let i = 0; i < diff.length; i++) s += diff[Math.floor(rnd() * diff.length)];
      boot.push(s / diff.length);
    }
    boot.sort((a, b) => a - b);
    console.log(`\n  짝지은 부트스트랩 (ν=0.8 vs 지금) 평균 ${(mean(diff) * 100).toFixed(2)}%p` +
      `  95% 구간 [${(boot[50] * 100).toFixed(2)}, ${(boot[1949] * 100).toFixed(2)}]%p` +
      `  ${boot[50] > 0 || boot[1949] < 0 ? "**0을 안 품는다**" : "0을 품는다"}`);
    expect(names.length).toBeGreaterThan(30);
  });
});
