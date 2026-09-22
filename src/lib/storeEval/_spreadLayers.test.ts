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
      { name: "입지를 전부 평균으로", get: (r) => r.demandH * r.share * mLoc / r.cap },
    ];
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
