// 계산 과정 설명(how-it-works 화면)이 보여주는 숫자 테스트 (2026-09-14 신설).
//
// 이 화면의 존재 이유가 "숫자가 실제로 어떻게 나왔는지 보여준다"는 것이라, **여기서 보여주는
// 값이 실제 예측과 한 자리라도 다르면 화면 전체가 거짓말이 된다.** 그래서 고정하는 건 모양이
// 아니라 동일성이다 — 각 줄의 값이 저장된 결과·기존 계산 함수와 같은 값인지.
//
// 2026-09-03에 기여도 라벨과 값이 몇 달간 어긋나 있던 전례가 있어서(revenueDrivers.ts 주석),
// "라벨과 값이 짝이 맞는가"도 같이 본다.

import { describe, expect, it } from "vitest";
import { buildWalkthrough, type WalkRow } from "./calcWalkthrough";
import { computeMarketDemand } from "./calc";
import { mergeModelSettings } from "./settings";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import type { CandidateInput, EvaluationResult } from "./types";

const settings = mergeModelSettings(null);

/** 주거중심이 되도록(유동/거주 = 2배) 잡은 최소 입력. 연령 합계는 pop1km의 50% 이상이어야 한다. */
const candidate = {
  floating500Avg: 6000,
  pop500m: 3000,
  floating500Male: 3300,
  floating500_10s: 0,
  floating500_20s: 0,
  floating500_30s: 0,
  floating500_40s: 0,
  floating500_50s: 0,
  floating500_60plus: 0,
  pop1km: 10000,
  male1kmRatio: 0.5,
  age1km_0_9: 500,
  age1km_10_19: 1200,
  age1km_20_29: 1500,
  age1km_30_39: 1500,
  age1km_40_49: 1500,
  age1km_50_59: 1000,
  age1km_60_69: 500,
  age1km_70_79: 300,
  age1km_80plus: 200,
} satisfies Partial<CandidateInput> as CandidateInput;

const result = {
  candidateCode: "N999",
  candidateName: "테스트",
  marketDemand: 1234,
  marketGrade: "A",
  expectedPcCount: 100,
  hourlyRate: 1300,
  competitorIp: 240,
  ownCompetitivenessScore: 3.42,
  competitorAvgCompetitiveness: 2.88,
  competitivenessGap: 1.1875,
  expectedOwnDemand: 617,
  inflowRestriction: "보통",
  v62Rate: -0.03,
  v62Final: 54_000_000,
  v62FinalBeforeCap: 54_000_000,
  conservativeSales: 45_900_000,
  upperSales: 62_100_000,
  v61Baseline: 55_670_000,
  v61ModelLabel: "PC 이용량·먹거리 분리 학습",
  v61TrainingSampleCount: 38,
  revenueBreakdown: {
    pcHours: 33_000,
    uncappedPcHours: 33_000,
    pcRevenue: 42_900_000,
    productRevenue: 11_100_000,
    monthlyRevenue: 54_000_000,
    revenueBeforeCap: 54_000_000,
    capacityCapped: false,
    baselineRevenue: 55_670_000,
    overflowRevenue: 0,
    sampleCount: 38,
    usageDrivers: null,
    usageDroppedTariff: false,
  },
} as unknown as EvaluationResult;

const rowsOf = (walk: NonNullable<ReturnType<typeof buildWalkthrough>>, step: 1 | 2 | 3) =>
  walk.steps.find((s) => s.step === step)!.rows;

const find = (rows: WalkRow[], label: string) => rows.find((r) => r.label.includes(label));

