// "매출은 어떻게 계산될까?" 화면에 실제 숫자가 흘러가는 과정을 만들어 준다 (2026-09-14 신설).
//
// 사용자 요청: 그 화면이 "수요란 무엇이다 / 몫이란 무엇이다"라는 정의만 적어두고 숫자가 하나도
// 없어서, 읽어도 "그래서 이 후보지 5,300만원이 어디서 나왔나"에 답이 안 된다는 것이었다.
//
// ⚠️ **여기서 새로 계산하는 산식은 하나도 없다.** 1단계는 evaluate.ts가 쓰는 것과 같은
// computeMarketDemand를 그대로 부르고, 2·3단계는 저장된 EvaluationResult가 이미 들고 있는
// 중간값을 꺼내 늘어놓기만 한다(경쟁력점수·격차·자사수요·이용시간·먹거리·보정률은 전부
// evaluate.ts가 계산해 결과에 실어둔 값이다). 규칙을 두 벌 만들면 화면과 실제 예측이 언젠가
// 갈라지므로, 계산이 필요한 자리는 반드시 기존 export를 호출한다.
//
// 표시 형식은 화면이 정한다 — 여기서는 숫자와 "어떤 종류의 숫자인지"만 돌려준다
// (revenueDrivers.ts·peerPosition.ts와 같은 방식).

import { computeMarketDemand, describeMarketGradeThresholds, type MarketDemandInput } from "./calc";
import type { EvaluationResult, ModelSettings } from "./types";

/** 화면이 formatWon/formatPercent 중 무엇을 쓸지 고르는 데 쓴다. */
export type WalkKind =
  | "won" // 금액(원)
  | "count" // 사람 수·대수 같은 정수
  | "hours" // 시간
  | "percent" // 0.03 → 3%
  | "score" // 2.88 같은 점수
  | "multiple" // 1.19 → ×1.19
  | "text";

export type WalkRow = {
  label: string;
  value: number | string | null;
  kind: WalkKind;
  /** 이 값이 어디서 왔는지 한 줄. 식이면 식 그대로 적는다. */
  note?: string;
  /** 그 단계의 결론 줄(굵게 표시). 단계마다 하나씩만 둔다. */
  result?: boolean;
};

export type WalkStep = {
  /** 1·2·3단계 */
  step: 1 | 2 | 3;
  rows: WalkRow[];
  /** 값이 모자라 단계를 못 채웠을 때 그 이유. null이면 정상. */
  blocked: string | null;
};

export type Walkthrough = {
  steps: WalkStep[];
  /** 3단계에서 실제로 쓰인 모형 이름(결과에 저장된 값 그대로). */
  modelLabel: string;
  /**
   * 저장된 결과를 만든 뒤 기본정보가 바뀌어서, 지금 입력으로 다시 구한 상권수요가 저장값과
   * 다른 경우. 1단계(지금 입력 기준)와 2·3단계(저장값 기준)가 어긋나 보이므로 화면이 알린다.
   */
  inputsChangedSinceResult: boolean;
};

type WalkSettings = Pick<
  ModelSettings,
  | "marketCharacterThreshold"
  | "marketDemandEffectiveRate"
  | "marketGradeAbsoluteThresholds"
  | "lowerBoundFactor"
  | "demandCeilingHoursPerUser"
  | "upperBoundFactor"
  | "v62MaxUtilizationRate"
>;

const EFFECTIVE_RATE_KEY = {
  번화가: "downtown",
  혼합: "mixed",
  주거중심: "residential",
} as const;

/** 한 달을 시간으로 — 가동률을 "이용시간 ÷ 전체 열린 시간"으로 보여줄 때만 쓴다(usageRevenue.ts와 같은 상수). */
const HOURS_PER_MONTH = 24 * 30;

