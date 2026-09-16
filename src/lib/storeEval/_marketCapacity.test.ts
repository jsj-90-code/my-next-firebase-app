// 1단계: 수요(인구) -> 상권이 감당하는 총 PC 대수 (2026-09-16). 일회성 분석용.
//
// 사용자 방향(2026-09-16): "1단계 먼저 해보자고."
//
// ── 왜 수요의 역할을 바꾸나 ──────────────────────────────────────────────
// 2026-09-16 하루 종일 인구로 매출·가동률을 설명하려다 전부 실패했다. 반경 100~1000m의
// 주거·유동, 가구·주택·소득·소비·직장인구, 지역 PC방 실매출까지 훑었는데 유동300m와 가동률이
// r=0.021, 수요÷총IP와 가동률이 r=0.018이다. 사실상 0이다.
//
// 그런데 같은 인구가 **상권 총IP(자사PC + 경쟁IP)**와는 r=0.692로 붙는다. 뜻이 분명하다 —
// 사람 많은 동네엔 PC방이 많이 생기고, 그래서 한 집당 돌아오는 몫은 결국 비슷해진다.
// 인구는 "우리가 얼마 버나"가 아니라 "이 동네가 PC 몇 대를 먹여 살리나"를 말한다.
//
// 이 파일은 그 관계를 산식으로 세운다. 결과 계수는 **"주민 N명당 PC 1대"**로 읽힌다 —
// 값이 이상하면 현장 감각으로 바로 잡아낼 수 있는 형태다(2026-09-16 사용자와 합의한 기준).
//
// ⚠️ 이건 매출 산식이 아니다. 3단계(가동률)가 매출을 정하고, 그 주 설명변수는 입지다.
//    입지평가는 재설계 대기 중이라(docs/backlog.md 2026-09-16) 3단계는 아직 못 세운다.
//
//   npx vitest run src/lib/storeEval/_marketCapacity.test.ts --reporter=verbose
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";

const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const ready = hasValidationSnapshot() && existsSync(FLOAT_FILE) && existsSync(RESI_FILE);
const describeIf = ready ? describe : describe.skip;

const RING = [100, 200, 300, 400, 500] as const;
const RESI_RADII = [100, 200, 300, 400, 500, 1000] as const;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const cv = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) / m;
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

