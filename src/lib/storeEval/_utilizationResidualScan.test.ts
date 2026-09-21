// 재정립 3단계 — 가동률 잔차를 무엇이 설명하나 (2026-09-21)
//
// ── 2단계까지 나온 것 ─────────────────────────────────────────────────────
// 가동률 = (수요÷총공급)^b x 입지^c 에서 자료가 원하는 b=0.30 · c=0.135다(산식은 둘 다 1).
// 그렇게 고치면 MAE 6.50 → 4.03%p인데, **'전부 훈련평균'(4.38%p)을 유의하게 못 이긴다.**
// 즉 지수를 바로잡아도 **설명력 자체가 거의 없다.** R²=0.285뿐이다.
//
// ⇒ 그러면 물음은 하나다: **가동률을 가르는 진짜 변수가 표본에 있는가?**
//
// ── ⭐ 제일 먼저 의심할 것 — 시급(가격) ───────────────────────────────────
// 지금 산식에서 **시급은 가동률 경로에 아예 안 들어간다.** `rateElasticity`·
// `referenceHourlyRate`는 **단가층**(pcUnitPrice)에만 쓰인다. 그런데 상식적으로
// 비싸면 덜 온다 — 가격은 매출이 아니라 **이용량**을 가르는 변수다.
// 표본의 시급은 1,200~2,000원으로 1.7배 벌어져 있다. 이게 안 들어가 있다.
//
// ── 같이 훑을 것 ──────────────────────────────────────────────────────────
// 개점 코호트(평가창 시점) · QSC(운영관리) · 자사 경쟁력점수 · 자사PC수 ·
// 주거/유동 규모 · 유동비중 · 경쟁점 수 · 편심도 · 접근성
//
// ── ⚠️ 판정 기준을 먼저 박는다 ────────────────────────────────────────────
// 1. **유의선은 ±0.32가 아니라 ±0.41이다.** n=38에서 단일 검정은 ±0.32지만 여러 개를
//    훑으면 우연히 ±0.41까지 나온다(`_schoolInflow` 4절에서 이 저장소가 쓰는 보정).
//    여기서 11개를 훑으므로 ±0.41을 쓴다.
// 2. **날것 상관으로 판정하지 않는다.** 상관이 넘으면 **모형에 넣었다 뺐다 하며 LOO 오차**를
//    비교한다(이 저장소 규칙: `feedback_raw_correlation_cannot_judge_structure`).
// 3. **순환을 조심한다.** 자사 경쟁력점수·경쟁점수는 이미 공급항(T) 안에 들어가 있다.
//    잔차와 상관이 나와도 그건 산식이 만든 것일 수 있다 — 표에 표시해 둔다.
// 4. **최악·SD를 항상 같이 본다.**
//
// ⚠️ 측정만 한다. 채택은 사용자가 정한다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_utilizationResidualScan.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, computeQualityScore, fittedParams, scoreTextbook } from "./textbookModel";
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
const corr = (a: number[], b: number[]) => {
  const s = sdOf(a) * sdOf(b);
  return s > 0 ? cov(a, b) / s : NaN;
};
const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
const pp = (v: number, d = 2) => `${(v * 100).toFixed(d)}%p`;
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
/** ⚠️ 여러 개를 훑을 때의 유의선. 단일 ±0.32가 아니다(`_schoolInflow` 4절). */
const SIG_MULTI = 0.41;