function buildDemandStep(
  candidate: MarketDemandInput,
  result: EvaluationResult,
  settings: WalkSettings,
): { step: WalkStep; recomputedMarketDemand: number | null } {
  const demand = computeMarketDemand(candidate, settings);
  const rows: WalkRow[] = [];

  rows.push({
    label: "반경 500m 유동인구 (하루 평균)",
    value: candidate.floating500Avg,
    kind: "count",
    note: "기본정보에 입력한 값",
  });
  rows.push({
    label: "반경 500m 거주인구",
    value: candidate.pop500m,
    kind: "count",
    note: "기본정보에 입력한 값",
  });

  const ratio =
    candidate.floating500Avg != null && candidate.pop500m != null && candidate.pop500m > 0
      ? candidate.floating500Avg / candidate.pop500m
      : null;
  rows.push({
    label: "유동 ÷ 거주",
    value: ratio,
    kind: "multiple",
    note: `${settings.marketCharacterThreshold.downtown}배 이상이면 번화가, ${settings.marketCharacterThreshold.mixed}배 이상이면 혼합, 그 아래는 주거중심`,
  });

  if (!demand.marketCharacter) {
    return {
      recomputedMarketDemand: null,
      step: {
        step: 1,
        rows,
        blocked: "유동인구·거주인구가 없어서 상권 성격을 정할 수 없습니다. 기본정보를 먼저 채워주세요.",
      },
    };
  }

  rows.push({ label: "→ 상권 성격", value: demand.marketCharacter, kind: "text" });
  rows.push({
    label: "어느 인구를 쓰나",
    value: `${demand.demandSource}인구`,
    kind: "text",
    note: demand.demandSource === "유동" ? "번화가·혼합은 지나다니는 사람 기준" : "주거중심은 사는 사람 기준",
  });
  rows.push({
    label: "나이·성별 이용률로 추린 원수요",
    value: demand.rawDemand,
    kind: "count",
    note: "10~20대 남성은 40%대, 50대는 3%대처럼 나이·성별마다 다른 이용률을 곱해 더한 값",
  });

  const rate = settings.marketDemandEffectiveRate[EFFECTIVE_RATE_KEY[demand.marketCharacter]];
  rows.push({
    label: `× 인정 비율 (${demand.marketCharacter})`,
    value: rate,
    kind: "percent",
    note: "성향이 있다고 매일 오는 건 아니라서 한 번 깎는다. 상권 성격별 예측 편향을 실측해 맞춰온 값이라 설정에서 바뀔 수 있다",
  });
  rows.push({
    label: "= 상권수요",
    value: demand.marketDemand,
    kind: "count",
    result: true,
    note: "이 동네 PC방 전체가 나눠 가질 파이. 아직 우리 것이 아니다",
  });
  if (result.marketGrade) {
    rows.push({ label: "상권 등급", value: result.marketGrade, kind: "text", note: describeMarketGradeThresholds(settings) });
  }

  return {
    recomputedMarketDemand: demand.marketDemand,
    step: {
      step: 1,
      rows,
      blocked:
        demand.marketDemand == null
          ? "연령별 인구 입력이 모자라 원수요를 낼 수 없습니다. 기본정보의 연령대별 인구를 채워주세요."
          : null,
    },
  };
}

function buildShareStep(result: EvaluationResult): WalkStep {
  const rows: WalkRow[] = [];

  rows.push({
    label: "우리 매장 경쟁력 점수",
    value: result.ownCompetitivenessScore,
    kind: "score",
    note: "시설·사양·입지·먹거리 네 가지를 정해진 비중으로 더한 값(비중은 위 표 참고)",
  });
  rows.push({
    label: "경쟁점 평균 경쟁력 점수",
    value: result.competitorAvgCompetitiveness,
    kind: "score",
    note: "반경 안의 경쟁점들을 같은 기준으로 매긴 평균",
  });
  rows.push({
    label: "= 경쟁력 격차",
    value: result.competitivenessGap,
    kind: "multiple",
    note: "우리 점수 ÷ 경쟁점 평균. 1보다 크면 우리가 낫다는 뜻",
  });
  rows.push({ label: "우리 계획 PC 대수", value: result.expectedPcCount, kind: "count" });
  rows.push({
    label: "경쟁점 PC 대수 합계",
    value: result.competitorIp,
    kind: "count",
    note: "조사한 경쟁점들의 PC 대수를 전부 더한 값",
  });

  const share =
    result.marketDemand != null && result.marketDemand > 0 && result.expectedOwnDemand != null
      ? result.expectedOwnDemand / result.marketDemand
      : null;
  rows.push({
    label: "= 우리 몫",
    value: share,
    kind: "percent",
    note: "(우리 대수 × 격차) ÷ (우리 대수 × 격차 + 경쟁점 대수 합계). 경쟁점이 없으면 100%",
  });
  rows.push({
    label: "상권수요 × 우리 몫 = 우리 매장으로 올 손님",
    value: result.expectedOwnDemand,
    kind: "count",
    result: true,
    note: "이 '손님 수'라는 숫자 자체는 3단계에 넣지 않는다. 대신 경쟁력·경쟁 규모·동네 수요를 따로 넘겨 3단계가 직접 쓴다 — 경쟁력이 매출에 주는 영향은 그대로 살아 있다",
  });

  return {
    step: 2,
    rows,
    blocked:
      result.expectedOwnDemand == null
        ? "경쟁점 정보나 계획 PC 대수가 없어서 우리 몫을 낼 수 없습니다."
        : null,
  };
}

