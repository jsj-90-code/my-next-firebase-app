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
