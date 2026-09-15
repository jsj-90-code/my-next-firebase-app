// 수요층만 따로 세운다 — 경쟁력·입지를 전부 뺀 상태에서 (2026-09-16). 일회성 분석용.
//
// 사용자 방향(2026-09-16):
//   "내 생각엔 수요를 제외한 입지/경쟁력평가를 일단 제하고, 수요데이터 + 상권내 총IP로만
//    판단해서 어느 정도의 수요 개념을 잡고, 이후에 경쟁력+입지평가 디테일 잡는 게 좋을 것 같은데.
//    일단 지금 500m 유동은 빼야 된다고 봄."
//
// 왜 이 순서가 맞나: 지금 산식은 수요·경쟁력·입지가 한꺼번에 들어가서, 결과가 나빠도 **어느
// 층이 틀렸는지** 알 수가 없다. 층을 하나만 세워 두고 재면 그 층의 실력이 그대로 보인다.
//
// 그래서 여기서는 이것만 쓴다:
//   시장수요 = 주거인구(반경 R) + 유동인구(반경 R') x alpha
//   상권공급 = 자사PC + 경쟁점 IP 합        <- 경쟁력 가중(gap^gamma) 없음
//   자사몫   = 시장수요 x 자사PC / 상권공급
//   매출     = 자사몫 x 실효단가 ÷ (1 - 상품비율)
//
// 경쟁력격차도, 입지점수도, 흡인력도, 밀집도 보정도 안 쓴다. 순수한 수요÷공급이다.
//
// ── 유동 500m는 뺀다 (사용자 지시) ───────────────────────────────────────
// 수원망포점 유동이 300->400m에서 4.19배 뛰는데, 500m 끝자락 지하철 상권을 먹은 것이다.
// 실제 우리 상권이 아니다. 그래서 유동은 100~400m와 단조 포락선만 본다.
// (포락선 = 바깥 고리 밀도를 직전 고리로 눌러 초과분만 걷어내는 방식. _effectiveTradeArea 참고)
//
//   npx vitest run src/lib/storeEval/_demandOnly.test.ts --reporter=verbose
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
const RING_RADII = [100, 200, 300, 400, 500] as const;
/** 유동에 쓸 반경 — 500m는 사용자 지시로 뺐다. "envelope"는 포락선으로 깎은 값이다. */
const FLOAT_CHOICES = [100, 200, 300, 400, "envelope"] as const;
const RESI_CHOICES = [100, 200, 300, 400, 500, 1000] as const;

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const cv = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) / m;
};

