// 경쟁을 계단 대신 **거리 감쇠**로 세면 (2026-09-20)
//
// ── 왜 ─────────────────────────────────────────────────────────────────────
// 지금은 300m 안이면 100%, 밖이면 0%로 자른다. 임의의 자이고 지방에서 깨진다:
//   문경시청점 — 373m 콤마PC가 0으로 세진다(23m 차이). 1.5km의 4곳도 0이다.
//              산식상 완전 독점인데 실제로는 시내 PC방들과 나눠 먹는다.
// Huff 원형은 계단이 아니라 곡선이다.
//
// ── 설계 (2026-09-20 한 번 고쳤다) ─────────────────────────────────────────
//     무게 = 1                                   (거리 ≤ 300m, 지금과 똑같이)
//          = exp(−(거리 − 300) ÷ scaleM)          (그 밖만 완만히)
//
// ⚠️ 첫 설계는 평지 없이 exp(−d/scaleM)이었는데, **근거리 무게까지 바꿔서** 300m 밖에
//    경쟁점이 없는 도시 매장 23곳도 평균 7.68%p 움직였다. 그건 "거리를 반영했다"가 아니라
//    "경쟁을 통째로 줄였다"이고 대조군도 못 넘었다(p=0.781). 평지를 두면 그 매장들이
//    **정확히 0 움직인다** — 가설을 제대로 겨냥하게 된다.
//
// ⚠️ **지금 동작을 포함하는 중첩 모형이다** — scaleM → 0이면 계단과 정확히 같다.
//    자유도는 scaleM 하나만 는다.
//
// ── 확인 기준 (먼저 적어둔다) ──────────────────────────────────────────────
//   1. **도시 매장은 거의 안 움직여야 한다.** 경쟁점이 이미 300m 안에 몰려 있어서다.
//      도시까지 크게 움직이면 그건 "경쟁을 통째로 줄인" 것이지 거리 감쇠가 아니다.
//   2. **지방·경쟁 공백 매장이 움직여야 한다** (문경·양주덕정처럼 300m 밖에 경쟁점이 있는 곳).
//   3. 홀드아웃(LOO, 축척까지 훈련겹에서만)에서 계단을 이겨야 한다.
//   4. 무작위 대조군 — 거리를 매장 안에서 섞어도 같은 이득이 나오면 거리가 한 일이 아니다.
//
// ⚠️ **측정만 한다.** 본체 기본값은 `rivalDistanceDecay: null`(꺼짐) 그대로다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_rivalDecay.test.ts --disable-console-intercept
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { buildLabRows, utilizationByStore, qscInWindowAverage, type LabRow, type QscRecord } from "./labInput";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import {
  DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook, type TextbookParams,
} from "./textbookModel";
import type { Competitor } from "./types";

