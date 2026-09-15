// 소상공인365 리포트 탭에서 뽑은 신호를 훑는다 (2026-09-16). 일회성 분석용.
//
// 왜 이게 중요한가: 2026-09-16 탐색에서 **인구 기반 수요는 대당매출을 설명하지 못한다**는 게
// 확인됐다(_textbookSweep.test.ts). 조합 36,288개를 훑어도 교과서식 최선이 MAPE 29.4%로,
// 좌석 수만 세는 기준선(16.85%)보다 나빴다. 원인은 균형이다 — 사람 많은 동네엔 PC방도 많이
// 생겨서, 인구는 "이 동네가 PC 몇 대를 먹여 살리나"만 말하고 "대당 얼마 버나"는 말하지 않는다.
//
// 그렇다면 대당매출을 말해 줄 자료가 따로 있어야 한다. 리포트 탭이 그걸 직접 준다:
//
//   sg3.salesAmt    그 반경 안 PC방의 **업소당 월매출** 13개월치 (신중동 500m: 2,495만원)
//   sg3.salesCnt    매출건수 -> 객단가를 만들 수 있다
//   sg2.bsnsCntData PC방 업소수 13개월치 -> 시장 총매출 = 업소당매출 x 업소수
//   sg4.empData     직장인구
//   sg4.incmData    소득 지수 (행정동별)
//   sg4.cnsmData    소비 지수 (행정동별)
//
// 인구를 거치지 않고 "이 동네 PC방이 실제로 얼마 버는가"를 바로 준다는 게 핵심이다.
//
// ⚠️ 상관은 후보를 찾는 도구지 채택 근거가 아니다. 이 저장소는 r=0.660짜리 신호를 넣었다가
//    MAPE를 30% -> 48%로 악화시킨 적이 있다(2026-09-15 밀집도 보정). 여기서 걸리는 건
//    "다음에 무작위 대조군으로 검정할 것"이지 "넣을 것"이 아니다.
//
//   npx vitest run src/lib/storeEval/_reportTabSignals.test.ts --reporter=verbose
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import type { Competitor } from "./types";

const TABS_FILE = ".local-tools/sbiz-report-tabs.json";
const ready = hasValidationSnapshot() && existsSync(TABS_FILE);
const describeIf = ready ? describe : describe.skip;

const RADII = [100, 200, 300, 400, 500, 1000] as const;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 차트 배열에서 "선택영역" 계열의 **수준값**을 꺼낸다.
 *
 * ⚠️ 같은 key로 계열이 둘 들어 있다 — 첫 번째가 수준값, 두 번째가 전월대비 증감률(%)이다.
 * 둘을 구별하지 않으면 매출액 자리에 -24.09 같은 퍼센트가 섞여 들어간다(조용히 틀린다).
 * 그래서 첫 번째만 쓴다.
 */
function selectedSeries(charts: any, key: string): number[] | null {
  const arr = charts?.[key];
  if (!Array.isArray(arr)) return null;
  const hit = arr.filter((x: any) => String(x?.key ?? "").includes("선택"));
  const vals = hit[0]?.values;
  return Array.isArray(vals) && vals.length ? vals.map(Number) : null;
}

/** 행정동별로만 오는 계열(소득·소비)은 동 평균을 쓴다. 선택영역 계열이 없다. */
function dongAverage(charts: any, key: string): number | null {
  const arr = charts?.[key];
  if (!Array.isArray(arr) || !arr.length) return null;
  const last: number[] = [];
  for (const row of arr) {
    const v = row?.values;
    if (Array.isArray(v) && v.length) last.push(Number(v[v.length - 1]));
  }
  return last.length ? mean(last) : null;
}

