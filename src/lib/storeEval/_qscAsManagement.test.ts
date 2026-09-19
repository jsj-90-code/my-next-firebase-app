// QSC를 관리 점수로 넣었을 때 적중률 (2026-09-20)
//
// ── 이 파일이 두 번 바뀌었다 ───────────────────────────────────────────────
// 1차(2026-09-20 새벽) — QSC를 **학습 피처**로 넣을지 **관리 점수**로 넣을지 재려고 만들었다.
//    그때는 관리 점수 갈래(B)를 운영 코드로 재지 못하고 **근사**했다. 경쟁력점수를
//    `(새관리 - 옛관리) x 시설비중 x 관리내부비중`만큼 직접 밀어서 흉내 낸 것이다.
// 2차(2026-09-20, 지금) — 관리 점수로 **실제로 옮긴 뒤**라, 근사를 걷어내고 운영과 **같은
//    함수**(`existingStoreEvaluationPatch`)를 통과시킨다. 시설점수 재정규화·경쟁점 평균 대비
//    격차 재계산이 근사식에는 없었으므로, 아래 숫자는 1차 표와 조금 다를 수 있다.
//    **운영 화면과 맞춰야 하는 건 1차 표가 아니라 이쪽이다.**
//
// ⚠️ 입력 조립은 `validation/page.tsx`의 `inputs`와 **나란히 놓고 diff**할 것. 2026-09-20에
//    `_liveCheck`가 `preemptionScore`를 빠뜨려 하루치 측정을 통째로 버렸다.
//
// ── 바닥은 70으로 확정됐다 ─────────────────────────────────────────────────
// 근거는 MAPE가 아니라 **자사/경쟁 비대칭**이다(calc.ts `QSC_MANAGEMENT_FLOOR` 주석).
// 자사는 본사 QSC, 경쟁점은 점포개발자 상/중/하 평가라 자가 다르므로, 자사 평균이 지금(4.00)에서
// 얼마나 벗어나는지가 "자사만 유리해지는가"를 가른다. 바닥 70이 평균 4.00에 제일 가깝다.
// ⚠️ **아래 바닥 훑기는 참고용이다. MAPE로 바닥을 다시 고르지 말 것** — 대조군을 어느 바닥에서도
//    못 넘는다(60 p=0.075 · 70 p=0.144 · 80 p=0.259).
//
// 실행:
//   npx vitest run src/lib/storeEval/_qscAsManagement.test.ts --disable-console-intercept
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { existingStoreEvaluationPatch, existingStoreSourceCode } from "./existingStoreEvaluation";
import {
  QSC_MANAGEMENT_FLOOR,
  computeCompetitorInvestigationSummary,
  franchiseAverageManagement,
  qscToManagementScore,
  summarizeValidationRows,
  type ValidationStoreInput,
} from "./calc";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import { qscInWindowAverage, type QscRecord } from "./labInput";
import { mergeModelSettings } from "./settings";
import type { Competitor, ExistingStore, ExistingStoreMonthlySales, LocationEvaluation, ModelSettings } from "./types";

const CACHE = new URL("../../../.local-tools/liveCheck-cache.json", import.meta.url);
const SNAP = new URL("../../../.local-tools/validation-snapshot.json", import.meta.url);

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