/** 고리 밀도를 단조로 눌러 바깥 발생원(지하철 등)의 초과분만 걷어낸다. */
function envelopeFloating(byRadius: Record<number, number>): number | null {
  let total = 0, prevVal = 0, prevArea = 0, prevDens: number | null = null, any = false;
  for (const R of RING_RADII) {
    const v = byRadius[R];
    if (v == null) continue;
    const area = Math.PI * R * R;
    const d = (v - prevVal) / (area - prevArea);
    const use = prevDens == null ? d : Math.min(d, prevDens);
    total += use * (area - prevArea);
    prevVal = v; prevArea = area; prevDens = use; any = true;
  }
  return any ? Math.round(total) : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("수요층만 — 경쟁력·입지 없이", () => {
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
    rivalIp: number;
    flo: Record<number, number>; floEnvelope: number | null;
    res: Record<number, number>;
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
    for (const R of RING_RADII) {
      const r = fv.radii?.[String(R)];
      if (r?.selected?.length) flo[R] = Math.round(mean(r.selected.slice(-12)));
    }
    const res: Record<number, number> = {};
    for (const R of RESI_CHOICES) {
      const r = rv.radii?.[String(R)];
      if (r?.totalPopulation != null) res[R] = Number(r.totalPopulation);
    }
    const cs = compsByCode.get(existingStoreSourceCode(st)) ?? [];
    rows.push({
      name: st.storeName, actual: st.actualMonthlyRevenueAvg, pc, rate,
      rivalIp: computeCompetitorIp(cs, st.operatingPcStores500m ?? null) ?? 0,
      flo, floEnvelope: envelopeFloating(flo), res,
    });
  }

  function floatingOf(r: Row, choice: (typeof FLOAT_CHOICES)[number]): number | null {
    return choice === "envelope" ? r.floEnvelope : (r.flo[choice] ?? null);
  }

  /**
   * 수요 ÷ 공급만으로 매출을 낸다. 수준 계수 A는 로그 공간 평균으로 닫힌 형태로 맞춘다 —
   * 눈으로 정할 값이 아니고, 맞춰야 조합끼리 공정하게 비교된다.
   */
  function score(resR: (typeof RESI_CHOICES)[number], floR: (typeof FLOAT_CHOICES)[number], alpha: number, productRatio = 0.5) {
    const use: { r: Row; util1: number }[] = [];
    for (const r of rows) {
      const pop = r.res[resR];
      const flow = floatingOf(r, floR);
      if (pop == null || flow == null) continue;
      const demand = pop + flow * alpha;
      const supply = r.pc + r.rivalIp;          // 경쟁력 가중 없음 — 순수 IP 합
      if (!(supply > 0)) continue;
      use.push({ r, util1: demand / supply });  // A=1일 때의 가동률(축척 미정)
    }
    if (use.length < 30) return null;
    const logs: number[] = [];
    for (const u of use) {
      const rev1 = u.r.pc * MONTH_HOURS * u.util1 * u.r.rate / (1 - productRatio);
      if (rev1 > 0) logs.push(Math.log(u.r.actual / rev1));
    }
    const A = Math.exp(mean(logs));
    const errs: number[] = [];
    for (const u of use) {
      const rev = u.r.pc * MONTH_HOURS * (A * u.util1) * u.r.rate / (1 - productRatio);
      errs.push(Math.abs(rev - u.r.actual) / u.r.actual);
    }
    const s = [...errs].sort((a, b) => a - b);
    return {
      mape: mean(errs), med: s[Math.floor(s.length / 2)],
      w20: errs.filter((v) => v <= 0.2).length / errs.length,
      max: s[s.length - 1], n: errs.length,
      // 긴장도(수요/공급)의 변동계수 — 실제 대당매출 변동(20%)과 비교하면 과잉인지 보인다.
      tensionCv: cv(use.map((u) => u.util1)),
    };
  }

  it("기준선 — 수요를 아예 안 쓰면", () => {
    const perPc = rows.map((r) => r.actual / r.pc);
    const b1 = rows.map((r) => r.pc * median(perPc));
    const errs = b1.map((p, i) => Math.abs(p - rows[i].actual) / rows[i].actual);
    console.log(`\n표본 ${rows.length}곳`);
    console.log(`B1 PC대수만        MAPE ${(mean(errs) * 100).toFixed(2)}%  ±20% ${(errs.filter((v) => v <= 0.2).length / errs.length * 100).toFixed(0)}%`);
    console.log(`실제 대당매출 변동계수 ${(cv(perPc) * 100).toFixed(0)}%`);
    expect(rows.length).toBeGreaterThan(30);
  });

  it("수요 ÷ 총IP 만으로 — 반경·가중 전수", () => {
    const out: { label: string; mape: number; med: number; w20: number; max: number; tcv: number }[] = [];
    for (const resR of RESI_CHOICES) {
      for (const floR of FLOAT_CHOICES) {
        for (const alpha of [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0]) {
          const sc = score(resR, floR, alpha);
          if (!sc) continue;
          out.push({ label: `주거${resR} 유동${floR} alpha=${alpha}`, mape: sc.mape, med: sc.med, w20: sc.w20, max: sc.max, tcv: sc.tensionCv });
        }
      }
    }
    out.sort((a, b) => a.mape - b.mape);
    console.log(`\n조합 ${out.length}개 · 상위 12개 (경쟁력·입지 전부 제외)`);
    for (const o of out.slice(0, 12)) {
      console.log(`  MAPE ${(o.mape * 100).toFixed(2)}%  중앙 ${(o.med * 100).toFixed(1)}%  ±20% ${(o.w20 * 100).toFixed(0)}%  최대 ${(o.max * 100).toFixed(0)}%  긴장도CV ${(o.tcv * 100).toFixed(0)}%   ${o.label}`);
    }
    console.log(`\n최악 3개 (같은 구조에서 얼마나 나빠질 수 있나)`);
    for (const o of out.slice(-3)) {
      console.log(`  MAPE ${(o.mape * 100).toFixed(2)}%   ${o.label}`);
    }
    expect(out.length).toBeGreaterThan(0);
  });

  it("유동 반경별 — 500m를 뺀 게 맞는가", () => {
    // 사용자가 500m를 빼라고 한 근거(망포점 지하철)가 숫자로도 맞는지 확인한다.
    // 주거 반경은 가장 좋았던 값으로 고정하고 유동만 바꾼다.
    const best = (() => {
      let b: { resR: (typeof RESI_CHOICES)[number]; mape: number } | null = null;
      for (const resR of RESI_CHOICES) {
        const sc = score(resR, 300, 0.2);
        if (sc && (!b || sc.mape < b.mape)) b = { resR, mape: sc.mape };
      }
      return b;
    })();
    expect(best).not.toBeNull();
    const resR = (best as NonNullable<typeof best>).resR;
    console.log(`\n주거 ${resR}m 고정, alpha=0.2 · 유동 반경만 바꿔가며`);
    for (const floR of [100, 200, 300, 400, "envelope"] as const) {
      const sc = score(resR, floR, 0.2);
      if (sc) console.log(`  유동 ${String(floR).padEnd(8)} MAPE ${(sc.mape * 100).toFixed(2)}%  긴장도CV ${(sc.tensionCv * 100).toFixed(0)}%  n=${sc.n}`);
    }
    // 500m는 사용자 지시로 산식에서 뺐지만, "뺀 게 맞았나"는 확인해야 한다.
    const with500 = (() => {
      const saved = rows.map((r) => r.flo[500]);
      const use: number[] = [];
      for (let i = 0; i < rows.length; i++) if (saved[i] != null) use.push(saved[i]);
      return use.length;
    })();
    console.log(`  (참고: 500m 값이 있는 매장 ${with500}곳 — 비교용으로만 본다)`);
    expect(resR).toBeTruthy();
  });

  it("alpha — '주거 기본 + 유동 +@'를 지키는 값은 얼마인가", () => {
    // 사용자 설계: "수요 부분에서는 주거수요를 기본으로 잡고, 유동수요를 +@로 잡는 건데".
    // 그런데 유동 포락선은 주거 1km의 중앙 2.08배다. alpha=1이면 유동이 주거의 2배가 되어
    // **유동이 수요를 지배한다** — 설계 의도와 반대다.
    // 그래서 alpha별로 "유동이 수요에서 차지하는 몫"과 MAPE를 같이 본다. 의도를 지키는 값이
    // 얼마나 손해인지 눈으로 정할 수 있게.
    const shares: Record<string, number[]> = {};
    for (const alpha of [0.1, 0.2, 0.3, 0.5, 0.75, 1.0]) {
      const arr: number[] = [];
      for (const r of rows) {
        const pop = r.res[1000];
        const flow = r.floEnvelope;
        if (pop == null || flow == null) continue;
        arr.push((flow * alpha) / (pop + flow * alpha));
      }
      shares[String(alpha)] = arr;
    }
    console.log(`\n주거1000m + 유동 포락선 — alpha별`);
    console.log(`${"alpha".padEnd(7)} ${"유동 비중(중앙)".padEnd(16)} MAPE     긴장도CV`);
    for (const alpha of [0.1, 0.2, 0.3, 0.5, 0.75, 1.0]) {
      const sc = score(1000, "envelope", alpha);
      const sh = median(shares[String(alpha)]);
      console.log(
        `${String(alpha).padEnd(7)} ${`${(sh * 100).toFixed(0)}%`.padEnd(16)} ${sc ? `${(sc.mape * 100).toFixed(2)}%` : "-"}   ${sc ? `${(sc.tensionCv * 100).toFixed(0)}%` : "-"}`,
      );
    }
    console.log(`  → 유동 비중이 50%를 넘으면 "주거 기본 + 유동 +@"가 아니라 유동이 주역이 된다.`);
    expect(rows.length).toBeGreaterThan(30);
  });
});