function buildRevenueStep(result: EvaluationResult, settings: WalkSettings): WalkStep {
  const rows: WalkRow[] = [];
  const b = result.revenueBreakdown;

  rows.push({
    label: "학습에 쓴 기존 가맹점 수",
    value: b?.sampleCount ?? result.v61TrainingSampleCount,
    kind: "count",
    note: `실제 매출 기록에서 배운다 — ${result.v61ModelLabel}`,
  });

  if (!b) {
    // 이용량 분리 학습을 못 쓴 경우(학습자료 부족·폴백). 저장된 값만으로 짧게 보여준다.
    rows.push({ label: "기본 예상매출", value: result.v61Baseline, kind: "won" });
    rows.push({
      label: "유입제약 보정",
      value: result.v62Rate,
      kind: "percent",
      note: result.inflowRestriction ? `입지동선평가의 유입제약 "${result.inflowRestriction}"` : undefined,
    });
    rows.push({ label: "= 최종 예상 월매출", value: result.v62Final, kind: "won", result: true });
    return {
      step: 3,
      rows,
      blocked:
        result.v62Final == null
          ? "예상 매출을 낼 재료가 모자랍니다. 결과 탭에서 계산을 먼저 실행해 주세요."
          : null,
    };
  }

  rows.push({
    label: "학습모형이 처음 내놓은 값 (보정 전)",
    value: b.baselineRevenue,
    kind: "won",
    note: "예상 PC 이용시간 × 실효단가 + 먹거리 매출. 아직 아래 보정이 안 들어갔다",
  });
  rows.push({
    label: "× 유입제약 보정",
    value: result.v62Rate,
    kind: "percent",
    note: result.inflowRestriction
      ? `입지동선평가의 유입제약 "${result.inflowRestriction}" — 손님이 다른 동네로 샐 가능성`
      : "입지동선평가의 유입제약",
  });
  if (b.overflowRevenue > 0) {
    rows.push({
      label: "+ 경쟁점이 못 받은 손님",
      value: b.overflowRevenue,
      kind: "won",
      note: "경쟁점이 자기 좌석 한계를 넘겨 받지 못한 수요가 우리 쪽으로 넘어온 몫",
    });
  }
  if (b.capacityCapped) {
    rows.push({
      label: "가동률 상한에 걸리기 전 값",
      value: b.revenueBeforeCap,
      kind: "won",
      note: `우리 좌석으로 물리적으로 받을 수 있는 한계(가동률 ${Math.round(settings.v62MaxUtilizationRate * 100)}%)를 넘어서 깎였다`,
    });
  }
  // 2026-09-23 — 상권수요 천장(calc.ts applyDemandCeiling). 운영은 꺼져 있어 안 뜨고, 주소만 초기평가에서만 뜬다.
  if (result.demandCapped) {
    rows.push({
      label: "상권수요 천장에 걸리기 전 값",
      value: result.v62FinalBeforeDemandCap,
      kind: "won",
      note: `상권 인원(자사수요 ${(result.expectedOwnDemand ?? 0).toLocaleString("ko-KR")}명 × ${settings.demandCeilingHoursPerUser ?? "-"}시간 = 월 ${Math.round(result.demandCeilingHours ?? 0).toLocaleString("ko-KR")}시간)이 채울 수 있는 이용시간을 넘어서 그 비율로 깎였다`,
    });
  }
  rows.push({
    label: "= 최종 예상 월매출",
    value: result.v62Final,
    kind: "won",
    result: true,
  });

  rows.push({
    label: "그 안의 PC 매출",
    value: b.pcRevenue,
    kind: "won",
    note: `예상 이용시간 ${Math.round(b.pcHours).toLocaleString("ko-KR")}시간 × 실효단가 ${Math.round(b.pcRevenue / b.pcHours).toLocaleString("ko-KR")}원 — 정가가 아니라 **실제로 시간당 받는 돈**이다 (좌석 추가과금이 더해지고 정액 할인이 빠진다)`,
  });
  rows.push({ label: "그 안의 먹거리 매출", value: b.productRevenue, kind: "won" });
  if (result.expectedPcCount && result.expectedPcCount > 0) {
    rows.push({
      label: "이때의 가동률",
      value: b.pcHours / (result.expectedPcCount * HOURS_PER_MONTH),
      kind: "percent",
      note: "예상 이용시간 ÷ (PC 대수 × 24시간 × 30일). 이 숫자가 경쟁점 실측보다 높으면 결과 탭이 짚어준다",
    });
  }

  rows.push({
    label: "보수적으로 보면",
    value: result.conservativeSales,
    kind: "won",
    note: `최종값의 ${Math.round(settings.lowerBoundFactor * 100)}%`,
  });
  rows.push({
    label: "잘 되면",
    value: result.upperSales,
    kind: "won",
    note: `최종값의 ${Math.round(settings.upperBoundFactor * 100)}%`,
  });

  return { step: 3, rows, blocked: null };
}

