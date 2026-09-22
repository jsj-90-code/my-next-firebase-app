// 주소만 알 때 V62는 얼마나 맞히나 — **점포개발 초기 모드**의 정확도 (2026-09-22 밤)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 사용자(2026-09-22): *"주소만 기입하면 예상매출까지 나오도록. 점포개발 초기 완전 초기자료.
//   자동으로 안 되는 건 보정값 또는 고정값으로 변환해서 진행하자. V62에 덮어씌우는 형태 말고."*
//
// 그 도구를 만들기 전에 **답해야 할 숫자가 하나** 있다: 조사값을 전부 기본값으로 바꾸면
// 오차가 얼마가 되나. 이게 없으면 도구를 만들어 놓고도 "이 숫자를 얼마나 믿나"에 답을 못 한다.
// 초기 자료라도 ±20%인지 ±50%인지는 말해 줘야 쓸 수 있다.
//
// ── 어떻게 재나 ───────────────────────────────────────────────────────────
// **운영 V62를 그대로 쓴다**(`storedAccuracyParity`와 같은 배선. 한 인자도 안 바꾼다).
// 바꾸는 건 **입력 자료뿐**이다 — 현장 조사로만 알 수 있는 칸을 비워서, 코드에 이미 있는
// 기본값 장치가 대신 채우게 둔다:
//     경쟁점 대수 빈칸  -> computeCompetitorAppliedPcCount의 간략_기본대수
//     경쟁점 품질 빈칸  -> 자사와 같은 함수가 결측으로 처리(동급 취급)
//     입지평가 없음     -> hasLocationEvaluation=false로 그 항이 빠진다
//
// ⚠️ **자사 쪽은 안 비운다.** 자사 PC대수·시급·시설 구성은 현장 조사가 아니라 **기획값**이라
//    점포개발 초기에도 사람이 정한다. 그걸 비우면 재는 대상이 달라진다.
// ⚠️ 운영 V62 코드는 **한 글자도 안 건드린다.** 입력만 갈아 끼운다.
//
// 실행: npx vitest run src/lib/storeEval/_addressOnlyMode.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  computeCompetitorInvestigationSummary, resolveManagementScores, summarizeValidationRows,
  type ValidationStoreInput,
} from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { qscInWindowAverage, type QscRecord } from "./labInput";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "./existingStoreEvaluation";
import { mergeModelSettings } from "./settings";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import type {
  Competitor, ExistingStore, ExistingStoreMonthlySales, LocationEvaluation,
} from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;

/** 현장 조사로만 알 수 있는 칸 — 주소만 아는 단계에서는 전부 빈칸이다. */
const QUALITY_FIELDS = [
  "singleSeatCount", "room1", "room2", "teamRoom", "coupleZone", "vipZone",
  "friendsZone", "firstClassZone", "regularCoupleSeatCount", "teamRoomTotalSeats",
  "vgaBase", "vgaTop", "vgaTop2", "cpu", "cpuTop1", "cpuTop2",
  "ram", "ramTop", "monitorBase", "monitorTop",
  "foodScore", "interiorScore", "managementScore",
] as const;
const PC_COUNT_FIELDS = ["totalPcCount", "appliedPcCount"] as const;