describeIf("재정립 3단계 — 가동률 잔차 훑기", () => {
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
  const storeByCode = new Map(stores.map((s) => [s.storeCode, s]));

  type Rec = {
    n: string; act: number; X: number; L: number;
    cand: Record<string, number | null>;
  };
  const R: Rec[] = [];
  for (const r of base) {
    const b = computeTextbook(r.input, full);
    const act = r.input.actualUtilization;
    if (act == null || !(act > 0) || b.utilization == null || !(b.utilization > 0) || b.capped) continue;
    if (b.locationMultiplier == null) continue;
    const s = storeByCode.get(r.input.storeCode);
    const months = evaluationMonths(s?.openedAt ?? null);
    // 평가창 시작 시점 = 개점 코호트. 2026-01을 0으로 두고 개월로 센다.
    const first = months[0] ?? null;
    const cohort = first ? (Number(first.slice(0, 4)) - 2026) * 12 + Number(first.slice(5, 7)) : null;
    const rivals = r.input.rivals ?? [];
    const oq = r.input.ownQualityParts ? computeQualityScore(r.input.ownQualityParts, P.qualityWeights) : null;
    R.push({
      n: r.input.storeName ?? r.input.storeCode, act,
      X: Math.log(b.utilization) - Math.log(b.locationMultiplier),
      L: Math.log(b.locationMultiplier),
      cand: {
        "log 시급": r.input.hourlyRate != null && r.input.hourlyRate > 0 ? Math.log(r.input.hourlyRate) : null,
        "개점 코호트(월)": cohort,
        "QSC": qscByStoreCode.get(r.input.storeCode) ?? null,
        "자사 경쟁력점수": oq,
        "log 자사PC": r.input.pcCount ? Math.log(r.input.pcCount) : null,
        "log 주거1km": r.input.pop1km ? Math.log(r.input.pop1km) : null,
        "log 유동400": r.input.floatingByRadius[400] ? Math.log(r.input.floatingByRadius[400] as number) : null,
        "유동 비중": b.totalDemandUsers ? (b.floatingDemandUsers ?? 0) / b.totalDemandUsers : null,
        "경쟁점 수": rivals.length,
        "편심도": r.input.location?.direction ?? null,
        "접근성 점수": r.input.location?.access ?? null,
      },
    });
  }

  /** 2단계에서 고른 최선 단순형(b=0.3·c=0.15)의 잔차. 전 표본 절편으로 맞춘다. */
  const A = R.map((x) => Math.log(x.act));
  const B0 = 0.3, C0 = 0.15;
  const fitVal = R.map((x) => B0 * x.X + C0 * x.L);
  const a0 = mean(A.map((v, i) => v - fitVal[i]));
  const resid = A.map((v, i) => v - (a0 + fitVal[i]));
  /** 지금 산식(b=c=1)의 잔차도 같이 본다 — 어느 쪽 잔차를 설명하는지 다를 수 있다. */
  const fitNow = R.map((x) => x.X + x.L);
  const aNow = mean(A.map((v, i) => v - fitNow[i]));
  const residNow = A.map((v, i) => v - (aNow + fitNow[i]));

  it("(1) 훑기 — 잔차와의 상관", () => {
    console.log(`\n[잔차 훑기] n=${R.length} · ⚠️ 유의선 **±${SIG_MULTI}**(11개를 훑으므로 단일 ±0.32가 아니다)`);
    console.log(`  잔차 기준: (가동률)=(수요÷총공급)^0.3 x 입지^0.15 · SD(log) ${sdOf(resid).toFixed(4)}`);
    console.log(`\n  후보              n    잔차(b=.3)   잔차(지금 b=1)   실측 직접   순환?`);
    const keys = Object.keys(R[0].cand);
    const scored: { k: string; r: number; n: number }[] = [];
    for (const k of keys) {
      const idx = R.map((x, i) => (x.cand[k] != null ? i : -1)).filter((i) => i >= 0);
      if (idx.length < 20) { console.log(`  ${k.padEnd(16)}${String(idx.length).padStart(4)}   자료 부족`); continue; }
      const v = idx.map((i) => R[i].cand[k] as number);
      const r1 = corr(v, idx.map((i) => resid[i]));
      const r2 = corr(v, idx.map((i) => residNow[i]));
      const r3 = corr(v, idx.map((i) => A[i]));
      const circular = ["자사 경쟁력점수", "경쟁점 수", "log 자사PC", "log 주거1km", "log 유동400", "유동 비중", "편심도", "접근성 점수"].includes(k);
      scored.push({ k, r: r1, n: idx.length });
      console.log(`  ${k.padEnd(16)}${String(idx.length).padStart(4)}${r1.toFixed(3).padStart(12)}${Math.abs(r1) > SIG_MULTI ? " *" : "  "}` +
        `${r2.toFixed(3).padStart(14)}${Math.abs(r2) > SIG_MULTI ? " *" : "  "}${r3.toFixed(3).padStart(11)}   ${circular ? "산식 안에 있음" : "—"}`);
    }
    const hits = scored.filter((x) => Math.abs(x.r) > SIG_MULTI).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    console.log(`\n  ±${SIG_MULTI} 넘는 것: ${hits.length ? hits.map((x) => `${x.k}(${x.r.toFixed(3)})`).join(" · ") : "**없음**"}`);
    console.log(`  ⚠️ '산식 안에 있음' 표시는 그 변수가 이미 수요·공급·입지 항에 들어가 있다는 뜻이다.`);
    console.log(`     잔차와 상관이 나와도 **산식이 만든 상관**일 수 있으니 따로 파야 한다.`);
    expect(R.length).toBeGreaterThan(30);
  });

  it("(2) ⭐ 시급은 왜 없나 — 가동률 경로에 가격이 안 들어간다", () => {
    const idx = R.map((x, i) => (x.cand["log 시급"] != null ? i : -1)).filter((i) => i >= 0);
    const v = idx.map((i) => R[i].cand["log 시급"] as number);
    const rates = idx.map((i) => Math.exp(R[i].cand["log 시급"] as number));
    console.log(`\n[시급] 지금 산식은 시급을 **단가층에만** 쓴다(rateElasticity 0.546). 가동률엔 안 쓴다.`);
    console.log(`  표본 시급: 중앙 ${med(rates).toFixed(0)}원 · 범위 ${Math.min(...rates).toFixed(0)}~${Math.max(...rates).toFixed(0)}원 (${(Math.max(...rates) / Math.min(...rates)).toFixed(1)}배)`);
    console.log(`  log(시급) vs 실측 가동률       r = ${corr(v, idx.map((i) => A[i])).toFixed(3)}`);
    console.log(`  log(시급) vs 잔차(b=.3)        r = ${corr(v, idx.map((i) => resid[i])).toFixed(3)}`);
    console.log(`  log(시급) vs 잔차(지금 b=1)     r = ${corr(v, idx.map((i) => residNow[i])).toFixed(3)}`);
    console.log(`\n  [시급 사분위별 실측 가동률]`);
    const sorted = [...idx].sort((a, b) => (R[a].cand["log 시급"] as number) - (R[b].cand["log 시급"] as number));
    const q = Math.ceil(sorted.length / 4);
    for (let i = 0; i < 4; i++) {
      const g = sorted.slice(i * q, (i + 1) * q);
      if (!g.length) continue;
      console.log(`    ${i + 1}분위  시급 ${med(g.map((j) => Math.exp(R[j].cand["log 시급"] as number))).toFixed(0)}원` +
        ` · 실측 가동률 ${pct(med(g.map((j) => R[j].act)))}` +
        ` · 잔차 ${med(g.map((j) => resid[j])).toFixed(3)}`);
    }
    console.log(`\n  ⚠️ 비싸면 덜 온다면 상관이 **음수**여야 한다. 부호부터 확인할 것.`);
    console.log(`     부호가 반대면 "비싼 곳은 좋은 자리라서 잘 된다"는 역인과일 수 있다 — 통제가 필요하다.`);
    expect(idx.length).toBeGreaterThan(30);
  });

  it("(3) 날것 상관이 아니라 오차로 판정한다 — 넣었다 뺐다", () => {
    // 이 저장소 규칙: 상관으로 구조를 판정하지 않는다. 모형에 넣고 **LOO 오차**를 본다.
    const looWith = (extraKey: string | null) => {
      const idx = extraKey ? R.map((x, i) => (x.cand[extraKey] != null ? i : -1)).filter((i) => i >= 0) : R.map((_, i) => i);
      const out: { pred: number; act: number }[] = [];
      for (const i of idx) {
        const tr = idx.filter((k) => k !== i);
        // y = a + b X + c L (+ d Z) — 정규방정식을 쓰지 않고 잔차 직교화로 푼다(변수 3~4개뿐).
        const cols = (j: number) => extraKey ? [R[j].X, R[j].L, R[j].cand[extraKey] as number] : [R[j].X, R[j].L];
        const m = cols(tr[0]).length;
        const means = Array.from({ length: m }, (_, c) => mean(tr.map((j) => cols(j)[c])));
        const my = mean(tr.map((j) => A[j]));
        // 정규방정식 (m<=3) — 가우스 소거
        const M: number[][] = Array.from({ length: m }, () => Array(m + 1).fill(0));
        for (let p = 0; p < m; p++) {
          for (let q2 = 0; q2 < m; q2++) M[p][q2] = mean(tr.map((j) => (cols(j)[p] - means[p]) * (cols(j)[q2] - means[q2])));
          M[p][m] = mean(tr.map((j) => (cols(j)[p] - means[p]) * (A[j] - my)));
        }
        for (let p = 0; p < m; p++) {
          let piv = p;
          for (let q2 = p + 1; q2 < m; q2++) if (Math.abs(M[q2][p]) > Math.abs(M[piv][p])) piv = q2;
          [M[p], M[piv]] = [M[piv], M[p]];
          if (Math.abs(M[p][p]) < 1e-12) continue;
          for (let q2 = p + 1; q2 < m; q2++) {
            const f = M[q2][p] / M[p][p];
            for (let s = p; s <= m; s++) M[q2][s] -= f * M[p][s];
          }
        }
        const beta = Array(m).fill(0);
        for (let p = m - 1; p >= 0; p--) {
          let s = M[p][m];
          for (let q2 = p + 1; q2 < m; q2++) s -= M[p][q2] * beta[q2];
          beta[p] = Math.abs(M[p][p]) < 1e-12 ? 0 : s / M[p][p];
        }
        const ci = cols(i);
        out.push({ pred: Math.exp(my + beta.reduce((s, bb, c) => s + bb * (ci[c] - means[c]), 0)), act: R[i].act });
      }
      return out;
    };
    const mae = (v: { pred: number; act: number }[]) => mean(v.map((x) => Math.abs(x.pred - x.act)));
    const wst = (v: { pred: number; act: number }[]) => Math.max(...v.map((x) => Math.abs(x.pred - x.act) / x.act));
    const sdE = (v: { pred: number; act: number }[]) => sdOf(v.map((x) => Math.abs(x.pred - x.act)));
    const w5 = (v: { pred: number; act: number }[]) => v.filter((x) => Math.abs(x.pred - x.act) <= 0.05).length;
    const b0 = looWith(null);
    console.log(`\n[넣었다 뺐다] 기본형 = a + b·log(수요÷공급) + c·log(입지), 계수는 훈련겹에서 적합`);
    console.log(`  추가 변수            n     MAE      SD      최악     ±5%p    기본 대비`);
    console.log(`  ${"(없음)".padEnd(18)}${String(b0.length).padStart(4)}${pp(mae(b0)).padStart(9)}${pp(sdE(b0)).padStart(9)}` +
      `${pct(wst(b0)).padStart(9)}${(w5(b0) + "/" + b0.length).padStart(9)}`);
    for (const k of Object.keys(R[0].cand)) {
      const idx = R.map((x, i) => (x.cand[k] != null ? i : -1)).filter((i) => i >= 0);
      if (idx.length < 20) continue;
      const v = looWith(k);
      // 같은 매장 집합에서 견주려면 기본형도 같은 집합으로 다시 재야 공정하다.
      const bSame = b0.filter((_, i) => idx.includes(i));
      console.log(`  ${k.padEnd(18)}${String(v.length).padStart(4)}${pp(mae(v)).padStart(9)}${pp(sdE(v)).padStart(9)}` +
        `${pct(wst(v)).padStart(9)}${(w5(v) + "/" + v.length).padStart(9)}` +
        `${pp(mae(v) - mae(bSame)).padStart(11)}${mae(v) < mae(bSame) ? " 좋아짐" : ""}`);
    }
    console.log(`\n  ⚠️ 상관이 커도 LOO에서 안 좋아지면 **과적합**이다. 이 표가 판정이다.`);

    // ── 대조군 — 아무 뜻 없는 변수를 넣으면 얼마나 좋아지나 ──────────────
    // 변수를 하나 더 넣으면 **무작위여도** LOO가 조금 좋아질 수 있다. 그 크기를 재야
    // "QSC가 0.44%p 좋아졌다"가 신호인지 판단할 수 있다. 200번 돌린다.
    let seed = 20260921;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const gains: number[] = [];
    for (let t = 0; t < 200; t++) {
      const key = `__rand${t}`;
      for (const x of R) x.cand[key] = rnd();
      gains.push(mae(looWith(key)) - mae(b0));
      for (const x of R) delete x.cand[key];
    }
    gains.sort((a, b) => a - b);
    console.log(`\n[대조군] 무작위 변수 200개를 하나씩 넣어 본다 — 뜻 없는 변수도 얼마나 좋아지나`);
    console.log(`  개선폭 분포: 최고 ${pp(gains[0])} · 5퍼센타일 ${pp(gains[10])} · 중앙 ${pp(gains[100])} · 최악 ${pp(gains[199])}`);
    const beats = (g: number) => gains.filter((x) => x <= g).length / gains.length;
    console.log(`\n  실제 후보의 p값 (무작위가 이만큼 좋아질 확률)`);
    for (const k of ["QSC", "자사 경쟁력점수", "접근성 점수", "log 시급"]) {
      const idx = R.map((x, i) => (x.cand[k] != null ? i : -1)).filter((i) => i >= 0);
      if (idx.length < 20) continue;
      const g = mae(looWith(k)) - mae(b0.filter((_, i) => idx.includes(i)));
      const p = beats(g);
      console.log(`    ${k.padEnd(16)}개선 ${pp(g)}  p = ${p.toFixed(3)}  ${p < 0.05 ? "**유의**" : "미달 — 무작위와 구별 안 됨"}`);
    }
    const nCand = Object.keys(R[0].cand).length;
    console.log(`\n  ⚠️ p가 0.05를 못 넘으면 그 변수는 **아무것도 안 한 것**과 같다.`);
    console.log(`  ⚠️ **다중비교 보정을 빼먹지 말 것** — 후보를 ${nCand}개 훑었으므로 문턱은 0.05가 아니라`);
    console.log(`     0.05÷${nCand} = ${(0.05 / nCand).toFixed(4)}다(본페로니). 그 기준으로 보면 위의 '유의'는 **전부 미달**이다.`);
    console.log(`     QSC(p=0.015)는 관문을 반쯤 넘은 것이지 통과가 아니다. 그리고 최악이 65.1 → 77.8%로`);
    console.log(`     크게 나빠지고, **후보지엔 QSC 자료가 아예 없어** 실무에서 예측값을 못 바꾼다`);
    console.log(`     (이미 2026-09-20에 같은 이유로 채택을 미뤄 둔 항이다).`);
    console.log(`     자사 경쟁력점수(p=0.035)는 **이미 공급항 안에 들어가 있어** 순환 의심이 남는다.`);
    expect(gains.length).toBe(200);
  });
});