describe("계산 과정 설명", () => {
  it("평가결과가 없으면 아무것도 만들지 않는다", () => {
    // 아직 계산한 적 없는 후보지의 숫자를 여기서 지어내면 안 된다.
    expect(buildWalkthrough(candidate, null, settings)).toBeNull();
  });

  it("1단계 상권수요는 evaluate.ts가 쓰는 함수와 같은 값을 낸다", () => {
    const walk = buildWalkthrough(candidate, result, settings)!;
    const expected = computeMarketDemand(candidate, settings);
    const rows = rowsOf(walk, 1);

    expect(find(rows, "상권 성격")?.value).toBe(expected.marketCharacter);
    expect(find(rows, "원수요")?.value).toBe(expected.rawDemand);
    expect(find(rows, "= 상권수요")?.value).toBe(expected.marketDemand);
  });

  it("1단계 인정 비율은 판정된 상권 성격의 설정값을 그대로 쓴다", () => {
    const walk = buildWalkthrough(candidate, result, settings)!;
    const rows = rowsOf(walk, 1);
    // 위 입력은 유동/거주 = 2배라 주거중심이다.
    expect(find(rows, "상권 성격")?.value).toBe("주거중심");
    expect(find(rows, "인정 비율")?.value).toBe(settings.marketDemandEffectiveRate.residential);
  });

  it("2단계 값은 전부 저장된 결과에서 꺼낸 것이다", () => {
    const rows = rowsOf(buildWalkthrough(candidate, result, settings)!, 2);
    expect(find(rows, "우리 매장 경쟁력 점수")?.value).toBe(result.ownCompetitivenessScore);
    expect(find(rows, "경쟁점 평균 경쟁력 점수")?.value).toBe(result.competitorAvgCompetitiveness);
    expect(find(rows, "경쟁력 격차")?.value).toBe(result.competitivenessGap);
    expect(find(rows, "경쟁점 PC 대수 합계")?.value).toBe(result.competitorIp);
    expect(find(rows, "올 손님")?.value).toBe(result.expectedOwnDemand);
  });

  it("2단계 '우리 몫'은 자사수요 ÷ 상권수요와 같다", () => {
    const rows = rowsOf(buildWalkthrough(candidate, result, settings)!, 2);
    expect(find(rows, "우리 몫")?.value).toBeCloseTo(617 / 1234, 10);
  });

  it("3단계는 보정 전 → 보정 → 최종 순서로, 최종값이 저장된 V62와 같다", () => {
    const rows = rowsOf(buildWalkthrough(candidate, result, settings)!, 3);
    expect(find(rows, "처음 내놓은 값")?.value).toBe(result.revenueBreakdown!.baselineRevenue);
    expect(find(rows, "유입제약 보정")?.value).toBe(result.v62Rate);
    expect(find(rows, "= 최종 예상 월매출")?.value).toBe(result.v62Final);
    expect(find(rows, "PC 매출")?.value).toBe(result.revenueBreakdown!.pcRevenue);
    expect(find(rows, "먹거리 매출")?.value).toBe(result.revenueBreakdown!.productRevenue);
    expect(find(rows, "보수적으로")?.value).toBe(result.conservativeSales);
    expect(find(rows, "잘 되면")?.value).toBe(result.upperSales);
  });

  it("가동률 상한에 안 걸렸으면 그 줄을 아예 안 그린다", () => {
    const rows = rowsOf(buildWalkthrough(candidate, result, settings)!, 3);
    expect(find(rows, "상한에 걸리기 전")).toBeUndefined();
  });

  it("가동률 상한에 걸렸으면 걸리기 전 값을 같이 보여준다", () => {
    const capped = {
      ...result,
      revenueBreakdown: { ...result.revenueBreakdown!, capacityCapped: true, revenueBeforeCap: 60_000_000 },
    } as EvaluationResult;
    const rows = rowsOf(buildWalkthrough(candidate, capped, settings)!, 3);
    expect(find(rows, "상한에 걸리기 전")?.value).toBe(60_000_000);
  });

  it("경쟁점 넘침 몫이 0이면 그 줄을 안 그린다", () => {
    expect(find(rowsOf(buildWalkthrough(candidate, result, settings)!, 3), "못 받은 손님")).toBeUndefined();
  });

  it("이용량 모형을 못 쓴 결과도 최종값까지는 보여준다", () => {
    const fallback = { ...result, revenueBreakdown: undefined } as EvaluationResult;
    const rows = rowsOf(buildWalkthrough(candidate, fallback, settings)!, 3);
    expect(find(rows, "기본 예상매출")?.value).toBe(result.v61Baseline);
    expect(find(rows, "= 최종 예상 월매출")?.value).toBe(result.v62Final);
  });

  it("입력이 모자라면 지어내지 않고 막힌 이유를 남긴다", () => {
    const empty = { ...candidate, floating500Avg: null, pop500m: null } as unknown as CandidateInput;
    const walk = buildWalkthrough(empty, result, settings)!;
    const step1 = walk.steps.find((s) => s.step === 1)!;
    expect(step1.blocked).toBeTruthy();
    expect(find(step1.rows, "= 상권수요")).toBeUndefined();
  });

  it("저장된 결과 이후 입력이 바뀌면 그 사실을 알린다", () => {
    // 저장된 marketDemand(1234)는 위 입력으로 다시 계산한 값과 다르다.
    expect(buildWalkthrough(candidate, result, settings)!.inputsChangedSinceResult).toBe(true);

    const recomputed = computeMarketDemand(candidate, settings).marketDemand;
    const fresh = { ...result, marketDemand: recomputed } as EvaluationResult;
    expect(buildWalkthrough(candidate, fresh, settings)!.inputsChangedSinceResult).toBe(false);
  });

  it("모든 줄은 라벨이 있고, 단계마다 결론 줄은 하나뿐이다", () => {
    const walk = buildWalkthrough(candidate, result, settings)!;
    for (const step of walk.steps) {
      expect(step.rows.every((r) => r.label.length > 0)).toBe(true);
      expect(step.rows.filter((r) => r.result).length).toBe(1);
    }
  });
});

