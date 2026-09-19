// 검증화면이 Firestore(storeEvalSystemStatus/accuracy)에 저장해둔 적중률이, **지금 운영
// 데이터와 지금 코드로 그대로 재현되는지** 확인한다. 후보지 화면이 그 저장값을 그대로 보여주기
// 때문에, 설정이 바뀐 뒤 검증화면을 아무도 안 열면 옛 숫자가 계속 사실처럼 표시된다.
//
// 화면 코드(validation/page.tsx loadValidationData + computed)를 그대로 따라 한다 —
// 새 산식을 만들지 않는다. 데이터만 admin SDK로 미리 떠둔 스냅샷에서 읽는다:
//   node scripts/dumpValidationSnapshot.mjs
// 스냅샷은 운영 자료라 git에 올라가지 않는다 — 없으면 이 블록 전체를 건너뛴다.
// 그래서 평소 `npm test`에서는 아무 일도 안 하고, 확인이 필요할 때 스냅샷을 떠서 돌린다.
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import {
  CORE_VALIDATION_MIN_MONTHS,
  computeCompetitorInvestigationSummary,
  computeStabilizedPerformance,
  resolveManagementScores,
  summarizeValidationRows,
  type ValidationStoreInput,
} from "./calc";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { qscInWindowAverage, type QscRecord } from "./labInput";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import {
  existingStoreEvaluationPatch,
  existingStoreSourceCode,
  prepareExistingStoresForEvaluation,
} from "./existingStoreEvaluation";
import { evaluateCandidate } from "./evaluate";
import { mergeModelSettings } from "./settings";
import { computeOverflowPcHours, runUsageCohortValidation } from "./usageRevenue";
import type {
  CandidateInput,
  Competitor,
  EvaluationResult,
  ExistingStore,
  ExistingStoreMonthlySales,
  LocationEvaluation,
} from "./types";


type Snapshot = {
  fetchedAt: string;
  candidates: CandidateInput[];
  results: (EvaluationResult & { candidateCode: string; calculatedAt?: number })[];
  existingStores: ExistingStore[];
  competitors: Record<string, unknown>[];
  locationEvaluations: LocationEvaluation[];
  sales: ExistingStoreMonthlySales[];
  /**
   * 본사 QSC 점검 기록. 2026-09-19부터 운영 V62가 관리 수준을 학습 피처로 쓴다 —
   * 여기에 안 실으면 이 시험만 QSC 없이 계산해서 **화면과 다른 숫자**로 통과/실패한다.
   * 스냅샷 키 이름은 실험실 시절 그대로지만(`labQscScores`), 내용은 운영이 읽는 것과 같은
   * 원자료다(`scripts/writeQscScoresToFirestore.mjs`가 두 컬렉션에 같은 것을 쓴다).
   */
  labQscScores?: { storeCode?: string; openedAt?: string | null; records?: QscRecord[] }[];
  settings: Record<string, unknown> | null;
  storedAccuracy: {
    sampleCount: number;
    meanAbsoluteErrorPct: number;
    medianAbsoluteErrorPct: number;
    within10PctRatio: number;
    within15PctRatio: number;
    within20PctRatio: number;
    modelVersion: string;
    updatedAt: number;
  } | null;
};

const describeIfSnapshot = hasValidationSnapshot() ? describe : describe.skip;

/** 스냅샷의 QSC 원자료 -> 매장코드별 평균. 운영과 **같은 함수**(qscInWindowAverage)를 쓴다. */
function qscScoresFrom(snap: { labQscScores?: Snapshot["labQscScores"] }): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of snap.labQscScores ?? []) {
    if (!d.storeCode) continue;
    const avg = qscInWindowAverage(d.records ?? [], d.openedAt ?? null);
    if (avg != null && avg > 0) out.set(d.storeCode, avg);
  }
  return out;
}

