// 교과서식 초안 — 독점매장에서 수요 수준을 고정하고 층을 쌓는다 (2026-09-16). 일회성 분석용.
//
// 사용자 방향(2026-09-16): "일단 동일한 산식으로 갈 거기 때문에, 독점매장을 수요로 맞춰놓으면
// 일단 초안 완성 아닐까?"
//
// 맞는 접근이다. 지금 필요한 건 높은 적중률이 아니라 **모든 계수가 뜻을 갖는 완결된 산식 하나**다.
// 그래야 어느 층이 틀렸는지 층별로 판정할 수 있다.
//
// ── 구조 ────────────────────────────────────────────────────────────────
//   수요    = (주거1km + 유동400m x alpha)를 **연령별 PC방 이용률로 환산**한 값
//   가동률  = A x 수요 x 격차^gamma ÷ (자사PC x 격차^gamma + 경쟁IP)
//            (gamma>1이면 우위 매장 쏠림. A는 독점매장에서 고정)
//   매출    = 자사PC x 720시간 x 가동률 x 실효단가 ÷ (1-상품비율)
//
// A를 **독점매장에서만** 정하는 게 핵심이다. 독점상권은 경쟁IP=0이라 공급이 자사PC뿐이고,
// 그래서 경쟁 항의 간섭 없이 수요 수준만 정해진다. 전체 표본으로 A를 맞추면 경쟁 항의 오차가
// A로 스며들어 "수요가 맞는지"를 영영 못 가른다.
//
// ⚠️ 목표는 매출이 아니라 **가동률**이다. 매출에는 요금·상품매출·할인이 섞여 수요 측정의
//    실력이 흐려진다(memory: project_pc_hours_from_utilization — 역산 11.7% vs 가동률 2.3%).
//    가동률은 게토에서 받은 실측값을 쓴다(평가창 12개월 평균).
//
//   npx vitest run src/lib/storeEval/_draftFormula.test.ts --reporter=verbose
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";

const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const UTIL_FILE = ".local-tools/geto-utilization.json";
const ready = hasValidationSnapshot() && existsSync(FLOAT_FILE) && existsSync(RESI_FILE) && existsSync(UTIL_FILE);
const describeIf = ready ? describe : describe.skip;

const RING = [100, 200, 300, 400, 500] as const;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
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

/**
 * 연령별 PC방 이용률 — **1,000명 중 몇 명이 PC방을 쓰나** (2026-09-16 사용자 제공 실측 조사).
 *
 *   연령   남성   여성   남녀평균
 *   10대   390    130     260
 *   20대   420    150     285
 *   30대   170     45     108
 *   40대   100     20      60
 *   50대    35      8      22   (40대 이하만 쓰므로 여기선 안 쓴다)
 *
 * ⚠️ 이 값은 **우리 데이터로 맞춘 게 아니다.** 외부 조사값을 그대로 넣었는데 독점 3곳이
 *    최대오차 0.8% 안에 들어왔다(추정치로 만든 가중치는 3.2~4.7%였다). 과적합일 수 없는
 *    종류의 일치라 이 값을 신뢰한다.
 * ⚠️ 2020~2021 조사라 절대 수준은 낡았을 수 있다. 다만 이 산식에서 의미를 갖는 건
 *    **연령 간 비율**뿐이다 — 전체 수준은 계수 A가 흡수한다.
 * 성별 자료를 연령과 교차해 갖고 있지 않아 남녀 1:1 평균을 쓴다. 남성 값만 써도 비율이
 * 거의 같아 결과가 비슷했다(독점 1.5%).
 */
