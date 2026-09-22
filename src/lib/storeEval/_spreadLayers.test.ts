// 퍼짐 과장 1.46배 — **어느 층이 과장하나** (2026-09-22 밤)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 2km 경쟁점을 넣고 나서 가동률 평균은 맞는다(편향 -0.63%p). 남은 건 **퍼짐**이다:
// 예측이 매장 간 차이를 실측보다 1.46배 넓게 벌린다. 잘 되는 곳은 더 높게, 안 되는 곳은
// 더 낮게 찍는다. 이걸 줄이면 ±5%p 안에 드는 매장이 크게 는다.
//
// 가동률은 세 조각의 곱이다:
//     log(가동률) = log(수요시간) + log(점유율) + log(입지배율) − log(PC×720)
// 각 조각의 **퍼짐(log SD)**과, 각 조각이 실측 가동률과 **얼마나 같이 움직이는지**를 따로 잰다.
//
// ── 읽는 법 (결과 보기 전에 적어 둔다) ────────────────────────────────────
// · 어떤 층의 퍼짐이 크고 실측과의 상관이 낮으면 → **그 층이 잡음을 만든다**(과장의 범인)
// · 퍼짐이 크고 상관도 높으면 → 그 층은 일을 하고 있다. 줄이면 오히려 나빠진다
// · 층을 하나씩 **평균으로 눌러** 보고 퍼짐·오차가 어떻게 되는지도 같이 본다
//   ⚠️ 이건 **진단**이지 채택 후보가 아니다. 평균으로 누르는 건 기전이 아니다.
//
// ⚠️ 측정만 한다. 계수를 고르지 않는다.
//
// 실행: npx vitest run src/lib/storeEval/_spreadLayers.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const sdOf = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const corr = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  const s = sdOf(a) * sdOf(b);
  return s > 0 ? mean(a.map((v, i) => (v - ma) * (b[i] - mb))) / s : NaN;
};

