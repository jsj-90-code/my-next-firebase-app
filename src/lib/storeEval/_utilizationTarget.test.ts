// 수요÷공급이 **실제 가동률**과 붙는지 본다 (2026-09-16). 일회성 분석용.
//
// 왜 목표를 가동률로 바꾸나: 지금까지는 매출로 검증했는데, 매출에는 요금·상품매출·할인이
// 섞여 있어 수요 측정의 실력이 흐려진다. 이 저장소에는 이미 답이 적혀 있었다 —
// "PC 이용시간은 가동률에서. 매출÷요금 역산은 좌석 추가과금·정액할인 때문에 11.7% 틀리고
//  가동률 필드는 2.3%"(memory: project_pc_hours_from_utilization).
//
// 월매출 레코드에 utilizationRate가 월별로 들어 있다. 평가창(오픈 후 12개월) 평균을 쓴다.
//
// ── 실측 (2026-09-16) ────────────────────────────────────────────────────
//   평균 가동률: 최소 17.6% · 중앙 32.3% · 최대 46.5% (40곳)
//   월 최대의 최대: 52.0%
//   독점매장 3곳: 탕정역 34.1% · 광주각화 35.1% · 남악 29.1%  -> 전부 중간이다
//
// 즉 독점매장이 가동률 상한에 걸려 있다는 증거는 없다. 가동률 최상위 3곳
// (전대후문 46.5% · 청주지웰시티 43.6% · 울산대 42.2%)은 오히려 전부 경쟁점이 있는 매장이다.
//
// 이 파일이 답하려는 질문: **수요÷공급 비가 실제 가동률을 설명하는가?**
// 설명한다면 "수요 -> 점유율 -> 매출" 구조는 살아 있고 측정만 고치면 된다.
// 설명하지 못한다면 가동률을 정하는 건 상권이 아니라 매장 자체다.
//
//   npx vitest run src/lib/storeEval/_utilizationTarget.test.ts --reporter=verbose
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { computeCompetitorIp } from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { evaluationMonths } from "./evaluationSalesPeriod";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import type { Competitor } from "./types";

const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const ready = hasValidationSnapshot() && existsSync(FLOAT_FILE) && existsSync(RESI_FILE);
const describeIf = ready ? describe : describe.skip;

