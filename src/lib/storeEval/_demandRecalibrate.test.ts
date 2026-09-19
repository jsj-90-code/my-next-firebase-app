// 유동 400m로 바꾼 뒤 수요 계수를 다시 맞추면 나아지나 (2026-09-20)
//
// ── 무엇을 묻나 ────────────────────────────────────────────────────────────
// 사용자: *"유동400으로한다음에 수요 (주거,유동) 계수/산식 조정 방식"*
// 2026-09-20 1차 측정에서 400m를 그대로 넣으면 나빠졌다(MAPE 8.83% -> 9.10%).
// 계수를 400m에 맞춰 다시 잡으면 되돌아오는가?
//
// ── 먼저 기전 (여기를 안 보면 헛수고한다) ──────────────────────────────────
// 학습 피처는 `log(상권수요 ÷ (자사PC + 경쟁IP))`이고 학습 전에 **표준화**된다. 그래서:
//
//   ⚠️ **유동에 전역 배율 k를 곱하면 log(k)만큼의 상수 이동이라 학습이 통째로 흡수한다.**
//      즉 "유동 계수를 키운다"는 조정은 **거의 항등변환**이다(2026-09-19 수요 축척 A
//      정규화가 아무 일도 안 했던 것과 같은 함정 — storeeval 실험 판정 기준 ⑤).
//      완전한 항등은 아니다: 배율이 **상권성격 분류**(유동500÷거주500)를 움직이고, 분류가
//      유효율을 고르기 때문이다. 그 경로만 남는다. 아래 (1)에서 실제로 확인한다.
//
//   그래서 **진짜 자유도는 둘뿐이다.**
//     ① 유효율 3개의 **상대** 수준 (전체 배율은 흡수되므로 실질 2자유도)
//        = 사실상 "상권성격 3분류 더미의 상대 높이"를 조정하는 것이다.
//     ② 분류 임계값 (어느 매장이 어느 더미를 받는가)
//
// ── 공정성 ─────────────────────────────────────────────────────────────────
// ⚠️ 400m에만 계수를 맞춰 주고 500m는 기본값으로 두면 **비교가 조작된다.**
//    그래서 **두 반경 각각에 같은 격자를 돌려 "각자의 최선"끼리 비교**한다.
//
// ⚠️⚠️ **이 격자탐색은 평가에 쓰는 바로 그 38곳에서 고른다 = 데이터 누출이다.**
//    리브원아웃은 *모형 계수*만 빼고 학습하지 최적 유효율은 전 매장을 보고 고른다.
//    그래서 아래 "최선"은 **달성 가능한 상한**이지 기대 성능이 아니다. 무작위 대조군을
//    같이 돌려 "아무 격자나 돌려도 이만큼은 좋아진다"의 크기를 같이 잰다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_demandRecalibrate.test.ts --disable-console-intercept
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import {
  computeCompetitorInvestigationSummary,
  computeMarketCharacter,
  summarizeValidationRows,
  type ValidationStoreInput,
} from "./calc";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import { qscInWindowAverage, type QscRecord } from "./labInput";
import { mergeModelSettings } from "./settings";
import type { Competitor, ExistingStore, ExistingStoreMonthlySales, LocationEvaluation, ModelSettings } from "./types";

const CACHE = new URL("../../../.local-tools/liveCheck-cache.json", import.meta.url);
const SNAP = new URL("../../../.local-tools/validation-snapshot.json", import.meta.url);

// 300m도 같이 본다 — 1차 측정에서 300m(MAPE 8.94%)가 400m(9.10%)보다 나았다.
// 사용자: *"사실 유동은 300정도가 더 적합한것같기도"*
type Radius = 100 | 200 | 300 | 400 | 500;
const RADII: Radius[] = [100, 200, 300, 400, 500];

function withRadius(s: ExistingStore, r: Radius, scale = 1): ExistingStore {
  const g = (suffix: string) => {
    const v = (s as unknown as Record<string, number | null | undefined>)[`floating${r}${suffix}`] ?? null;
    return v == null ? null : v * scale;
  };
  return {
    ...s,
    floating500Avg: g("Avg"), floating500Male: g("Male"),
    floating500_10s: g("_10s"), floating500_20s: g("_20s"), floating500_30s: g("_30s"),
    floating500_40s: g("_40s"), floating500_50s: g("_50s"), floating500_60plus: g("_60plus"),
  };
}