describeIf("퍼짐 과장 — 어느 층이 과장하나", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  const qscByStoreCode = new Map<string, number>();
  type QscSite = { storeCode?: string; id?: string; openedAt?: string; records?: QscRecord[] };
  const sites: QscSite[] = (snap.labQscScores ?? []) as QscSite[];
  if (!sites.length && existsSync(QSC_FILE)) {
    const f = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [k, v] of Object.entries(f)) sites.push({ ...v, storeCode: k.replace(/^existing:/, "") });
  }
  for (const d of sites) {
    const code = d.storeCode ?? d.id;
    const avg = qscInWindowAverage(d.records ?? [], d.openedAt ?? null);
    if (code && avg != null) qscByStoreCode.set(code, avg);
  }
  const base = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(base, DEFAULT_TEXTBOOK_PARAMS));

  type Row = {
    name: string; act: number; pred: number;
    demandH: number; share: number; loc: number; cap: number;
  };
  const rows: Row[] = [];
  for (const r of base) {
    const act = r.input.actualUtilization;
    if (act == null || !(act > 0)) continue;
    const b = computeTextbook(r.input, P);
    if (b.utilization == null || !(b.utilization > 0)) continue;
    if (b.totalDemandHours == null || b.share == null || b.locationMultiplier == null) continue;
    const pc = r.input.pcCount ?? 0;
    if (!(pc > 0)) continue;
    rows.push({
      name: r.input.storeName ?? r.input.storeCode, act, pred: b.utilization,
      demandH: b.totalDemandHours, share: b.share, loc: b.locationMultiplier, cap: pc * 720,
    });
  }

  it("(1) 층마다 얼마나 퍼져 있고, 실측과 얼마나 같이 움직이나", () => {
    const A = rows.map((r) => Math.log(r.act));
    const layers: { name: string; v: number[] }[] = [
      { name: "수요시간", v: rows.map((r) => Math.log(r.demandH)) },
      { name: "점유율", v: rows.map((r) => Math.log(r.share)) },
      { name: "입지배율", v: rows.map((r) => Math.log(r.loc)) },
      { name: "용량(PC×720)", v: rows.map((r) => -Math.log(r.cap)) },
    ];
    const pred = rows.map((r) => Math.log(r.pred));
    console.log(`\n[층별 퍼짐] n=${rows.length} · 전부 log 기준 · 판정 기준은 가동률`);
    console.log(`  층              퍼짐(SD)   실측과 상관   예측 퍼짐에서 차지하는 몫`);
    for (const L of layers) {
      // 그 층이 예측 퍼짐에 얼마나 기여하나 = cov(층, 예측) / var(예측)
      const mp = mean(pred), ml = mean(L.v);
      const contrib = mean(L.v.map((v, i) => (v - ml) * (pred[i] - mp))) / (sdOf(pred) ** 2);
      console.log(`  ${L.name.padEnd(14)}${L.v.length ? sdOf(L.v).toFixed(3).padStart(8) : "    -"}`
        + `${corr(L.v, A).toFixed(3).padStart(13)}${(contrib * 100).toFixed(0).padStart(20)}%`);
    }
    console.log(`\n  예측 퍼짐 ${sdOf(pred).toFixed(3)} · 실측 퍼짐 ${sdOf(A).toFixed(3)}`
      + ` · **과장 ${(sdOf(pred) / sdOf(A)).toFixed(2)}배**`);
    console.log(`  예측 vs 실측 상관 r = ${corr(pred, A).toFixed(3)}`);
    console.log(`\n  ⭐ 읽는 법: 퍼짐이 크고 **실측과 상관이 낮은** 층이 잡음을 만든다.`);
    console.log(`     퍼짐이 크고 상관도 높으면 그 층은 일을 하는 것이다 — 줄이면 나빠진다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(3) ⭐ 입지 두 조각을 따로 본다 — 개념은 맞는데 계산이 틀렸다면 어디인가", () => {
    // 사용자(2026-09-22): *"경쟁점 1층인데 우리 7층이야. 유입에 불리함.
    //   우리매장 상권 끝에 있어, 점포 옆은 그냥 공터야. 이러면 유입에 불리함. 이런 개념이지."*
    // => **항목은 맞다.** `항목은 뜻으로, 계수만 자료로` — 빼지 않는다. 계산을 파야 한다.
    //
    // 그 두 예시가 산식의 두 조각과 그대로 대응한다:
    //   "우리 7층"      -> 접근성(access)   = 층·지상여부·엘리베이터
    //   "상권 끝, 공터"  -> 중심도(centrality) = 유동 300m ÷ 1km (반경비로 정규화)
    // 합쳐서 실측과 음의 상관인데, **둘 다 음수인지 한쪽이 끌어내리는지**를 갈라 본다.
    const A: number[] = [], cen: number[] = [], acc: number[] = [], resid: number[] = [];
    const named: { name: string; act: number; cen: number | null; acc: number | null; loc: number }[] = [];
    for (const r of base) {
      const act = r.input.actualUtilization;
      if (act == null || !(act > 0)) continue;
      const b = computeTextbook(r.input, P);
      if (b.utilization == null || !(b.utilization > 0) || b.locationMultiplier == null) continue;
      const c = r.input.location?.centrality ?? null;
      const a = r.input.location?.access ?? null;
      named.push({ name: r.input.storeName ?? r.input.storeCode, act, cen: c, acc: a, loc: b.locationMultiplier });
      A.push(Math.log(act));
      // 잔차 = 실측 ÷ 예측. 입지를 빼고 본 예측 대비 남는 몫이 입지와 맞아야 한다.
      resid.push(Math.log(act) - (Math.log(b.utilization) - Math.log(b.locationMultiplier) * P.indexCalibration!.locationExponent));
      cen.push(c != null && c > 0 ? Math.log(c) : NaN);
      acc.push(a != null && a > 0 ? Math.log(a) : NaN);
    }
    const pairs = (x: number[], y: number[]) => {
      const idx = x.map((v, i) => (Number.isFinite(v) && Number.isFinite(y[i]) ? i : -1)).filter((i) => i >= 0);
      return [idx.map((i) => x[i]), idx.map((i) => y[i])] as const;
    };
    const show = (label: string, v: number[]) => {
      const [a1, b1] = pairs(v, A);
      const [a2, b2] = pairs(v, resid);
      console.log(`  ${label.padEnd(16)}n=${String(a1.length).padStart(3)}`
        + `   실측 가동률과 r = ${corr(a1, b1).toFixed(3).padStart(7)}`
        + `   입지 뺀 잔차와 r = ${corr(a2, b2).toFixed(3).padStart(7)}`);
    };
    console.log(`\n[입지 두 조각] 유의선 ±0.41(여러 개를 훑을 때의 자) · 둘 다 log`);
    show("중심도", cen);
    show("접근성", acc);
    show("입지배율(합)", named.map((x) => Math.log(x.loc)));
    console.log(`\n  ⭐ "입지 뺀 잔차와의 상관"이 진짜 판정이다 — 입지가 설명해야 할 몫과 맞물리나.`);
    console.log(`     양수면 방향이 맞고(더 좋은 입지 = 더 잘 됨), 음수면 **반대로 작동**한다.`);
    // 극단 매장을 눈으로 확인한다 — 숫자만 보면 자료 오류를 못 잡는다.
    const byAcc = named.filter((x) => x.acc != null).sort((a, b) => (a.acc as number) - (b.acc as number));
    console.log(`\n  접근성 낮은 5곳 / 높은 5곳 (점수 · 실측 가동률)`);
    for (const x of byAcc.slice(0, 5)) console.log(`    ${x.name.padEnd(16)}${(x.acc as number).toFixed(2)}점  ${(x.act * 100).toFixed(1)}%`);
    console.log(`    ...`);
    for (const x of byAcc.slice(-5)) console.log(`    ${x.name.padEnd(16)}${(x.acc as number).toFixed(2)}점  ${(x.act * 100).toFixed(1)}%`);
    const byCen = named.filter((x) => x.cen != null).sort((a, b) => (a.cen as number) - (b.cen as number));
    console.log(`\n  중심도 낮은 5곳 / 높은 5곳 (지수 · 실측 가동률)`);
    for (const x of byCen.slice(0, 5)) console.log(`    ${x.name.padEnd(16)}${(x.cen as number).toFixed(2)}  ${(x.act * 100).toFixed(1)}%`);
    console.log(`    ...`);
    for (const x of byCen.slice(-5)) console.log(`    ${x.name.padEnd(16)}${(x.cen as number).toFixed(2)}  ${(x.act * 100).toFixed(1)}%`);
    // ── 그럼 세기가 맞나 — 지금 지수는 0.169다 ──────────────────────────────
    // 잔차와 r=0.48인데 성적이 안 움직인다면, 방향이 아니라 **세기**가 문제일 수 있다.
    // ⛔ 여기서 값을 고르지 않는다. 재고 표만 남긴다.
    const rowsU = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    const scoreAt = (exp: number) => {
      const P2 = { ...P, indexCalibration: { ...P.indexCalibration!, locationExponent: exp } };
      const errs: number[] = [], preds: number[] = [];
      for (const { r, act } of rowsU) {
        const b = computeTextbook(r.input, P2);
        if (b.utilization == null || !(b.utilization > 0)) continue;
        errs.push(b.utilization - act); preds.push(Math.log(b.utilization));
      }
      const abs = errs.map(Math.abs);
      const actLog = rowsU.map((x) => Math.log(x.act));
      return {
        mae: mean(abs), worst: Math.max(...abs), bias: mean(errs),
        within5: abs.filter((v) => v <= 0.05).length,
        spread: sdOf(preds) / sdOf(actLog),
      };
    };
    console.log(`\n[재고 표] 입지 지수(locationExponent)를 바꿔 본다 · 지금 ${P.indexCalibration!.locationExponent}`);
    console.log(`  지수      MAE       최악      편향     ±5%p   퍼짐`);
    for (const e of [0, 0.169, 0.3, 0.5, 0.75, 1.0]) {
      const s = scoreAt(e);
      const tag = e === P.indexCalibration!.locationExponent ? "  ← 지금" : e === 1 ? "  ← 교과서" : "";
      console.log(`  ${e.toFixed(3).padStart(5)}${(s.mae * 100).toFixed(2).padStart(9)}%p`
        + `${(s.worst * 100).toFixed(2).padStart(9)}%p${(s.bias * 100).toFixed(2).padStart(9)}%p`
        + `  ${String(s.within5).padStart(2)}/${rowsU.length}  ${s.spread.toFixed(2)}배${tag}`);
    }
    console.log(`\n  ⛔ **값을 고르지 않는다.** 사용자가 정할 자리다.`);
    console.log(`  ⚠️ 지수를 올리면 퍼짐이 늘 수 있다 — MAE만 보지 말고 퍼짐·최악을 같이 봐라.`);
    expect(named.length).toBeGreaterThan(30);
  });

  it("(2) 층을 하나씩 평균으로 눌러 본다 — ⚠️ 진단일 뿐 채택 후보가 아니다", () => {
    const A = rows.map((r) => Math.log(r.act));
    const geoOf = (v: number[]) => Math.exp(mean(v));
    const score = (get: (r: Row) => number) => {
      const errs = rows.map((r, i) => get(r) - Math.exp(A[i]));
      const abs = errs.map(Math.abs);
      const preds = rows.map(get);
      return {
        mae: mean(abs), worst: Math.max(...abs), bias: mean(errs),
        within5: abs.filter((x) => x <= 0.05).length,
        spread: sdOf(preds.map(Math.log)) / sdOf(A),
      };
    };
    const mDemand = geoOf(rows.map((r) => Math.log(r.demandH)));
    const mShare = geoOf(rows.map((r) => Math.log(r.share)));
    const mLoc = geoOf(rows.map((r) => Math.log(r.loc)));
    const cases: { name: string; get: (r: Row) => number }[] = [
      { name: "지금 그대로", get: (r) => r.pred },
      { name: "수요를 전부 평균으로", get: (r) => mDemand * r.share * r.loc / r.cap },
      { name: "점유율을 전부 평균으로", get: (r) => r.demandH * mShare * r.loc / r.cap },
      // ⛔ **입지 행은 뺐다 — 내가 틀리게 쟀다**(2026-09-22 정정).
      //    `b.share`에는 **이미 입지배율이 지수와 함께 반영돼 있다**
      //    (textbookModel: share = rawShare × locationMultiplier^locExp).
      //    여기서 `r.loc`을 또 곱하면 입지를 **두 번**, 그것도 지수 없이 1제곱으로 곱한 것이다.
      //    그 잘못된 값으로 "입지는 일을 안 한다"는 결론을 냈다가 (3)번에서 뒤집혔다.
      //    입지의 영향은 **산식 안에서 지수를 바꿔** 재야 한다 — (3)번 재고 표가 그것이다.
    ];
    void mLoc;
    console.log(`\n[층 누르기] 그 층의 매장별 차이를 없애면 어떻게 되나`);
    console.log(`  경우                      MAE       최악      편향     ±5%p   퍼짐`);
    for (const c of cases) {
      const s = score(c.get);
      console.log(`  ${c.name.padEnd(24)}${(s.mae * 100).toFixed(2).padStart(7)}%p`
        + `${(s.worst * 100).toFixed(2).padStart(9)}%p${(s.bias * 100).toFixed(2).padStart(9)}%p`
        + `  ${String(s.within5).padStart(2)}/${rows.length}  ${s.spread.toFixed(2)}배`);
    }
    console.log(`\n  ⚠️ 평균으로 누르는 건 **기전이 아니다** — 채택 후보로 읽지 마라.`);
    console.log(`     "그 층을 지우면 오히려 좋아지는가"를 보는 진단일 뿐이다.`);
    console.log(`     좋아지는 층이 있으면 그 층이 **잘못 계산되고 있다**는 뜻이다.`);
  });
});