describeIfSnapshot("저장된 적중률이 현재 데이터·코드로 재현되는가", () => {
  const snap = loadValidationSnapshot<Snapshot>() as Snapshot;
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);

  // 화면은 12개월 평가구간 매출만 읽는다(listEvaluationSales). 전체를 넣으면 실제 평균이
  // 달라지므로 같은 필터를 여기서도 건다.
  const wantedSalesIds = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wantedSalesIds.has(`${s.storeCode}_${s.yearMonth}`));

  // ⚠️ **검증 화면(validation/page.tsx)과 나란히 놓고 diff할 것.** 한 인자라도 빠지면 운영과
  //    다른 모형을 재게 된다(2026-09-20에 _liveCheck가 preemptionScore를 빠뜨려 하루치 측정을
  //    버렸다). 2026-09-20부터 QSC는 **여기로** 들어간다 — 관리 점수가 되어 경쟁력점수로 흐른다.
  const qscByStoreCode = qscScoresFrom(snap);
  const stores = prepareExistingStoresForEvaluation(snap.existingStores, allCompetitors, snap.locationEvaluations, settings, qscByStoreCode);

  const competitorsByLookup = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    competitorsByLookup.set(c.candidateCode, [...(competitorsByLookup.get(c.candidateCode) ?? []), c]);
  }
  const locByLookup = new Map(snap.locationEvaluations.map((l) => [l.candidateCode, l]));

  const inputs: ValidationStoreInput[] = stores.map((s) => {
    const lookupCode = existingStoreSourceCode(s);
    const loc = locByLookup.get(lookupCode) ?? null;
    const competitors = competitorsByLookup.get(lookupCode) ?? [];
    return {
      storeCode: s.storeCode,
      storeName: s.storeName,
      brand: s.brandType ?? loc?.brandType ?? null,
      openedAt: s.openedAt,
      completedMonths: s.completedMonths ?? 0,
      franchiseStatus: s.franchiseStatus,
      isPostOpenIssue: s.excludedFromModel,
      postOpenIssueReason: s.excludedReason,
      pcCount: s.pcCount,
      evaluationPcCount: s.evaluationPcCount,
      hourlyRate: s.hourlyRate,
      ownDemand: s.ownDemand,
      marketDemand: s.marketDemand,
      competitorIp: s.competitorIp,
      extraPcHours: computeOverflowPcHours(
        s.marketDemand,
        { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore },
        competitors,
        settings,
      ),
      competitivenessScore: s.competitivenessScore,
      competitivenessGap: s.competitivenessGap,
      actualRevenueAvg: s.actualMonthlyRevenueAvg,
      specialDemandType: s.specialDemandType,
      specialDemandIntensity: s.specialDemandIntensity,
      inflowRestriction: loc?.inflowRestriction ?? null,
      visibilityScore: loc?.visibilityScore ?? null,
      preemptionScore: loc?.preemptionScore ?? null,
      hasLocationEvaluation: loc != null,
      floor: s.floor,
      groundLevel: s.groundLevel,
      hasElevator: s.hasElevator,
      competitorSummary: computeCompetitorInvestigationSummary(competitors),
      sheetV61Predicted: s.v61Predicted,
    };
  });

  const { rows } = runUsageCohortValidation(inputs, sales, settings);
  const coreRows = rows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy);
  const summary = summarizeValidationRows(coreRows, {
    mape: settings.targetMAE,
    medianAe: settings.targetMedianAE,
    within10: settings.target10pctRatio,
    within20: settings.target20pctRatio,
    maxBias: settings.maxAvgBias,
  });

  const stored = snap.storedAccuracy;

  it("재계산 결과를 남긴다", () => {
    const pct = (v: number | null) => (v == null ? "-" : `${(v * 100).toFixed(2)}%`);
    console.log(
      [
        `스냅샷 ${snap.fetchedAt}`,
        `정식검증군 ${summary.sampleCount}곳 (최소 완료월 ${CORE_VALIDATION_MIN_MONTHS})`,
        `MAPE ${pct(summary.meanAbsoluteErrorPct)} · 중앙값 ${pct(summary.medianAbsoluteErrorPct)}`,
        `±10% ${pct(summary.within10PctRatio)} · ±15% ${pct(summary.within15PctRatio)} · ±20% ${pct(summary.within20PctRatio)}`,
        stored
          ? `저장값: n=${stored.sampleCount} MAPE ${pct(stored.meanAbsoluteErrorPct)} ±10% ${pct(stored.within10PctRatio)} ±20% ${pct(stored.within20PctRatio)} (${new Date(stored.updatedAt).toISOString()}, ${stored.modelVersion})`
          : "저장값 없음",
      ].join("\n"),
    );
    expect(summary.sampleCount).toBeGreaterThan(0);
  });

  it("표본 수가 저장값과 같다", () => {
    expect(stored).not.toBeNull();
    expect(summary.sampleCount).toBe(stored!.sampleCount);
  });

  // 반올림 오차만 허용한다. 이보다 벌어지면 저장값이 옛 설정·옛 데이터로 계산된 것이다.
  const close = (a: number | null, b: number) => Math.abs((a ?? Number.NaN) - b) < 1e-6;

  it("MAPE·중앙값이 저장값과 같다", () => {
    expect(close(summary.meanAbsoluteErrorPct, stored!.meanAbsoluteErrorPct)).toBe(true);
    expect(close(summary.medianAbsoluteErrorPct, stored!.medianAbsoluteErrorPct)).toBe(true);
  });

  it("±10 / ±15 / ±20% 적중률이 저장값과 같다", () => {
    expect(close(summary.within10PctRatio, stored!.within10PctRatio)).toBe(true);
    expect(close(summary.within15PctRatio, stored!.within15PctRatio)).toBe(true);
    expect(close(summary.within20PctRatio, stored!.within20PctRatio)).toBe(true);
  });

  it("모형 버전 표기가 저장값과 같다", () => {
    expect(`${settings.modelVersion}-usage-v1`).toBe(stored!.modelVersion);
  });
});

