// 성별 x 연령 교차 환산 (2026-09-16). 일회성 분석용.
//
// 사용자 지시(2026-09-16): "성별 교차 필수인데, PC방 남성비율이 높아서."
//
// 맞다. 사용자가 준 실측 조사값에서 남녀 이용률이 약 3배 차이다:
//   연령   남성(1,000명당)  여성(1,000명당)
//   10대   390              130
//   20대   420              150
//   30대   170               45
//   40대   100               20
// 남녀 1:1로 평균 내면 남성 비중이 높은 상권을 과소평가한다.
//
// ── 자료 한계와 근사 ─────────────────────────────────────────────────────
// 성별 x 연령 **교차** 자료는 두 출처 모두 없다. 있는 건:
//   유동 400m : demographics.male / female 총수 + 연령별 총수 (교차 없음)
//   주거 1km  : pops.woman_cnt / tot_ppltn_cnt + age_1~age_9 (교차 없음)
//
// 그래서 "각 연령대 안의 성비 = 그 지역 전체 성비"로 근사한다:
//   수요_age = 인구_age x [ m x 남성이용률_age + (1-m) x 여성이용률_age ]
// m은 주거·유동 각각의 남성비율을 따로 쓴다.
//
// 근사가 성립할 여지: 남성비율이 실제로 매장마다 다르다(유동 50.4~66.9%, 중앙 57.9%).
// 근사의 한계: 20대 남성이 많은 공단 상권과 60대 남성이 많은 지역이 같은 m으로 잡힌다.
//
//   npx vitest run src/lib/storeEval/_genderCross.test.ts --reporter=verbose
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";

const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const UTIL_FILE = ".local-tools/geto-utilization.json";
const ready = hasValidationSnapshot() && existsSync(FLOAT_FILE) && existsSync(RESI_FILE) && existsSync(UTIL_FILE);
const describeIf = ready ? describe : describe.skip;

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/** 실측 조사값 — 1,000명당 PC방 이용자 수 (2026-09-16 사용자 제공). */
const RATE_M = { teens: 0.390, twenties: 0.420, thirties: 0.170, forties: 0.100 };
const RATE_F = { teens: 0.130, twenties: 0.150, thirties: 0.045, forties: 0.020 };
const RATE_AVG = { teens: 0.260, twenties: 0.285, thirties: 0.1075, forties: 0.060 };