const RING = [100, 200, 300, 400, 500] as const;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const cv = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) / m;
};
function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** 고리 밀도를 단조로 눌러 외부 발생원의 초과분만 걷어낸다(_effectiveTradeArea 참고). */
function envelope(by: Record<number, number>): number | null {
  let t = 0, pv = 0, pa = 0, pd: number | null = null, any = false;
  for (const R of RING) {
    const v = by[R];
    if (v == null) continue;
    const A = Math.PI * R * R;
    const d = (v - pv) / (A - pa);
    const u = pd == null ? d : Math.min(d, pd);
    t += u * (A - pa);
    pv = v; pa = A; pd = u; any = true;
  }
  return any ? Math.round(t) : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("가동률을 목표로 — 수요÷공급이 가동률을 설명하는가", () => {
  const fl = JSON.parse(readFileSync(FLOAT_FILE, "utf8"));
  const re = JSON.parse(readFileSync(RESI_FILE, "utf8"));
  const floSites = fl.sites ?? fl;
  const resSites = re.sites ?? re;

  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);

  type Row = {
    name: string | null; pc: number; util: number; utilMax: number;
    rivalIp: number; ownShare: number; competitorCount: number;
    flo: Record<number, number>; floEnv: number | null; res: Record<number, number>;
  };
  const rows: Row[] = [];

  for (const st of stores as any[]) {
    if (st.excludedFromModel) continue;
    const pc = st.evaluationPcCount ?? st.pcCount;
    if (!pc) continue;
    const want = new Set(evaluationMonths(st.openedAt));
    const ur = (snap.sales as any[])
      .filter((s) => s.storeCode === st.storeCode && want.has(s.yearMonth) && s.utilizationRate != null)
      .map((s) => Number(s.utilizationRate));
    if (ur.length < 6) continue;

    const key = `existing:${st.storeCode}`;
    const fv = floSites[key], rv = resSites[key];
    if (!fv || !rv) continue;
    const flo: Record<number, number> = {};
    for (const R of RING) {
      const r = fv.radii?.[String(R)];
      if (r?.selected?.length) flo[R] = Math.round(mean(r.selected.slice(-12)));
    }
    const res: Record<number, number> = {};
    for (const R of [...RING, 1000]) {
      const r = rv.radii?.[String(R)];
      if (r?.totalPopulation != null) res[R] = Number(r.totalPopulation);
    }
    if (flo[300] == null || res[1000] == null) continue;

    const cs = compsByCode.get(existingStoreSourceCode(st)) ?? [];
    const rivalIp = computeCompetitorIp(cs, st.operatingPcStores500m ?? null) ?? 0;
    rows.push({
      name: st.storeName, pc, util: mean(ur), utilMax: Math.max(...ur),
      rivalIp, ownShare: pc / (pc + rivalIp),
      competitorCount: cs.filter((c) => c.investigationStatus !== "경쟁점없음").length,
      flo, floEnv: envelope(flo), res,
    });
  }

  it("실제 가동률 분포", () => {
    const u = rows.map((r) => r.util).sort((a, b) => a - b);
    console.log(`\n매장 ${rows.length}곳 · 평가창 평균 가동률`);
    console.log(`  최소 ${(u[0] * 100).toFixed(1)}% · 중앙 ${(u[Math.floor(u.length / 2)] * 100).toFixed(1)}% · 최대 ${(u[u.length - 1] * 100).toFixed(1)}%`);
    console.log(`  변동계수 ${(cv(rows.map((r) => r.util)) * 100).toFixed(0)}%`);
    console.log(`  월 최대 가동률의 최대값 ${(Math.max(...rows.map((r) => r.utilMax)) * 100).toFixed(1)}%`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("수요÷공급 vs 실제 가동률", () => {
    // 이 구조가 옳다면 수요÷공급이 클수록 가동률이 높아야 한다. 상관이 양수이고 유의해야 한다.
    const ys = rows.map((r) => r.util);
    const n = rows.length;
    const sigLine = 2 / Math.sqrt(n);

    const demands: [string, (r: Row) => number | null][] = [
      ["주거1000m", (r) => r.res[1000] ?? null],
      ["주거500m", (r) => r.res[500] ?? null],
      ["유동300m", (r) => r.flo[300] ?? null],
      ["유동500m", (r) => r.flo[500] ?? null],
      ["유동 포락선", (r) => r.floEnv],
      ["주거1000 + 유동300x0.3", (r) => (r.res[1000] ?? 0) + (r.flo[300] ?? 0) * 0.3],
      ["주거1000 + 유동포락선x0.3", (r) => (r.res[1000] ?? 0) + (r.floEnv ?? 0) * 0.3],
    ];

    console.log(`\n표본 ${n}곳 · 유의선 |r| > ${sigLine.toFixed(3)}`);
    console.log(`${"수요 측정".padEnd(26)} ${"수요÷공급 r".padStart(12)} ${"수요÷자사PC r".padStart(14)}  긴장도CV`);
    for (const [label, get] of demands) {
      const xs1: number[] = [], xs2: number[] = [], yy: number[] = [];
      for (const r of rows) {
        const d = get(r);
        if (d == null || !(d > 0)) continue;
        const supply = r.pc + r.rivalIp;
        if (!(supply > 0)) continue;
        xs1.push(d / supply);
        xs2.push(d / r.pc);
        yy.push(r.util);
      }
      if (yy.length < 20) continue;
      const r1 = pearson(xs1, yy), r2 = pearson(xs2, yy);
      const s = (v: number) => (Math.abs(v) > sigLine ? "*" : " ");
      console.log(`${label.padEnd(26)} ${r1.toFixed(3).padStart(12)}${s(r1)} ${r2.toFixed(3).padStart(13)}${s(r2)}  ${(cv(xs1) * 100).toFixed(0)}%`);
    }
    console.log(`\n(참고) 실제 가동률 변동계수 ${(cv(ys) * 100).toFixed(0)}% — 긴장도CV가 이보다 훨씬 크면 진폭이 과하다.`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("경쟁만 따로 — 경쟁이 가동률을 낮추는가", () => {
    // 수요를 빼고 경쟁만 본다. "상권 IP가 포화면 어쩔 건데"에 대한 직접 검정이다.
    const n = rows.length;
    const sigLine = 2 / Math.sqrt(n);
    const ys = rows.map((r) => r.util);
    const cands: [string, (r: Row) => number][] = [
      ["자사PC ÷ (자사PC+경쟁IP)", (r) => r.ownShare],
      ["경쟁IP", (r) => r.rivalIp],
      ["경쟁점 수", (r) => r.competitorCount],
      ["경쟁IP ÷ 주거1000m", (r) => r.rivalIp / (r.res[1000] || 1)],
      ["총IP ÷ 주거1000m (상권 포화도)", (r) => (r.pc + r.rivalIp) / (r.res[1000] || 1)],
      ["총IP ÷ (주거1000+유동300x0.3)", (r) => (r.pc + r.rivalIp) / ((r.res[1000] ?? 0) + (r.flo[300] ?? 0) * 0.3 || 1)],
    ];
    console.log(`\n경쟁 관련 신호 vs 실제 가동률 (유의선 ${sigLine.toFixed(3)})`);
    for (const [label, get] of cands) {
      const xs = rows.map(get);
      const r = pearson(xs, ys);
      console.log(`  ${label.padEnd(32)} r = ${r.toFixed(3)}${Math.abs(r) > sigLine ? " *" : ""}`);
    }
    expect(rows.length).toBeGreaterThan(30);
  });

  it("그럼 가동률을 만드는 건 뭔가 — 매장 쪽 신호", () => {
    // 상권(수요·경쟁)이 가동률을 설명하지 못한다면 남은 건 매장 자체다.
    // 경쟁력점수·입지점수·요금·규모·연차를 한 줄에 놓고 본다.
    const n = rows.length;
    const sigLine = 2 / Math.sqrt(n);
    const ys = rows.map((r) => r.util);
    const byCode = new Map((stores as any[]).map((s) => [s.storeCode, s]));
    const locByCode = new Map((snap.locationEvaluations as any[]).map((l) => [l.candidateCode, l]));

    const cands: [string, (r: Row, st: any, loc: any) => number | null][] = [
      ["경쟁력점수", (_r, st) => st.competitivenessScore ?? null],
      ["경쟁력격차", (_r, st) => st.competitivenessGap ?? null],
      ["시간당 요금", (_r, st) => st.hourlyRate ?? null],
      ["PC대수", (r) => r.pc],
      ["입지동선종합", (_r, _st, loc) => loc?.locationScore ?? null],
      ["가시성", (_r, _st, loc) => loc?.visibilityScore ?? null],
      ["선점경쟁", (_r, _st, loc) => loc?.preemptionScore ?? null],
      ["먹거리평가", (_r, st) => st.ownFoodScore ?? null],
      ["인테리어평가", (_r, st) => st.ownInteriorScore ?? null],
      ["오픈연도", (_r, st) => {
        const m = String(st.openedAt ?? "").match(/^(\d{4})/);
        return m ? Number(m[1]) : null;
      }],
    ];

    console.log(`\n매장 쪽 신호 vs 실제 가동률 (n=${n}, 유의선 ${sigLine.toFixed(3)})`);
    const out: { label: string; r: number; n: number }[] = [];
    for (const [label, get] of cands) {
      const xs: number[] = [], yy: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const st = byCode.get((rows[i] as any).code ?? "") ?? [...byCode.values()].find((s: any) => s.storeName === rows[i].name);
        if (!st) continue;
        const loc = locByCode.get(existingStoreSourceCode(st));
        const v = get(rows[i], st, loc);
        if (v == null || !Number.isFinite(v)) continue;
        xs.push(v); yy.push(ys[i]);
      }
      if (yy.length < 15) continue;
      out.push({ label, r: pearson(xs, yy), n: yy.length });
    }
    out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    for (const o of out) {
      console.log(`  ${o.label.padEnd(16)} r = ${o.r.toFixed(3)}${Math.abs(o.r) > sigLine ? " *" : "  "}  n=${o.n}`);
    }
    expect(out.length).toBeGreaterThan(0);
  });

  it("피크 집중도 — 월평균 가동률이 눌리는가", () => {
    // 사용자 관찰(2026-09-16): "피크타임 때 만석은 물리적인 상한에 걸리는 거고, 다만 피크타임이
    // 아닌 경우도 있는데 이때는 출입의 제약이 있겠지."
    //
    // 가설: 유동이 피크에 몰린 상권일수록 그 시간엔 좌석 상한에 걸려 더 못 받고, 나머지 시간은
    // 비어서 **월평균 가동률이 눌린다.** 반대로 하루에 고르게 퍼진 상권은 같은 총유동이라도
    // 월평균 가동률이 높아야 한다. 맞다면 피크 집중도와 가동률은 음의 상관이어야 한다.
    //
    // ⚠️ 소상공인365 응답에 구간 라벨이 없다(값 6개만 온다). 그래서 "몇 시가 피크인가"는
    //    말하지 않고 **순서에 의존하지 않는 지표**만 쓴다 — 최대 비중, 상위 2구간 비중,
    //    그리고 분포의 고름(엔트로피). 라벨을 지어내지 않는다.
    const tabsFile = ".local-tools/sbiz-report-tabs.json";
    if (!existsSync(tabsFile)) { console.log("리포트 탭 자료가 없다"); return; }
    const tabs = JSON.parse(readFileSync(tabsFile, "utf8"));
    const tabSites = tabs.sites ?? tabs;
    const byName = new Map((stores as any[]).map((s) => [s.storeName, s.storeCode]));

    const xs: Record<string, number[]> = { 최대구간비중: [], 상위2구간비중: [], 고름: [] };
    const ys: number[] = [];
    for (const r of rows) {
      const code = byName.get(r.name ?? "");
      const site = code ? tabSites[`existing:${code}`] : null;
      const row = site?.radii?.["500"]?.sg4?.tables?.["시간대별 일평균 유동인구"]?.selectedRow;
      if (!Array.isArray(row) || row.length < 4) continue;
      const vals = row.map(Number).filter((v: number) => Number.isFinite(v) && v >= 0);
      const sum = vals.reduce((a: number, b: number) => a + b, 0);
      if (!(sum > 0)) continue;
      const share = vals.map((v: number) => v / sum);
      const sorted = [...share].sort((a, b) => b - a);
      // 엔트로피 — 클수록 하루에 고르게 퍼져 있다는 뜻.
      const ent = -share.reduce((s: number, p: number) => s + (p > 0 ? p * Math.log(p) : 0), 0);
      xs["최대구간비중"].push(sorted[0]);
      xs["상위2구간비중"].push(sorted[0] + sorted[1]);
      xs["고름"].push(ent);
      ys.push(r.util);
    }
    const n = ys.length;
    if (n < 15) { console.log(`표본 부족 (n=${n})`); return; }
    const sigLine = 2 / Math.sqrt(n);
    console.log(`\n시간대 분포 vs 실제 가동률 (n=${n}, 유의선 ${sigLine.toFixed(3)})`);
    for (const [label, arr] of Object.entries(xs)) {
      const r = pearson(arr, ys);
      console.log(`  ${label.padEnd(14)} r = ${r.toFixed(3)}${Math.abs(r) > sigLine ? " *" : ""}`);
    }
    console.log(`  가설대로라면 최대구간비중은 음(-), 고름은 양(+)이어야 한다.`);
    console.log(`  최대구간비중 분포: ${(Math.min(...xs["최대구간비중"]) * 100).toFixed(1)}% ~ ${(Math.max(...xs["최대구간비중"]) * 100).toFixed(1)}%`);
    expect(n).toBeGreaterThan(10);
  });
});