/**
 * 저장된 평가결과가 없으면 null — 화면은 "결과 탭에서 계산을 먼저 돌려주세요"라고 안내한다.
 * 아직 계산한 적 없는 후보지의 숫자를 여기서 새로 만들어내지 않는다.
 */
export function buildWalkthrough(
  candidate: MarketDemandInput,
  result: EvaluationResult | null,
  settings: WalkSettings,
): Walkthrough | null {
  if (!result) return null;

  const demand = buildDemandStep(candidate, result, settings);
  const steps = [demand.step, buildShareStep(result), buildRevenueStep(result, settings)];

  return {
    steps,
    modelLabel: result.v61ModelLabel,
    inputsChangedSinceResult:
      demand.recomputedMarketDemand != null &&
      result.marketDemand != null &&
      demand.recomputedMarketDemand !== result.marketDemand,
  };
}

/**
 * 2단계 "경쟁력 점수는 무엇으로 매기나"를 설정에서 뽑아 만든다 (2026-09-14 신설).
 *
 * ⚠️ 이걸 만든 이유 — 화면에 비중을 글자로 박아두면 **반드시 낡는다.** 실제로 이 화면은
 * "좌석30·사양25·먹거리20·인테리어15·위치10"이라는 2026-08-27 당시의 5분류를 그대로 달고
 * 있었는데, 2026-08-28에 4분류로 재편됐고 2026-09-03에 비중이 또 바뀌었다(하드:시설:입지
 * 30:40:30 → 20:50:20). 항목 하나(관리)는 화면에 아예 없었다.
 *
 * 그래서 숫자를 쓰지 않고 `competitivenessWeights` / `specWeights` / `facilityWeights` /
 * `locationCompositeWeights`에서 그대로 읽어 계산한다. 설정이 바뀌면 화면이 따라 바뀐다.
 */
export type WeightPart = { label: string; pct: number };
export type WeightRow = {
  label: string;
  /** 경쟁력 점수 전체에서 차지하는 비중. 0.185 = 18.5% */
  pct: number;
  desc: string;
  /** 그 항목 **안에서**의 세부 비중. 전체 대비가 아니다. */
  parts?: WeightPart[];
};

type WeightSettings = Pick<
  ModelSettings,
  "competitivenessWeights" | "specWeights" | "facilityWeights" | "locationCompositeWeights"
>;

export function buildCompetitivenessWeights(settings: WeightSettings): WeightRow[] {
  const w = settings.competitivenessWeights;
  const spec = settings.specWeights;
  const fac = settings.facilityWeights;
  const loc = settings.locationCompositeWeights;

  return [
    {
      label: "시설",
      pct: w.interior,
      desc: "어떤 좌석이 얼마나 갖춰져 있고, 꾸밈새와 관리 상태가 어떤지",
      parts: [
        { label: "존 구성", pct: fac.zoneComposition },
        { label: "인테리어", pct: fac.interior },
        { label: "관리", pct: fac.management },
      ],
    },
    {
      label: "사양",
      pct: w.spec,
      desc: "컴퓨터 성능",
      parts: [
        { label: "그래픽카드", pct: spec.vga },
        { label: "모니터", pct: spec.monitor },
        { label: "CPU", pct: spec.cpu },
        { label: "램", pct: spec.ram },
      ],
    },
    {
      label: "입지",
      pct: w.location,
      desc: "상권 안에서 어디에 있는지. 입지동선평가가 없으면 층수·엘리베이터로 대신한다",
      parts: [
        { label: "상권위치·동선", pct: loc.marketPositionFlow },
        { label: "선점", pct: loc.preemption },
        { label: "가시성", pct: loc.visibility },
      ],
    },
    {
      label: "먹거리",
      pct: w.food,
      desc: "파는 음식 수준. 조사자가 직접 확인한 값이 있으면 브랜드 기본값보다 그게 우선한다",
    },
  ].sort((a, b) => b.pct - a.pct);
}
