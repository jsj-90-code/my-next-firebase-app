// 연령별 이용률 환산이 필요한가 (2026-09-16). 일회성 분석용.
//
// 사용자 질문(2026-09-16): "연령별 수요는 중간에 환산 한번 하는 거지?"
//
// 지금 초안은 **환산을 안 한다.** 10대·20대·30대를 그냥 동등하게 더한다(age_2+age_3+age_4).
// 10대와 30대의 PC방 이용률이 같을 리 없으니 환산이 있어야 맞다.
//
//   수요 = SUM(연령대 인구 x 그 연령대의 이용률)
//
// ⚠️ **가중치를 데이터로 맞추면 안 된다.** 독점매장이 3곳뿐인데 A + 가중치 2개면 파라미터가
//    표본 수와 같아져 3곳에 완벽히 맞는다. 그건 검증이 아니라 끼워맞추기다.
//    그래서 이 파일은 **미리 정해둔 가중치 묶음**만 시험한다. 데이터로 뽑지 않는다.
//    판정은 (1) 독점 최대오차가 5% 아래인가, (2) 나머지 29곳이 나빠지지 않는가 둘 다로 한다.
//
// 가중치 출처:
//   · textbookModel.ts DEFAULT_TEXTBOOK_PARAMS — 2026-09-15에 쓰던 값
//   · 동등 가중 — 지금 초안(10~30대 1:1:1)
//   · 그 밖은 "10대가 제일 많이 쓰고 나이 들수록 준다"는 상식을 여러 세기로 표현한 것
//
//   npx vitest run src/lib/storeEval/_ageWeights.test.ts --reporter=verbose
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