describe("QSC를 관리 점수로 넣었을 때 적중률", () => {
  const cache = JSON.parse(readFileSync(CACHE, "utf8")) as {
    storedStores: ExistingStore[]; competitors: Competitor[];
    locations: LocationEvaluation[]; salesRows: ExistingStoreMonthlySales[];
    settings: Partial<ModelSettings>;
  };
  const settings = mergeModelSettings(cache.settings);
  const compsByCandidate = new Map<string, Competitor[]>();
  for (const c of cache.competitors) {
    compsByCandidate.set(c.candidateCode, [...(compsByCandidate.get(c.candidateCode) ?? []), c]);
  }
  const locByCandidate = new Map(cache.locations.map((l) => [l.candidateCode, l]));
  const qsc = qscScores();

  /**
   * `prepareExistingStoresForEvaluation`과 **같은 일**을 하되 바닥을 바꿔 끼울 수 있게 한 것.
   * 갈아끼우는 규칙(환산 -> 없으면 가맹점 평균)과 패치 함수는 운영과 같다.
   * `floor = null`이면 아예 안 갈아끼운다 = 저장된 관리 4.00 = 2026-09-19까지의 운영.
   */
  const prepare = (floor: number | null): ExistingStore[] => {
    const mgmtFor = (code: string) => floor == null ? null : qscToManagementScore(qsc.get(code), floor);
    const avg = floor == null ? null
      : franchiseAverageManagement(cache.storedStores.map((s) => mgmtFor(s.storeCode)));
    return cache.storedStores.map((s) => {
      const code = existingStoreSourceCode(s);
      const management = avg == null ? null : (mgmtFor(s.storeCode) ?? avg);
      const withManagement = management == null ? s : { ...s, ownManagementScore: management };
      return {
        ...withManagement,
        ...existingStoreEvaluationPatch(
          withManagement, compsByCandidate.get(code) ?? [], locByCandidate.get(code) ?? null, settings, management,
        ),
      };
    });
  };

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

  const score = (inputs: ValidationStoreInput[]) => {
    const { rows } = runUsageCohortValidation(inputs, cache.salesRows, settings);
    const core = rows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy);
    return { s: summarizeValidationRows(core, { mape: settings.targetMAE, medianAe: settings.targetMedianAE,
      within10: settings.target10pctRatio, within20: settings.target20pctRatio, maxBias: settings.maxAvgBias }), core };
  };

  /** 자사 관리 점수 평균 — "자사만 유리해지는가"를 가르는 값이다. */
  const ownAverage = (stores: ExistingStore[]) => {
    const vs = stores.map((s) => s.ownManagementScore).filter((v): v is number => v != null);
    return vs.reduce((a, b) => a + b, 0) / (vs.length || 1);
  };

  it("바닥 70(채택) · 기준선 · 바닥 훑기", () => {
    const pct = (v: number | null, d = 2) => (v == null ? "-" : `${(v * 100).toFixed(d)}%`);
    const worst = (r: ReturnType<typeof score>) => Math.max(...r.core.map((x) => x.absoluteErrorPct ?? 0));
    const line = (label: string, stores: ExistingStore[]) => {
      const r = score(build(stores));
      console.log(
        `  ${label.padEnd(30)}${pct(r.s.meanAbsoluteErrorPct).padStart(9)}${pct(r.s.medianAbsoluteErrorPct).padStart(9)}` +
        `${pct(r.s.within10PctRatio, 0).padStart(8)}${pct(r.s.within20PctRatio, 0).padStart(8)}${pct(worst(r)).padStart(9)}` +
        `${ownAverage(stores).toFixed(2).padStart(9)}`);
    };

    console.log(`\n  QSC 있는 매장 ${qsc.size}곳 · 확정 바닥 ${QSC_MANAGEMENT_FLOOR}`);
    console.log(`\n══ QSC -> 관리 점수 (n=38 리브원아웃, 운영 코드 경로) ══`);
    console.log(`  ${"".padEnd(30)}${"MAPE".padStart(9)}${"중앙".padStart(9)}${"±10%".padStart(8)}${"±20%".padStart(8)}${"최악".padStart(9)}${"자사평균".padStart(9)}`);
    line("QSC 안 씀 (2026-09-19 운영)", prepare(null));
    line(`바닥 ${QSC_MANAGEMENT_FLOOR} (채택 · 지금 운영)`, prepare(QSC_MANAGEMENT_FLOOR));

    console.log(`\n  ── 참고: 바닥 훑기 (MAPE로 다시 고르지 말 것 — 위 주석) ──`);
    for (const floor of [60, 65, 70, 75, 80]) line(`바닥 ${floor}`, prepare(floor));
    console.log(`\n  자사 평균이 4.00에서 멀어질수록 자사/경쟁 비교가 한쪽으로 기운다.`);
    console.log(`  경쟁점은 점포개발자 상/중/하 평가(평균 2.67)라 **자가 다르다**.`);
  });

  // 확정된 바닥이 코드에 그대로 있는지 못박는다. 여기가 바뀌면 위 표도 다시 재야 한다.
  it("바닥은 70이고, QSC 없는 매장은 가맹점 평균을 받는다", () => {
    expect(QSC_MANAGEMENT_FLOOR).toBe(70);
    expect(qsc.size).toBeGreaterThan(20);
    const withQsc = prepare(QSC_MANAGEMENT_FLOOR);
    // 전 매장이 값을 갖는다 — 두 자가 섞이면 안 된다.
    expect(withQsc.every((s) => s.ownManagementScore != null)).toBe(true);
    // 자사 평균이 옛 4.00 근처에 남는다(바닥 70을 고른 이유 그 자체다).
    expect(Math.abs(ownAverage(withQsc) - 4)).toBeLessThan(0.25);
  });
});