// 기존점 문서에 저장돼 있는 completedMonths / actualMonthlyRevenueAvg는 크론이 매일 다시
// 계산해 넣는 파생값이다. 이 둘이 원자료(월매출)와 어긋나면 **모형이 틀린 정답지로 학습한다** —
// 적중률 숫자는 멀쩡해 보이는데 기준이 잘못된, 가장 알아채기 어려운 형태의 사고다.
describeIfSnapshot("기존점의 실제매출 파생값이 월매출 원자료와 맞는가", () => {
  const snap = loadValidationSnapshot<Snapshot>() as Snapshot;

  // cronSync.monthsBetween과 같은 계산. 진행 중인 이번 달은 크론이 빼고 계산하므로 여기서도 뺀다.
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const elapsed = (openedAt: string, yearMonth: string) => {
    const open = new Date(openedAt);
    const [y, m] = yearMonth.split("-").map(Number);
    return (y - open.getFullYear()) * 12 + (m - 1 - open.getMonth());
  };

  const salesByStore = new Map<string, ExistingStoreMonthlySales[]>();
  for (const s of snap.sales) {
    salesByStore.set(s.storeCode, [...(salesByStore.get(s.storeCode) ?? []), s]);
  }

  const mismatches: string[] = [];
  for (const store of snap.existingStores) {
    if (!store.openedAt) continue;
    const rows = (salesByStore.get(store.storeCode) ?? [])
      .filter((r) => r.yearMonth !== currentYearMonth)
      .map((r) => ({ elapsedMonths: elapsed(store.openedAt!, r.yearMonth), pcSales: r.pcSales, productSales: r.productSales }));
    if (rows.length === 0) continue;
    const recomputed = computeStabilizedPerformance(rows);

    if (recomputed.completedMonths !== (store.completedMonths ?? 0)) {
      mismatches.push(
        `${store.storeCode} ${store.storeName} 완료월 저장=${store.completedMonths} 재계산=${recomputed.completedMonths}`,
      );
    }
    const savedAvg = store.actualMonthlyRevenueAvg ?? null;
    const calcAvg = recomputed.actualMonthlyRevenueAvg;
    const bothNull = savedAvg == null && calcAvg == null;
    // 원 단위 반올림 차이는 넘긴다.
    if (!bothNull && (savedAvg == null || calcAvg == null || Math.abs(savedAvg - calcAvg) > 1)) {
      mismatches.push(`${store.storeCode} ${store.storeName} 평균 저장=${savedAvg} 재계산=${calcAvg}`);
    }
  }

  it("완료월수와 실제매출평균이 원자료에서 그대로 재현된다", () => {
    if (mismatches.length) console.log("불일치:\n" + mismatches.join("\n"));
    expect(mismatches).toEqual([]);
  });
});