describeIf("리포트 탭 신호 훑기", () => {
  const tabs = JSON.parse(readFileSync(TABS_FILE, "utf8"));
  const tabSites = tabs.sites ?? tabs;

  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);

  type Row = { name: string | null; actual: number; pc: number; signals: Record<string, number> };
  const rows: Row[] = [];

  for (const st of stores as any[]) {
    if (st.excludedFromModel || !st.actualMonthlyRevenueAvg) continue;
    const pc = st.evaluationPcCount ?? st.pcCount;
    if (!pc) continue;
    const site = tabSites[`existing:${st.storeCode}`];
    if (!site) continue;

    const sig: Record<string, number> = {};
    for (const R of RADII) {
      const r = site.radii?.[String(R)];
      if (!r) continue;
      const amt = selectedSeries(r.sg3?.charts, "salesAmt");
      const cnt = selectedSeries(r.sg3?.charts, "salesCnt");
      const biz = selectedSeries(r.sg2?.charts, "bsnsCntData");
      const emp = selectedSeries(r.sg4?.charts, "empData");
      if (amt) sig[`업소당매출${R}m`] = mean(amt.slice(-12));
      if (cnt) sig[`매출건수${R}m`] = mean(cnt.slice(-12));
      if (amt && cnt) {
        const c = mean(cnt.slice(-12));
        if (c > 0) sig[`객단가${R}m`] = mean(amt.slice(-12)) / c;
      }
      if (biz) sig[`업소수${R}m`] = mean(biz.slice(-12));
      if (amt && biz) sig[`시장총매출${R}m`] = mean(amt.slice(-12)) * mean(biz.slice(-12));
      if (emp) sig[`직장인구${R}m`] = emp[emp.length - 1];
      const inc = dongAverage(r.sg4?.charts, "incmData");
      const cns = dongAverage(r.sg4?.charts, "cnsmData");
      if (inc != null) sig[`소득${R}m`] = inc;
      if (cns != null) sig[`소비${R}m`] = cns;
      // 업소당매출 추세 — 최근 6개월 평균 ÷ 그 이전 6개월 평균. 상권이 뜨는지 지는지.
      if (amt && amt.length >= 12) {
        const recent = mean(amt.slice(-6));
        const before = mean(amt.slice(-12, -6));
        if (before > 0) sig[`매출추세${R}m`] = recent / before;
      }
    }
    rows.push({ name: st.storeName, actual: st.actualMonthlyRevenueAvg, pc, signals: sig });
  }

  it("표본이 잡힌다", () => {
    console.log(`표본 ${rows.length}곳 · 신호 ${Object.keys(rows[0]?.signals ?? {}).length}종`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("리포트 탭 신호 × 대당매출", () => {
    const names = [...new Set(rows.flatMap((r) => Object.keys(r.signals)))].sort();
    const n = rows.length;
    const sigLine = 2 / Math.sqrt(n);

    const out: { name: string; rA: number | null; rB: number | null; n: number }[] = [];
    for (const name of names) {
      const sub = rows.filter((r) => Number.isFinite(r.signals[name]));
      if (sub.length < 10) continue;
      const xs = sub.map((r) => r.signals[name]);
      out.push({
        name,
        rA: pearson(xs, sub.map((r) => r.actual)),
        rB: pearson(xs, sub.map((r) => r.actual / r.pc)),
        n: sub.length,
      });
    }
    out.sort((a, b) => Math.abs(b.rB ?? 0) - Math.abs(a.rB ?? 0));

    const fmt = (v: number | null) => (v == null ? "  -   " : `${v >= 0 ? "+" : ""}${v.toFixed(3)}`);
    const star = (v: number | null) => (v != null && Math.abs(v) > sigLine ? "*" : " ");
    console.log(`\n표본 ${n}곳 · 유의선 |r| > ${sigLine.toFixed(3)}`);
    console.log(`${"신호".padEnd(20)} ${"(A)실매출".padStart(9)} ${"(B)대당매출".padStart(10)}   n`);
    for (const o of out.slice(0, 30)) {
      console.log(`${o.name.padEnd(20)} ${fmt(o.rA)}${star(o.rA)} ${fmt(o.rB)}${star(o.rB)}  ${o.n}`);
    }
    expect(out.length).toBeGreaterThan(0);
  });

  it("지역 업소당매출이 우리 대당매출의 자가 되는가", () => {
    // 가장 직접적인 후보. 이게 붙으면 "그 동네 PC방 평균 x 우리 프리미엄 배수"라는
    // 아주 단순하고 설명 가능한 산식이 선다.
    // 0인 곳이 있다 — 그 반경 안에 PC방 매출 자료가 없는 경우다. 나누면 Infinity가 되므로 뺀다.
    const zeros = rows.filter((r) => r.signals["업소당매출500m"] === 0).length;
    const missing = rows.filter((r) => !Number.isFinite(r.signals["업소당매출500m"])).length;
    console.log(`\n자료 가용성 — 업소당매출500m: 값 있음 ${rows.length - zeros - missing}곳 · 0 ${zeros}곳 · 없음 ${missing}곳 (전체 ${rows.length})`);
    const sub = rows.filter((r) => Number.isFinite(r.signals["업소당매출500m"]) && r.signals["업소당매출500m"] > 0);
    const xs = sub.map((r) => r.signals["업소당매출500m"]);
    const perPc = sub.map((r) => r.actual / r.pc);
    const ratio = sub.map((r, i) => r.actual / (xs[i] * 10000));
    const sorted = [...ratio].sort((a, b) => a - b);
    const cv = Math.sqrt(ratio.reduce((s, x) => s + (x - mean(ratio)) ** 2, 0) / ratio.length) / mean(ratio);
    console.log(`\n우리매출 ÷ 지역 업소당매출 (n=${sub.length})`);
    console.log(`  중앙 ${sorted[Math.floor(sorted.length / 2)].toFixed(2)}배 · 최소 ${sorted[0].toFixed(2)} · 최대 ${sorted[sorted.length - 1].toFixed(2)} · 변동계수 ${(cv * 100).toFixed(0)}%`);
    console.log(`  참고 — 실제 대당매출 변동계수는 20%다. 이 배수의 변동계수가 그보다 작아야 쓸모가 있다.`);
    console.log(`  상관: 지역 업소당매출 vs 대당매출 r = ${(pearson(xs, perPc) ?? 0).toFixed(3)}`);
    // 38곳 중 7곳은 반경 안에 PC방 매출 자료가 아예 없고 1곳은 0이라 30곳만 쓸 수 있다.
    expect(sub.length).toBeGreaterThan(25);
  });
});
