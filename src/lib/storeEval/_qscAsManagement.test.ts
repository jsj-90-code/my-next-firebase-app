// QSC를 **관리 점수로** 넣을 것인가, **학습 피처로** 넣을 것인가 (2026-09-20)
//
// ⚠️ 오늘(2026-09-19 밤) 운영 V62에 QSC를 **학습 피처**(log(QSC/92.6))로 넣었다. 그런데
//    실험실은 같은 QSC를 **관리 점수 칸**에 넣는다(`qscToManagementScore`). 그리고 그 선택은
//    사용자가 뜻으로 정한 것이었다:
//
//      *"나는 관리점수에 QSC가 반영되었으면한데, 배율적용하면 약간 보정값이잖아"*
//
//    `labInput.ts`가 그 원칙을 이렇게 적어 뒀다 — **"항목은 뜻으로 정하고 계수만 자료로
//    정한다."** 학습 피처는 예측에 곱해지는 보정항이라, 사용자가 거부한 "배율"에 가깝다.
//    즉 **내가 사용자 뜻과 다른 자리에 넣었을 수 있다.**
//
// ── 세 가지를 나란히 잰다 ──────────────────────────────────────────────────
//   A 지금(피처)     관리 4.00 고정 + log(QSC/92.6)을 학습 피처로
//   B 실험실 뜻      관리 = 1 + (QSC-60) x (4/40) · 피처 없음
//   C 둘 다          ⚠️ 이중계산. 얼마나 겹치는지 보려고만 잰다 — 채택 후보가 아니다.
//
// ⚠️ **경쟁점에는 QSC가 없다.** 자사만 관리 점수가 움직이므로 경쟁력격차도 같이 움직인다.
//    그게 B의 부작용이고, 그래서 A와 단순 비교가 안 된다는 점을 염두에 두고 읽어야 한다.
//
// 실행:
//   npx vitest run src/lib/storeEval/_qscAsManagement.test.ts --disable-console-intercept
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import {
  computeCompetitorInvestigationSummary,
  summarizeValidationRows,
  type ValidationStoreInput,
} from "./calc";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import { qscInWindowAverage, type QscRecord } from "./labInput";
/** 바닥을 바꿔가며 보려고 여기서 직접 환산한다(labInput의 qscToManagementScore와 같은 식). */
const toMgmt = (q, floor) => q == null || !Number.isFinite(q) || q <= 0 ? null : Math.max(1, Math.min(5, 1 + (q - floor) * (4 / (100 - floor))));
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

