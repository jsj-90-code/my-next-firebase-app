// 유효상권 반경을 지점마다 스스로 정하게 한다 (2026-09-16). 일회성 분석용.
//
// 사용자 관찰(2026-09-16):
//   "교과서로 바꾼 후에 수원망포점 매출 높길래 봤더니 유동500 끝자락에 지하철이 있는데
//    여기 유동을 함께 먹어서 엄청 높아진 것 같다. 실제론 유효상권 아닌데."
//
// 실제로 그렇다. 망포점 12개월 평균 유동인구는
//   100m 1,945 → 200m 4,201 → 300m 11,608 → 400m 48,692 → 500m 96,401
// 로 300→400m에서 4.19배(+37,084명) 뛴다. 지하철 상권이 400m 안에 들어온 것이다.
//
// ── 어떻게 자동으로 가려내나 ─────────────────────────────────────────────
// 매장은 그 동네에서 사람이 가장 몰리는 자리에 연다. 그러면 **고리 밀도**(그 고리에서만의
// 명 ÷ 고리 면적)는 바깥으로 갈수록 떨어지는 게 정상이다. 바깥 고리가 안쪽보다 촘촘하면
// 원 밖에 더 큰 발생원(지하철·대형시설)이 있다는 뜻이고, 그건 우리 상권이 아니다.
//
// 그래서 **밀도가 다시 올라가기 직전까지**를 유효상권으로 잡는다. 반경을 고정하지 않고
// 지점마다 다르게 정해지며, 정상적인 지점은 그대로 500m가 나온다.
//
// 52곳 중 8곳이 바깥 고리가 100m 고리보다 촘촘하다(하안금당사거리·수원망포·광주각화 등).
//
// ⚠️ 이건 "유동을 더 정확히 재는" 방법이지 "적중률을 올리는" 방법이 아니다. 둘은 다르다.
//    2026-09-16 탐색에서 인구 기반 수요는 대당매출을 거의 설명하지 못한다는 게 확인됐다
//    (_textbookSweep.test.ts의 lambda 탐색). 그래도 수요를 정확히 재는 건 별개로 옳다 —
//    틀린 수요 위에 경쟁력·입지를 얹으면 그 둘도 같이 틀린 걸 배운다.
//
//   npx vitest run src/lib/storeEval/_effectiveTradeArea.test.ts --reporter=verbose
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { mergeModelSettings } from "./settings";
import type { Competitor } from "./types";

const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const ready = hasValidationSnapshot() && existsSync(FLOAT_FILE) && existsSync(RESI_FILE);
const describeIf = ready ? describe : describe.skip;

const RADII = [100, 200, 300, 400, 500] as const;
type Radius = (typeof RADII)[number];
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

/** 고리 밀도 — 그 고리에서만의 명 ÷ 고리 면적. 반경 누적값에서 되돌린다. */
export function ringDensities(byRadius: Partial<Record<Radius, number>>): Partial<Record<Radius, number>> {
  const out: Partial<Record<Radius, number>> = {};
  let prevVal = 0, prevArea = 0;
  for (const R of RADII) {
    const v = byRadius[R];
    if (v == null) continue;
    const area = Math.PI * R * R;
    out[R] = (v - prevVal) / (area - prevArea);
    prevVal = v;
    prevArea = area;
  }
  return out;
}

/**
 * 유효상권 반경 — 고리 밀도가 **다시 올라가기 직전**까지.
 *
 * tolerance는 "약간 올라간 것"까지는 봐주는 여유다. 측정 잡음으로 1~2%씩 흔들리는 걸
 * 경계로 잡으면 지점마다 반경이 들쭉날쭉해진다. 기본 1.15는 "15% 넘게 촘촘해지면 외부
 * 발생원으로 본다"는 뜻이다.
 */
export function effectiveRadius(byRadius: Partial<Record<Radius, number>>, tolerance = 1.15): Radius {
  const dens = ringDensities(byRadius);
  let best: Radius = RADII[0];
  let prev: number | null = null;
  for (const R of RADII) {
    const d = dens[R];
    if (d == null) continue;
    if (prev != null && d > prev * tolerance) break; // 여기서 외부 발생원이 들어왔다
    best = R;
    prev = d;
  }
  return best;
}

/**
 * 단조 포락선 — 바깥 고리를 **버리지 않고 과한 만큼만 깎는다.**
 *
 * 처음 만든 자르기 규칙(effectiveRadius)은 첫 상승에서 통째로 잘랐는데 너무 과격했다:
 * 광주각화점이 100m로 잘려 유동 545명만 남았고(60배 축소), 대당매출 상관도 0.203 → 0.142로
 * 나빠졌다. 신호까지 잘라낸 것이다.
 *
 * 대신 "매장에서 멀어질수록 밀도는 떨어진다"는 성질만 강제한다. 어떤 고리의 밀도가 직전
 * 고리보다 높으면 직전 값으로 눌러서 면적은 그대로 두고 초과분만 없앤다. 지하철이 들어온
 * 고리도 "그 자리에 원래 있었을 만큼"은 남는다.
 */