const QSC_FILE = ".local-tools/qsc-scores.json";
const describeIf = hasValidationSnapshot() ? describe : describe.skip;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describeIf("경쟁 거리 감쇠", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(
    snap.existingStores, allCompetitors, snap.locationEvaluations, settings,
  );
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }
  const utilByStore = utilizationByStore(snap.sales ?? [], snap.existingStores);
  type QscSite = { name?: string; openedAt?: string; records?: QscRecord[] };
  const qscSites = new Map<string, QscSite>();
  for (const d of (snap.labQscScores ?? []) as ({ storeCode?: string; id?: string } & QscSite)[]) {
    const c = d.storeCode ?? d.id;
    if (c) qscSites.set(c, d);
  }
  if (!qscSites.size && existsSync(QSC_FILE)) {
    const sites = JSON.parse(readFileSync(QSC_FILE, "utf8")).sites as Record<string, QscSite>;
    for (const [k, v] of Object.entries(sites)) qscSites.set(k.replace(/^existing:/, ""), v);
  }
  const qscByStoreCode = new Map<string, number>();
  for (const [code, site] of qscSites) {
    const a = qscInWindowAverage(site.records ?? [], site.openedAt ?? null);
    if (a != null) qscByStoreCode.set(code, a);
  }

  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, qscByStoreCode });
  const P = DEFAULT_TEXTBOOK_PARAMS;
  const step = (): TextbookParams => ({ ...P, rivalDistanceDecay: null });
  const dec = (s: number): TextbookParams => ({ ...P, rivalDistanceDecay: { plateauM: P.effectiveRadiusM, scaleM: s } });
  const isMono = (r: LabRow) => !(r.input.competitorIp ?? 0);

  const GRID = [100, 150, 200, 250, 300, 400, 500, 700, 1000, 1500];

  const stat = (p: TextbookParams) => {
    const sc = scoreTextbook(rows, p);
    const monoBy = new Map(rows.map((r) => [r.input.storeCode, isMono(r)]));
    const e = sc.rows.filter((x) => x.predicted != null && x.actual > 0)
      .map((x) => ({ e: (x.predicted as number) / x.actual - 1, mono: monoBy.get(x.storeCode) === true }));
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    return {
      mape: sc.mape ?? NaN, median: sc.medianAbsErr ?? NaN, within20: sc.within20 ?? NaN,
      max: sc.maxAbsErr ?? NaN,
      mono: avg(e.filter((x) => x.mono).map((x) => x.e)),
      comp: avg(e.filter((x) => !x.mono).map((x) => x.e)),
      over: sc.requiredShare?.overOne ?? NaN,
    };
  };

  it("(1) scaleM 훑기 — 계단과 나란히", () => {
    const s0 = stat(step());
    console.log(`\n[거리 감쇠 훑기] 표본 ${rows.length}곳`);
    console.log("   scaleM     독점    경쟁상권     격차     MAPE     중앙   ±20%    최대  100%초과");
    const line = (label: string, s: ReturnType<typeof stat>) =>
      console.log(`  ${label.padStart(8)}  ${(s.mono * 100).toFixed(1).padStart(6)}%  ${(s.comp * 100).toFixed(1).padStart(7)}%  ` +
        `${((s.comp - s.mono) * 100).toFixed(1).padStart(6)}%p  ${(s.mape * 100).toFixed(2).padStart(6)}%  ` +
        `${(s.median * 100).toFixed(1).padStart(5)}%  ${(s.within20 * 100).toFixed(0).padStart(3)}%  ` +
        `${(s.max * 100).toFixed(0).padStart(4)}%  ${String(s.over).padStart(6)}곳`);
    line("계단300", s0);
    for (const s of GRID) line(String(s) + "m", stat(dec(s)));
    console.log("  ⚠️ 감쇠는 **먼 경쟁점을 새로 센다**(계단에서 0이던 것). 그래서 경쟁무게가");
    console.log("     늘어 점유율이 내려가는 게 기본 방향이다. 그런데도 성적이 좋아지면 그건");
    console.log("     '거리에 따라 다르게 센다'가 일을 한 것이다.");
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(2) 누가 움직이나 — 도시는 가만히 있어야 한다", () => {
    const S = 300;
    const a = scoreTextbook(rows, step()), b = scoreTextbook(rows, dec(S));
    const ma = new Map(a.rows.map((x) => [x.storeCode, x])), mb = new Map(b.rows.map((x) => [x.storeCode, x]));
    type D = { name: string; e0: number; e1: number; near: number; far: number; d: number };
    const ds: D[] = [];
    for (const r of rows) {
      const x = ma.get(r.input.storeCode), y = mb.get(r.input.storeCode);
      if (!x || !y || x.absErrPct == null || y.absErrPct == null) continue;
      const rv = (r.input.rivals ?? []).filter((z) => z.ip > 0);
      ds.push({
        name: r.input.storeName ?? r.input.storeCode,
        e0: x.absErrPct, e1: y.absErrPct,
        near: rv.filter((z) => z.distanceM != null && z.distanceM <= 300).reduce((s, z) => s + z.ip, 0),
        far: rv.filter((z) => z.distanceM != null && z.distanceM > 300).reduce((s, z) => s + z.ip, 0),
        d: y.absErrPct - x.absErrPct,
      });
    }
    ds.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
    console.log(`\n[누가 움직이나] 계단300 -> 감쇠 ${S}m · 오차 변화 큰 순`);
    console.log("  매장              300m안IP  300m밖IP   오차 전 -> 후");
    for (const x of ds.slice(0, 12)) {
      console.log(`  ${x.name.padEnd(15)}${String(x.near).padStart(8)}${String(x.far).padStart(9)}   ` +
        `${(x.e0 * 100).toFixed(1).padStart(5)}% -> ${(x.e1 * 100).toFixed(1).padStart(5)}%  ${(x.d * 100).toFixed(1).padStart(6)}%p`);
    }
    const noFar = ds.filter((x) => x.far === 0), hasFar = ds.filter((x) => x.far > 0);
    const avgAbs = (a: D[]) => a.length ? a.reduce((s, x) => s + Math.abs(x.d), 0) / a.length : NaN;
    console.log(`\n  300m 밖 경쟁점 **없는** ${noFar.length}곳 평균 변화 ${(avgAbs(noFar) * 100).toFixed(2)}%p  <- 0에 가까워야 한다`);
    console.log(`  300m 밖 경쟁점 **있는** ${hasFar.length}곳 평균 변화 ${(avgAbs(hasFar) * 100).toFixed(2)}%p`);
    expect(ds.length).toBeGreaterThan(30);
  });

  it("(3) LOO 홀드아웃 — 축척까지 훈련겹에서만", () => {
    const loo = (p: TextbookParams) => {
      const errs: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const train = rows.filter((_, k) => k !== i);
        const full = fittedParams(p, scoreTextbook(train, p));
        const b = computeTextbook(rows[i].input, full);
        const a = rows[i].actualRevenue;
        if (b.monthlyRevenue != null && a > 0) errs.push(Math.abs(b.monthlyRevenue - a) / a);
      }
      const s = [...errs].sort((x, y) => x - y);
      return { mape: errs.reduce((x, y) => x + y, 0) / errs.length, median: s[Math.floor(s.length / 2)], within20: errs.filter((v) => v <= 0.2).length / errs.length };
    };
    console.log(`\n[LOO 홀드아웃]`);
    console.log("   설정        MAPE     중앙   ±20%");
    const l0 = loo(step());
    console.log(`  계단300   ${(l0.mape * 100).toFixed(2).padStart(6)}%  ${(l0.median * 100).toFixed(1).padStart(5)}%  ${(l0.within20 * 100).toFixed(0).padStart(3)}%`);
    for (const s of [150, 200, 250, 300, 400, 500]) {
      const l = loo(dec(s));
      console.log(`  감쇠${String(s).padStart(4)}m  ${(l.mape * 100).toFixed(2).padStart(6)}%  ${(l.median * 100).toFixed(1).padStart(5)}%  ${(l.within20 * 100).toFixed(0).padStart(3)}%`);
    }
    expect(rows.length).toBeGreaterThan(30);
  });

  it("(4) 무작위 대조군 — 거리를 매장 안에서 섞는다", () => {
    // 한 매장의 경쟁점들끼리 **거리만** 맞바꾼다. 경쟁 구성(IP·품질)과 거리 분포는 그대로고
    // "어느 경쟁점이 가까운가"만 깨진다. 거리가 일을 한다면 이 섞음에서 이득이 줄어야 한다.
    const shuffled = (rand: () => number): LabRow[] => rows.map((r) => {
      const rv = r.input.rivals ?? [];
      const ds = rv.map((z) => z.distanceM);
      for (let i = ds.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [ds[i], ds[j]] = [ds[j], ds[i]];
      }
      return { actualRevenue: r.actualRevenue, input: { ...r.input, rivals: rv.map((z, i) => ({ ...z, distanceM: ds[i] })) } };
    });
    const pick = (rs: LabRow[]) => {
      let best = { s: 0, mape: Number.POSITIVE_INFINITY };
      for (const s of GRID) {
        const m = scoreTextbook(rs, dec(s)).mape ?? Number.POSITIVE_INFINITY;
        if (m < best.mape) best = { s, mape: m };
      }
      return best;
    };
    const base = scoreTextbook(rows, step()).mape ?? NaN;
    const real = base - pick(rows).mape;
    const rand = mulberry32(20260920);
    const gains: number[] = [];
    const bases: number[] = [];
    const bests: number[] = [];
    for (let t = 0; t < 200; t++) {
      const sh = shuffled(rand);
      const b = scoreTextbook(sh, step()).mape ?? NaN;
      if (!Number.isFinite(b)) continue;
      const p2 = pick(sh);
      bases.push(b); bests.push(p2.mape); gains.push(b - p2.mape);
    }
    const qOf = (arr: number[], p: number) => {
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(s.length * p))];
    };
    const pv = (gains.filter((g) => g >= real).length + 1) / (gains.length + 1);
    const pvBest = (bests.filter((m) => m <= pick(rows).mape).length + 1) / (bests.length + 1);
    console.log(`\n[대조군] 매장 안에서 경쟁점 거리를 섞는다 (${gains.length}회)`);
    console.log(`  기준선(계단300)  실제 ${(base * 100).toFixed(2)}%  vs  섞으면 중앙 ${(qOf(bases, 0.5) * 100).toFixed(2)}%`);
    console.log(`  최선(감쇠)      실제 ${(pick(rows).mape * 100).toFixed(2)}% (${pick(rows).s}m)  vs  섞으면 중앙 ${(qOf(bests, 0.5) * 100).toFixed(2)}%`);
    console.log(`  좋아진 폭       실제 ${(real * 100).toFixed(2)}%p  vs  섞으면 중앙 ${(qOf(gains, 0.5) * 100).toFixed(2)}%p · 95퍼센타일 ${(qOf(gains, 0.95) * 100).toFixed(2)}%p`);
    console.log(`  p(좋아진 폭 기준) = ${pv.toFixed(3)}  ${pv <= 0.05 ? "통과 ✅" : "미달 ❌"}`);
    console.log(`  p(최선값 기준)   = ${pvBest.toFixed(3)}  ${pvBest <= 0.05 ? "통과 ✅" : "미달 ❌"}`);
    console.log(`  ⚠️ **기준선 두 줄을 먼저 본다.** 섞어도 기준선이 거의 같으면 '좋아진 폭'을`);
    console.log(`     나란히 놓을 수 있다. 크게 다르면 p는 판정이 아니라 참고다`);
    console.log(`     (2026-09-20 바깥선택지에서 같은 함정을 밟았다).`);
    expect(gains.length).toBeGreaterThan(100);
  });
});