describe("QSC를 관리 점수로 넣을 것인가, 학습 피처로 넣을 것인가", () => {
  const cache = JSON.parse(readFileSync(CACHE, "utf8")) as {
    storedStores: ExistingStore[]; competitors: Competitor[];
    locations: LocationEvaluation[]; salesRows: ExistingStoreMonthlySales[];
    settings: Partial<ModelSettings>;
  };
  const settings = mergeModelSettings(cache.settings);
  const stores = prepareExistingStoresForEvaluation(cache.storedStores, cache.competitors, cache.locations, settings);
  const compsByCandidate = new Map<string, Competitor[]>();
  for (const c of cache.competitors) {
    compsByCandidate.set(c.candidateCode, [...(compsByCandidate.get(c.candidateCode) ?? []), c]);
  }
  const locByCandidate = new Map(cache.locations.map((l) => [l.candidateCode, l]));
  const qsc = qscScores();

  // 관리 점수 한 칸이 경쟁력점수에 미치는 무게 = 시설비중 x 관리 내부비중.
  const wMgmt = settings.competitivenessWeights.interior * settings.facilityWeights.management;

  // QSC가 없는 매장에는 **있는 곳들의 평균 관리 점수**를 넣는다(두 자가 섞이지 않게 —
  // labInput.ts franchiseAverageManagement와 같은 규칙).
  const mgmtFor = (floor: number) => {
    const m = new Map<string, number>();
    for (const s of stores) {
      const v = toMgmt(qsc.get(s.storeCode) ?? null, floor);
      if (v != null) m.set(s.storeCode, v);
    }
    const avg = [...m.values()].reduce((a, b) => a + b, 0) / (m.size || 1);
    return { byCode: m, avg };
  };

  const build = (mode: "A" | "B" | "C", floor = 60): ValidationStoreInput[] => stores.map((s) => {
    const { byCode: mgmtByCode, avg: mgmtAvg } = mgmtFor(floor);
    const code = existingStoreSourceCode(s);
    const loc = locByCandidate.get(code) ?? null;
    const comps = compsByCandidate.get(code) ?? [];
    const base: ValidationStoreInput = {
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
    // 피처로 넣는 갈래(A·C)
    if (mode === "A" || mode === "C") base.qscScore = qsc.get(s.storeCode) ?? null;
    // 관리 점수로 넣는 갈래(B·C) — 자사 경쟁력점수를 그만큼 옮긴다(경쟁점은 QSC가 없어 그대로).
    if (mode === "B" || mode === "C") {
      const now = s.ownManagementScore ?? 4;
      const next = mgmtByCode.get(s.storeCode) ?? mgmtAvg;
      const d = (next - now) * wMgmt;
      const own0 = base.competitivenessScore ?? null, gap0 = base.competitivenessGap ?? null;
      const avg = own0 != null && gap0 != null && gap0 > 0 ? own0 / gap0 : null;
      const own1 = own0 != null ? own0 + d : null;
      base.competitivenessScore = own1 ?? base.competitivenessScore;
      base.competitivenessGap = own1 != null && avg != null && avg > 0 ? own1 / avg : base.competitivenessGap;
    }
    return base;
  });

  const score = (inputs: ValidationStoreInput[]) => {
    const { rows } = runUsageCohortValidation(inputs, cache.salesRows, settings);
    const core = rows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy);
    return { s: summarizeValidationRows(core, { mape: settings.targetMAE, medianAe: settings.targetMedianAE,
      within10: settings.target10pctRatio, within20: settings.target20pctRatio, maxBias: settings.maxAvgBias }), core };
  };

  it("A(피처) · B(관리점수) · C(둘 다)", () => {
    const pct = (v: number | null, d = 2) => (v == null ? "-" : `${(v * 100).toFixed(d)}%`);
    console.log(`\n  QSC 있는 매장 ${mgmtFor(60).byCode.size}곳 · 지금 운영은 38곳 전부 4.00` +
      ` · 관리 한 칸의 경쟁력 무게 ${(wMgmt * 100).toFixed(1)}%`);
    console.log(`\n══ QSC를 어디에 넣나 (n=38 리브원아웃) ══`);
    console.log(`  ${"".padEnd(30)}${"MAPE".padStart(9)}${"중앙".padStart(9)}${"±10%".padStart(8)}${"±20%".padStart(8)}${"최악".padStart(9)}`);
    const worst = (r: ReturnType<typeof score>) => Math.max(...r.core.map((x) => x.absoluteErrorPct ?? 0));
    const line = (label: string, r: ReturnType<typeof score>) => console.log(
      `  ${label.padEnd(30)}${pct(r.s.meanAbsoluteErrorPct).padStart(9)}${pct(r.s.medianAbsoluteErrorPct).padStart(9)}` +
      `${pct(r.s.within10PctRatio, 0).padStart(8)}${pct(r.s.within20PctRatio, 0).padStart(8)}${pct(worst(r)).padStart(9)}`);

    // QSC를 아예 안 쓰는 기준선도 같이 본다.
    const none = build("A").map((x) => ({ ...x, qscScore: null }));
    line("QSC 안 씀 (기준선)", score(none));
    line("A 학습 피처 (지금 운영)", score(build("A")));
    line("C 둘 다 ⚠️이중계산", score(build("C")));

    // ── 바닥을 훑는다 — 사용자: *"60이였나 70이였나"* ─────────────────────
    // 바닥이 바뀌면 **자사 평균 관리점수의 수준**이 같이 움직인다. 경쟁점은 점포개발자
    // 상/중/하 평가라 자가 다르므로, 자사 평균이 지금(4.00)에서 얼마나 벗어나는지가
    // "자사만 유리해지는가"를 가른다.
    console.log(`\n  ── B 관리 점수: 바닥을 어디로 두나 ──`);
    for (const floor of [60, 65, 70, 75, 80]) {
      const { avg } = mgmtFor(floor);
      line(`B 바닥 ${floor} (자사평균 ${avg.toFixed(2)})`, score(build("B", floor)));
    }
    console.log(`\n  지금 운영의 자사 관리점수는 38곳 전부 4.00이다. 바닥 70이면 평균이 4.00 근처라`);
    console.log(`  **수준은 그대로 두고 매장별 변별만 생긴다** — 자사/경쟁 비교를 안 건드린다.`);
    expect(mgmtFor(60).byCode.size).toBeGreaterThan(20);
  });
});