export function cappedFloating(byRadius: Partial<Record<Radius, number>>, maxRadius: Radius = 500): number | null {
  const dens = ringDensities(byRadius);
  let total = 0, prevArea = 0, prevDens: number | null = null;
  let any = false;
  for (const R of RADII) {
    if (R > maxRadius) break;
    const d = dens[R];
    if (d == null) continue;
    const area = Math.PI * R * R;
    const use = prevDens == null ? d : Math.min(d, prevDens);
    total += use * (area - prevArea);
    prevArea = area;
    prevDens = use;
    any = true;
  }
  return any ? Math.round(total) : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("유효상권 반경 — 지점마다 스스로 정하기", () => {
  const fl = JSON.parse(readFileSync(FLOAT_FILE, "utf8"));
  const re = JSON.parse(readFileSync(RESI_FILE, "utf8"));
  const floSites = fl.sites ?? fl;
  const resSites = re.sites ?? re;

  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);

  type Site = { key: string; name: string; flo: Partial<Record<Radius, number>>; res: Partial<Record<Radius, number>> };
  const sites: Site[] = [];
  for (const [key, v] of Object.entries<any>(floSites)) {
    const flo: Partial<Record<Radius, number>> = {};
    for (const R of RADII) {
      const r = v.radii?.[String(R)];
      if (r?.selected?.length) flo[R] = Math.round(mean(r.selected.slice(-12)));
    }
    const res: Partial<Record<Radius, number>> = {};
    const rv = resSites[key];
    for (const R of RADII) {
      const r = rv?.radii?.[String(R)];
      if (r?.totalPopulation != null) res[R] = Number(r.totalPopulation);
    }
    sites.push({ key, name: v.name ?? key, flo, res });
  }

  it("유효상권 반경 분포", () => {
    const counts = new Map<Radius, number>();
    const shrunk: { name: string; r: Radius; f500: number; fEff: number }[] = [];
    for (const s of sites) {
      if (Object.keys(s.flo).length < RADII.length) continue;
      const R = effectiveRadius(s.flo);
      counts.set(R, (counts.get(R) ?? 0) + 1);
      if (R < 500) shrunk.push({ name: s.name, r: R, f500: s.flo[500] as number, fEff: s.flo[R] as number });
    }
    console.log("\n유효상권 반경 분포");
    for (const R of RADII) console.log(`  ${String(R).padStart(4)}m : ${counts.get(R) ?? 0}곳`);

    shrunk.sort((a, b) => b.f500 / b.fEff - a.f500 / a.fEff);
    console.log("\n500m를 그대로 쓰면 과대평가되는 곳 (배수 큰 순)");
    console.log(`${"이름".padEnd(16)} 유효반경  유동500m    유효반경 유동   과대배수`);
    for (const s of shrunk.slice(0, 14)) {
      console.log(
        `${s.name.padEnd(16)} ${String(s.r).padStart(5)}m ${String(s.f500).padStart(9)} ${String(s.fEff).padStart(13)} ${(s.f500 / s.fEff).toFixed(2).padStart(9)}배`,
      );
    }
    expect(sites.length).toBeGreaterThan(40);
  });

  it("수원망포점 — 사용자가 짚은 사례", () => {
    const s = sites.find((x) => x.name.includes("망포"));
    expect(s).toBeTruthy();
    const site = s as Site;
    const dens = ringDensities(site.flo);
    console.log("\n[수원망포점] 반경별 유동인구와 고리 밀도");
    for (const R of RADII) {
      const d = dens[R];
      console.log(`  ${String(R).padStart(4)}m  누적 ${String(site.flo[R]).padStart(7)}  고리밀도 ${d == null ? "-" : d.toFixed(4)}`);
    }
    const R = effectiveRadius(site.flo);
    console.log(`  → 유효상권 ${R}m 로 판정. 500m 대비 유동인구 ${((site.flo[500] as number) / (site.flo[R] as number)).toFixed(1)}배 과대평가였다.`);
    expect(R).toBeLessThan(500);
  });

  it("주거인구는 같은 문제가 있나", () => {
    // 주거인구는 밤에 자는 사람이라 지하철 같은 점 발생원이 없다. 확인해 둔다 —
    // 없다면 주거는 반경을 넓게 써도 되고, 유동만 유효상권으로 자르면 된다.
    let shrunkCount = 0;
    const examples: string[] = [];
    for (const s of sites) {
      if (Object.keys(s.res).length < RADII.length) continue;
      const R = effectiveRadius(s.res);
      if (R < 500) {
        shrunkCount++;
        if (examples.length < 8) examples.push(`${s.name}(${R}m)`);
      }
    }
    console.log(`\n주거인구 기준 유효반경이 500m 미만인 곳: ${shrunkCount}곳`);
    if (examples.length) console.log(`  ${examples.join(", ")}`);
    console.log("  → 유동보다 적으면, 주거는 넓게 쓰고 유동만 잘라도 된다는 뜻이다.");
    expect(sites.length).toBeGreaterThan(40);
  });

  it("유효상권을 쓰면 실제매출과의 관계가 나아지는가", () => {
    // 상관이 채택 근거는 아니다. 다만 "더 정확히 쟀다"면 실제매출과의 관계가 나빠질 이유는
    // 없다 — 나빠지면 이 자르기가 신호까지 잘라낸 것이므로 다시 봐야 한다.
    const byCode = new Map(sites.map((s) => [s.key, s]));
    const xs500: number[] = [], xsEff: number[] = [], ys: number[] = [];
    for (const st of stores as any[]) {
      if (st.excludedFromModel || !st.actualMonthlyRevenueAvg) continue;
      const pc = st.evaluationPcCount ?? st.pcCount;
      if (!pc) continue;
      const s = byCode.get(`existing:${st.storeCode}`);
      if (!s || Object.keys(s.flo).length < RADII.length) continue;
      const R = effectiveRadius(s.flo);
      xs500.push(s.flo[500] as number);
      xsEff.push(s.flo[R] as number);
      ys.push(st.actualMonthlyRevenueAvg / pc);
    }
    const corr = (a: number[], b: number[]) => {
      const ma = mean(a), mb = mean(b);
      let sab = 0, saa = 0, sbb = 0;
      for (let i = 0; i < a.length; i++) {
        const da = a[i] - ma, db = b[i] - mb;
        sab += da * db; saa += da * da; sbb += db * db;
      }
      return sab / Math.sqrt(saa * sbb);
    };
    const n = ys.length;
    console.log(`\n대당매출과의 상관 (n=${n}, 유의선 ${(2 / Math.sqrt(n)).toFixed(3)})`);
    console.log(`  유동 500m 고정   r = ${corr(xs500, ys).toFixed(3)}`);
    console.log(`  유동 유효상권    r = ${corr(xsEff, ys).toFixed(3)}`);
    expect(n).toBeGreaterThan(30);
  });

  it("단조 포락선 — 버리지 않고 깎는 방식", () => {
    const byCode = new Map(sites.map((s) => [s.key, s]));
    const cols: Record<string, number[]> = { "500m 고정": [], "포락선 500m": [], "포락선 400m": [], "포락선 300m": [], "300m 고정": [] };
    const ys: number[] = [];
    for (const st of stores as any[]) {
      if (st.excludedFromModel || !st.actualMonthlyRevenueAvg) continue;
      const pc = st.evaluationPcCount ?? st.pcCount;
      if (!pc) continue;
      const s = byCode.get(`existing:${st.storeCode}`);
      if (!s || Object.keys(s.flo).length < RADII.length) continue;
      cols["500m 고정"].push(s.flo[500] as number);
      cols["300m 고정"].push(s.flo[300] as number);
      cols["포락선 500m"].push(cappedFloating(s.flo, 500) as number);
      cols["포락선 400m"].push(cappedFloating(s.flo, 400) as number);
      cols["포락선 300m"].push(cappedFloating(s.flo, 300) as number);
      ys.push(st.actualMonthlyRevenueAvg / pc);
    }
    const corr = (a: number[], b: number[]) => {
      const ma = mean(a), mb = mean(b);
      let sab = 0, saa = 0, sbb = 0;
      for (let i = 0; i < a.length; i++) {
        const da = a[i] - ma, db = b[i] - mb;
        sab += da * db; saa += da * da; sbb += db * db;
      }
      return sab / Math.sqrt(saa * sbb);
    };
    console.log(`\n대당매출과의 상관 (n=${ys.length}, 유의선 ${(2 / Math.sqrt(ys.length)).toFixed(3)})`);
    for (const [label, xs] of Object.entries(cols)) {
      console.log(`  ${label.padEnd(12)} r = ${corr(xs, ys).toFixed(3)}`);
    }

    const s = sites.find((x) => x.name.includes("망포")) as Site;
    console.log(`\n[수원망포점] 500m 고정 ${s.flo[500]} → 포락선 ${cappedFloating(s.flo, 500)}`);
    const g = sites.find((x) => x.name.includes("각화")) as Site;
    console.log(`[광주각화점] 500m 고정 ${g.flo[500]} → 포락선 ${cappedFloating(g.flo, 500)}`);
    const p = sites.find((x) => x.name.includes("평내호평")) as Site;
    console.log(`[평내호평점] 500m 고정 ${p.flo[500]} → 포락선 ${cappedFloating(p.flo, 500)}  (정상형이라 거의 안 깎여야 한다)`);
    expect(ys.length).toBeGreaterThan(30);
  });
});
