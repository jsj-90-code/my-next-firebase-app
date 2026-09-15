// 독점상권에서 수요 측정만 따로 검증한다 (2026-09-16). 일회성 분석용.
//
// 사용자 방향(2026-09-16):
//   "기존 산식은 주거/번화가에 따라 수요측정이 다르지만, 현재 방식은 고정이기 때문에
//    독점매장 먼저 파악해보는 거."
//
// 왜 독점매장인가: 교과서식은 매출 = 수요 x 점유율 x 단가다. 경쟁이 있으면 수요가 틀려도
// 점유율이 그걸 가려버려서 **어느 쪽이 틀렸는지 알 수가 없다.** 그런데 독점상권에서는
// 점유율이 1에 가까우므로 매출 ≒ 수요 x 단가가 되고, 수요 측정의 실력이 그대로 드러난다.
//
// 그리고 운영 산식(calc.ts computeMarketDemand)은 이미 상권성격에 따라 수요원을 바꾼다 —
// 번화가·혼합은 유동, 주거중심은 주거를 쓴다(08_계산기준). 교과서식만 공통으로 간다.
// 그게 맞는지도 여기서 같이 본다.
//
// 상권성격 판정은 운영 산식과 같은 정의를 쓴다(유동500 ÷ 주거500, 8 이상 번화가 / 4 이상 혼합).
// ⚠️ 유동 500m는 산식에서는 빼기로 했지만(수원망포점 지하철 사례), **분류 기준**으로는
//    운영 산식과 같은 자를 써야 비교가 된다. 300m로 바꾸면 분류가 어떻게 달라지는지도 같이 낸다.
//
//   npx vitest run src/lib/storeEval/_monopolyDemand.test.ts --reporter=verbose
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { computeCompetitorIp } from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import type { Competitor } from "./types";

const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const ready = hasValidationSnapshot() && existsSync(FLOAT_FILE) && existsSync(RESI_FILE);
const describeIf = ready ? describe : describe.skip;

const MONTH_HOURS = 24 * 30;
const RING = [100, 200, 300, 400, 500] as const;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const cv = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) / m;
};

