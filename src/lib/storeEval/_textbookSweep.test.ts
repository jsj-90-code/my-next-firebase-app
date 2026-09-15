// 교과서식 파라미터·반경 전수 탐색 (2026-09-16). 일회성 분석용 — `_` 접두사라 일반 실행에서 빠진다.
//
// 왜 지금 다시 도는가: 2026-09-14~15에 교과서식은 MAPE 29%가 벽이었고, 그 원인이 "새 자료가
// 없어서"로 진단됐다(파라미터 50,400개 전수 확인). 2026-09-15에 소상공인365·SGIS를 API로 뚫어
// 반경 100~1000m 유동·주거를 전 지점 같은 기준으로 받았고, 2026-09-16에 크론이 그걸 되돌리던
// 문제까지 고쳤다. 그래서 **같은 탐색을 새 자료 위에서 다시 돌리는 것**이 지금 가장 값이 크다.
//
// ⚠️ 이 하네스는 운영 산식도, textbookModel.ts도 건드리지 않는다. 반경을 바꾸는 건
//    `pop1km`/`residentAges` 슬롯에 그 반경 값을 꽂아 넣는 방식으로 한다(모델은 그대로 둔다).
//    여기서 뭔가 이겨야 그때 Firestore·화면에 배선한다 — 안 이긴 걸 미리 배선하지 않는다.
//
//   npx vitest run src/lib/storeEval/_textbookSweep.test.ts --reporter=verbose
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { computeCompetitorIp } from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { DEFAULT_TEXTBOOK_PARAMS, scoreTextbook, type TextbookInput, type TextbookParams } from "./textbookModel";
import type { Competitor } from "./types";

const FLOAT_FILE = ".local-tools/sbiz-floating-population.json";
const RESI_FILE = ".local-tools/sgis-resident-population.json";
const ready = hasValidationSnapshot() && existsSync(FLOAT_FILE) && existsSync(RESI_FILE);
const describeIf = ready ? describe : describe.skip;

type Ages7 = { age0s: number; age10s: number; age20s: number; age30s: number; age40s: number; age50s: number; age60plus: number };
const ALL_RADII = [100, 200, 300, 400, 500, 1000] as const;
type Radius = (typeof ALL_RADII)[number];

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