function qscScores(): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const s = JSON.parse(readFileSync(SNAP, "utf8")) as {
      labQscScores?: { storeCode?: string; openedAt?: string | null; records?: QscRecord[] }[];
    };
    for (const d of s.labQscScores ?? []) {
      if (!d.storeCode) continue;
      const a = qscInWindowAverage(d.records ?? [], d.openedAt ?? null);
      if (a != null && a > 0) out.set(d.storeCode, a);
    }
  } catch { /* 없으면 QSC 없이 잰다 */ }
  return out;
}

describe("유동 400m + 수요 계수 재조정", () => {
  const cache = JSON.parse(readFileSync(CACHE, "utf8")) as {
    storedStores: ExistingStore[]; competitors: Competitor[];
    locations: LocationEvaluation[]; salesRows: ExistingStoreMonthlySales[];
    settings: Partial<ModelSettings>;
  };
  const base = mergeModelSettings(cache.settings);
  const qsc = qscScores();
  const compsByCandidate = new Map<string, Competitor[]>();
  for (const c of cache.competitors) {
    compsByCandidate.set(c.candidateCode, [...(compsByCandidate.get(c.candidateCode) ?? []), c]);
  }
  const locByCandidate = new Map(cache.locations.map((l) => [l.candidateCode, l]));

  /** ⚠️ validation/page.tsx의 inputs 조립과 나란히 놓고 diff할 것. */
  const build = (stores: ExistingStore[], settings: ModelSettings): ValidationStoreInput[] => stores.map((s) => {
    const code = existingStoreSourceCode(s);
    const loc = locByCandidate.get(code) ?? null;
    const comps = compsByCandidate.get(code) ?? [];
    return {
      storeCode: s.storeCode, storeName: s.storeName, brand: s.brandType ?? loc?.brandType ?? null,
      openedAt: s.openedAt, completedMonths: s.completedMonths ?? 0, franchiseStatus: s.franchiseStatus,
      isPostOpenIssue: s.excludedFromModel, postOpenIssueReason: s.excludedReason,
      pcCount: s.pcCount, evaluationPcCount: s.evaluationPcCount, hourlyRate: s.hourlyRate,
      ownDemand: s.ownDemand, marketDemand: s.marketDemand, competitorIp: s.competitorIp,
      extraPcHours: computeOverflowPcHours(s.marketDemand,
        { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore }, comps, settings),
      competitivenessScore: s.competitivenessScore, competitivenessGap: s.competitivenessGap,
      actualRevenueAvg: s.actualMonthlyRevenueAvg, specialDemandType: s.specialDemandType,
      specialDemandIntensity: s.specialDemandIntensity, inflowRestriction: loc?.inflowRestriction ?? null,
      visibilityScore: loc?.visibilityScore ?? null, preemptionScore: loc?.preemptionScore ?? null,
      hasLocationEvaluation: loc != null,
      floor: s.floor, groundLevel: s.groundLevel, hasElevator: s.hasElevator,
      competitorSummary: computeCompetitorInvestigationSummary(comps), sheetV61Predicted: s.v61Predicted,
    };
  });

  type Knobs = {
    radius: Radius;
    /** 유동에 곱하는 전역 배율. 기전 확인용(거의 흡수된다). */
    floatScale?: number;
    /** 상권성격 임계값 배율. 400m는 유동이 줄어드니 같은 분류를 유지하려면 <1이어야 한다. */
    thresholdScale?: number;
    rate?: Partial<ModelSettings["marketDemandEffectiveRate"]>;
  };

  const run = ({ radius, floatScale = 1, thresholdScale = 1, rate }: Knobs) => {
    const settings: ModelSettings = {
      ...base,
      marketCharacterThreshold: {
        downtown: base.marketCharacterThreshold.downtown * thresholdScale,
        mixed: base.marketCharacterThreshold.mixed * thresholdScale,
      },
      marketDemandEffectiveRate: { ...base.marketDemandEffectiveRate, ...rate },
    };
    const swapped = cache.storedStores.map((s) => withRadius(s, radius, floatScale));
    const stores = prepareExistingStoresForEvaluation(swapped, cache.competitors, cache.locations, settings, qsc);
    const { rows } = runUsageCohortValidation(build(stores, settings), cache.salesRows, settings);
    const core = rows.filter((x) => x.brand === "블랙라벨" && x.includedInCoreAccuracy);
    return {
      swapped, settings, core,
      s: summarizeValidationRows(core, { mape: base.targetMAE, medianAe: base.targetMedianAE,
        within10: base.target10pctRatio, within20: base.target20pctRatio, maxBias: base.maxAvgBias }),
    };
  };

  const pct = (v: number | null, d = 2) => (v == null ? "-" : `${(v * 100).toFixed(d)}%`);
  const nOf = (ratio: number | null, total: number) => ratio == null ? "-" : `${Math.round(ratio * total)}곳`;
  const line = (label: string, r: ReturnType<typeof run>) => console.log(
    `  ${label.padEnd(34)}${pct(r.s.meanAbsoluteErrorPct).padStart(9)}${pct(r.s.medianAbsoluteErrorPct).padStart(9)}` +
    `${nOf(r.s.within10PctRatio, r.core.length).padStart(8)}${nOf(r.s.within20PctRatio, r.core.length).padStart(8)}`);
  const head = () => console.log(`  ${"".padEnd(34)}${"MAPE".padStart(9)}${"중앙".padStart(9)}${"±10%".padStart(8)}${"±20%".padStart(8)}`);

  const charCounts = (r: ReturnType<typeof run>) => {
    const t: Record<string, number> = {};
    for (const s of r.swapped) {
      const c = computeMarketCharacter(s.floating500Avg, s.pop500m, r.settings) ?? "없음";
      t[c] = (t[c] ?? 0) + 1;
    }
    return t;
  };
  const showChar = (label: string, r: ReturnType<typeof run>) =>
    console.log(`  ${label.padEnd(34)}` + Object.entries(charCounts(r)).map(([k, v]) => `${k} ${v}곳`).join(" · "));

  it("(1) 기전 확인 — 유동에 전역 배율을 곱하면 무슨 일이 일어나나", () => {
    console.log(`\n══ (1) 유동 전역 배율 k — 학습이 흡수하는가 (300m 기준) ══`);
    head();
    for (const k of [1.0, 1.18, 1.5, 2.0]) line(`300m · k=${k.toFixed(2)}`, run({ radius: 300, floatScale: k }));
    console.log(`\n  ↑ MAPE가 거의 안 움직이면 **배율은 학습이 흡수한다**는 뜻이다(항등변환).`);
    console.log(`     조금 움직이는 몫은 배율이 상권성격 분류를 밀어낸 것이다:`);
    for (const k of [1.0, 1.18, 1.5, 2.0]) showChar(`  300m · k=${k.toFixed(2)}`, run({ radius: 300, floatScale: k }));
    expect(true).toBe(true);
  });

  it("(2) 분류를 500m와 같게 맞추면 — 임계값 재조정", () => {
    console.log(`\n══ (2) 분류 이동을 걷어내면 좁은 반경이 살아나나 ══`);
    const ref = charCounts(run({ radius: 500 }));
    console.log(`  기준(500m 현행) 분류: ` + Object.entries(ref).map(([k, v]) => `${k} ${v}곳`).join(" · "));
    head();
    line("500m 현행 (대조)", run({ radius: 500 }));
    for (const radius of [300, 400] as Radius[]) {
      for (const ts of [1.0, 0.85, 0.75, 0.65, 0.55]) {
        line(`${radius}m · 임계값 x${ts.toFixed(2)}`, run({ radius, thresholdScale: ts }));
      }
    }
    console.log(`  분류 분포:`);
    for (const radius of [300, 400] as Radius[]) {
      for (const ts of [1.0, 0.75, 0.55]) showChar(`  ${radius}m · 임계값 x${ts.toFixed(2)}`, run({ radius, thresholdScale: ts }));
    }
    expect(true).toBe(true);
  });

  it("(3) 유효율 격자 — 두 반경에 **같은 격자**를 돌려 각자의 최선끼리 비교", () => {
    // 혼합은 0.61로 고정한다. 전체 배율은 학습이 흡수하므로 상대값만 의미가 있고,
    // 하나를 고정해야 "같은 것을 두 번 세는" 자유도가 안 생긴다.
    // ⚠️ 1차 격자(번화가 최솟값 0.55)에서 **다섯 반경 전부 하한에 붙었다.** 그건 "자료가
    //    0.55를 골랐다"가 아니라 "격자 끝이 골랐다"는 뜻이다(계수 고착 검사와 같은 논리).
    //    그래서 아래로 넓혔다. 넓혀도 계속 하한에 붙으면 **그 방향은 자료가 지지하지만 값은
    //    자료가 못 정한다**는 뜻이므로 채택 근거가 될 수 없다.
    const DOWNTOWN = [0.30, 0.40, 0.50, 0.55, 0.61, 0.689, 0.80, 0.95];
    const RESIDENT = [0.30, 0.40, 0.50, 0.546, 0.61, 0.75];
    const THRESH = [1.0, 0.85, 0.7, 0.55];

    console.log(`\n══ (3) 유효율 격자 (혼합 0.61 고정 · 반경마다 ${DOWNTOWN.length}x${RESIDENT.length}x${THRESH.length} = ${DOWNTOWN.length * RESIDENT.length * THRESH.length}조합) ══`);
    console.log(`  ⚠️ 평가하는 바로 그 38곳에서 고른다 = **데이터 누출**. 아래 "최선"은 상한이지 기대 성능이 아니다.`);

    const best: Record<number, { mape: number; label: string; r: ReturnType<typeof run> }> = {};
    for (const radius of RADII) {
      for (const thresholdScale of THRESH) {
        for (const downtown of DOWNTOWN) {
          for (const residential of RESIDENT) {
            const r = run({ radius, thresholdScale, rate: { downtown, residential } });
            const m = r.s.meanAbsoluteErrorPct;
            if (m == null) continue;
            if (!best[radius] || m < best[radius].mape) {
              best[radius] = { mape: m, r, label: `임계값 x${thresholdScale} · 번화가 ${downtown} · 주거 ${residential}` };
            }
          }
        }
      }
    }

    console.log(`\n  ── 기본 계수 (조정 전) ──`);
    head();
    for (const radius of RADII) line(`${radius}m 기본계수`, run({ radius }));

    console.log(`\n  ── 각 반경의 격자 최선 (같은 격자를 똑같이 돌렸다) ──`);
    head();
    for (const radius of RADII) {
      line(`${radius}m 격자 최선`, best[radius].r);
      console.log(`     ${best[radius].label}`);
    }

    console.log(`\n  ── 반경별 개선폭 (기본계수 -> 격자최선) ──`);
    for (const radius of RADII) {
      const b = run({ radius }).s.meanAbsoluteErrorPct!;
      console.log(`  ${radius}m: ${pct(b)} -> ${pct(best[radius].mape)}   (${((best[radius].mape - b) * 100).toFixed(2)}%p)`);
    }
    // ── 격자 끝에 붙었나 (계수 고착 검사) ────────────────────────────────
    const loD = Math.min(...DOWNTOWN), hiD = Math.max(...DOWNTOWN);
    const loR = Math.min(...RESIDENT), hiR = Math.max(...RESIDENT);
    console.log(`\n  ── ⚠️ 격자 끝에 붙었나 (붙었으면 값을 자료가 아니라 격자가 정한 것이다) ──`);
    for (const radius of RADII) {
      const m = best[radius].label.match(/번화가 ([\d.]+) · 주거 ([\d.]+)/)!;
      const d = Number(m[1]), r = Number(m[2]);
      const tags = [
        d === loD ? "번화가 하한" : d === hiD ? "번화가 상한" : null,
        r === loR ? "주거 하한" : r === hiR ? "주거 상한" : null,
      ].filter(Boolean);
      console.log(`  ${radius}m: ${tags.length ? "⚠️ " + tags.join(" · ") + " 에 붙음" : "격자 안쪽 (고착 아님)"}`);
    }

    console.log(`\n  ── 읽는 법 ──`);
    console.log(`  모든 반경이 격자로 비슷하게 좋아진다면, 그건 반경의 공이 아니라`);
    console.log(`  **유효율 2자유도를 38곳에 맞춘 과적합**이다. 한 반경만 유독 더 좋아져야 의미가 있다.`);
    expect(best[500].mape).toBeGreaterThan(0);
  }, 600_000);

  it("(4) ⭐ 무작위 대조군 — 상권성격을 섞어도 격자가 같은 만큼 좋아지나", () => {
    // ── 이 검사가 답을 가른다 ────────────────────────────────────────────
    // "유효율을 다시 맞추면 좋아진다"가 신호이려면, **상권성격이 실제로 뭔가를 가를 때만**
    // 좋아져야 한다. 라벨을 무작위로 섞었는데도 같은 만큼 좋아진다면 그 개선은
    // "3분류 더미에 2자유도를 준 것"일 뿐이다(무작위 대조군 — 이 저장소의 1번 관문).
    //
    // 섞는 방법: `pop500m`을 매장끼리 뒤섞는다. pop500m은 **상권성격 판정에만** 쓰이고
    // (주거 원수요는 pop1km·age1km_*를 쓴다) 다른 계산에 안 들어가므로, 이걸 섞으면
    // **분류만 무작위가 되고 나머지는 그대로**다. 깨끗한 대조군이다.
    const COARSE_D = [0.40, 0.55, 0.689, 0.85];
    const COARSE_R = [0.35, 0.50, 0.546, 0.70];
    const gridBest = (stores: ExistingStore[], radius: Radius) => {
      let bestM = Infinity;
      for (const downtown of COARSE_D) for (const residential of COARSE_R) {
        const settings: ModelSettings = { ...base, marketDemandEffectiveRate: { ...base.marketDemandEffectiveRate, downtown, residential } };
        const swapped = stores.map((s) => withRadius(s, radius));
        const prepared = prepareExistingStoresForEvaluation(swapped, cache.competitors, cache.locations, settings, qsc);
        const { rows } = runUsageCohortValidation(build(prepared, settings), cache.salesRows, settings);
        const core = rows.filter((x) => x.brand === "블랙라벨" && x.includedInCoreAccuracy);
        const m = summarizeValidationRows(core, { mape: base.targetMAE, medianAe: base.targetMedianAE,
          within10: base.target10pctRatio, within20: base.target20pctRatio, maxBias: base.maxAvgBias }).meanAbsoluteErrorPct;
        if (m != null && m < bestM) bestM = m;
      }
      return bestM;
    };

    // 재현 가능한 난수(고정 씨앗) — 돌릴 때마다 결론이 바뀌면 안 된다.
    let seed = 20260920;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const shuffled = () => {
      const pops = cache.storedStores.map((s) => s.pop500m);
      for (let i = pops.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [pops[i], pops[j]] = [pops[j], pops[i]];
      }
      return cache.storedStores.map((s, i) => ({ ...s, pop500m: pops[i] }));
    };

    console.log(`\n══ (4) ⭐ 무작위 대조군 — 상권성격 라벨을 섞어도 좋아지나 (거친 격자 4x4) ══`);
    for (const radius of [300, 500] as Radius[]) {
      const real0 = gridBest(cache.storedStores, radius);
      const plain = run({ radius }).s.meanAbsoluteErrorPct!;
      const realGain = (real0 - plain) * 100;
      const gains: number[] = [];
      for (let t = 0; t < 12; t++) {
        const st = shuffled();
        const b = gridBest(st, radius);
        const p = (() => {
          const swapped = st.map((s) => withRadius(s, radius));
          const prepared = prepareExistingStoresForEvaluation(swapped, cache.competitors, cache.locations, base, qsc);
          const { rows } = runUsageCohortValidation(build(prepared, base), cache.salesRows, base);
          const core = rows.filter((x) => x.brand === "블랙라벨" && x.includedInCoreAccuracy);
          return summarizeValidationRows(core, { mape: base.targetMAE, medianAe: base.targetMedianAE,
            within10: base.target10pctRatio, within20: base.target20pctRatio, maxBias: base.maxAvgBias }).meanAbsoluteErrorPct!;
        })();
        gains.push((b - p) * 100);
      }
      gains.sort((a, b) => a - b);
      const med = gains[Math.floor(gains.length / 2)];
      const beats = gains.filter((g) => g <= realGain).length;
      console.log(`  ${radius}m  진짜 라벨 개선 ${realGain.toFixed(3)}%p  ·  무작위 라벨 개선 중앙 ${med.toFixed(3)}%p ` +
        `(최대개선 ${gains[0].toFixed(3)} ~ 최소 ${gains.at(-1)!.toFixed(3)})`);
      console.log(`        무작위 ${gains.length}회 중 진짜만큼 좋아진 횟수: ${beats}회  ->  p ≈ ${(beats / gains.length).toFixed(2)}`);
    }
    console.log(`\n  p가 작아야(≈0.05 이하) "상권성격이 실제로 뭔가를 가른다"고 말할 수 있다.`);
    console.log(`  p가 크면 유효율 조정의 개선은 **더미 2자유도를 38곳에 맞춘 것**일 뿐이다.`);
    expect(true).toBe(true);
  }, 900_000);
});