/** 고리 밀도를 단조로 눌러 외부 발생원(지하철 등)의 초과분만 걷어낸다. */
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
describeIf("1단계 — 인구가 정하는 상권 총 PC 대수", () => {
  const snap = loadValidationSnapshot<any>();
  const fl = JSON.parse(readFileSync(FLOAT_FILE, "utf8"));
  const re = JSON.parse(readFileSync(RESI_FILE, "utf8"));
  const floSites = fl.sites ?? fl;
  const resSites = re.sites ?? re;

  // 경쟁IP — 문서의 appliedPcCount(미조사 보정이 반영된 적용값)를 쓴다.
  // ⚠️ pcCount 필드는 전 문서가 0이다(2026-09-16에 이걸로 한 번 틀렸다). totalPcCount는 실측,
  //    appliedPcCount는 산식이 실제로 쓰는 값이다.
  const rivalIp = new Map<string, number>();
  const rivalCount = new Map<string, number>();
  for (const c of snap.competitors as any[]) {
    const v = Number(c.appliedPcCount ?? c.totalPcCount ?? 0);
    rivalIp.set(c.candidateCode, (rivalIp.get(c.candidateCode) ?? 0) + v);
    if (c.investigationStatus !== "경쟁점없음") {
      rivalCount.set(c.candidateCode, (rivalCount.get(c.candidateCode) ?? 0) + 1);
    }
  }

  type Row = {
    name: string; pc: number; rival: number; totalIp: number; nRivals: number;
    flo: Record<number, number>; floEnv: number | null; res: Record<number, number>;
  };
  const rows: Row[] = [];
  for (const st of snap.existingStores as any[]) {
    const pc = st.evaluationPcCount ?? st.pcCount;
    if (!pc) continue;
    const key = `existing:${st.storeCode}`;
    const fv = floSites[key], rv = resSites[key];
    if (!fv || !rv) continue;
    const flo: Record<number, number> = {};
    for (const R of RING) {
      const r = fv.radii?.[String(R)];
      if (r?.selected?.length) flo[R] = Math.round(mean(r.selected.slice(-12)));
    }
    const res: Record<number, number> = {};
    for (const R of RESI_RADII) {
      const r = rv.radii?.[String(R)];
      if (r?.totalPopulation != null) res[R] = Number(r.totalPopulation);
    }
    if (Object.keys(flo).length < RING.length || res[1000] == null) continue;
    const rival = rivalIp.get(st.storeCode) ?? 0;
    rows.push({
      name: st.storeName, pc, rival, totalIp: pc + rival,
      nRivals: rivalCount.get(st.storeCode) ?? 0,
      flo, floEnv: envelope(flo), res,
    });
  }

  it("표본과 기본 통계", () => {
    console.log(`\n표본 ${rows.length}곳`);
    console.log(`  자사PC     중앙 ${median(rows.map((r) => r.pc))}대 · 변동계수 ${(cv(rows.map((r) => r.pc)) * 100).toFixed(0)}%`);
    console.log(`  경쟁IP     중앙 ${median(rows.map((r) => r.rival))}대 · 변동계수 ${(cv(rows.map((r) => r.rival)) * 100).toFixed(0)}%`);
    console.log(`  상권 총IP  중앙 ${median(rows.map((r) => r.totalIp))}대 · 변동계수 ${(cv(rows.map((r) => r.totalIp)) * 100).toFixed(0)}%`);
    console.log(`  경쟁점 수  중앙 ${median(rows.map((r) => r.nRivals))}곳 · 최대 ${Math.max(...rows.map((r) => r.nRivals))}곳`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("어떤 수요가 총IP를 가장 잘 설명하나", () => {
    const n = rows.length;
    const sig = 2 / Math.sqrt(n);
    const ys = rows.map((r) => r.totalIp);
    const cands: [string, (r: Row) => number | null][] = [];
    for (const R of RESI_RADII) cands.push([`주거${R}m`, (r) => r.res[R] ?? null]);
    for (const R of RING) cands.push([`유동${R}m`, (r) => r.flo[R] ?? null]);
    cands.push(["유동 포락선", (r) => r.floEnv]);
    for (const a of [0.1, 0.2, 0.3, 0.5, 1.0]) {
      cands.push([`주거1km + 유동300 x${a}`, (r) => (r.res[1000] ?? 0) + (r.flo[300] ?? 0) * a]);
      cands.push([`주거1km + 포락선 x${a}`, (r) => (r.res[1000] ?? 0) + (r.floEnv ?? 0) * a]);
    }

    const out: { label: string; r: number; mape: number; per: number }[] = [];
    for (const [label, get] of cands) {
      const xs: number[] = [], yy: number[] = [];
      for (const r of rows) {
        const v = get(r);
        if (v == null || !(v > 0)) continue;
        xs.push(v); yy.push(r.totalIp);
      }
      if (yy.length < 25) continue;
      // 계수는 로그 공간 평균으로 맞춘다 — 큰 상권이 계수를 독식하지 않게.
      const k = Math.exp(mean(yy.map((y, i) => Math.log(y / xs[i]))));
      const mape = mean(yy.map((y, i) => Math.abs(k * xs[i] - y) / y));
      out.push({ label, r: pearson(xs, yy), mape, per: 1 / k });
    }
    out.sort((a, b) => a.mape - b.mape);
    console.log(`\n수요 -> 상권 총IP (n=${rows.length}, 유의선 ${sig.toFixed(3)})`);
    console.log(`${"수요 측정".padEnd(24)} ${"상관 r".padStart(8)} ${"MAPE".padStart(8)}   PC 1대당 인구`);
    for (const o of out.slice(0, 12)) {
      console.log(`${o.label.padEnd(24)} ${o.r.toFixed(3).padStart(8)}${Math.abs(o.r) > sig ? "*" : " "} ${(o.mape * 100).toFixed(1).padStart(7)}%   ${Math.round(o.per).toLocaleString()}명`);
    }
    expect(out.length).toBeGreaterThan(0);
  });

  it("독점매장에서는 어떻게 나오나", () => {
    // 독점상권은 총IP = 우리 PC뿐이다. 그래서 "이 동네가 감당하는 대수"를 우리가 혼자 채우고
    // 있는 셈이다. 산식이 그보다 훨씬 큰 값을 내면 "더 넣어도 된다"고 말하는 것이고,
    // 실제 가동률이 중간(29~35%)인 걸 보면 그건 과한 주장이다.
    const mono = rows.filter((r) => r.rival === 0);
    const rest = rows.filter((r) => r.rival > 0);
    const demand = (r: Row) => (r.res[1000] ?? 0) + (r.floEnv ?? 0) * 0.3;
    const k = Math.exp(mean(rows.map((r) => Math.log(r.totalIp / demand(r)))));
    console.log(`\n전체 계수: PC 1대당 인구 ${Math.round(1 / k).toLocaleString()}명`);
    console.log(`\n독점매장 ${mono.length}곳 — 예측 총IP vs 실제(=자사PC)`);
    for (const r of mono) {
      const pred = k * demand(r);
      console.log(`  ${r.name.padEnd(14)} 수요 ${Math.round(demand(r)).toLocaleString().padStart(9)}  예측 ${pred.toFixed(0).padStart(4)}대  실제 ${String(r.totalIp).padStart(4)}대  (${(pred / r.totalIp).toFixed(2)}배)`);
    }
    const monoRatio = mean(mono.map((r) => (k * demand(r)) / r.totalIp));
    const restRatio = mean(rest.map((r) => (k * demand(r)) / r.totalIp));
    console.log(`\n  독점매장 평균 ${monoRatio.toFixed(2)}배 · 경쟁 있는 곳 평균 ${restRatio.toFixed(2)}배`);
    console.log(`  1.0보다 크면 "이 동네는 더 들어올 수 있다", 작으면 "이미 포화"라는 뜻이다.`);
    expect(mono.length).toBeGreaterThan(0);
  });

  it("포화도가 실제 경쟁 진입과 맞는가", () => {
    // 산식이 "아직 여유 있다"고 한 상권에 실제로 경쟁점이 더 많이 있는지 본다.
    // 맞다면 이 산식은 시장 규모를 제대로 읽는 것이다.
    const demand = (r: Row) => (r.res[1000] ?? 0) + (r.floEnv ?? 0) * 0.3;
    const k = Math.exp(mean(rows.map((r) => Math.log(r.totalIp / demand(r)))));
    const slack = rows.map((r) => (k * demand(r)) / r.totalIp);
    const n = rows.length;
    const sig = 2 / Math.sqrt(n);
    console.log(`\n예측/실제 비(여유도) vs 실제 경쟁 (n=${n}, 유의선 ${sig.toFixed(3)})`);
    console.log(`  여유도 vs 경쟁점 수   r = ${pearson(slack, rows.map((r) => r.nRivals)).toFixed(3)}`);
    console.log(`  여유도 vs 경쟁IP      r = ${pearson(slack, rows.map((r) => r.rival)).toFixed(3)}`);
    console.log(`  여유도 vs 자사PC      r = ${pearson(slack, rows.map((r) => r.pc)).toFixed(3)}`);
    console.log(`  여유도 분포: ${Math.min(...slack).toFixed(2)} ~ ${Math.max(...slack).toFixed(2)} (중앙 ${median(slack).toFixed(2)})`);
    expect(rows.length).toBeGreaterThan(30);
  });
});
