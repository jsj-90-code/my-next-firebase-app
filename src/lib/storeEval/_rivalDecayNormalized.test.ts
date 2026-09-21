// 경쟁점을 거리로 차등 적용한다 — **총량을 고정하고** 거리 구조만 본다 (2026-09-21)
//
// ── 사용자 지시 ───────────────────────────────────────────────────────────
// *"경쟁점 어디까지 적용할것인가 그걸 해야하는 순서였던거같다. 전에말했던 거리에 따라서
// 차등적용되는 구조로해야겠다. 거리딱정해서 없애고 이런거말고"*
//
// 지금은 300m 계단이다 — 안이면 100%, 밖이면 0%. 오송점 팀플PC가 **342m**라 통째로 안 세지고
// 점유율이 100%가 된다. 하안금당사거리는 경쟁점 3곳이 **전부 407~504m**라 역시 독점 취급이다.
// 사용자: *"오송점 팀플PC방 적용안된거 말이안되는 산식임"*. 맞는 말이다.
//
// ── ⚠️ 이건 2026-09-20에 한 번 기각된 갈래다. 무엇이 달라졌나 ────────────
// `_rivalDecay.test.ts`에서 두 설계를 쟀고 둘 다 떨어졌다:
//
//   첫 설계  exp(−d/λ) 전 구간      -> 근거리까지 줄여 **경쟁을 통째로 줄인** 게 됐다 (p=0.781)
//   둘째 설계 300m 평지 + 밖만 감쇠   -> 먼 경쟁점을 새로 세서 **총량이 늘었다** (p=0.995)
//
// **둘 다 경쟁 총량을 바꿨다.** 그리고 오늘 `_demandRebuild`에서 b=0.765가 나왔다 —
// 경쟁이 셀수록 과소예측이다. 그러니 총량을 늘리는 설계(둘째)는 **당연히** 나빠진다.
// 총량이 결과를 지배해서 '거리 구조'가 하는 일을 볼 수가 없었다.
//
// 그래서 이번엔 **총량을 고정한다.** 전 매장 경쟁무게 합이 지금(계단 300m)과 같아지도록
// 전역 상수 k를 곱한다. 그러면 수준이 약분되고 **매장 간 상대만** 남는다.
//
//   ip' = ip x f(거리) x k,    k = Σ(ip x 계단) ÷ Σ(ip x f)
//
// ⚠️ k는 **전역 상수 하나**다. 매장마다 다르게 주면 그건 정규화가 아니라 매장별 보정이다.
//
// ── 과녁 ──────────────────────────────────────────────────────────────────
// **b** = log(필요 점유율) = a + b x log(예측 점유율)의 기울기. 지금 0.765.
// 축척도 전역 상수도 b를 못 바꾼다. 거리 구조가 진짜 일을 하면 b가 1로 간다.
// r도 같이 본다 — b만 맞고 r이 떨어지면 순서를 망친 것이다(오늘 θ에서 그랬다).
//
// ── 관문 (먼저 박는다) ────────────────────────────────────────────────────
//   관문 0  중첩 확인 — 계단(λ→0 극한)이 지금 값과 같아야 한다.
//   관문 1  **b가 1로 가나 · r이 안 떨어지나.** 본 과녁.
//   관문 2  LOO 홀드아웃에서 이기나.
//   관문 3  ⚠️ 가운데가 안 무너지나 (오늘 δ·ν가 여기서 죽었다).
//   관문 4  무작위 대조군 — 경쟁점 거리를 **매장 안에서 섞는다**. 총량은 이미 고정이므로
//           섞어도 이득이 남으면 거리가 한 일이 아니다.
//
// ⚠️ **측정만 한다.** `rivalDistanceDecay: null`은 이 파일이 안 바꾼다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_rivalDecayNormalized.test.ts --disable-console-intercept
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
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const R0 = DEFAULT_TEXTBOOK_PARAMS.effectiveRadiusM; // 300

