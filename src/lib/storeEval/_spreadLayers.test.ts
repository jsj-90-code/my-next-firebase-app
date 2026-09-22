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
    console.log(`\n  ⛔ **표본 안 성적으로 고르면 안 된다.** 아래 (4)가 진짜 판정이다.`);
    expect(named.length).toBeGreaterThan(30);
  });

  it("(4) ⭐ 자료가 입지 지수를 고를 수 있나 — 중첩 LOO + 분별력", () => {
    // 사용자(2026-09-22): *"입지지수는 가정치라 결과에 맞춰야 하나? 다만 분별력은 있어야 함."*
    //
    // 맞는 구분이다. **입지배율 자체는 측정값**이고(유동 300/1000 · 층·엘리베이터),
    // **그게 얼마나 세게 작용하나는 잴 방법이 없다 = 가정치**다.
    //
    // 가정치를 자료로 골라도 되는 조건은 어제 눈금 보정 b에 쓴 잣대와 같다:
    //   (가) **자료가 고를 수 있나** — 겹마다 다른 값이 나오면 못 고르는 것이다
    //   (나) **홀드아웃에서 재현되나** — 표본 안 최선은 허수다
    // 통과하면 자료가 고른 값을 쓰고, 못 하면 **교과서 1**을 쓴다.
    // 그리고 분별력(순서를 제대로 매기나)을 같이 본다 — 오차가 작아도 순서를 못 매기면
    // 후보지 평가에 못 쓴다.
    const GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2];
    const use = base.map((r) => ({ r, act: r.input.actualUtilization }))
      .filter((x): x is { r: typeof base[number]; act: number } => x.act != null && x.act > 0);
    /** 지수 e로 낸 예측(캐시해 둔다 — 겹마다 다시 안 돌린다). */
    const predBy = new Map<number, number[]>();
    for (const e of GRID) {
      const P2 = { ...P, indexCalibration: { ...P.indexCalibration!, locationExponent: e } };
      predBy.set(e, use.map(({ r }) => computeTextbook(r.input, P2).utilization ?? NaN));
    }
    const acts = use.map((x) => x.act);
    const maeOn = (e: number, idx: number[]) =>
      mean(idx.map((i) => Math.abs((predBy.get(e) as number[])[i] - acts[i])));

    // ── 중첩 LOO — 한 곳을 빼고 **나머지로 지수를 고른 뒤** 안 본 그 곳을 맞힌다 ──
    const picked: number[] = [];
    const looErr: number[] = [];
    for (let i = 0; i < use.length; i++) {
      const train = use.map((_, j) => j).filter((j) => j !== i);
      let bestE = GRID[0], bestV = Infinity;
      for (const e of GRID) { const v = maeOn(e, train); if (v < bestV) { bestV = v; bestE = e; } }
      picked.push(bestE);
      looErr.push(Math.abs((predBy.get(bestE) as number[])[i] - acts[i]));
    }
    const counts = new Map<number, number>();
    for (const e of picked) counts.set(e, (counts.get(e) ?? 0) + 1);
    const spread = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\n[중첩 LOO] 한 곳을 빼고 나머지 ${use.length - 1}곳으로 지수를 고른 뒤, 안 본 그 곳을 맞힌다`);
    console.log(`  겹마다 고른 지수: ${spread.map(([e, n]) => `${e.toFixed(1)}(${n}회)`).join(" · ")}`);
    console.log(`  **자료가 고를 수 있나**: ${counts.size === 1 ? "✅ 40겹 전부 같은 값 — 고른다" : `겹마다 ${counts.size}가지로 갈린다`}`);
    console.log(`  중첩 LOO MAE = ${(mean(looErr) * 100).toFixed(2)}%p`);
    console.log(`\n  비교 — 고정값으로 갔을 때 (같은 표본)`);
    console.log(`  지수     MAE      최악      분별력 r(log)   순위 분별력`);
    const all = use.map((_, i) => i);
    const actLog = acts.map(Math.log);
    const rankOf = (v: number[]) => {
      const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
      const rk = new Array(v.length).fill(0);
      idx.forEach(([, i], k) => { rk[i] = k + 1; });
      return rk;
    };
    const actRank = rankOf(acts);
    for (const e of [0, 0.169, 0.5, 1.0]) {
      const P2 = { ...P, indexCalibration: { ...P.indexCalibration!, locationExponent: e } };
      const pr = use.map(({ r }) => computeTextbook(r.input, P2).utilization ?? NaN);
      const errs = pr.map((v, i) => Math.abs(v - acts[i]));
      console.log(`  ${e.toFixed(3).padStart(5)}${(mean(errs) * 100).toFixed(2).padStart(8)}%p`
        + `${(Math.max(...errs) * 100).toFixed(2).padStart(9)}%p`
        + `${corr(pr.map(Math.log), actLog).toFixed(3).padStart(14)}`
        + `${corr(rankOf(pr), actRank).toFixed(3).padStart(14)}`);
    }
    void all;
    console.log(`\n  ⭐ 읽는 법`);
    console.log(`     · 겹마다 고른 값이 갈리면 **자료가 못 고르는 것**이다 -> 교과서 1을 쓴다`);
    console.log(`     · 중첩 LOO MAE가 고정값들보다 나쁘면 **고르는 행위 자체가 손해**다`);
    console.log(`     · 분별력 r은 **순서를 제대로 매기나**다. 오차가 작아도 순서를 못 매기면`);
    console.log(`       후보지 평가에 못 쓴다(사용자: "다만 분별력은 있어야 함").`);
    expect(picked.length).toBe(use.length);
  });

  it("(0) ⭐⭐ 이거 그냥 평균 맞추기 아니냐 — '전부 평균'을 이기나", () => {
    // 사용자(2026-09-22): *"매장별 편차가 없어서 신뢰가 안 된다. 매장들이 다 예상 가동률이
    //   비슷했어서, 이거 뭐 그냥 평균 맞추기 한 거 아냐? 실제 데이터 값이 보정값으로 눌러서
    //   평균 맞춘 느낌 나서 얘기했던 거였어."*
    //
    // **제일 중요한 물음이다.** 산식이 매장을 가르는 게 아니라 전부 비슷한 값을 뱉으면,
    // 오차가 작아도 아무 쓸모가 없다(후보지마다 같은 답이 나온다는 뜻이라서다).
    //
    // 이 저장소에 전례가 있다 — 2026-09-21에 *"산식은 '전부 평균'보다 못하다(6.33 vs 4.26%p)"*
    // 였다. **모든 매장에 똑같은 값을 찍는 것보다 나빴다.**
    //
    // 판정: **LOO 전부 평균**(그 매장을 뺀 나머지의 평균을 그 매장 예측으로 쓴다)과 견준다.
    // 이게 "아무것도 모를 때"의 바닥이다. 이걸 못 이기면 산식은 값을 못 한다.
    const acts = rows.map((r) => r.act);
    const preds = rows.map((r) => r.pred);
    const n = rows.length;
    const looMean = acts.map((_, i) => mean(acts.filter((__, j) => j !== i)));
    const mae = (p: number[]) => mean(p.map((v, i) => Math.abs(v - acts[i])));
    const worst = (p: number[]) => Math.max(...p.map((v, i) => Math.abs(v - acts[i])));
    const within = (p: number[]) => p.filter((v, i) => Math.abs(v - acts[i]) <= 0.05).length;
    console.log(`\n[바닥 대조] n=${n} · "아무것도 모를 때"보다 나은가`);
    console.log(`  경우                  MAE       최악      ±5%p    예측 퍼짐(SD)`);
    const line = (name: string, p: number[]) => console.log(
      `  ${name.padEnd(20)}${(mae(p) * 100).toFixed(2).padStart(7)}%p`
      + `${(worst(p) * 100).toFixed(2).padStart(9)}%p  ${String(within(p)).padStart(2)}/${n}`
      + `${(sdOf(p) * 100).toFixed(2).padStart(13)}%p`);
    line("전부 평균(LOO)", looMean);
    line("지금 산식", preds);
    console.log(`  ${"실측".padEnd(20)}${"—".padStart(7)}  ${"—".padStart(9)}  ${"—".padStart(5)}`
      + `${(sdOf(acts) * 100).toFixed(2).padStart(13)}%p`);
    const win = mae(preds) < mae(looMean);
    console.log(`\n  ⭐ ${win ? "**이긴다**" : "⛔ **진다**"} — 산식 ${(mae(preds) * 100).toFixed(2)}%p vs 전부 평균 ${(mae(looMean) * 100).toFixed(2)}%p`);
    console.log(`     예측 퍼짐 ${(sdOf(preds) * 100).toFixed(2)}%p vs 실측 퍼짐 ${(sdOf(acts) * 100).toFixed(2)}%p`);
    console.log(`     (전부 평균은 퍼짐이 0에 가깝다 — 매장을 하나도 안 가른다는 뜻이다)`);
    // 예측이 실제로 갈리는지 **눈으로** 본다. 숫자만 보면 "비슷하다"는 느낌을 확인 못 한다.
    const sorted = rows.map((r, i) => ({ ...r, i })).sort((a, b) => a.pred - b.pred);
    console.log(`\n  매장별 예측 가동률 — 낮은 5곳 / 높은 5곳 (예측 vs 실측)`);
    for (const x of sorted.slice(0, 5)) console.log(`    ${x.name.padEnd(16)}${(x.pred * 100).toFixed(1).padStart(6)}%  (실측 ${(x.act * 100).toFixed(1)}%)`);
    console.log(`    ...`);
    for (const x of sorted.slice(-5)) console.log(`    ${x.name.padEnd(16)}${(x.pred * 100).toFixed(1).padStart(6)}%  (실측 ${(x.act * 100).toFixed(1)}%)`);
    console.log(`    예측 범위 ${(Math.min(...preds) * 100).toFixed(1)}~${(Math.max(...preds) * 100).toFixed(1)}%`
      + ` · 실측 범위 ${(Math.min(...acts) * 100).toFixed(1)}~${(Math.max(...acts) * 100).toFixed(1)}%`);
    expect(n).toBeGreaterThan(30);
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