const RATE_M = { teens: 0.390, twenties: 0.420, thirties: 0.170, forties: 0.100 };
const RATE_F = { teens: 0.130, twenties: 0.150, thirties: 0.045, forties: 0.020 };
/** 지역 남성비율 m으로 남녀 이용률을 섞는다. m=0.5면 남녀평균과 같다. */
const blend = (m) => ({
  teens: m * RATE_M.teens + (1 - m) * RATE_F.teens,
  twenties: m * RATE_M.twenties + (1 - m) * RATE_F.twenties,
  thirties: m * RATE_M.thirties + (1 - m) * RATE_F.thirties,
  forties: m * RATE_M.forties + (1 - m) * RATE_F.forties,
});
/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("교과서식 초안 — 독점에서 수요를 고정하고 층을 쌓는다", () => {
  const snap = loadValidationSnapshot<any>();
  const fl = JSON.parse(readFileSync(FLOAT_FILE, "utf8"));
  const re = JSON.parse(readFileSync(RESI_FILE, "utf8"));
  const util = JSON.parse(readFileSync(UTIL_FILE, "utf8"));
  const floSites = fl.sites ?? fl;
  const resSites = re.sites ?? re;

  // 경쟁IP — appliedPcCount(미조사 보정 반영). pcCount 필드는 전 문서가 0이라 쓰면 안 된다.
  const rivalIp = new Map<string, number>();
  for (const c of snap.competitors as any[]) {
    const v = Number(c.appliedPcCount ?? c.totalPcCount ?? 0);
    rivalIp.set(c.candidateCode, (rivalIp.get(c.candidateCode) ?? 0) + v);
  }
  const locByCode = new Map((snap.locationEvaluations as any[]).map((l) => [l.candidateCode, l]));

  type Row = {
    name: string; pc: number; rival: number; gap: number; rate: number | null;
    demandBase: number;     // 주거1km 10~30대
    demandFlow: number;     // 유동400m 10~30대
    util: number;           // 실측 가동률(평가창 12개월 평균)
    locScore: number | null; compScore: number | null;
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
    const flo: Record<number, number> = {};
    for (const R of RING) {
      const r = fv.radii?.[String(R)];
      if (r?.selected?.length) flo[R] = Math.round(mean(r.selected.slice(-12)));
    }
    // 주거 1km를 **PC방 이용자 수로 환산**한다 — SGIS age_2(10대)~age_5(40대)에 연령별 이용률을 곱한다.
    const p1k = rv.radii?.["1000"]?.pops;
    const resMale = p1k?.woman_cnt != null && Number(p1k.tot_ppltn_cnt) > 0
      ? 1 - Number(p1k.woman_cnt) / Number(p1k.tot_ppltn_cnt)
      : 0.5;
    const RR = blend(resMale);
    const pop = p1k?.age_2_cnt == null
      ? null
      : Number(p1k.age_2_cnt) * RR.teens
        + Number(p1k.age_3_cnt) * RR.twenties
        + Number(p1k.age_4_cnt) * RR.thirties
        + Number(p1k.age_5_cnt) * RR.forties;
    // 유동 400m도 같은 이용률로 환산. 연령·성별은 최근월 한 벌만 오므로 12개월 평균 축척으로
    // 맞춘다(writeFloatingPopulationToFirestore.mjs와 같은 보정).
    const f400 = fv.radii?.["400"];
    let env: number | null = null;
    if (f400?.selected?.length && f400.demographics) {
      const avg = Math.round(mean(f400.selected.slice(-12)));
      const recent = f400.selected[f400.selected.length - 1];
      const sc = recent > 0 ? avg / recent : 1;
      const d = f400.demographics;
      const FR = blend(d.total > 0 ? d.male / d.total : 0.5);
      env = ((d.age10s ?? 0) * FR.teens
        + (d.age20s ?? 0) * FR.twenties
        + (d.age30s ?? 0) * FR.thirties
        + (d.age40s ?? 0) * FR.forties) * sc;
    }
    if (pop == null || env == null) continue;
    const loc = locByCode.get(st.storeCode);
    rows.push({
      name: st.storeName, pc, rival: rivalIp.get(st.storeCode) ?? 0,
      gap: st.competitivenessGap ?? 1, rate: st.hourlyRate ?? null,
      demandBase: Number(pop), demandFlow: env,
      util: mean(u.rows.map((r: any) => r.monthlyRate)),
      locScore: loc?.locationScore ?? null, compScore: st.competitivenessScore ?? null,
    });
  }

  // 유동 가중 — 유동인구는 "명"이 아니라 "하루 통행량"이라 주거인구와 단위가 다르다(같은 사람이
  // 여러 번 세어진다). 0.2를 곱하면 유동이 수요에서 차지하는 몫이 중앙 22%가 되어 사용자 설계
  // ("주거 기본 + 유동 +@")와 맞는다.
  //
  // 반경 선택 근거(2026-09-16): 사용자 판정 기준 "독점매장이 5% 내외로 맞아야 한다"로 수요식
  // 149개를 거르니 통과가 2개뿐이었고, 둘 다 주거1km + 유동400m 계열이었다. 유동 500m는
  // 수원망포점처럼 지하철 상권을 먹고(300->400m에서 4.19배), 100~300m는 너무 좁아 오차가 커진다.
  const ALPHA = 0.15;
  const demand = (r: Row) => r.demandBase + r.demandFlow * ALPHA;

  /**
   * 가동률의 축척 없는 형태 — A를 곱하면 가동률이 된다.
   *
   * 유도: 자사수요 = 총수요 x 점유율, 점유율 = (자사PC x 격차^gamma) / (자사PC x 격차^gamma + 경쟁IP).
   * 가동률 = 자사수요 ÷ 자사PC 이므로 자사PC가 약분돼 **분자에 격차^gamma가 남는다**.
   *
   *   가동률 = A x 수요 x 격차^gamma ÷ (자사PC x 격차^gamma + 경쟁IP)
   *
   * ⚠️ 2026-09-16에 이 분자의 격차^gamma를 빠뜨려서 gamma를 올릴수록 가동률이 내려가는
   *    반대 결과가 나왔다(gamma=1 MAPE 60% -> gamma=6 78%). 분모에만 넣으면 "경쟁력이 좋을수록
   *    공급이 늘어 덜 찬다"는 말이 되는데, 그건 뜻이 반대다.
   * 독점상권(경쟁IP=0)에서는 격차^gamma가 약분돼 가동률 = A x 수요 ÷ 자사PC가 된다 —
   * 경쟁 항과 무관하게 수요 수준만 정해지므로 A를 여기서 정하는 근거가 된다.
   */
  const shape = (r: Row, gamma: number) => {
    const g = Math.pow(r.gap, gamma);
    return (demand(r) * g) / (r.pc * g + r.rival);
  };

  /** 독점매장(경쟁IP=0)에서 수요 계수 A를 정한다. 거기선 격차^gamma가 약분된다. */
  function calibrateA(gamma: number): { A: number; used: string[]; spread: number } {
    const mono = rows.filter((r) => r.rival === 0);
    const As = mono.map((r) => r.util / shape(r, gamma));
    const A = median(As);
    return { A, used: mono.map((r) => r.name), spread: (Math.max(...As) - Math.min(...As)) / A };
  }

  function score(A: number, gamma: number) {
    const errs = rows.map((r) => {
      const pred = A * shape(r, gamma);
      return Math.abs(pred - r.util) / r.util;
    });
    const s = [...errs].sort((a, b) => a - b);
    return {
      mape: mean(errs), med: s[Math.floor(s.length / 2)],
      w20: errs.filter((v) => v <= 0.2).length / errs.length,
      max: s[s.length - 1],
    };
  }

  it("표본", () => {
    const mono = rows.filter((r) => r.rival === 0);
    console.log(`\n표본 ${rows.length}곳 (실측 가동률 있는 매장) · 그중 독점 ${mono.length}곳: ${mono.map((r) => r.name).join(", ")}`);
    console.log(`수요식: (주거1km + 유동400m x${ALPHA})를 연령별 이용률로 환산`);
    console.log("이용률(1,000명당 남/여): 10대 390/130 · 20대 420/150 · 30대 170/45 · 40대 100/20 — 지역 남성비율로 섞는다");
    expect(rows.length).toBeGreaterThan(25);
  });

  it("초안 — 독점에서 A를 고정하고 gamma를 훑는다", () => {
    console.log(`\n${"gamma".padEnd(7)} ${"A(수요계수)".padStart(12)} ${"가동률 MAPE".padStart(12)} ${"중앙".padStart(8)} ${"±20%".padStart(7)} ${"최대".padStart(8)}`);
    const results: { gamma: number; A: number; mape: number }[] = [];
    for (const gamma of [1, 1.5, 2, 3, 4, 5, 6]) {
      const { A } = calibrateA(gamma);
      const s = score(A, gamma);
      results.push({ gamma, A, mape: s.mape });
      console.log(`${String(gamma).padEnd(7)} ${A.toExponential(3).padStart(12)} ${(s.mape * 100).toFixed(2).padStart(11)}% ${(s.med * 100).toFixed(1).padStart(7)}% ${(s.w20 * 100).toFixed(0).padStart(6)}% ${(s.max * 100).toFixed(0).padStart(7)}%`);
    }
    const best = results.reduce((a, b) => (b.mape < a.mape ? b : a));
    const cal = calibrateA(best.gamma);
    console.log(`\n최선 gamma=${best.gamma} · A=${best.A.toExponential(3)}`);
    console.log(`  A는 독점 ${cal.used.length}곳(${cal.used.join(", ")})으로만 정했다. 곳마다 ${(cal.spread * 100).toFixed(0)}% 벌어진다.`);
    console.log(`  뜻: 수요 1명이 가동률 ${(best.A * 100).toExponential(2)}%p를 만든다 = PC 1대를 100% 채우려면 ${Math.round(1 / best.A).toLocaleString()}명이 필요하다.`);
    expect(results.length).toBeGreaterThan(0);
  });

  it("초안이 남기는 오차를 무엇이 설명하는가", () => {
    // 이 오차가 곧 3단계(입지·경쟁력)가 올려야 할 몫이다.
    const gamma = 4;
    const { A } = calibrateA(gamma);
    const resid = rows.map((r) => r.util / (A * shape(r, gamma)));
    const n = rows.length;
    const sig = 2 / Math.sqrt(n);
    console.log(`\ngamma=${gamma} 초안이 남긴 오차(실제÷예측) — n=${n}, 유의선 ${sig.toFixed(3)}`);
    for (const [label, get] of [
      ["입지동선종합", (r: Row) => r.locScore],
      ["경쟁력점수", (r: Row) => r.compScore],
      ["경쟁력격차", (r: Row) => r.gap],
      ["자사PC", (r: Row) => r.pc],
    ] as const) {
      const a: number[] = [], b: number[] = [];
      rows.forEach((r, i) => { const v = get(r); if (v != null) { a.push(v); b.push(resid[i]); } });
      if (a.length < 15) continue;
      const rr = pearson(a, b);
      console.log(`  ${label.padEnd(14)} r = ${rr.toFixed(3)}${Math.abs(rr) > sig ? " *" : ""}  n=${a.length}`);
    }
    const s = [...resid].sort((a, b) => a - b);
    console.log(`  오차 분포: ${s[0].toFixed(2)} ~ ${s[s.length - 1].toFixed(2)} (중앙 ${median(resid).toFixed(2)})`);
    const over = rows.map((r, i) => ({ n: r.name, v: resid[i] })).sort((a, b) => a.v - b.v);
    console.log(`  가장 과대예측: ${over.slice(0, 3).map((o) => `${o.n} ${o.v.toFixed(2)}`).join(" · ")}`);
    console.log(`  가장 과소예측: ${over.slice(-3).map((o) => `${o.n} ${o.v.toFixed(2)}`).join(" · ")}`);
    expect(rows.length).toBeGreaterThan(25);
  });

  it("매출까지 환산하면", () => {
    // 초안의 최종 산출물은 매출이다. 가동률 -> 매출 환산은 요금과 상품비율만 더 쓴다.
    const gamma = 4;
    const { A } = calibrateA(gamma);
    const MONTH_HOURS = 24 * 30;
    const byName = new Map((snap.existingStores as any[]).map((s) => [s.storeName, s]));
    const errs: number[] = [];
    for (const r of rows) {
      const st = byName.get(r.name);
      const actual = st?.actualMonthlyRevenueAvg;
      if (!actual || r.rate == null) continue;
      const u = Math.min(A * shape(r, gamma), 0.55); // 실측 최대 46.5% -> 상한 55%
      const pred = r.pc * MONTH_HOURS * u * r.rate / 0.5;
      errs.push(Math.abs(pred - actual) / actual);
    }
    const s = [...errs].sort((a, b) => a - b);
    console.log(`\n매출 환산 (가동률 상한 55%, 상품비율 50%) — n=${errs.length}`);
    console.log(`  MAPE ${(mean(errs) * 100).toFixed(2)}% · 중앙 ${(s[Math.floor(s.length / 2)] * 100).toFixed(1)}% · ±20% ${(errs.filter((v) => v <= 0.2).length / errs.length * 100).toFixed(0)}%`);
    console.log(`  (참고) 운영 산식 V62는 MAPE 9.26%, PC대수만 세는 기준선은 16.85%다.`);
    expect(errs.length).toBeGreaterThan(20);
  });
});