/** 거리 가중 함수들. 거리를 모르면 1(= 안쪽)로 본다 — 지금 코드와 같은 보수적 처리다. */
type Shape = { key: string; f: (d: number | null) => number };
const SHAPES: Shape[] = [
  { key: "계단300", f: (d) => (d == null || d <= R0 ? 1 : 0) },
  ...[150, 250, 400, 600].map((L) => ({ key: `지수 λ=${L}`, f: (d: number | null) => (d == null ? 1 : Math.exp(-d / L)) })),
  ...[200, 300, 500].map((d0) => ({ key: `거듭 d0=${d0}`, f: (d: number | null) => (d == null ? 1 : 1 / (1 + (d / d0) ** 2)) })),
  ...[500, 800, 1200].map((D) => ({ key: `선형 D=${D}`, f: (d: number | null) => (d == null ? 1 : Math.max(0, 1 - d / D)) })),
  // 2026-09-21 추가 — **정답 구조에 제일 가까운 형태.** 사용자: "계단식이 정답맞아?"
  //   안쪽은 평평하다(실무 의견 "유효거리 안이면 거리가 크게 작용 안 한다" + 자료도 지지)
  //   바깥은 0이 아니라 점차 줄어든다(302m가 0인 건 현실이 아니다)
  // 어제 이 모양을 총량 자유로 쟀다가 실패했다. **총량 고정으로는 오늘 처음 잰다.**
  ...[150, 300, 500, 800].map((L) => ({ key: `평지+감쇠 ${L}`, f: (d: number | null) => (d == null || d <= R0 ? 1 : Math.exp(-(d - R0) / L)) })),
  // 2026-09-21 — 사용자: "400까지는 100으로보고 이후에는 98 80 75 이런식으로 하면되는거아님?"
  // **평지 반경을 늘린다.** 앞의 평지형은 전부 300m였다. 평지 400이면 오송점 팀플PC(342m)가
  // 100%로 세지고, 하안금당(407·446·480m)도 평지 바로 밖이라 거의 다 세진다.
  ...[350, 400, 450, 500].map((Rp) => ({ key: `계단${Rp}`, f: (d: number | null) => (d == null || d <= Rp ? 1 : 0) })),
  ...[[400, 300], [400, 600], [400, 1000], [450, 600], [500, 600]].map(([Rp, L]) =>
    ({ key: `평지${Rp}+감쇠${L}`, f: (d: number | null) => (d == null || d <= Rp ? 1 : Math.exp(-(d - Rp) / L)) })),
];