// 경쟁력점수·경쟁력격차·자사수요·상권수요·경쟁점IP도 크론이 매 실행마다 다시 써넣는 캐시다.
// 검증화면은 어차피 다시 계산해서 쓰지만, **기존점 목록·프로필·스코어카드는 이 캐시를 그대로
// 보여준다**. 캐시가 뒤처져 있으면 화면 숫자와 모형이 쓰는 숫자가 달라진다.
describeIfSnapshot("기존점의 경쟁력·수요 캐시가 지금 설정으로 재현되는가", () => {
  const snap = loadValidationSnapshot<Snapshot>() as Snapshot;
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);

  const competitorsByLookup = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    competitorsByLookup.set(c.candidateCode, [...(competitorsByLookup.get(c.candidateCode) ?? []), c]);
  }
  const locByLookup = new Map(snap.locationEvaluations.map((l) => [l.candidateCode, l]));

  const FIELDS = ["competitivenessScore", "competitivenessGap", "ownDemand", "marketDemand", "competitorIp"] as const;
  const near = (a: unknown, b: unknown) => {
    if (a == null && b == null) return true;
    if (typeof a !== "number" || typeof b !== "number") return a === b;
    // 저장은 배정밀도 그대로라 사실상 완전 일치해야 한다. 아주 작은 여유만 둔다.
    return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-12);
  };

  // ⚠️ **cronSync와 나란히 놓고 diff할 것.** 이 캐시를 매일 06:00 KST에 쓰는 게 cronSync이고,
  //    2026-09-20부터 거기서 관리 점수를 QSC 환산값으로 갈아끼운다. 여기서 안 넘기면 이 시험이
  //    "캐시가 뒤처졌다"고 영영 우기게 된다(크론은 멀쩡한데).
  const management = resolveManagementScores(snap.existingStores.map((s) => s.storeCode), qscScoresFrom(snap));

  const drift: string[] = [];
  for (const store of snap.existingStores) {
    const lookupCode = existingStoreSourceCode(store);
    const patch = existingStoreEvaluationPatch(
      store,
      competitorsByLookup.get(lookupCode) ?? [],
      locByLookup.get(lookupCode) ?? null,
      settings,
      management.scoreFor(store.storeCode),
    );
    for (const key of FIELDS) {
      const saved = (store as unknown as Record<string, unknown>)[key];
      if (!near(saved, patch[key])) {
        drift.push(`${store.storeCode} ${store.storeName} ${key} 저장=${String(saved)} 재계산=${String(patch[key])}`);
      }
    }
  }

  it("저장된 캐시가 지금 설정으로 다시 계산한 값과 같다", () => {
    if (drift.length) console.log(`캐시 뒤처짐 ${drift.length}건:\n` + drift.slice(0, 30).join("\n"));
    expect(drift).toEqual([]);
  });
});

