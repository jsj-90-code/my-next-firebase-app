// 유동인구 반경을 400m로 바꾸면 운영 V62가 어떻게 되나 (2026-09-20)
//
// ── 왜 재나 ────────────────────────────────────────────────────────────────
// 실험실(교과서식 수요모형)은 유동 **400m**를 쓰고 운영 V62는 **500m**를 쓴다.
// 실험실 근거(`textbookModel.ts` DEFAULT_TEXTBOOK_PARAMS 주석):
//   *"500m는 수원망포점처럼 지하철 상권을 먹는다(300→400m에서 4.19배 점프). 100~300m는 너무
//     좁아 오차가 커진다. 독점 5% 체를 통과한 조합이 전부 400m 계열이었다."*
//
// ⚠️ **그 근거는 실험실 모형 안에서 잰 값이다.** V62는 다른 식이다 —
//    유동에 연령·성별 이용률을 곱해 원수요를 내고(`estimateRawDemand`) 거기에 유효율
//    (번화가 .53 / 혼합 .61 / 주거중심 .78)을 곱한다. 그러니 V62에서 다시 재야 한다.
//
// ⚠️⚠️ **반경을 바꾸면 시장성격 판정도 같이 움직인다.** `computeMarketCharacter`가
//    "유동500 ÷ 거주500"으로 번화가/혼합/주거중심을 가르고, 그 분류가 유효율을 고른다.
//    즉 이건 필드 하나 갈아끼우는 게 아니라 **매장 분류가 통째로 흔들리는 변경**이다.
//    그래서 적중률뿐 아니라 **분류가 몇 곳 바뀌는지**를 같이 찍는다.
//
// ⚠️ 입력 조립은 `validation/page.tsx`의 `inputs`와 **나란히 놓고 diff**할 것.
//    2026-09-20에 `_liveCheck`가 `preemptionScore`를 빠뜨려 하루치 측정을 버렸다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_floatingRadius.test.ts --disable-console-intercept
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import {
  computeCompetitorInvestigationSummary,
  computeMarketCharacter,
  computeMarketDemand,
  summarizeValidationRows,
  type ValidationStoreInput,
} from "./calc";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import { qscInWindowAverage, type QscRecord } from "./labInput";
import { mergeModelSettings } from "./settings";
import type { Competitor, ExistingStore, ExistingStoreMonthlySales, LocationEvaluation, ModelSettings } from "./types";

const CACHE = new URL("../../../.local-tools/liveCheck-cache.json", import.meta.url);
const SNAP = new URL("../../../.local-tools/validation-snapshot.json", import.meta.url);

const RADII = [100, 200, 300, 400, 500] as const;
type Radius = (typeof RADII)[number];

