// 주거형태(1인가구·아파트) 보정이 진짜인지 무작위 대조군으로 검정한다 (2026-09-16). 일회성.
//
// 왜 이 검정이 필요한가: `_newSignalsScan.test.ts`에서 교과서식 잔차와 1인가구비율이 r=-0.40,
// 아파트비율이 r=+0.40으로 붙었다. 기전도 설명된다 — 아파트 가족 세대는 집에 PC가 있고,
// 원룸 1인 가구는 PC방을 쓴다. 그럴듯하다.
//
// **그런데 이 저장소는 정확히 여기서 한 번 속았다.** 2026-09-15에 밀집도 보정이 r=0.660으로
// 훨씬 강했는데, 실제로 산식에 넣으니 MAPE가 30%→48%로 나빠졌다(docs/backlog.md).
// 표본 38곳에 파라미터를 하나 더 얹으면 잡음에도 맞아버리기 때문이다.
//
// 그래서 **무작위 대조군**을 둔다:
//   1) 진짜 신호로 보정 계수를 최적화해 MAPE 개선폭을 잰다.
//   2) 같은 신호 값을 매장끼리 무작위로 섞어(permutation) 같은 최적화를 N번 반복한다.
//      섞은 신호는 매장과 아무 관계가 없으므로, 여기서 나오는 개선은 전부 "잡음에 맞춘 몫"이다.
//   3) 진짜 개선폭이 섞은 개선폭 분포의 95퍼센타일을 넘지 못하면 **채택하지 않는다.**
//
//   npx vitest run src/lib/storeEval/_householdSignalTest.test.ts --reporter=verbose
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

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** 재현 가능한 난수 — 검정을 돌릴 때마다 결론이 흔들리면 안 된다. */
function makeRng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
describeIf("주거형태 보정 — 무작위 대조군 검정", () => {
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings);
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);

  const fl = JSON.parse(readFileSync(FLOAT_FILE, "utf8"));
  const re = JSON.parse(readFileSync(RESI_FILE, "utf8"));
  const floSites = fl.sites ?? fl;
  const resSites = re.sites ?? re;

  type Row = { input: TextbookInput; actualRevenue: number; oneFamily: number; apartment: number };
  const rows: Row[] = [];
  for (const s of stores as any[]) {
    if (s.excludedFromModel || !s.actualMonthlyRevenueAvg) continue;
    const pc = s.evaluationPcCount ?? s.pcCount;
    if (!pc) continue;
    const key = `existing:${s.storeCode}`;
    const fsite = floSites[key];
    const rsite = resSites[key];
    if (!fsite || !rsite) continue;

    const f500 = fsite.radii?.["500"];
    const r500 = rsite.radii?.["500"];
    const r1k = rsite.radii?.["1000"];
    if (!f500?.selected?.length || !r500 || !r1k) continue;

    const fam400 = rsite.radii?.["400"]?.family;
    const hou1k = r1k.house;
    if (!fam400 || !hou1k) continue;
    const oneFamily = Number(fam400.family_1_cnt) / Number(fam400.tot_family_cnt);
    const apartment = Number(hou1k.house_2_cnt) / Number(hou1k.tot_house_cnt);
    if (!Number.isFinite(oneFamily) || !Number.isFinite(apartment)) continue;

    const code = existingStoreSourceCode(s);
    const cs = compsByCode.get(code) ?? [];
    const p1k = r1k.pops;
    rows.push({
      actualRevenue: s.actualMonthlyRevenueAvg,
      oneFamily, apartment,
      input: {
        storeCode: s.storeCode, storeName: s.storeName,
        pcCount: pc, hourlyRate: s.hourlyRate,
        competitivenessGap: s.competitivenessGap,
        competitorIp: computeCompetitorIp(cs, s.operatingPcStores500m ?? null),
        competitorCount: cs.filter((c) => c.investigationStatus !== "경쟁점없음").length,
        pop500m: Number(r500.totalPopulation), pop1km: Number(r1k.totalPopulation),
        residentAges: p1k?.age_1_cnt == null ? null : {
          age0s: Number(p1k.age_1_cnt), age10s: Number(p1k.age_2_cnt), age20s: Number(p1k.age_3_cnt),
          age30s: Number(p1k.age_4_cnt), age40s: Number(p1k.age_5_cnt), age50s: Number(p1k.age_6_cnt),
          age60plus: Number(p1k.age_7_cnt) + Number(p1k.age_8_cnt) + Number(p1k.age_9_cnt),
        },
        floatingByRadius: { 500: Math.round(mean(f500.selected.slice(-12))) },
        floatingAgesByRadius: {},
      },
    });
  }

  const BASE: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, useFloatingAgeWeights: false };

  /**
   * 신호로 수요를 보정한 뒤 MAPE를 낸다.
   * 보정은 (신호/중앙값)^beta 배율이다 — 중앙값 기준이라 beta=0이면 보정 전과 완전히 같다.
   * 배율은 pop1km·pop500m·유동에 같이 걸어야 하므로, 입력 인구를 직접 곱해 넣는다.
   */
  function mapeWith(signal: number[], beta: number): number | null {
    const med = median(signal);
    if (!(med > 0)) return null;
    const scaled = rows.map((r, i) => {
      const k = Math.pow(signal[i] / med, beta);
      return {
        actualRevenue: r.actualRevenue,
        input: {
          ...r.input,
          pop500m: r.input.pop500m == null ? null : r.input.pop500m * k,
          pop1km: r.input.pop1km == null ? null : r.input.pop1km * k,
          residentAges: r.input.residentAges == null ? null : {
            age0s: r.input.residentAges.age0s * k, age10s: r.input.residentAges.age10s * k,
            age20s: r.input.residentAges.age20s * k, age30s: r.input.residentAges.age30s * k,
            age40s: r.input.residentAges.age40s * k, age50s: r.input.residentAges.age50s * k,
            age60plus: r.input.residentAges.age60plus * k,
          },
          floatingByRadius: { 500: (r.input.floatingByRadius[500] ?? 0) * k },
        },
      };
    });
    return scoreTextbook(scaled, BASE).mape;
  }

  const BETAS = [-2, -1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.5, 2];

  /** beta를 훑어 가장 좋은 MAPE를 찾는다. 보정 전(beta=0) 대비 개선폭도 같이 낸다. */
  function bestImprovement(signal: number[]): { base: number; best: number; beta: number; gain: number } | null {
    const base = mapeWith(signal, 0);
    if (base == null) return null;
    let best = base, bestBeta = 0;
    for (const b of BETAS) {
      const m = mapeWith(signal, b);
      if (m != null && m < best) { best = m; bestBeta = b; }
    }
    return { base, best, beta: bestBeta, gain: base - best };
  }

  it("표본이 잡힌다", () => {
    console.log(`표본 ${rows.length}곳`);
    expect(rows.length).toBeGreaterThan(30);
  });

  for (const [label, get] of [
    ["1인가구비율 400m", (r: Row) => r.oneFamily],
    ["아파트비율 1km", (r: Row) => r.apartment],
  ] as const) {
    it(`${label} — 무작위 대조군 대비`, () => {
      const real = rows.map(get);
      const realResult = bestImprovement(real);
      expect(realResult).not.toBeNull();
      const { base, best, beta, gain } = realResult as NonNullable<typeof realResult>;

      // 대조군: 같은 값들을 매장끼리 섞는다. 분포는 그대로고 매장과의 대응만 깨진다.
      const rng = makeRng(20260916);
      const N = 500;
      const shuffledGains: number[] = [];
      for (let iter = 0; iter < N; iter++) {
        const perm = [...real];
        for (let i = perm.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [perm[i], perm[j]] = [perm[j], perm[i]];
        }
        const res = bestImprovement(perm);
        if (res) shuffledGains.push(res.gain);
      }
      shuffledGains.sort((a, b) => a - b);
      const p95 = shuffledGains[Math.floor(shuffledGains.length * 0.95)];
      const better = shuffledGains.filter((g) => g >= gain).length;
      const pValue = (better + 1) / (shuffledGains.length + 1);

      console.log(
        `\n[${label}]\n` +
        `  보정 전 MAPE ${(base * 100).toFixed(2)}% → 보정 후 ${(best * 100).toFixed(2)}% (beta=${beta}, 개선 ${(gain * 100).toFixed(2)}%p)\n` +
        `  무작위 대조군 ${shuffledGains.length}회: 중앙 개선 ${(median(shuffledGains) * 100).toFixed(2)}%p · 95퍼센타일 ${(p95 * 100).toFixed(2)}%p\n` +
        `  p = ${pValue.toFixed(3)} → ${pValue < 0.05 ? "✅ 잡음으로 설명 안 됨 (다음 단계: 홀드아웃 검정)" : "❌ 잡음과 구별 안 됨 — 채택하지 않는다"}`,
      );
      expect(shuffledGains.length).toBeGreaterThan(100);
    });
  }
});