describeIf("주소만 알 때 V62는 얼마나 맞히나", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  const settings = mergeModelSettings(snap.settings);
  const rawCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wantedSalesIds = new Set(evaluationSalesIds(snap.existingStores as ExistingStore[]));
  const sales: ExistingStoreMonthlySales[] = (snap.sales ?? [])
    .filter((s: ExistingStoreMonthlySales) => wantedSalesIds.has(`${s.storeCode}_${s.yearMonth}`));
  const qscByStoreCode = new Map<string, number>();
  for (const d of (snap.labQscScores ?? []) as { storeCode?: string; openedAt?: string | null; records?: QscRecord[] }[]) {
    if (!d.storeCode) continue;
    const avg = qscInWindowAverage(d.records ?? [], d.openedAt ?? null);
    if (avg != null && avg > 0) qscByStoreCode.set(d.storeCode, avg);
  }

  /** 조사 칸을 비운 경쟁점 자료를 만든다. 원본은 안 건드린다. */
  const blankCompetitors = (opts: { quality: boolean; pcCount: boolean }): Competitor[] =>
    rawCompetitors.map((c) => {
      const out = { ...c } as unknown as Record<string, unknown>;
      if (opts.quality) for (const k of QUALITY_FIELDS) out[k] = null;
      if (opts.pcCount) {
        for (const k of PC_COUNT_FIELDS) out[k] = null;
        // 대수를 모르면 조사수준도 "간략"이다 — 그래야 기본대수 장치가 작동한다.
        out.surveyLevel = "간략";
      }
      return out as unknown as Competitor;
    });

  /**
   * ⚠️ **가시성 점수는 V62 정식검증군의 필수 조건이다**(`isCoreEligibleForV61Training` 안의
   * `hasRequiredVisibility`). 입지평가를 통째로 비웠더니 표본이 0이 됐다.
   * 주소만으로는 가시성을 모르므로 **고정값으로 치환**한다(사용자 지시: "자동으로 안 되는 건
   * 보정값 또는 고정값으로 변환"). 표본 중앙값을 쓴다 — 고른 값이므로 여기 적어 둔다.
   */
  const visibilityFallback = (() => {
    const v = (snap.locationEvaluations as LocationEvaluation[])
      .map((l) => l.visibilityScore).filter((x): x is number => x != null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  })();

  /** `storedAccuracyParity`와 **같은 배선**. 자료만 갈아 끼운다. */
  const run = (competitors: Competitor[], useLocation: boolean) => {
    const stores = prepareExistingStoresForEvaluation(
      snap.existingStores, competitors, snap.locationEvaluations, settings, qscByStoreCode,
    );
    const byLookup = new Map<string, Competitor[]>();
    for (const c of competitors) byLookup.set(c.candidateCode, [...(byLookup.get(c.candidateCode) ?? []), c]);
    const locByLookup = new Map((snap.locationEvaluations as LocationEvaluation[]).map((l) => [l.candidateCode, l]));
    const inputs: ValidationStoreInput[] = stores.map((s) => {
      const lookupCode = existingStoreSourceCode(s);
      const raw = locByLookup.get(lookupCode) ?? null;
      const loc = useLocation ? raw : null;
      const cs = byLookup.get(lookupCode) ?? [];
      return {
        storeCode: s.storeCode, storeName: s.storeName,
        // ⚠️ 브랜드는 **입지평가를 안 해도 안다** — 우리가 정하는 값이지 조사값이 아니다.
        //    입지평가를 통째로 비웠더니 여기 붙어 있던 브랜드까지 사라져 정식검증군이 0이 됐다.
        brand: s.brandType ?? raw?.brandType ?? null,
        openedAt: s.openedAt, completedMonths: s.completedMonths ?? 0,
        franchiseStatus: s.franchiseStatus,
        isPostOpenIssue: s.excludedFromModel, postOpenIssueReason: s.excludedReason,
        pcCount: s.pcCount, evaluationPcCount: s.evaluationPcCount, hourlyRate: s.hourlyRate,
        ownDemand: s.ownDemand, marketDemand: s.marketDemand, competitorIp: s.competitorIp,
        extraPcHours: computeOverflowPcHours(
          s.marketDemand,
          { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore },
          cs, settings,
        ),
        competitivenessScore: s.competitivenessScore, competitivenessGap: s.competitivenessGap,
        actualRevenueAvg: s.actualMonthlyRevenueAvg,
        specialDemandType: s.specialDemandType, specialDemandIntensity: s.specialDemandIntensity,
        inflowRestriction: loc?.inflowRestriction ?? null,
        // 가시성만은 고정값으로 대체한다(위 주석) — 없으면 정식검증군이 통째로 빈다.
        visibilityScore: useLocation ? (loc?.visibilityScore ?? null) : visibilityFallback,
        preemptionScore: loc?.preemptionScore ?? null,
        hasLocationEvaluation: loc != null,
        floor: s.floor, groundLevel: s.groundLevel, hasElevator: s.hasElevator,
        competitorSummary: computeCompetitorInvestigationSummary(cs),
        sheetV61Predicted: s.v61Predicted,
      };
    });
    const { rows } = runUsageCohortValidation(inputs, sales, settings);
    const core = rows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy);
    return summarizeValidationRows(core, {
      mape: settings.targetMAE, medianAe: settings.targetMedianAE,
      within10: settings.target10pctRatio, within20: settings.target20pctRatio,
      maxBias: settings.maxAvgBias,
    });
  };

  it("⭐ 조사값을 하나씩 빼면 V62 정확도가 어떻게 되나", () => {
    const pct = (v: number | null | undefined) => (v == null ? "    -" : `${(v * 100).toFixed(2)}%`);
    const levels: { name: string; s: ReturnType<typeof run> }[] = [
      { name: "L0 지금 — 전부 조사됨", s: run(rawCompetitors, true) },
      { name: "L1 경쟁점 품질만 기본값", s: run(blankCompetitors({ quality: true, pcCount: false }), true) },
      { name: "L2 + 경쟁점 대수도 기본값", s: run(blankCompetitors({ quality: true, pcCount: true }), true) },
      { name: "L3 + 입지평가도 없음 ← 주소만", s: run(blankCompetitors({ quality: true, pcCount: true }), false) },
    ];
    console.log(`\n[주소만 모드] 운영 V62 그대로 · 입력 자료만 비운다 · 정식검증군 기준`);
    console.log(`  단계                          n     MAPE    중앙값   ±10%    ±20%    편향`);
    for (const { name, s } of levels) {
      console.log(`  ${name.padEnd(28)}${String(s.sampleCount).padStart(3)}  ${pct(s.meanAbsoluteErrorPct)}`
        + `  ${pct(s.medianAbsoluteErrorPct)}  ${pct(s.within10PctRatio)}  ${pct(s.within20PctRatio)}`
        + `  ${pct(s.avgBiasPct)}`);
    }
    const l0 = levels[0].s.meanAbsoluteErrorPct ?? 0, l3 = levels[3].s.meanAbsoluteErrorPct ?? 0;
    console.log(`\n  ⭐ **주소만 넣으면 MAPE ${pct(l0)} -> ${pct(l3)}** (${(l3 / l0).toFixed(2)}배)`);
    console.log(`  ⚠️ 자사 쪽(PC대수·시급·시설 구성)은 안 비웠다 — 그건 조사가 아니라 **기획값**이라`);
    console.log(`     점포개발 초기에도 사람이 정한다. 그것까지 표준값으로 두면 더 나빠진다.`);
    console.log(`  ⚠️ 이 표는 **기존점 40곳으로 잰 것**이다. 후보지에서는 경쟁점 자료가 더 부실해`);
    console.log(`     실제로는 이보다 나쁠 수 있다(오늘 구리돌다리에서 500m 경쟁점 3곳만 조사된 걸 봤다).`);
    console.log(`\n  ⭐ **설계에 중요한 것 — L1이 L2보다 나쁘다**(12.57% vs 10.82%).`);
    console.log(`     품질만 비우고 대수는 실측을 쓰면 자료가 어긋나서 더 틀린다.`);
    console.log(`     => **어설프게 반만 채우지 마라.** 일관되게 다 기본값으로 가는 게 낫다.`);
    console.log(`        조사가 들어오면 품질·대수를 **같이** 채워야 한다.`);
    expect(levels[0].s.sampleCount).toBeGreaterThan(0);
  });
});