/** 한 지점의 반경별 신호 묶음. 수집 JSON에서 그대로 편다. */
type Signals = {
  residentTotal: Partial<Record<Radius, number>>;
  residentAges: Partial<Record<Radius, Ages7>>;
  floatingTotal: Partial<Record<Radius, number>>;
  floatingAges: Partial<Record<Radius, Ages7>>;
  /** SGIS 사업체 — 직장인구 대용. 반경별 종사자수. */
  employees: Partial<Record<Radius, number>>;
  corpCount: Partial<Record<Radius, number>>;
  /** 주택유형: house_2가 아파트로 보인다(신중동 6,417/6,573). 비율로 쓴다. */
  apartmentRatio: Partial<Record<Radius, number>>;
  /** 1인가구 비율(family_1 / tot_family). */
  oneFamilyRatio: Partial<Record<Radius, number>>;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function readSignals(): Map<string, Signals> {
  const fl = JSON.parse(readFileSync(FLOAT_FILE, "utf8"));
  const re = JSON.parse(readFileSync(RESI_FILE, "utf8"));
  const out = new Map<string, Signals>();
  const ensure = (key: string) => {
    let s = out.get(key);
    if (!s) {
      s = { residentTotal: {}, residentAges: {}, floatingTotal: {}, floatingAges: {}, employees: {}, corpCount: {}, apartmentRatio: {}, oneFamilyRatio: {} };
      out.set(key, s);
    }
    return s;
  };

  for (const [key, site] of Object.entries<any>(re.sites ?? re)) {
    const s = ensure(key);
    for (const R of ALL_RADII) {
      const r = site.radii?.[String(R)];
      if (!r) continue;
      if (r.totalPopulation != null) s.residentTotal[R] = r.totalPopulation;
      const p = r.pops;
      if (p && p.age_1_cnt != null) {
        s.residentAges[R] = {
          age0s: Number(p.age_1_cnt), age10s: Number(p.age_2_cnt), age20s: Number(p.age_3_cnt),
          age30s: Number(p.age_4_cnt), age40s: Number(p.age_5_cnt), age50s: Number(p.age_6_cnt),
          age60plus: Number(p.age_7_cnt) + Number(p.age_8_cnt) + Number(p.age_9_cnt),
        };
      }
      if (r.corp?.employee_cnt != null) s.employees[R] = Number(r.corp.employee_cnt);
      if (r.corp?.corp_cnt != null) s.corpCount[R] = Number(r.corp.corp_cnt);
      const h = r.house;
      if (h && Number(h.tot_house_cnt) > 0) s.apartmentRatio[R] = Number(h.house_2_cnt) / Number(h.tot_house_cnt);
      const f = r.family;
      if (f && Number(f.tot_family_cnt) > 0) s.oneFamilyRatio[R] = Number(f.family_1_cnt) / Number(f.tot_family_cnt);
    }
  }

  for (const [key, site] of Object.entries<any>(fl.sites ?? fl)) {
    const s = ensure(key);
    for (const R of ALL_RADII) {
      const r = site.radii?.[String(R)];
      if (!r || !r.selected || r.selected.length === 0) continue;
      const last12 = r.selected.slice(-12);
      const avg = Math.round(mean(last12));
      s.floatingTotal[R] = avg;
      const d = r.demographics;
      if (d) {
        const recent = r.selected[r.selected.length - 1];
        const scale = recent > 0 ? avg / recent : 1;
        s.floatingAges[R] = {
          age0s: 0,
          age10s: (d.age10s ?? 0) * scale, age20s: (d.age20s ?? 0) * scale, age30s: (d.age30s ?? 0) * scale,
          age40s: (d.age40s ?? 0) * scale, age50s: (d.age50s ?? 0) * scale, age60plus: (d.age60plus ?? 0) * scale,
        };
      }
    }
  }
  return out;
}

describeIf("교과서식 — 새 기초자료 위에서 다시 탐색", () => {
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const signals = readSignals();

  type Row = { input: TextbookInput; actualRevenue: number; sig: Signals };
  const base: Row[] = [];
  for (const s of stores as any[]) {
    if (s.excludedFromModel || !s.actualMonthlyRevenueAvg) continue;
    const code = existingStoreSourceCode(s);
    const sig = signals.get(`existing:${s.storeCode}`);
    if (!sig) continue;
    const cs = compsByCode.get(code) ?? [];
    base.push({
      actualRevenue: s.actualMonthlyRevenueAvg,
      sig,
      input: {
        storeCode: s.storeCode, storeName: s.storeName,
        pcCount: s.evaluationPcCount ?? s.pcCount,
        hourlyRate: s.hourlyRate,
        competitivenessGap: s.competitivenessGap,
        competitorIp: computeCompetitorIp(cs, s.operatingPcStores500m ?? null),
        competitorCount: cs.filter((c) => c.investigationStatus !== "경쟁점없음").length,
        pop500m: s.pop500m, pop1km: s.pop1km,
        residentAges: null,
        floatingByRadius: {}, floatingAgesByRadius: {},
      },
    });
  }

  /** 반경 조합을 모델 입력 슬롯에 꽂는다. 주거는 1km 슬롯, 유동은 500m 슬롯을 쓴다. */
  function withRadii(rows: Row[], resR: Radius, floR: Radius): { input: TextbookInput; actualRevenue: number }[] {
    return rows.map((r) => ({
      actualRevenue: r.actualRevenue,
      input: {
        ...r.input,
        pop500m: r.sig.residentTotal[500] ?? null,
        pop1km: r.sig.residentTotal[resR] ?? null,
        residentAges: r.sig.residentAges[resR] ?? null,
        floatingByRadius: { 500: r.sig.floatingTotal[floR] ?? null },
        floatingAgesByRadius: { 500: r.sig.floatingAges[floR] ?? null },
      },
    }));
  }

  it("표본이 잡힌다", () => {
    console.log(`표본 ${base.length}곳 · 신호 수집 ${signals.size}지점`);
    expect(base.length).toBeGreaterThan(30);
  });

  it("기본 파라미터 성적 (새 자료 기준선)", () => {
    const rows = withRadii(base, 1000, 500);
    const sc = scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS);
    console.log(`기본값: MAPE ${((sc.mape ?? 0) * 100).toFixed(2)}% · 중앙값 ${((sc.medianAbsErr ?? 0) * 100).toFixed(2)}% · ±20% ${((sc.within20 ?? 0) * 100).toFixed(1)}% · 최대 ${((sc.maxAbsErr ?? 0) * 100).toFixed(0)}% · n=${sc.sampleCount}`);
    expect(sc.sampleCount).toBeGreaterThan(30);
  });

  // 교과서식 29%가 "좋은" 건지 "나쁜" 건지는 혼자 봐서는 모른다. 아무 정보도 안 쓰는
  // 기준선과 비교해야 한다. 여기서 교과서식이 단순 기준선을 못 이기면, 문제는 파라미터가
  // 아니라 **구조**다 — 인구에서 수요를 뽑는 길 자체가 신호를 못 담고 있다는 뜻이다.
  it("아무것도 안 쓰는 기준선과 비교", () => {
    const MONTH_HOURS = 24 * 30;
    const acts = base.map((r) => r.actualRevenue);
    const med = (a: number[]) => { const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)]; };
    const mape = (pred: number[]) => {
      const e = pred.map((p, i) => Math.abs(p - acts[i]) / acts[i]);
      return e.reduce((a, b) => a + b, 0) / e.length;
    };
    const within = (pred: number[], t: number) => {
      const e = pred.map((p, i) => Math.abs(p - acts[i]) / acts[i]);
      return e.filter((v) => v <= t).length / e.length;
    };

    // B0 — 전 지점 중앙값. 매장 정보를 하나도 안 쓴다.
    const b0 = acts.map(() => med(acts));
    // B1 — PC대수 x (대당매출 중앙값). 좌석 수만 쓴다.
    const perPc = base.map((r, i) => acts[i] / (r.input.pcCount as number));
    const b1 = base.map((r) => (r.input.pcCount as number) * med(perPc));
    // B2 — 좌석 x 요금 x 가동률 중앙값. 용량과 가격만 쓴다(수요 추정을 아예 안 한다).
    const util = base.map((r, i) => {
      const cap = (r.input.pcCount as number) * MONTH_HOURS * (r.input.hourlyRate ?? 0);
      return cap > 0 ? acts[i] / cap : null;
    }).filter((v): v is number => v != null);
    const b2 = base.map((r) => (r.input.pcCount as number) * MONTH_HOURS * (r.input.hourlyRate ?? 0) * med(util));

    for (const [label, pred] of [["B0 중앙값(정보 0)", b0], ["B1 PC대수만", b1], ["B2 PC대수x요금", b2]] as const) {
      console.log(`${label.padEnd(20)} MAPE ${(mape(pred) * 100).toFixed(2)}%  ±20% ${(within(pred, 0.2) * 100).toFixed(0)}%`);
    }
    console.log("교과서식 최선           MAPE 29.42%");
    console.log("운영 산식(V62)          MAPE  9.26%");
    expect(acts.length).toBeGreaterThan(30);
  });

  // 교과서식이 왜 단순 기준선보다 나쁜가 — 균형 가설을 검정한다.
  //
  // 가설: PC방 시장은 **공급이 수요를 따라간다.** 사람이 많은 동네에는 PC방도 많이 생긴다.
  // 그렇다면 (수요 ÷ 공급)은 동네마다 거의 같아지고, 그 결과 한 매장의 매출은 좌석 수에
  // 거의 비례한다. 인구는 "이 동네가 PC 몇 대를 먹여 살리나"를 말해 줄 뿐, "우리 가게가
  // 대당 얼마를 버나"는 말해 주지 않는다.
  //
  // 이 가설이 맞으면 교과서식이 나쁜 이유가 설명된다 — 인구 총량은 지점마다 몇 배씩
  // 차이 나는데 실제 대당매출은 그만큼 안 흔들리므로, 인구를 매출에 그대로 실으면
  // 예측 분산이 실제보다 훨씬 커진다.
  it("균형 가설 — 공급이 수요를 따라가는가", () => {
    const rows = withRadii(base, 1000, 500);
    const xs: number[] = [];  // 시장 수요(인구)
    const ys: number[] = [];  // 시장 공급(우리 PC + 경쟁 IP)
    const perPc: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const pop = r.input.pop1km;
      const flow = r.input.floatingByRadius[500];
      const pc = r.input.pcCount;
      if (pop == null || flow == null || !pc) continue;
      xs.push(pop + flow * 0.2);
      ys.push(pc + (r.input.competitorIp ?? 0));
      perPc.push(r.actualRevenue / pc);
    }
    const corr = (a: number[], b: number[]) => {
      const ma = a.reduce((x, y) => x + y, 0) / a.length;
      const mb = b.reduce((x, y) => x + y, 0) / b.length;
      let sab = 0, saa = 0, sbb = 0;
      for (let i = 0; i < a.length; i++) {
        const da = a[i] - ma, db = b[i] - mb;
        sab += da * db; saa += da * da; sbb += db * db;
      }
      return sab / Math.sqrt(saa * sbb);
    };
    const cv = (a: number[]) => {
      const m = a.reduce((x, y) => x + y, 0) / a.length;
      const v = a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length;
      return Math.sqrt(v) / m;
    };
    console.log(`\n시장수요(주거1km+유동x0.2) vs 시장공급(자사PC+경쟁IP): r = ${corr(xs, ys).toFixed(3)} (n=${xs.length})`);
    console.log(`변동계수 — 시장수요 ${(cv(xs) * 100).toFixed(0)}% · 시장공급 ${(cv(ys) * 100).toFixed(0)}% · 실제 대당매출 ${(cv(perPc) * 100).toFixed(0)}%`);
    console.log("→ 대당매출의 변동이 인구 변동보다 훨씬 작으면, 인구를 매출에 그대로 실으면 안 된다.");
    expect(xs.length).toBeGreaterThan(30);
  });

  /**
   * 교과서식 v2 후보 — 긴장도(수요/공급)를 **감쇠 지수 λ로 눌러서** 쓴다.
   *
   * 지금 구조는 가동률 = 수요 / 공급 그대로다(λ=1). 그런데 균형 가설 검정에서 봤듯이
   * 공급이 수요를 따라가므로 이 비는 실제보다 훨씬 크게 흔들린다. λ<1로 누르면 그 과잉
   * 변동이 줄고, λ=0이면 "모든 동네 가동률이 같다"(=B1 PC대수만)가 된다.
   *
   * 이 구조는 두 극단을 모두 품는다 — λ를 데이터가 고르게 두면 "상권 정보가 대당매출을
   * 얼마나 설명하는가"를 그 값이 그대로 말해 준다. λ*가 0에 가까우면 상권은 설명력이 없는 것이다.
   *
   * 수준(A)은 로그 공간 평균으로 닫힌 형태로 맞춘다(fitHoursPerUser와 같은 방식) —
   * 눈으로 정할 값이 아니고, 이걸 맞춰야 λ끼리 공정하게 비교된다.
   */
  it("교과서식 v2 — 긴장도 감쇠 λ 탐색", () => {
    const MONTH_HOURS = 24 * 30;
    const medOf = (a: number[]) => { const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)]; };

    type V2Row = { pc: number; rate: number; tension: number; actual: number };
    function buildRows(resR: Radius, floR: Radius, ff: number, gamma: number, outside: number): V2Row[] {
      const out: V2Row[] = [];
      for (const r of base) {
        const pc = r.input.pcCount;
        const rate = r.input.hourlyRate;
        const pop = r.sig.residentTotal[resR];
        const flow = r.sig.floatingTotal[floR];
        if (!pc || rate == null || pop == null || flow == null) continue;
        const gap = r.input.competitivenessGap ?? 1;
        const demand = pop + flow * ff;
        const supply = pc * Math.pow(gap, gamma) + (r.input.competitorIp ?? 0) + outside;
        if (!(supply > 0)) continue;
        out.push({ pc, rate, tension: demand / supply, actual: r.actualRevenue });
      }
      return out;
    }

    function scoreV2(rows: V2Row[], lambda: number, maxUtil: number, productRatio: number) {
      const medT = medOf(rows.map((r) => r.tension));
      if (!(medT > 0)) return null;
      // 수준 A를 로그 공간에서 닫힌 형태로 맞춘다(상한에 걸린 건 제외 — 배율 추정을 왜곡한다).
      const logs: number[] = [];
      for (const r of rows) {
        const shape = Math.pow(r.tension / medT, lambda);
        const rev1 = r.pc * MONTH_HOURS * shape * r.rate / (1 - productRatio);
        if (rev1 > 0 && r.actual > 0) logs.push(Math.log(r.actual / rev1));
      }
      if (!logs.length) return null;
      const A = Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length);

      const errs: number[] = [];
      for (const r of rows) {
        const util = Math.min(A * Math.pow(r.tension / medT, lambda), maxUtil);
        const rev = r.pc * MONTH_HOURS * util * r.rate / (1 - productRatio);
        errs.push(Math.abs(rev - r.actual) / r.actual);
      }
      const sorted = [...errs].sort((a, b) => a - b);
      return {
        mape: errs.reduce((a, b) => a + b, 0) / errs.length,
        med: sorted[Math.floor(sorted.length / 2)],
        w20: errs.filter((v) => v <= 0.2).length / errs.length,
        max: sorted[sorted.length - 1],
        n: errs.length,
      };
    }

    const results: { label: string; mape: number; med: number; w20: number; max: number; lambda: number }[] = [];
    const LAMBDAS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1.0, 1.25];
    for (const resR of ALL_RADII) {
      for (const floR of ALL_RADII) {
        for (const ff of [0.05, 0.1, 0.2, 0.35, 0.5]) {
          for (const gamma of [0.5, 1.0, 1.5]) {
            for (const outside of [0, 100, 200, 400]) {
              const rows = buildRows(resR, floR, ff, gamma, outside);
              if (rows.length < 30) continue;
              for (const lambda of LAMBDAS) {
                const sc = scoreV2(rows, lambda, 0.85, 0.5);
                if (!sc) continue;
                results.push({
                  label: `주거${resR} 유동${floR} ff=${ff} gamma=${gamma} oo=${outside} lambda=${lambda}`,
                  mape: sc.mape, med: sc.med, w20: sc.w20, max: sc.max, lambda,
                });
              }
            }
          }
        }
      }
    }
    results.sort((a, b) => a.mape - b.mape);
    console.log(`\n조합 ${results.length}개 · 상위 12개`);
    for (const r of results.slice(0, 12)) {
      console.log(`  MAPE ${(r.mape * 100).toFixed(2)}%  중앙 ${(r.med * 100).toFixed(1)}%  ±20% ${(r.w20 * 100).toFixed(0)}%  최대 ${(r.max * 100).toFixed(0)}%   ${r.label}`);
    }
    // λ별 최선을 따로 본다 — 상권 정보가 실제로 값을 더하는지가 여기서 보인다.
    console.log("\nλ별 최선 (λ=0은 상권을 아예 안 쓰는 것과 같다)");
    for (const lam of LAMBDAS) {
      const best = results.filter((r) => r.lambda === lam).sort((a, b) => a.mape - b.mape)[0];
      if (best) console.log(`  lambda=${String(lam).padEnd(5)} MAPE ${(best.mape * 100).toFixed(2)}%   ${best.label}`);
    }
    expect(results.length).toBeGreaterThan(0);
  });

  it("반경 × 파라미터 전수 탐색", () => {
    const P = DEFAULT_TEXTBOOK_PARAMS;
    const results: { label: string; mape: number; med: number; w20: number; max: number }[] = [];
    const floatingFactors = [0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.8];
    const outsideOptions = [0, 50, 100, 200, 400, 800];
    const gapExps = [0.5, 1.0, 1.5, 2.0];
    const aggs = [0, 0.1, 0.2];

    for (const resR of ALL_RADII) {
      for (const floR of ALL_RADII) {
        const rows = withRadii(base, resR, floR);
        if (rows.some((r) => r.input.pop1km == null || r.input.floatingByRadius[500] == null)) continue;
        for (const useAge of [true, false]) {
          for (const ff of floatingFactors) {
            for (const oo of outsideOptions) {
              for (const ge of gapExps) {
                for (const ag of aggs) {
                  const p: TextbookParams = {
                    ...P, residentRadius: 1000, floatingRadius: 500,
                    useResidentAgeWeights: useAge, useFloatingAgeWeights: useAge,
                    floatingFactor: ff, outsideOptionIp: oo, gapExponent: ge, agglomerationFactor: ag,
                  };
                  const sc = scoreTextbook(rows, p);
                  if (sc.mape == null) continue;
                  results.push({
                    label: `주거${resR} 유동${floR} 연령${useAge ? "on" : "off"} ff=${ff} oo=${oo} gamma=${ge} agg=${ag}`,
                    mape: sc.mape, med: sc.medianAbsErr ?? 1, w20: sc.within20 ?? 0, max: sc.maxAbsErr ?? 9,
                  });
                }
              }
            }
          }
        }
      }
    }
    results.sort((a, b) => a.mape - b.mape);
    console.log(`\n조합 ${results.length}개 · 상위 15개 (MAPE 낮은 순)`);
    for (const r of results.slice(0, 15)) {
      console.log(`  MAPE ${(r.mape * 100).toFixed(2)}%  중앙 ${(r.med * 100).toFixed(1)}%  ±20% ${(r.w20 * 100).toFixed(0)}%  최대 ${(r.max * 100).toFixed(0)}%   ${r.label}`);
    }
    expect(results.length).toBeGreaterThan(0);
  });
});