// 대시보드와 후보지 목록은 **저장된 평가 결과**(storeEvalResults)를 그대로 보여준다.
// 결과는 후보지 결과 탭을 열 때만 다시 계산해 저장되므로, 설정이나 경쟁점이 바뀐 뒤 그 탭을
// 안 열면 대시보드에는 옛 예상매출이 계속 사실처럼 떠 있는다. 얼마나 벌어져 있는지 본다.
describeIfSnapshot("저장된 후보지 평가 결과가 지금 데이터로 재현되는가", () => {
  const snap = loadValidationSnapshot<Snapshot>() as Snapshot;
  const settings = mergeModelSettings(snap.settings);
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const wantedSalesIds = new Set(evaluationSalesIds(snap.existingStores));
  const sales = snap.sales.filter((s) => wantedSalesIds.has(`${s.storeCode}_${s.yearMonth}`));

  const rows = (snap.candidates ?? []).map((candidate) => {
    const competitors = allCompetitors.filter((c) => c.candidateCode === candidate.code);
    const loc = snap.locationEvaluations.find((l) => l.candidateCode === candidate.code) ?? null;
    const recomputed = evaluateCandidate({
      candidate,
      competitors,
      locationEvaluation: loc,
      settings,
      existingStores: snap.existingStores,
      trainingLocationEvaluations: snap.locationEvaluations,
      trainingCompetitors: allCompetitors,
      trainingSales: sales,
      // 2026-09-20 — 후보지 결과 탭(ResultTab)과 같은 모양. 기존점의 **관리 점수**가 여기서
      // 나오고, 후보지 자신은 개점 전이라 점검 기록이 없어 **가맹점 평균**을 받는다.
      trainingQscScores: qscScoresFrom(snap),
    });
    const stored = (snap.results ?? []).find((r) => r.candidateCode === candidate.code) ?? null;
    const storedValue = stored?.v62Final ?? null;
    const diffPct =
      storedValue != null && storedValue > 0 && recomputed.v62Final != null
        ? (recomputed.v62Final - storedValue) / storedValue
        : null;
    // 2026-09-14 — 총액만 보면 내부값이 낡아도 통과한다. 실제로 실효단가를 넣은 날 N002·N012가
    // 그렇게 빠져나갔다(총액은 0.5% 안이었는데 저장된 PC매출÷이용시간이 아직 정가였다).
    // 계산법 화면이 그 내부값을 그대로 읽어 보여주므로, 낡으면 화면이 거짓말을 한다.
    const storedRate = stored?.revenueBreakdown && stored.revenueBreakdown.pcHours > 0
      ? stored.revenueBreakdown.pcRevenue / stored.revenueBreakdown.pcHours : null;
    const nowRate = recomputed.revenueBreakdown && recomputed.revenueBreakdown.pcHours > 0
      ? recomputed.revenueBreakdown.pcRevenue / recomputed.revenueBreakdown.pcHours : null;
    return { code: candidate.code, name: candidate.name ?? "", stored: storedValue, now: recomputed.v62Final, diffPct,
      storedRate, nowRate, calculatedAt: stored?.calculatedAt ?? null };
  });

  it("차이를 표로 남긴다", () => {
    const won = (v: number | null) => (v == null ? "-" : Math.round(v).toLocaleString("ko-KR"));
    console.log(
      ["후보지\t저장값\t지금값\t차이", ...rows.map((r) =>
        `${r.code} ${r.name}\t${won(r.stored)}\t${won(r.now)}\t${r.diffPct == null ? "-" : `${(r.diffPct * 100).toFixed(2)}%`}`,
      )].join("\n"),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  // 결과가 저장된 후보지는 지금 계산과 같아야 한다. 벌어져 있으면 대시보드가 옛 숫자다.
  it("저장된 결과가 지금 계산과 0.5% 이내로 같다", () => {
    const stale = rows.filter((r) => r.diffPct != null && Math.abs(r.diffPct) > 0.005);
    if (stale.length) {
      console.log(
        `대시보드가 뒤처진 후보지 ${stale.length}곳 — 결과 탭을 한 번 열면 갱신된다:\n` +
          stale.map((r) => `  ${r.code} ${r.name} 저장=${r.stored} 지금=${r.now} (${((r.diffPct as number) * 100).toFixed(2)}%)`).join("\n"),
      );
    }
    expect(stale.map((r) => r.code)).toEqual([]);
  });

  // 총액이 맞아도 내부값이 낡을 수 있다. 계산법 화면은 이 내부값을 읽는다.
  it("저장된 실효단가가 지금 설정과 같다 — 총액만 맞으면 놓친다", () => {
    const off = rows.filter((r) => r.storedRate != null && r.nowRate != null
      && Math.abs((r.storedRate as number) - (r.nowRate as number)) > 1);
    if (off.length) {
      console.log(
        [`저장된 실효단가가 낡은 후보지 ${off.length}곳 — 결과 탭에서 다시 계산을 누르면 갱신된다:`,
          ...off.map((r) => `  ${r.code} ${r.name} 저장=${Math.round(r.storedRate as number)}원 지금=${Math.round(r.nowRate as number)}원`),
        ].join(String.fromCharCode(10)),
      );
    }
    expect(off.map((r) => r.code)).toEqual([]);
  });
});
