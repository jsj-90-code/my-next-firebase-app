// 독점매장만으로 수요식을 판정한다 (2026-09-16). 일회성 분석용.
//
// 사용자 판정 기준(2026-09-16):
//   "독점매장은 수요를 점유하는 개념이 없으니까 경쟁력환산이나 입지가 큰 의미 없을 테고,
//    현재 수요 산식을 대입했을 때 **모든 독점매장이 오차율 5% 내외로 맞춰지는 게 최선**이라고 본다."
//
// 옳은 기준이다. 독점상권은 점유율이 1이라 가동률 = A x 수요 ÷ 자사PC가 되고, 경쟁 항도
// 경쟁력격차도 약분된다. **수요식만 발가벗겨진다.** 여기서 안 맞으면 수요가 틀린 것이고,
// 경쟁력·입지로 덮을 수도 없다.
//
// ⚠️ 이건 **필요조건이지 충분조건이 아니다.** 독점 3곳에 맞는 수요식은 무수히 많다 —
//    자유도 2개짜리 표본이기 때문이다. "5% 안에 든다"는 후보를 거르는 체이지, 맞다는 증명이 아니다.
//    그래서 이 파일은 (1) 5% 안에 드는 수요식이 있는지, (2) 그게 나머지 29곳에서도 버티는지를
//    같이 낸다. 독점에서만 맞고 나머지가 무너지면 그건 3곳에 과적합한 것이다.
//
//   npx vitest run src/lib/storeEval/_monopolyFit.test.ts --reporter=verbose
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";

const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const UTIL_FILE = ".local-tools/geto-utilization.json";
const ready = hasValidationSnapshot() && existsSync(FLOAT_FILE) && existsSync(RESI_FILE) && existsSync(UTIL_FILE);
const describeIf = ready ? describe : describe.skip;