describeIf("거리 차등 — 총량 고정", () => {
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
   * ⚠️ 2026-09-21에 여기서 한 번 틀렸다 — computeTextbook이 `effectiveRadiusM`으로 **한 번 더**
   * 거른다(textbookModel 품질 모드). ip를 아무리 바꿔도 300m 밖이면 그냥 건너뛰어서,
   * "300m 밖을 새로 센다"가 전혀 안 들어갔다. 감쇠를 f로만 처리하려면 계단을 꺼야 한다.
   * 계단 모양은 f가 밖을 0으로 만드니 PINF로도 결과가 같다(관문 0이 그걸 확인한다).
   */
  const PINF = { ...P, effectiveRadiusM: Number.POSITIVE_INFINITY };
  const nameOf = (r: LabRow) => r.input.storeName ?? r.input.storeCode;

  /** 전 매장 Σ(ip x f) — 정규화 상수를 만드는 데 쓴다. */
  const totalOf = (f: Shape["f"], src: LabRow[]) =>
    src.reduce((s, r) => s + (r.input.rivals ?? []).reduce((t, v) => t + (v.ip > 0 ? v.ip * f(v.distanceM) : 0), 0), 0);

  /** 모양 f를 먹이되 **전역 상수 하나**로 총량을 계단과 맞춘다. */
  const apply = (f: Shape["f"], src: LabRow[] = base, normalize = true): LabRow[] => {
    const k = normalize
      ? (() => { const a = totalOf(SHAPES[0].f, src), b = totalOf(f, src); return b > 0 ? a / b : 1; })()
      : 1;
    return src.map((r) => ({
      ...r,
      input: { ...r.input, rivals: (r.input.rivals ?? []).map((v) => (v.ip > 0 ? { ...v, ip: v.ip * f(v.distanceM) * k } : v)) },
    }));
  };

  const slope = (rows: LabRow[], p = PINF) => {
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
    return { b: sxx > 0 ? sxy / sxx : NaN, r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN, q };
  };
  const loo = (rows: LabRow[], p = PINF) => {
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

  it("(0) 중첩 확인 — 계단을 그대로 먹이면 지금과 같은가", () => {
    const a = slope(base, P), b = slope(apply(SHAPES[0].f), PINF);
    console.log(`\n[관문 0] 계단300 재적용 — b ${a.b.toFixed(6)} vs ${b.b.toFixed(6)}  ${Math.abs(a.b - b.b) < 1e-9 ? "**같다**" : "❌"}`);
    console.log(`  지금 b = ${a.b.toFixed(3)} · r = ${a.r.toFixed(3)} · LOO ${(mape(loo(base, P)) * 100).toFixed(2)}%`);
    expect(Math.abs(a.b - b.b)).toBeLessThan(1e-9);
  });

  it("(1)(2)(3) 모양 훑기 — 총량 고정 vs 안 함", () => {
    const l0 = loo(base, P);
    const ranked = [...l0.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    const q = Math.ceil(ranked.length / 4);
    const gs = [0, 1, 2, 3].map((i) => new Set(ranked.slice(i * q, (i + 1) * q)));
    console.log(`\n[모양 훑기] ⭐ 총량 **고정** (전역 상수 k로 계단과 맞춤)`);
    console.log("   모양          k     │    b       r    │ 4분위 필요÷예측          │ LOO MAPE │ 1분위(가운데) 4분위");
    for (const sh of SHAPES) {
      const rows = apply(sh.f);
      const k = totalOf(SHAPES[0].f, base) / Math.max(1e-9, totalOf(sh.f, base));
      const s = slope(rows), L = loo(rows);
      const gm = gs.map((g) => mean([...L.entries()].filter(([x]) => g.has(x)).map(([, v]) => v)));
      console.log(`  ${sh.key.padEnd(12)}${k.toFixed(2).padStart(6)}  │ ${s.b.toFixed(3).padStart(6)} ${s.r.toFixed(3).padStart(7)} │  ` +
        quart(s).map((x) => x.toFixed(2).padStart(5)).join(" ") + `  │ ${(mape(L) * 100).toFixed(2).padStart(6)}%  │ ` +
        `${(gm[0] * 100).toFixed(1).padStart(7)}% ${(gm[3] * 100).toFixed(1).padStart(7)}%${sh.key === "계단300" ? "  <- 지금" : ""}`);
    }
    console.log(`\n[대조] 총량 **안 맞춤** (2026-09-20 설계 재현 — 왜 실패했는지 보이라고 같이 찍는다)`);
    console.log("   모양                │    b       r    │ LOO MAPE");
    for (const sh of SHAPES.filter((s) => s.key !== "계단300")) {
      const rows = apply(sh.f, base, false);
      const s = slope(rows);
      console.log(`  ${sh.key.padEnd(20)}│ ${s.b.toFixed(3).padStart(6)} ${s.r.toFixed(3).padStart(7)} │ ${(mape(loo(rows)) * 100).toFixed(2).padStart(6)}%`);
    }
    console.log(`\n  ⚠️ 관문 1 — **b가 1로 가면서 r이 안 떨어져야** 거리 구조가 일한 것이다.`);
    console.log(`     관문 3 — 1분위(가운데)가 나빠지면서 4분위만 좋아지면 트레이드오프다.`);
    expect(SHAPES.length).toBeGreaterThan(5);
  });

  it("(4) 무작위 대조군 — 거리를 매장 안에서 섞는다", () => {
    // 총량은 이미 고정이라 섞어도 총량은 같다. 남는 건 "어느 경쟁점이 가까운가"뿐이다.
    const best = SHAPES.find((s) => s.key === "거듭 d0=300")!;
    const real = mape(loo(base, P)) - mape(loo(apply(best.f)));
    let seed = 20260921;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const gains: number[] = [];
    for (let b = 0; b < 200; b++) {
      const shuffled = base.map((r) => {
        const rv = (r.input.rivals ?? []).filter((v) => v.ip > 0);
        if (rv.length < 2) return r;
        const ds = rv.map((v) => v.distanceM);
        for (let i = ds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ds[i], ds[j]] = [ds[j], ds[i]]; }
        let k = 0;
        return { ...r, input: { ...r.input, rivals: (r.input.rivals ?? []).map((v) => (v.ip > 0 ? { ...v, distanceM: ds[k++] } : v)) } };
      });
      gains.push(mape(loo(shuffled, P)) - mape(loo(apply(best.f, shuffled))));
    }
    gains.sort((a, b) => a - b);
    const p = gains.filter((g) => g >= real).length / gains.length;
    console.log(`\n[관문 4] 무작위 대조군 200회 · ${best.key} (총량 고정)`);
    console.log(`  실제 이득 ${(real * 100).toFixed(2)}%p  ·  섞으면 중앙 ${(gains[100] * 100).toFixed(2)}%p · 95퍼센타일 ${(gains[190] * 100).toFixed(2)}%p`);
    console.log(`  p = ${p.toFixed(3)}  ${p < 0.05 ? "**유의 — 거리가 한 일이다**" : "미달"}`);
    expect(gains.length).toBe(200);
  });

  // ── 그래서 실무에서는 얼마나 달라지나 ───────────────────────────────────
  //
  // 자료는 계단을 고른다(위 셋). 그런데 사용자 지적도 맞다 — 342m가 0으로 세지는 건
  // 말이 안 된다. **둘 중 하나를 고르는 건 성적이 아니라 판단**이라, 판단 재료를 만든다.
  // 기존점은 성적으로 견주면 되지만 **후보지는 실매출이 없어 채점할 수 없다.**
  // 그래서 "얼마나 움직이나"만 찍는다.
  it("(5) 후보지가 얼마나 움직이나 — 고르는 건 사람이다", () => {
    const shapes = SHAPES.filter((s) => ["계단300", "거듭 d0=500", "선형 D=1200", "지수 λ=400"].includes(s.key));
    // 기존점에서 잡은 전역 상수 k를 후보지에도 **그대로** 쓴다(후보지로 k를 다시 잡으면 판이 달라진다).
    const ks = new Map(shapes.map((s) => [s.key, totalOf(SHAPES[0].f, base) / Math.max(1e-9, totalOf(s.f, base))]));
    const fitted = new Map(shapes.map((s) => {
      const rows = apply(s.f);
      return [s.key, fittedParams(PINF, scoreTextbook(rows, PINF))];
    }));
    // 후보지 행은 기존점과 같은 방식으로 조립한다 — buildLabCandidateRows가 필요하지만
    // 여기서는 경쟁점 거리만 바뀌므로 **기존점 판에 있는 후보지 코드**만 다룬다.
    // (후보지 전용 조립은 `_candidateRedFlags`가 한다. 여기서는 기존점 중 '가짜 독점'을 본다.)
    const fake = base.filter((r) => {
      const rv = (r.input.rivals ?? []).filter((v) => v.ip > 0 && v.distanceM != null);
      return rv.length > 0 && !rv.some((v) => (v.distanceM as number) <= R0);
    });
    const band = base.filter((r) => (r.input.rivals ?? []).some((v) => v.ip > 0 && (v.distanceM ?? 0) > R0 && (v.distanceM ?? 0) <= 800));
    console.log(`\n[누가 움직이나] 기존점 ${base.length}곳 중`);
    console.log(`  300m 안에 경쟁점이 하나도 없는 '가짜 독점' ${fake.length}곳: ${fake.map(nameOf).join(" · ") || "없음"}`);
    console.log(`  300~800m에 경쟁점이 있는 곳 ${band.length}곳`);
    console.log(`\n  매장              ` + shapes.map((s) => s.key.padStart(11)).join("") + "   최근접 경쟁점");
    for (const r of [...fake, ...band.filter((x) => !fake.includes(x))].slice(0, 14)) {
      const ds = (r.input.rivals ?? []).filter((v) => v.ip > 0 && v.distanceM != null).map((v) => Math.round(v.distanceM as number));
      const cells = shapes.map((s) => {
        const rows = apply(s.f);
        const row = rows.find((x) => nameOf(x) === nameOf(r))!;
        const b = computeTextbook(row.input, fitted.get(s.key)!);
        return (b.monthlyRevenue == null ? "-" : `${Math.round(b.monthlyRevenue / 1e4).toLocaleString()}만`).padStart(11);
      });
      console.log(`  ${nameOf(r).padEnd(16)}${cells.join("")}   ${ds.length ? Math.min(...ds) + "m" : "-"}`);
    }
    console.log(`\n  전역 상수 k: ` + shapes.map((s) => `${s.key} ${ks.get(s.key)!.toFixed(2)}`).join(" · "));
    console.log(`  ⚠️ 자료는 계단을 고른다(관문 1~4 전부). 감쇠를 쓰려면 **성적을 조금 내주고**`);
    console.log(`     "342m가 0으로 세지지 않는다"를 사는 것이다. 그 교환을 할지는 사람이 정한다.`);
    expect(shapes.length).toBe(4);
  });

  // ── 사용자 결정(2026-09-21): **감쇠로 간다** ────────────────────────────
  //
  // *"감쇠로가자. 개념이 그게맞을것같다. 기본 거리는 100으로보고, 기준 거리초과하는매장은
  //  감쇠. 이게 개념이 맞는거같은데. **나중에 401m 나오면그건어쩔건데.**"*
  //
  // 계단의 근본 문제를 정확히 짚었다 — 경계를 어디에 두든 **그 바로 밖 사례가 계속 나온다.**
  // 오송점 342m가 그랬고, 400으로 옮기면 하안금당 407m가 그렇다. 감쇠는 그게 구조적으로 없다.
  // 성적은 대가를 치른다. 그 안에서 제일 나은 (R, λ)를 고르는 게 이 절이다.
  //
  //   무게 = 1                        (거리 <= R)
  //        = exp(−(거리 − R) ÷ λ)      (그 밖)
  it("(6) 감쇠 격자 — 기준거리 R x 감쇠폭 λ", () => {
    const l0 = loo(base, P);
    const ranked = [...l0.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    const qn = Math.ceil(ranked.length / 4);
    const g1 = new Set(ranked.slice(0, qn));
    const RS = [250, 300, 350, 400];
    const LS = [50, 100, 150, 250, 400];
    console.log(`\n[감쇠 격자] 무게 = 1 (d<=R) · exp(−(d−R)/λ) (밖) · 총량 고정`);
    console.log(`  기준선 계단300 — r 0.804 · LOO 19.02% · 1분위 3.5%`);
    // ⚠️ 사용자 규칙 — MAPE만 보면 안 된다. **오차 스프레드(최악·SD)를 항상 같이 본다.**
    //    2026-09-21에 이걸 빼먹고 격자를 찍었다가 "최대오차는 어떻게 됐냐"는 질문을 받았다.
    const worst = (m: Map<string, number>) => Math.max(...m.values());
    const sdOf = (m: Map<string, number>) => {
      const v = [...m.values()], mu = mean(v);
      return Math.sqrt(mean(v.map((x) => (x - mu) ** 2)));
    };
    const b0 = loo(base, P);
    console.log(`  기준선 최악 ${(worst(b0) * 100).toFixed(1)}% · SD ${(sdOf(b0) * 100).toFixed(1)}%p`);
    console.log(`  각 칸: r / LOO / 최악 / 1분위(가운데)`);
    console.log("      R │" + LS.map((L) => `λ=${L}`.padStart(25)).join(""));
    const grid: { key: string; r: number; mape: number; q1: number; worst: number; sd: number }[] = [];
    for (const R of RS) {
      const cells: string[] = [];
      for (const L of LS) {
        const f = (d: number | null) => (d == null || d <= R ? 1 : Math.exp(-(d - R) / L));
        const rows = apply(f);
        const sl = slope(rows), LL = loo(rows);
        const q1 = mean([...LL.entries()].filter(([x]) => g1.has(x)).map(([, v]) => v));
        grid.push({ key: `R=${R} λ=${L}`, r: sl.r, mape: mape(LL), q1, worst: worst(LL), sd: sdOf(LL) });
        cells.push(`${sl.r.toFixed(3)} ${(mape(LL) * 100).toFixed(1)} ${(worst(LL) * 100).toFixed(0)} ${(q1 * 100).toFixed(1)}`.padStart(25));
      }
      console.log(`  ${String(R).padStart(7)} │` + cells.join(""));
    }
    const byR = [...grid].sort((a, b) => b.r - a.r);
    const byM = [...grid].sort((a, b) => a.mape - b.mape);
    console.log(`\n  r 높은 순    ${byR.slice(0, 4).map((x) => `${x.key}(${x.r.toFixed(3)})`).join(" · ")}`);
    console.log(`  MAPE 낮은 순 ${byM.slice(0, 4).map((x) => `${x.key}(${(x.mape * 100).toFixed(2)}%)`).join(" · ")}`);
    const byW = [...grid].sort((a, b) => a.worst - b.worst);
    console.log(`  최악 낮은 순 ${byW.slice(0, 4).map((x) => `${x.key}(${(x.worst * 100).toFixed(0)}%)`).join(" · ")}`);
    console.log(`  SD 낮은 순   ${[...grid].sort((a, b) => a.sd - b.sd).slice(0, 4).map((x) => `${x.key}(${(x.sd * 100).toFixed(1)}%p)`).join(" · ")}`);

    // 고른 값이 오송점·하안금당 경쟁점을 몇 %로 세는지 — 실무에서 바로 보는 숫자다.
    console.log(`\n  [그 값이 실제 경쟁점을 몇 %로 세나]`);
    for (const [R, L] of [[300, 150], [300, 250], [350, 150], [400, 150]] as [number, number][]) {
      const w = (d: number) => (d <= R ? 1 : Math.exp(-(d - R) / L));
      console.log(`    R=${R} λ=${L}  오송 팀플PC 342m ${(w(342) * 100).toFixed(0)}%` +
        `  ·  하안금당 407m ${(w(407) * 100).toFixed(0)}% / 446m ${(w(446) * 100).toFixed(0)}% / 480m ${(w(480) * 100).toFixed(0)}%` +
        `  ·  문경 371m ${(w(371) * 100).toFixed(0)}% · 1500m ${(w(1500) * 100).toFixed(0)}%`);
    }
    console.log(`\n  ⚠️ MAPE로는 계단이 낫고 **최악·SD로는 감쇠가 낫다.** 지표가 서로 다른 말을 한다.`);
    expect(grid.length).toBe(20);
  });

  // ── 채택 판정 — R=300 λ=150의 손해가 유의한가 ──────────────────────────
  //
  // MAPE가 19.02 -> 21.11%로 나빠진다. 그게 **자료가 계단을 고른 것**인지
  // **잡음 안인지**를 가른다. 짝지은 부트스트랩 — 매장 단위로 재표집한다.
  // 같이 최악·SD도 부트스트랩한다(사용자 규칙: 스프레드를 항상 같이 본다).
  it("(7) 채택 판정 — 짝지은 부트스트랩", () => {
    const R = 300, L = 150;
    const f = (d: number | null) => (d == null || d <= R ? 1 : Math.exp(-(d - R) / L));
    const A = loo(base, P), B = loo(apply(f));
    const names = [...A.keys()].filter((n) => B.has(n));
    const dMape = names.map((n) => B.get(n)! - A.get(n)!); // 양수 = 감쇠가 더 틀림
    let seed = 20260921;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const bootMape: number[] = [], bootWorst: number[] = [];
    for (let k = 0; k < 2000; k++) {
      const idx = names.map(() => Math.floor(rnd() * names.length));
      bootMape.push(mean(idx.map((i) => dMape[i])));
      bootWorst.push(Math.max(...idx.map((i) => B.get(names[i])!)) - Math.max(...idx.map((i) => A.get(names[i])!)));
    }
    bootMape.sort((a, b) => a - b); bootWorst.sort((a, b) => a - b);
    const wA = Math.max(...A.values()), wB = Math.max(...B.values());
    console.log(`\n[채택 판정] 계단300 vs 감쇠 R=${R} λ=${L} · 짝지은 부트스트랩 2000회 · n=${names.length}`);
    console.log(`  MAPE 차이   실제 ${(mean(dMape) * 100).toFixed(2)}%p (감쇠가 더 틀림)` +
      `  95% 구간 [${(bootMape[50] * 100).toFixed(2)}, ${(bootMape[1949] * 100).toFixed(2)}]%p` +
      `  ${bootMape[50] > 0 || bootMape[1949] < 0 ? "**0을 안 품는다 — 자료가 계단을 골랐다**" : "**0을 품는다 — 자료가 못 고른다**"}`);
    console.log(`  최악 차이   실제 ${((wB - wA) * 100).toFixed(1)}%p (${(wA * 100).toFixed(1)}% -> ${(wB * 100).toFixed(1)}%)` +
      `  95% 구간 [${(bootWorst[50] * 100).toFixed(1)}, ${(bootWorst[1949] * 100).toFixed(1)}]%p`);
    console.log(`\n  매장별로 누가 좋아지고 누가 나빠지나 (변화 큰 순)`);
    const moved = names.map((n) => ({ n, d: B.get(n)! - A.get(n)! })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    for (const x of moved.slice(0, 10)) {
      console.log(`    ${x.n.padEnd(16)}${(A.get(x.n)! * 100).toFixed(1).padStart(6)}% -> ${(B.get(x.n)! * 100).toFixed(1).padStart(6)}%   ${x.d > 0 ? "나빠짐" : "좋아짐"} ${(Math.abs(x.d) * 100).toFixed(1)}%p`);
    }
    console.log(`\n  좋아진 곳 ${moved.filter((x) => x.d < 0).length}곳 · 나빠진 곳 ${moved.filter((x) => x.d > 0).length}곳`);
    expect(names.length).toBeGreaterThan(30);
  });
});