// 운영 스냅샷이 있으면 실제 후보지로도 돌린다. 새로 표시하는 값은 실데이터로 한 번 돌려보라는
// 규칙(docs/handoff-to-codex-20260913.md)에 따른 것이다 — 단위 테스트는 내가 상정한 값만 넣는다.
const snapshotDescribe = hasValidationSnapshot() ? describe : describe.skip;

snapshotDescribe("운영 스냅샷 실데이터", () => {
  const snapshot = loadValidationSnapshot<{
    candidates: CandidateInput[];
    results: EvaluationResult[];
    settings: Record<string, unknown> | null;
  }>();
  const live = mergeModelSettings(snapshot.settings as never);

  it("저장된 후보지 전부에서 최종값이 저장된 V62와 정확히 같다", () => {
    const byCode = new Map(snapshot.results.map((r) => [r.candidateCode, r]));
    let checked = 0;
    for (const c of snapshot.candidates) {
      const stored = byCode.get(c.code);
      if (!stored || stored.v62Final == null) continue;
      const walk = buildWalkthrough(c, stored, live)!;
      const rows = rowsOf(walk, 3);
      expect(find(rows, "= 최종 예상 월매출")?.value, c.code).toBe(stored.v62Final);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("저장된 후보지 전부에서 1단계 상권수요가 계산 함수와 같다", () => {
    for (const c of snapshot.candidates) {
      const stored = snapshot.results.find((r) => r.candidateCode === c.code);
      if (!stored) continue;
      const rows = rowsOf(buildWalkthrough(c, stored, live)!, 1);
      const row = find(rows, "= 상권수요");
      if (!row) continue; // 입력이 모자란 후보지는 blocked로 막혀 있다
      expect(row.value, c.code).toBe(computeMarketDemand(c, live).marketDemand);
    }
  });

  it("숫자 줄에 NaN·Infinity가 없다", () => {
    for (const c of snapshot.candidates) {
      const stored = snapshot.results.find((r) => r.candidateCode === c.code);
      if (!stored) continue;
      for (const step of buildWalkthrough(c, stored, live)!.steps) {
        for (const row of step.rows) {
          if (typeof row.value !== "number") continue;
          expect(Number.isFinite(row.value), `${c.code} ${row.label}`).toBe(true);
        }
      }
    }
  });
});