type Ages = { teens: number; twenties: number; thirties: number; forties: number };

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("성별 x 연령 교차", () => {
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
    res: Ages; resMale: number;   // 주거 1km 연령별 + 남성비율
    flo: Ages; floMale: number;   // 유동 400m 연령별 + 남성비율
  };
  const rows: Row[] = [];
  for (const st of snap.existingStores as any[]) {
    const pc = st.evaluationPcCount ?? st.pcCount;
    if (!pc) continue;
    const u = util[st.storeName];
    if (!u?.rows?.length) continue;
    const fv = floSites[`existing:${st.storeCode}`];
    const rv = resSites[`existing:${st.storeCode}`];
    if (!fv || !rv) continue;
    const p = rv.radii?.["1000"]?.pops;
    const f = fv.radii?.["400"];
    if (p?.age_2_cnt == null || p.woman_cnt == null || !f?.selected?.length || !f.demographics) continue;
    const tot = Number(p.tot_ppltn_cnt);
    if (!(tot > 0)) continue;
    const d = f.demographics;
    if (!(d.total > 0)) continue;
    const avg = Math.round(mean(f.selected.slice(-12)));
    const recent = f.selected[f.selected.length - 1];
    const sc = recent > 0 ? avg / recent : 1;
    rows.push({
      name: st.storeName, pc, rival: rivalIp.get(st.storeCode) ?? 0,
      gap: st.competitivenessGap ?? 1,
      util: mean(u.rows.map((r: any) => r.monthlyRate)),
      res: { teens: Number(p.age_2_cnt), twenties: Number(p.age_3_cnt), thirties: Number(p.age_4_cnt), forties: Number(p.age_5_cnt) },
      resMale: 1 - Number(p.woman_cnt) / tot,
      flo: { teens: (d.age10s ?? 0) * sc, twenties: (d.age20s ?? 0) * sc, thirties: (d.age30s ?? 0) * sc, forties: (d.age40s ?? 0) * sc },
      floMale: d.male / d.total,
    });
  }
  const mono = rows.filter((r) => r.rival === 0);
  const rest = rows.filter((r) => r.rival > 0);
  const ALPHA = 0.2;

  /** 성비 m으로 연령별 이용률을 섞는다. m=0.5면 남녀평균과 같다. */
  function blended(ages: Ages, m: number, useGender: boolean): number {
    const k = (key: keyof Ages) =>
      useGender ? m * RATE_M[key] + (1 - m) * RATE_F[key] : RATE_AVG[key];
    return ages.teens * k("teens") + ages.twenties * k("twenties")
      + ages.thirties * k("thirties") + ages.forties * k("forties");
  }
  /**
   * 어디에 성별 교차를 적용할지.
   *
   * "연령대 안 성비 = 지역 전체 성비"라는 근사가 **주거에서 특히 약하다.** 주거인구 전체
   * 성비에는 고령층이 섞여 있어서, 고령 여성이 많은 동네는 전체 여성비가 올라가지만 그게
   * 10~40대 성비를 대표하지 않는다. 유동은 낮 시간 통행이라 그 왜곡이 덜하고, 실제로
   * 매장 간 차이도 유동이 크다(유동 50.4~66.9% vs 주거 46.1~57.0%).
   */
  type Mode = "none" | "both" | "floatingOnly";
  const demandOf = (r: Row, mode: Mode) =>
    blended(r.res, r.resMale, mode === "both")
    + blended(r.flo, r.floMale, mode !== "none") * ALPHA;

  function evaluate(mode: Mode, gamma = 4) {
    const As = mono.map((r) => r.util / (demandOf(r, mode) / r.pc));
    const A = median(As);
    const monoErrs = mono.map((r) => Math.abs(A * (demandOf(r, mode) / r.pc) - r.util) / r.util);
    const restErrs = rest.map((r) => {
      const g = Math.pow(r.gap, gamma);
      const pred = A * (demandOf(r, mode) * g) / (r.pc * g + r.rival);
      return Math.abs(pred - r.util) / r.util;
    });
    const all = [...monoErrs, ...restErrs];
    return {
      A, per: 1 / A, maxMono: Math.max(...monoErrs),
      restMape: mean(restErrs), allMape: mean(all),
      within20: all.filter((v) => v <= 0.2).length / all.length,
    };
  }

  it("성비 분포", () => {
    console.log(`\n표본 ${rows.length}곳 (독점 ${mono.length})`);
    const fm = rows.map((r) => r.floMale), rm = rows.map((r) => r.resMale);
    console.log(`유동 400m 남성비율: ${(Math.min(...fm) * 100).toFixed(1)}% ~ ${(Math.max(...fm) * 100).toFixed(1)}% (중앙 ${(median(fm) * 100).toFixed(1)}%)`);
    console.log(`주거 1km 남성비율: ${(Math.min(...rm) * 100).toFixed(1)}% ~ ${(Math.max(...rm) * 100).toFixed(1)}% (중앙 ${(median(rm) * 100).toFixed(1)}%)`);
    expect(rows.length).toBeGreaterThan(25);
  });

  it("성별 교차를 넣으면 나아지는가", () => {
    const off = evaluate("none");
    const on = evaluate("both");
    const floOnly = evaluate("floatingOnly");
    console.log(`\n${"".padEnd(18)} ${"독점 최대오차".padStart(12)} ${"나머지 MAPE".padStart(12)} ${"전체 MAPE".padStart(11)} ${"±20%".padStart(7)} ${"PC1대당".padStart(9)}`);
    for (const [label, e] of [["남녀평균(현행)", off], ["성별교차(주거+유동)", on], ["성별교차(유동만)", floOnly]] as const) {
      console.log(`${label.padEnd(18)} ${(e.maxMono * 100).toFixed(1).padStart(11)}% ${(e.restMape * 100).toFixed(1).padStart(11)}% ${(e.allMape * 100).toFixed(1).padStart(10)}% ${(e.within20 * 100).toFixed(0).padStart(6)}% ${Math.round(e.per).toLocaleString().padStart(8)}명`);
    }
    // 판정은 둘 다 본다 — 독점 5% 기준(사용자 기준)과 전체 MAPE.
    for (const [label, e] of [["주거+유동", on], ["유동만", floOnly]] as const) {
      console.log(`→ ${label}: 독점 5% 기준 ${e.maxMono <= 0.05 ? "통과" : "미달"}(${(e.maxMono * 100).toFixed(1)}%) · 전체 MAPE ${e.allMape < off.allMape ? "개선" : "악화"}(${(off.allMape * 100).toFixed(1)}% → ${(e.allMape * 100).toFixed(1)}%)`);
    }
    expect(rows.length).toBeGreaterThan(25);
  });

  it("남성비율이 높은 상권에서 특히 달라지는가", () => {
    // 성별 교차의 실체는 "남성 많은 상권을 더 크게 본다"는 것이다. 실제로 그런지,
    // 그리고 그 매장들의 실측 가동률이 실제로 높은지 본다.
    const on = evaluate("floatingOnly");
    const off = evaluate("none");
    const rowsWithDelta = rows.map((r) => {
      const dOn = demandOf(r, "floatingOnly"), dOff = demandOf(r, "none");
      const g = Math.pow(r.gap, 4);
      const predOn = on.A * (dOn * g) / (r.pc * g + r.rival);
      const predOff = off.A * (dOff * g) / (r.pc * g + r.rival);
      return { n: r.name, m: r.floMale, ratio: predOn / predOff, util: r.util, errOn: Math.abs(predOn - r.util) / r.util, errOff: Math.abs(predOff - r.util) / r.util };
    }).sort((a, b) => b.m - a.m);
    console.log(`\n${"매장".padEnd(14)} ${"유동 남성비".padStart(10)} ${"예측 변화".padStart(9)} ${"실제 가동률".padStart(11)} ${"오차 전".padStart(8)} ${"오차 후".padStart(8)}`);
    for (const r of [...rowsWithDelta.slice(0, 4), ...rowsWithDelta.slice(-4)]) {
      console.log(`${r.n.padEnd(14)} ${(r.m * 100).toFixed(1).padStart(9)}% ${((r.ratio - 1) * 100).toFixed(1).padStart(8)}% ${(r.util * 100).toFixed(1).padStart(10)}% ${(r.errOff * 100).toFixed(0).padStart(7)}% ${(r.errOn * 100).toFixed(0).padStart(7)}%`);
    }
    expect(rows.length).toBeGreaterThan(25);
  });
});