/** 연령대별 이용률. 절대값은 A가 흡수하므로 **서로의 비만** 의미가 있다. */
type W = { teens: number; twenties: number; thirties: number; forties: number };
const WEIGHT_SETS: { label: string; w: W; why: string }[] = [
  { label: "동등 (지금 초안)", w: { teens: 1, twenties: 1, thirties: 1, forties: 0 }, why: "10~30대를 1:1:1로 더한다" },
  { label: "교과서식 기본값", w: { teens: 0.35, twenties: 0.30, thirties: 0.14, forties: 0.05 }, why: "textbookModel.ts DEFAULT" },
  { label: "10대 중심 (강)", w: { teens: 1, twenties: 0.6, thirties: 0.25, forties: 0 }, why: "나이 들수록 급격히 준다" },
  { label: "10대 중심 (약)", w: { teens: 1, twenties: 0.85, thirties: 0.6, forties: 0 }, why: "나이 들수록 완만히 준다" },
  { label: "20대 중심", w: { teens: 0.7, twenties: 1, thirties: 0.5, forties: 0 }, why: "20대가 정점" },
  { label: "10~20대만", w: { teens: 1, twenties: 1, thirties: 0, forties: 0 }, why: "30대는 안 온다고 본다" },
  { label: "40대까지 (동등+40대 절반)", w: { teens: 1, twenties: 1, thirties: 1, forties: 0.5 }, why: "40대도 일부 온다" },
  // ── 실측 조사값 (2026-09-16 사용자 제공) ─────────────────────────────────
  // "연령별 1,000명 중 PC방 이용자 수" 조사. 지금까지 쓰던 값은 전부 추정치였고 이건 실측이다.
  //   10대 남 390 / 여 130,  20대 남 420 / 여 150,  30대 남 170 / 여 45,
  //   40대 남 100 / 여 20,   50대 남 35 / 여 8
  // 성별 자료를 연령과 교차해서 갖고 있지 않으므로 남녀 평균을 쓴다(1:1 가정).
  // ⚠️ 2020~2021 조사라 5~6년 지났다. 절대 수준은 낡았을 수 있지만 **연령 간 비율**은
  //    상대적으로 안정적일 것으로 본다 — 그리고 이 산식에서 의미를 갖는 건 비율뿐이다(A가 수준을 흡수).
  { label: "실측 조사값 (남녀평균)", w: { teens: 0.260, twenties: 0.285, thirties: 0.1075, forties: 0.060 }, why: "2020~21 조사, 남녀 1:1 평균" },
  // 남성 비중이 높은 상권을 가정한 판(조사에서 남성 이용률이 여성의 약 3배다).
  { label: "실측 조사값 (남성만)", w: { teens: 0.390, twenties: 0.420, thirties: 0.170, forties: 0.100 }, why: "남성 값만 — 비율은 남녀평균과 거의 같다" },
];

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("연령별 이용률 환산", () => {
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
    // 주거 1km 연령대별 (SGIS age_2=10대 … age_5=40대)
    r10: number; r20: number; r30: number; r40: number;
    // 유동 400m 연령대별 (12개월 평균 축척으로 보정)
    f10: number; f20: number; f30: number; f40: number;
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
    const p = rv.radii?.["1000"]?.pops;
    if (p?.age_2_cnt == null) continue;
    const f = fv.radii?.["400"];
    if (!f?.selected?.length || !f.demographics) continue;
    const avg = Math.round(mean(f.selected.slice(-12)));
    const recent = f.selected[f.selected.length - 1];
    const sc = recent > 0 ? avg / recent : 1;
    const d = f.demographics;
    rows.push({
      name: st.storeName, pc, rival: rivalIp.get(st.storeCode) ?? 0,
      gap: st.competitivenessGap ?? 1,
      util: mean(u.rows.map((r: any) => r.monthlyRate)),
      r10: Number(p.age_2_cnt), r20: Number(p.age_3_cnt), r30: Number(p.age_4_cnt), r40: Number(p.age_5_cnt),
      f10: (d.age10s ?? 0) * sc, f20: (d.age20s ?? 0) * sc, f30: (d.age30s ?? 0) * sc, f40: (d.age40s ?? 0) * sc,
    });
  }
  const mono = rows.filter((r) => r.rival === 0);
  const rest = rows.filter((r) => r.rival > 0);

  const ALPHA = 0.2;
  const demandOf = (r: Row, w: W) =>
    (r.r10 * w.teens + r.r20 * w.twenties + r.r30 * w.thirties + r.r40 * w.forties)
    + (r.f10 * w.teens + r.f20 * w.twenties + r.f30 * w.thirties + r.f40 * w.forties) * ALPHA;

  function evaluate(w: W, gamma = 4) {
    const As = mono.map((r) => r.util / (demandOf(r, w) / r.pc));
    const A = median(As);
    const monoErrs = mono.map((r) => Math.abs(A * (demandOf(r, w) / r.pc) - r.util) / r.util);
    const restErrs = rest.map((r) => {
      const g = Math.pow(r.gap, gamma);
      const pred = A * (demandOf(r, w) * g) / (r.pc * g + r.rival);
      return Math.abs(pred - r.util) / r.util;
    });
    return {
      A, maxMono: Math.max(...monoErrs), monoErrs,
      restMape: mean(restErrs),
      per: 1 / A,
    };
  }

  it("표본", () => {
    console.log(`\n독점 ${mono.length}곳 · 경쟁 있는 곳 ${rest.length}곳`);
    console.log(`주거1km 연령 구성 (중앙): 10대 ${median(rows.map((r) => r.r10)).toLocaleString()} · 20대 ${median(rows.map((r) => r.r20)).toLocaleString()} · 30대 ${median(rows.map((r) => r.r30)).toLocaleString()} · 40대 ${median(rows.map((r) => r.r40)).toLocaleString()}`);
    expect(mono.length).toBeGreaterThan(2);
  });

  it("미리 정한 가중치들을 시험한다", () => {
    console.log(`\n${"가중치".padEnd(26)} ${"독점 최대오차".padStart(12)} ${"나머지 MAPE".padStart(12)} ${"PC1대당".padStart(10)}`);
    const out: { label: string; maxMono: number; restMape: number; per: number }[] = [];
    for (const { label, w } of WEIGHT_SETS) {
      const e = evaluate(w);
      out.push({ label, maxMono: e.maxMono, restMape: e.restMape, per: e.per });
      console.log(`${label.padEnd(26)} ${(e.maxMono * 100).toFixed(1).padStart(11)}% ${(e.restMape * 100).toFixed(1).padStart(11)}% ${Math.round(e.per).toLocaleString().padStart(9)}명`);
    }
    const base = out.find((o) => o.label === "동등 (지금 초안)")!;
    const better = out.filter((o) => o.maxMono < base.maxMono && o.restMape < base.restMape);
    console.log(`\n지금 초안(동등)보다 **양쪽 다** 나은 가중치: ${better.length}개`);
    if (better.length) for (const b of better) console.log(`  ${b.label} — 독점 ${(b.maxMono * 100).toFixed(1)}% · 나머지 ${(b.restMape * 100).toFixed(1)}%`);
    else console.log(`  없음 — 연령 환산을 넣어도 지금보다 나아지지 않는다.`);
    expect(out.length).toBeGreaterThan(0);
  });

  it("왜 차이가 작은지 — 연령 구성이 매장마다 비슷한가", () => {
    // 가중치를 바꿔도 결과가 안 변하는 흔한 이유는 **연령 구성비가 매장마다 비슷해서**다.
    // 구성비가 같으면 어떤 가중치를 써도 전 매장이 같은 배율로 곱해져 A가 흡수한다.
    const share = (r: Row) => {
      const t = r.r10 + r.r20 + r.r30;
      return { a: r.r10 / t, b: r.r20 / t, c: r.r30 / t };
    };
    const cv = (a: number[]) => {
      const m = mean(a);
      return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) / m;
    };
    const s = rows.map(share);
    console.log(`\n주거 10~30대 안에서의 구성비 (n=${rows.length})`);
    console.log(`  10대 ${(mean(s.map((x) => x.a)) * 100).toFixed(1)}% (변동계수 ${(cv(s.map((x) => x.a)) * 100).toFixed(0)}%)`);
    console.log(`  20대 ${(mean(s.map((x) => x.b)) * 100).toFixed(1)}% (변동계수 ${(cv(s.map((x) => x.b)) * 100).toFixed(0)}%)`);
    console.log(`  30대 ${(mean(s.map((x) => x.c)) * 100).toFixed(1)}% (변동계수 ${(cv(s.map((x) => x.c)) * 100).toFixed(0)}%)`);
    console.log(`  → 변동계수가 작으면 연령 가중은 A에 흡수돼 효과가 거의 없다.`);
    const ext = rows.map((r) => ({ n: r.name, a: share(r).a })).sort((x, y) => y.a - x.a);
    console.log(`  10대 비중 최고: ${ext.slice(0, 3).map((x) => `${x.n} ${(x.a * 100).toFixed(0)}%`).join(" · ")}`);
    console.log(`  10대 비중 최저: ${ext.slice(-3).map((x) => `${x.n} ${(x.a * 100).toFixed(0)}%`).join(" · ")}`);
    expect(rows.length).toBeGreaterThan(25);
  });
});