type Character = "번화가" | "혼합" | "주거중심";
function classify(floating: number, resident: number): Character | null {
  if (!(resident > 0)) return null;
  const ratio = floating / resident;
  if (ratio >= 8) return "번화가";
  if (ratio >= 4) return "혼합";
  return "주거중심";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("독점상권 — 수요 측정만 검증", () => {
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
    name: string | null; actual: number; pc: number; rate: number;
    rivalIp: number; competitorCount: number;
    ownShare: number;           // 자사PC ÷ (자사PC + 경쟁IP) — 1에 가까울수록 독점
    flo: Record<number, number>;
    res: Record<number, number>;
    char500: Character | null;  // 운영 산식과 같은 정의
    char300: Character | null;  // 유동 300m로 바꾸면
  };

  const rows: Row[] = [];
  for (const st of stores as any[]) {
    if (st.excludedFromModel || !st.actualMonthlyRevenueAvg) continue;
    const pc = st.evaluationPcCount ?? st.pcCount;
    const rate = st.hourlyRate;
    if (!pc || rate == null) continue;
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
    if (flo[500] == null || flo[300] == null || res[500] == null) continue;

    const cs = compsByCode.get(existingStoreSourceCode(st)) ?? [];
    const rivalIp = computeCompetitorIp(cs, st.operatingPcStores500m ?? null) ?? 0;
    rows.push({
      name: st.storeName, actual: st.actualMonthlyRevenueAvg, pc, rate,
      rivalIp, competitorCount: cs.filter((c) => c.investigationStatus !== "경쟁점없음").length,
      ownShare: pc / (pc + rivalIp),
      flo, res,
      char500: classify(flo[500], res[500]),
      char300: classify(flo[300], res[500]),
    });
  }

  it("표본과 분류", () => {
    const count = (get: (r: Row) => Character | null) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(String(get(r)), (m.get(String(get(r))) ?? 0) + 1);
      return m;
    };
    console.log(`\n표본 ${rows.length}곳`);
    console.log(`상권성격 (유동500 기준, 운영 산식과 같은 정의): ${[...count((r) => r.char500)].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    console.log(`상권성격 (유동300 기준):                      ${[...count((r) => r.char300)].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    const flipped = rows.filter((r) => r.char500 !== r.char300);
    console.log(`분류가 바뀌는 매장 ${flipped.length}곳: ${flipped.map((r) => `${r.name}(${r.char500}→${r.char300})`).join(", ")}`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("독점도 분포 — 어디까지가 독점인가", () => {
    const sorted = [...rows].sort((a, b) => b.ownShare - a.ownShare);
    console.log(`\n자사PC ÷ (자사PC + 경쟁IP) 상위 12곳 — 1에 가까울수록 독점`);
    console.log(`${"이름".padEnd(16)} 독점도  경쟁점수  자사PC  경쟁IP  상권성격`);
    for (const r of sorted.slice(0, 12)) {
      console.log(
        `${(r.name ?? "").padEnd(16)} ${r.ownShare.toFixed(3)}  ${String(r.competitorCount).padStart(6)}  ${String(r.pc).padStart(6)}  ${String(Math.round(r.rivalIp)).padStart(6)}  ${r.char500}`,
      );
    }
    console.log(`\n독점도 중앙 ${median(rows.map((r) => r.ownShare)).toFixed(3)} · 최소 ${Math.min(...rows.map((r) => r.ownShare)).toFixed(3)}`);
    expect(sorted.length).toBeGreaterThan(30);
  });

  it("독점매장에서 수요 측정의 실력", () => {
    // 독점상권에서는 점유율 ≒ 1이므로 매출 ≒ 수요 x 단가다.
    // 수요를 무엇으로 재느냐에 따라 "예측 대당매출"이 얼마나 흔들리는지 본다.
    // 기준: 실제 대당매출의 변동계수(약 20%)보다 작아야 쓸모가 있다.
    // 독점매장은 3곳뿐이다(탕정역·광주각화·남악, 전부 경쟁점 0곳). 4위가 0.542로 뚝 떨어진다.
    // 3곳으로는 통계가 안 되지만 **한 곳씩 뜯어보는 건 된다** — 그게 이 검정의 목적이다.
    // 이 3곳은 2026-09-15 교과서식이 터진 바로 그 매장들이다(광주각화 2억2천/실제 7,616만 등).
    const monopoly = rows.filter((r) => r.ownShare >= 0.99);
    const rest = rows.filter((r) => r.ownShare < 0.99);
    const restPerPc = median(rest.map((r) => r.actual / r.pc));
    console.log(`\n=== 독점매장 ${monopoly.length}곳을 한 곳씩 ===`);
    console.log(`(비교 기준: 경쟁 있는 ${rest.length}곳의 대당매출 중앙값 ${Math.round(restPerPc / 10000)}만원)`);
    for (const r of monopoly) {
      const perPc = r.actual / r.pc;
      console.log(`\n[${r.name}] ${r.char500} · 자사PC ${r.pc}대 · 경쟁 0곳`);
      console.log(`  실제 대당매출 ${Math.round(perPc / 10000)}만원 (경쟁 있는 곳 중앙값의 ${(perPc / restPerPc).toFixed(2)}배)`);
      for (const [label, v] of [
        ["주거500m", r.res[500]], ["주거1000m", r.res[1000]],
        ["유동300m", r.flo[300]], ["유동500m", r.flo[500]],
      ] as const) {
        if (v == null) continue;
        console.log(`  ${label.padEnd(10)} ${String(v).padStart(8)}  → PC 1대당 수요 ${(v / r.pc).toFixed(0)}`);
      }
    }
    // 경쟁이 없으면 "동네 수요를 통째로 먹는다"고 보는데, 실제로 그런가?
    const monoPerPc = monopoly.length ? median(monopoly.map((r) => r.actual / r.pc)) : 0;
    console.log(`\n독점매장 대당매출 중앙 ${Math.round(monoPerPc / 10000)}만원 vs 경쟁 있는 곳 ${Math.round(restPerPc / 10000)}만원`);
    console.log(`  → ${(monoPerPc / restPerPc).toFixed(2)}배. 1.0에 가까우면 "경쟁이 없어도 더 벌지는 않는다"는 뜻이고,`);
    console.log(`     그건 수요를 점유율로 나눠 갖는 구조 자체가 현실과 다르다는 신호다.`);

    const cuts = [0.5, 0.6, 0.7] as const;
    for (const cut of cuts) {
      const sub = rows.filter((r) => r.ownShare >= cut);
      if (sub.length < 4) continue;
      console.log(`\n── 독점도 ${cut} 이상: ${sub.length}곳 ──`);
      const perPc = sub.map((r) => r.actual / r.pc);
      console.log(`  실제 대당매출 변동계수 ${(cv(perPc) * 100).toFixed(0)}%`);

      const candidates: [string, (r: Row) => number | null][] = [
        ["주거500m", (r) => r.res[500] ?? null],
        ["주거1000m", (r) => r.res[1000] ?? null],
        ["유동300m", (r) => r.flo[300] ?? null],
        ["유동500m", (r) => r.flo[500] ?? null],
        ["주거1000+유동300x0.3", (r) => (r.res[1000] != null && r.flo[300] != null ? r.res[1000] + r.flo[300] * 0.3 : null)],
        ["상권성격별(번화가·혼합=유동300, 주거=주거1000)", (r) =>
          r.char500 === "주거중심" ? (r.res[1000] ?? null) : (r.flo[300] ?? null)],
      ];

      console.log(`  ${"수요 측정 방식".padEnd(42)} 대당수요CV  대당매출과 r`);
      for (const [label, get] of candidates) {
        const vals: number[] = [];
        const ys: number[] = [];
        for (const r of sub) {
          const d = get(r);
          if (d == null) continue;
          vals.push(d / r.pc);          // PC 1대가 감당하는 수요
          ys.push(r.actual / r.pc);
        }
        if (vals.length < 5) continue;
        const mx = mean(vals), my = mean(ys);
        let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < vals.length; i++) {
          const dx = vals[i] - mx, dy = ys[i] - my;
          sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
        }
        const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
        console.log(`  ${label.padEnd(42)} ${(cv(vals) * 100).toFixed(0).padStart(9)}%  ${r.toFixed(3).padStart(11)}`);
      }
    }
    expect(rows.length).toBeGreaterThan(30);
  });

  it("상권성격별로 수요원을 나누면 나아지는가", () => {
    // 운영 산식은 이미 나눈다. 교과서식도 나눠야 하는지 전체 표본에서 확인한다.
    const variants: [string, (r: Row) => number | null][] = [
      ["공통 — 주거1000 + 유동300x0.3", (r) => (r.res[1000] != null && r.flo[300] != null ? r.res[1000] + r.flo[300] * 0.3 : null)],
      ["공통 — 유동300만", (r) => r.flo[300] ?? null],
      ["공통 — 주거1000만", (r) => r.res[1000] ?? null],
      ["성격별 — 번화가·혼합=유동300 / 주거=주거1000", (r) => (r.char500 === "주거중심" ? (r.res[1000] ?? null) : (r.flo[300] ?? null))],
      ["성격별 — 번화가=유동300 / 혼합=합산 / 주거=주거1000", (r) =>
        r.char500 === "번화가" ? (r.flo[300] ?? null)
          : r.char500 === "주거중심" ? (r.res[1000] ?? null)
            : (r.res[1000] != null && r.flo[300] != null ? r.res[1000] + r.flo[300] * 0.3 : null)],
    ];
    console.log(`\n전체 ${rows.length}곳 — 수요원 선택별 성적 (경쟁력·입지 없음)`);
    console.log(`  ${"수요 측정 방식".padEnd(46)} MAPE     긴장도CV`);
    for (const [label, get] of variants) {
      const use: { r: Row; util1: number }[] = [];
      for (const r of rows) {
        const d = get(r);
        if (d == null) continue;
        const supply = r.pc + r.rivalIp;
        if (!(supply > 0)) continue;
        use.push({ r, util1: d / supply });
      }
      if (use.length < 30) continue;
      const logs = use.map((u) => Math.log(u.r.actual / (u.r.pc * MONTH_HOURS * u.util1 * u.r.rate / 0.5)));
      const A = Math.exp(mean(logs));
      const errs = use.map((u) => {
        const rev = u.r.pc * MONTH_HOURS * (A * u.util1) * u.r.rate / 0.5;
        return Math.abs(rev - u.r.actual) / u.r.actual;
      });
      console.log(`  ${label.padEnd(46)} ${(mean(errs) * 100).toFixed(2)}%   ${(cv(use.map((u) => u.util1)) * 100).toFixed(0)}%`);
    }
    expect(rows.length).toBeGreaterThan(30);
  });
});