const RING = [100, 200, 300, 400, 500] as const;
const RESI_RADII = [100, 200, 300, 400, 500, 1000] as const;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

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
describeIf("독점매장으로 수요식 판정", () => {
  const snap = loadValidationSnapshot<any>();
  const fl = JSON.parse(readFileSync(FLOAT_FILE, "utf8"));
  const re = JSON.parse(readFileSync(RESI_FILE, "utf8"));
  const util = JSON.parse(readFileSync(UTIL_FILE, "utf8"));
  const floSites = fl.sites ?? fl;
  const resSites = re.sites ?? re;

  const rivalIp = new Map<string, number>();
  for (const c of snap.competitors as any[]) {
    const v = Number(c.appliedPcCount ?? c.totalPcCount ?? 0);
    rivalIp.set(c.candidateCode, (rivalIp.get(c.candidateCode) ?? 0) + v);
  }

  type Row = {
    name: string; pc: number; rival: number; gap: number; util: number;
    res: Record<number, number>;
    resYoung: Record<number, number>;   // 10~30대 주거인구 (age_2+age_3+age_4)
    flo: Record<number, number>;
    floEnv: number | null;
    floYoung: Record<number, number>;   // 10~30대 유동인구
  };
  const rows: Row[] = [];
  for (const st of snap.existingStores as any[]) {
    const pc = st.evaluationPcCount ?? st.pcCount;
    if (!pc) continue;
    const u = util[st.storeName];
    if (!u?.rows?.length) continue;
    const key = `existing:${st.storeCode}`;
    const fv = floSites[key], rv = resSites[key];
    if (!fv || !rv) continue;

    const res: Record<number, number> = {};
    const resYoung: Record<number, number> = {};
    for (const R of RESI_RADII) {
      const r = rv.radii?.[String(R)];
      if (r?.totalPopulation != null) res[R] = Number(r.totalPopulation);
      const p = r?.pops;
      if (p?.age_2_cnt != null) resYoung[R] = Number(p.age_2_cnt) + Number(p.age_3_cnt) + Number(p.age_4_cnt);
    }
    const flo: Record<number, number> = {};
    const floYoung: Record<number, number> = {};
    for (const R of RING) {
      const r = fv.radii?.[String(R)];
      if (!r?.selected?.length) continue;
      const avg = Math.round(mean(r.selected.slice(-12)));
      flo[R] = avg;
      const d = r.demographics;
      if (d) {
        const recent = r.selected[r.selected.length - 1];
        const scale = recent > 0 ? avg / recent : 1;
        floYoung[R] = Math.round(((d.age10s ?? 0) + (d.age20s ?? 0) + (d.age30s ?? 0)) * scale);
      }
    }
    if (res[1000] == null || Object.keys(flo).length < RING.length) continue;
    rows.push({
      name: st.storeName, pc, rival: rivalIp.get(st.storeCode) ?? 0,
      gap: st.competitivenessGap ?? 1,
      util: mean(u.rows.map((r: any) => r.monthlyRate)),
      res, resYoung, flo, floEnv: envelope(flo), floYoung,
    });
  }

  const mono = rows.filter((r) => r.rival === 0);
  const rest = rows.filter((r) => r.rival > 0);

  /** 수요식 후보 — 이름과 계산식. 전부 "명" 단위라 계수가 해석 가능하다. */
  type Cand = { label: string; f: (r: Row) => number | null };
  const cands: Cand[] = [];
  for (const R of RESI_RADII) {
    cands.push({ label: `주거${R}m`, f: (r) => r.res[R] ?? null });
    cands.push({ label: `주거${R}m 10~30대`, f: (r) => r.resYoung[R] ?? null });
  }
  for (const R of RING) {
    cands.push({ label: `유동${R}m`, f: (r) => r.flo[R] ?? null });
    cands.push({ label: `유동${R}m 10~30대`, f: (r) => r.floYoung[R] ?? null });
  }
  cands.push({ label: "유동 포락선", f: (r) => r.floEnv });
  for (const RR of [300, 500, 1000] as const) {
    for (const FR of [200, 300, 400, "env"] as const) {
      for (const a of [0.1, 0.2, 0.3, 0.5, 0.75, 1.0]) {
        const flow = (r: Row) => (FR === "env" ? r.floEnv : r.flo[FR] ?? null);
        cands.push({
          label: `주거${RR}m + 유동${FR} x${a}`,
          f: (r) => { const p = r.res[RR], q = flow(r); return p == null || q == null ? null : p + q * a; },
        });
        cands.push({
          label: `주거${RR}m10~30 + 유동${FR}10~30 x${a}`,
          f: (r) => {
            const p = r.resYoung[RR], q = FR === "env" ? null : r.floYoung[FR];
            return p == null || q == null ? null : p + q * a;
          },
        });
      }
    }
  }

  /** 독점매장에서 A를 정하고, 각 독점매장의 오차와 최대오차를 낸다. */
  function monoFit(c: Cand) {
    const items = mono.map((r) => ({ r, d: c.f(r) })).filter((x): x is { r: Row; d: number } => x.d != null && x.d > 0);
    if (items.length < mono.length) return null;
    const As = items.map((x) => x.r.util / (x.d / x.r.pc));
    const A = median(As);
    const errs = items.map((x) => Math.abs(A * (x.d / x.r.pc) - x.r.util) / x.r.util);
    return { A, errs, maxErr: Math.max(...errs), items };
  }

  /** 같은 A와 수요식으로 나머지(경쟁 있는 곳)를 gamma=4로 평가한다 — 3곳 과적합 여부를 본다. */
  function restScore(c: Cand, A: number, gamma = 4) {
    const errs: number[] = [];
    for (const r of rest) {
      const d = c.f(r);
      if (d == null || !(d > 0)) continue;
      const g = Math.pow(r.gap, gamma);
      const pred = A * (d * g) / (r.pc * g + r.rival);
      errs.push(Math.abs(pred - r.util) / r.util);
    }
    return errs.length ? { mape: mean(errs), n: errs.length } : null;
  }

  it("표본", () => {
    console.log(`\n독점매장 ${mono.length}곳: ${mono.map((r) => `${r.name}(PC ${r.pc}, 가동률 ${(r.util * 100).toFixed(1)}%)`).join(" · ")}`);
    console.log(`경쟁 있는 매장 ${rest.length}곳 · 수요식 후보 ${cands.length}개`);
    expect(mono.length).toBeGreaterThan(2);
  });

  it("독점 3곳을 5% 안에 맞추는 수요식이 있는가", () => {
    const out: { label: string; maxErr: number; A: number; per: number; restMape: number | null }[] = [];
    for (const c of cands) {
      const f = monoFit(c);
      if (!f) continue;
      const rs = restScore(c, f.A);
      out.push({ label: c.label, maxErr: f.maxErr, A: f.A, per: 1 / f.A, restMape: rs?.mape ?? null });
    }
    out.sort((a, b) => a.maxErr - b.maxErr);
    const under5 = out.filter((o) => o.maxErr <= 0.05);
    console.log(`\n후보 ${out.length}개 중 독점 최대오차 5% 이내: ${under5.length}개`);
    console.log(`\n${"수요식".padEnd(34)} ${"독점 최대오차".padStart(12)} ${"PC1대당 인구".padStart(12)} ${"나머지 MAPE".padStart(12)}`);
    for (const o of out.slice(0, 15)) {
      console.log(`${o.label.padEnd(34)} ${(o.maxErr * 100).toFixed(1).padStart(11)}% ${Math.round(o.per).toLocaleString().padStart(11)}명 ${o.restMape == null ? "-".padStart(12) : `${(o.restMape * 100).toFixed(1)}%`.padStart(12)}`);
    }
    console.log(`\n(참고) 지금 초안 "주거1000m + 유동env x0.3"의 자리:`);
    const cur = out.find((o) => o.label === "주거1000m + 유동env x0.3");
    if (cur) console.log(`  독점 최대오차 ${(cur.maxErr * 100).toFixed(1)}% · 나머지 MAPE ${cur.restMape == null ? "-" : (cur.restMape * 100).toFixed(1) + "%"} · 순위 ${out.indexOf(cur) + 1}위`);
    expect(out.length).toBeGreaterThan(0);
  });

  it("독점에 잘 맞는 수요식이 나머지에서도 버티는가", () => {
    // 독점 3곳에만 맞추면 과적합이다. 독점 오차와 나머지 MAPE가 같이 좋은 게 있는지 본다.
    const out: { label: string; maxErr: number; restMape: number }[] = [];
    for (const c of cands) {
      const f = monoFit(c);
      if (!f) continue;
      const rs = restScore(c, f.A);
      if (!rs) continue;
      out.push({ label: c.label, maxErr: f.maxErr, restMape: rs.mape });
    }
    const good = out.filter((o) => o.maxErr <= 0.05).sort((a, b) => a.restMape - b.restMape);
    console.log(`\n독점 5% 이내이면서 나머지도 좋은 순 (n=${good.length})`);
    for (const o of good.slice(0, 10)) {
      console.log(`  독점 ${(o.maxErr * 100).toFixed(1).padStart(4)}%  나머지 ${(o.restMape * 100).toFixed(1).padStart(5)}%   ${o.label}`);
    }
    if (!good.length) console.log("  없음 — 5% 기준을 통과하는 수요식이 아예 없다.");
    // 독점 오차와 나머지 MAPE가 서로 무관하면, 독점 적합은 나머지를 전혀 보장하지 않는다는 뜻이다.
    const xs = out.map((o) => o.maxErr), ys = out.map((o) => o.restMape);
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    console.log(`\n독점 최대오차 vs 나머지 MAPE 상관 r = ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)} (후보 ${out.length}개)`);
    console.log(`  0에 가까우면 "독점에서 잘 맞는다고 전체가 잘 맞는 건 아니다"는 뜻이다.`);
    expect(out.length).toBeGreaterThan(0);
  });
});