/** 운영이 읽는 칸은 `floating500*` 하나뿐이다. 다른 반경을 재려면 그 칸에 갈아끼운다. */
function withRadius(s: ExistingStore, r: Radius): ExistingStore {
  if (r === 500) return s;
  const g = (suffix: string) => (s as unknown as Record<string, number | null | undefined>)[`floating${r}${suffix}`] ?? null;
  return {
    ...s,
    floating500Avg: g("Avg"),
    floating500Male: g("Male"),
    floating500_10s: g("_10s"),
    floating500_20s: g("_20s"),
    floating500_30s: g("_30s"),
    floating500_40s: g("_40s"),
    floating500_50s: g("_50s"),
    floating500_60plus: g("_60plus"),
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

describe("유동인구 반경 — 실험실 400m를 운영 V62에 넣으면", () => {
  const cache = JSON.parse(readFileSync(CACHE, "utf8")) as {
    storedStores: ExistingStore[]; competitors: Competitor[];
    locations: LocationEvaluation[]; salesRows: ExistingStoreMonthlySales[];
    settings: Partial<ModelSettings>;
  };
  const settings = mergeModelSettings(cache.settings);
  const qsc = qscScores();
  const compsByCandidate = new Map<string, Competitor[]>();
  for (const c of cache.competitors) {
    compsByCandidate.set(c.candidateCode, [...(compsByCandidate.get(c.candidateCode) ?? []), c]);
  }
  const locByCandidate = new Map(cache.locations.map((l) => [l.candidateCode, l]));

  /** ⚠️ validation/page.tsx의 inputs 조립과 나란히 놓고 diff할 것. */
  const build = (stores: ExistingStore[]): ValidationStoreInput[] => stores.map((s) => {
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

  /** 반경 하나로 운영 경로를 통째로 돌린다(관리 점수는 QSC 환산값 — 지금 운영 그대로). */
  const run = (r: Radius) => {
    const swapped = cache.storedStores.map((s) => withRadius(s, r));
    const stores = prepareExistingStoresForEvaluation(swapped, cache.competitors, cache.locations, settings, qsc);
    const { rows } = runUsageCohortValidation(build(stores), cache.salesRows, settings);
    const core = rows.filter((x) => x.brand === "블랙라벨" && x.includedInCoreAccuracy);
    return {
      swapped, stores, core,
      s: summarizeValidationRows(core, { mape: settings.targetMAE, medianAe: settings.targetMedianAE,
        within10: settings.target10pctRatio, within20: settings.target20pctRatio, maxBias: settings.maxAvgBias }),
    };
  };

  const results = new Map(RADII.map((r) => [r, run(r)]));

  it("반경별 적중률 · 시장성격 분류 이동", () => {
    const pct = (v: number | null, d = 2) => (v == null ? "-" : `${(v * 100).toFixed(d)}%`);
    const n = (ratio: number | null, total: number) => ratio == null ? "-" : `${Math.round(ratio * total)}곳`;

    console.log(`\n══ 유동 반경을 바꾸면 (정식검증군 n=38 리브원아웃, 운영 코드 경로) ══`);
    console.log(`  ${"반경".padEnd(10)}${"MAPE".padStart(9)}${"중앙".padStart(9)}${"±10%".padStart(10)}${"±20%".padStart(10)}${"최악".padStart(9)}`);
    for (const r of RADII) {
      const { s, core } = results.get(r)!;
      const worst = Math.max(...core.map((x) => x.absoluteErrorPct ?? 0));
      const tag = r === 500 ? " <- 지금 운영" : r === 400 ? " <- 실험실" : "";
      console.log(`  ${(r + "m").padEnd(10)}${pct(s.meanAbsoluteErrorPct).padStart(9)}${pct(s.medianAbsoluteErrorPct).padStart(9)}` +
        `${n(s.within10PctRatio, core.length).padStart(10)}${n(s.within20PctRatio, core.length).padStart(10)}${pct(worst).padStart(9)}${tag}`);
    }

    // ── 시장성격 분류 이동 (이게 반경 교체의 진짜 비용이다) ─────────────────
    const charOf = (stores: ExistingStore[]) => new Map(stores.map((s) =>
      [s.storeCode, computeMarketCharacter(s.floating500Avg, s.pop500m, settings)]));
    const base = charOf(results.get(500)!.swapped);

    console.log(`\n  ── 시장성격 분류가 몇 곳 바뀌나 (기존점 ${cache.storedStores.length}곳) ──`);
    for (const r of RADII) {
      if (r === 500) continue;
      const now = charOf(results.get(r)!.swapped);
      const moved = [...base.entries()].filter(([code, c]) => now.get(code) !== c);
      const tally: Record<string, number> = {};
      for (const [code, c] of moved) tally[`${c ?? "없음"} -> ${now.get(code) ?? "없음"}`] = (tally[`${c ?? "없음"} -> ${now.get(code) ?? "없음"}`] ?? 0) + 1;
      console.log(`  ${(r + "m").padEnd(8)}${String(moved.length).padStart(3)}곳 이동   ` +
        Object.entries(tally).map(([k, v]) => `${k} ${v}곳`).join(" · "));
    }

    // 지금 운영의 분류 분포
    const dist: Record<string, number> = {};
    for (const c of base.values()) dist[c ?? "없음"] = (dist[c ?? "없음"] ?? 0) + 1;
    console.log(`  지금(500m) 분포: ` + Object.entries(dist).map(([k, v]) => `${k} ${v}곳`).join(" · "));

    // ── 상권수요가 매장별로 얼마나 움직이나 ──────────────────────────────
    console.log(`\n  ── 400m로 바꿀 때 상권수요 변화 (기존점) ──`);
    const d500 = new Map(results.get(500)!.swapped.map((s) => [s.storeCode, computeMarketDemand(s, settings).marketDemand]));
    const d400 = new Map(results.get(400)!.swapped.map((s) => [s.storeCode, computeMarketDemand(s, settings).marketDemand]));
    const deltas = [...d500.entries()]
      .map(([code, v]) => ({ code, v, w: d400.get(code) ?? null }))
      .filter((x): x is { code: string; v: number; w: number } => x.v != null && x.w != null && x.v > 0)
      .map((x) => ({ ...x, pct: ((x.w - x.v) / x.v) * 100 }))
      .sort((a, b) => a.pct - b.pct);
    const nameOf = new Map(cache.storedStores.map((s) => [s.storeCode, s.storeName]));
    const med = deltas[Math.floor(deltas.length / 2)];
    console.log(`  중앙값 ${med.pct.toFixed(1)}% · 제일 많이 내린 곳/오른 곳 3개씩`);
    for (const x of [...deltas.slice(0, 3), ...deltas.slice(-3)]) {
      console.log(`    ${(nameOf.get(x.code) ?? x.code).padEnd(16)} ${String(x.v).padStart(7)} -> ${String(x.w).padStart(7)}   ${x.pct >= 0 ? "+" : ""}${x.pct.toFixed(1)}%`);
    }
  });

  it("자료가 전 매장에 다 있다 — 반경을 바꿔도 결측이 안 생긴다", () => {
    for (const r of RADII) {
      const missing = results.get(r)!.swapped.filter((s) => s.floating500Avg == null);
      expect({ r, missing: missing.length }).toEqual({ r, missing: 0 });
    }
  });
});
