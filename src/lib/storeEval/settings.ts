// 점포평가 모델 설정값의 기본값(초기 시드)과 Firestore 입출력.
// 모든 숫자는 원본 "12_운영판정" 시트 O/P열에서 그대로 가져온 값이다 (docs/model-spec.md §4).
// 코드에 하드코딩된 이 값들은 "초기 시드"일 뿐이고, 실제 계산은 항상 ModelSettings 문서를 읽어서
// 수행해야 한다 — 운영설정 화면에서 관리자가 바꾸면 그 값이 우선한다.

import type { ModelSettings } from "./types";

export const MODEL_SETTINGS_DOC_ID = "current";

// 08_계산기준!C54:E65 "AA 월별기준" 표의 순수익 2,000만원 대당 열 그대로.
const AA_MONTHLY_TARGETS_2000 = [
  { month: 1, dailyRevenuePerPcTarget: 19811, daysInMonth: 31 },
  { month: 2, dailyRevenuePerPcTarget: 19377, daysInMonth: 28 },
  { month: 3, dailyRevenuePerPcTarget: 18071, daysInMonth: 31 },
  { month: 4, dailyRevenuePerPcTarget: 16171, daysInMonth: 30 },
  { month: 5, dailyRevenuePerPcTarget: 18871, daysInMonth: 31 },
  { month: 6, dailyRevenuePerPcTarget: 17871, daysInMonth: 30 },
  { month: 7, dailyRevenuePerPcTarget: 21171, daysInMonth: 31 },
  { month: 8, dailyRevenuePerPcTarget: 21971, daysInMonth: 31 },
  { month: 9, dailyRevenuePerPcTarget: 17671, daysInMonth: 30 },
  { month: 10, dailyRevenuePerPcTarget: 17971, daysInMonth: 31 },
  { month: 11, dailyRevenuePerPcTarget: 17071, daysInMonth: 30 },
  { month: 12, dailyRevenuePerPcTarget: 19271, daysInMonth: 31 },
];

// 2026-08-27: 사용자가 같은 표의 순수익 1,000만원 대당 열을 그대로 제공함(08_계산기준!C54:E65와
// 동일 구조, 실측치 — 지어낸 값 아님).
const AA_MONTHLY_TARGETS_1000 = [
  { month: 1, dailyRevenuePerPcTarget: 14124, daysInMonth: 31 },
  { month: 2, dailyRevenuePerPcTarget: 13534, daysInMonth: 28 },
  { month: 3, dailyRevenuePerPcTarget: 12434, daysInMonth: 31 },
  { month: 4, dailyRevenuePerPcTarget: 10484, daysInMonth: 30 },
  { month: 5, dailyRevenuePerPcTarget: 13234, daysInMonth: 31 },
  { month: 6, dailyRevenuePerPcTarget: 12234, daysInMonth: 30 },
  { month: 7, dailyRevenuePerPcTarget: 15534, daysInMonth: 31 },
  { month: 8, dailyRevenuePerPcTarget: 16334, daysInMonth: 31 },
  { month: 9, dailyRevenuePerPcTarget: 12034, daysInMonth: 30 },
  { month: 10, dailyRevenuePerPcTarget: 12334, daysInMonth: 31 },
  { month: 11, dailyRevenuePerPcTarget: 11734, daysInMonth: 30 },
  { month: 12, dailyRevenuePerPcTarget: 13634, daysInMonth: 31 },
];

// 1,500만원 대당표는 원본 시트에 없다(2,000만원/1,000만원 두 열만 실제로 존재) — 사용자 요청대로
// "중간값"을 두 실측표의 월별 산술평균으로 계산한다(새 계수를 지어내는 게 아니라 이미 확보한 두
// 실측값의 평균일 뿐). 두 표의 month/daysInMonth는 항상 같은 순서로 맞물려 있다는 전제.
const AA_MONTHLY_TARGETS_1500 = AA_MONTHLY_TARGETS_2000.map((high, i) => {
  const low = AA_MONTHLY_TARGETS_1000[i];
  return {
    month: high.month,
    dailyRevenuePerPcTarget: Math.round((high.dailyRevenuePerPcTarget + low.dailyRevenuePerPcTarget) / 2),
    daysInMonth: high.daysInMonth,
  };
});

export function defaultModelSettings(): Omit<ModelSettings, "updatedAt" | "updatedBy"> {
  return {
    id: MODEL_SETTINGS_DOC_ID,
    modelVersion: "V62",
    inflowAdjustment: { 없음: 0, 보통: -0.03, 강함: -0.2 },
    lowerBoundFactor: 0.85,
    upperBoundFactor: 1.15,
    minTotalSample: 30,
    minStrongInflowSample: 5,
    targetMAE: 0.15,
    targetMedianAE: 0.1,
    target20pctRatio: 0.75,
    maxAvgBias: 0.05,
    target10pctRatio: 0.8,
    v61Fallback: {
      intercept: -79920.46038242977,
      hourlyRateCoef: 30.35495074620959,
      demandPerPcCoef: 390.05461852333895,
      competitivenessCoef: 158536.9275523547,
    },
    // 08_계산기준!VALIDATION에서 시작한 설정(최소학습표본12). λ와 혼합비율은 아래 실측 재검증으로 갱신했다.
    // 2026-09-02 minHourlyRateCoef 추가(사용자 확인) — 시간당요금이 경쟁력점수와 상관계수
    // 0.53으로 얽혀 비음수 릿지회귀가 요금 계수를 0으로 잘라버렸던 문제(신규후보지에서 요금을
    // 바꿔도 예상매출이 전혀 안 움직임) 수정.
    // 2026-09-02(2차) — 처음엔 0.08(중앙값·±10%·±20% 목표치 통과 위주)로 정했으나, 사용자 확인에
    // 따라 "적중률(임계값 통과) 위주"가 아니라 "전체 매장 오차크기(MAPE) 최소화" 기준으로 재선정 —
    // 세밀한 그리드서치 결과 0.04가 순수 MAPE 최적점(11.23%, 0.08은 11.68%). 대신 중앙값(10.39%,
    // 목표10% 미달)·±10%(46.2%, 0.08은 50.0%)는 0.08보다 못하다 — 목표치 자체는 별도 재검토 예정.
    // 2026-09-02(4차) minMarketDemandCoef/minCompetitivenessGapCoef 추가(사용자 확인: "경쟁점
    // 경쟁력은 반드시 평가 항목에 들어가야 한다") — empiricalFeaturesFor 4번째 피처(경쟁력점수×
    // log(경쟁력격차)) 재도입 + GPT 입지동선평가 데이터를 기존매장 competitivenessScore에도
    // 반영(백필)한 뒤, 3개 하한선을 좌표하강 방식으로 그리드서치(순수 MAPE 최소화 기준).
    // 2026-09-02(5차) 재조정 — 정식 검증군을 12개월+ 26곳에서 1개월+ 37곳으로 확대
    // (CORE_VALIDATION_MIN_MONTHS 주석 참고)하면서 최적 계수가 이동했다. 37곳 기준 2D
    // 그리드서치 결과 수요 0.04→0 / 격차 0.04→0.06이 최적(MAPE 12.10%→11.74%, 중앙값
    // 11.44%→10.75%, ±10% 43.2%→45.9%, 최대오차 26.2%→24.7%, 범위 25.8%p→24.1%p —
    // ±20%만 81.1%→78.4%로 하락). 사용자가 처음 제시한 방향("수요 비중 낮추고 경쟁력격차
    // 비중 높이기")과 일치하며, 26곳 코호트에서는 반대로 나왔던 게 표본 확대로 뒤집힌 것이다.
    // 독점매장 우려(격차↑가 독점을 더 깎는다)는 수요↓가 상쇄해서 순효과가 거의 없음을 확인했다
    // (독점 3곳 평균오차 14.3%→14.4%, 과소예측이던 탕정역·광주각화는 각 1%p 개선).
    v61Training: {
      // 2026-09-03 — 정상 학습표본 38곳 확장 후 재탐색. λ=10, 회귀80%/중앙값20%가 기존
      // λ=1, 60/40 대비 MAPE 12.02→11.46%, 중앙오차 12.54→12.24%, ±10% 39.5→42.1%,
      // ±20% 86.8% 유지, 최악 오차폭 60.8→58.0%p로 전 지표 개선/유지. 28곳 무작위 부분표본
      // 300회에서도 MAPE 254회·중앙오차 198회·오차폭 276회 우세해 전체표본 맞춤이 아님을 확인했다.
      ridgeLambda: 10,
      ridgeWeight: 0.8,
      baselineWeight: 0.2,
      minSampleCount: 12,
      minHourlyRateCoef: 0.03,
      // 2026-09-03 — 0에서 0.03으로. 이 하한선이 없으면 비음수 릿지가 수요 피처의 계수를 정확히
      // 0으로 만들어(자유 적합해도 0) 수요 산식이 예측에 전혀 반영되지 않는다. 수요 신호가
      // 통계적으로 유의하지 않아서(상관 0.116, 유의수준 0.33) 생기는 현상이며, "상권수요를
      // 경쟁점과 나눠 갖는다"는 구조를 반영해야 한다는 사업 판단으로 강제 투입한다
      // (minHourlyRateCoef·minCompetitivenessGapCoef와 같은 원칙). empiricalFeaturesFor 주석 참고.
      minMarketDemandCoef: 0.03,
      minCompetitivenessGapCoef: 0.06,
      // 2026-09-03 신설 — 배후수요형 특수상권(군부대·산업단지) 더미의 계수 하한선.
      // 이 더미는 하한선 없이 자유 적합해도 릿지가 스스로 살려 쓴다(MAPE 11.56%→11.32%) —
      // 수요 피처와 달리 신호가 실재한다는 뜻이다. 하한선은 그 위에 얼마나 더 밀어줄지의 문제다.
      // 0.1로 걸면 배후 5곳 편향이 -14.3%→+3.0%로 완전히 잡히고 MAPE 10.85%·±20% 86.5%까지
      // 좋아지지만 **오차폭이 46.67%→50.42%로 나빠진다**(200회 재추출에서도 폭 59/200으로 열세).
      // 사용자가 "오차폭 축소 우선"으로 확정했고 표본이 5곳뿐이라 과적합 위험도 커서, 편향을
      // 부분만 교정하는 보수적인 0.05를 택했다 — 재추출 200회에서 MAPE 176/200·±20% 183/200·
      // 오차폭 133/200으로 셋 다 우세하다.
      minBackingDemandCoef: 0.05,
    },
    // 08_계산기준!B44:D49 "신규점 실측예측" 룩업표 — 사용자가 채팅으로 직접 확인해 준 값이며
    // reference/점포평가_최신본.xlsx!08_계산기준 행44~49와 정확히 일치함을 확인했다(2026-08-20).
    demandCaptureTable: [
      { gapLowerBound: -99, captureRate: 0.4, growthRate: 0 },
      { gapLowerBound: 0.8, captureRate: 0.5, growthRate: 0 },
      { gapLowerBound: 1.0, captureRate: 0.55, growthRate: 0.03 },
      { gapLowerBound: 1.3, captureRate: 0.6, growthRate: 0.05 },
      { gapLowerBound: 1.7, captureRate: 0.65, growthRate: 0.1 },
      { gapLowerBound: 2.2, captureRate: 0.7, growthRate: 0.12 },
    ],
    measuredForecastProductRatio: 0.5,
    measuredForecastMaxReviewUtilization: 0.5,
    // 2026-08-30 추가(사용자 확인) — V61/V62 예측매출의 물리적 가동률 상한. 정식검증 26곳 실측
    // 환산가동률(24시간 평균)이 전부 20~49%(최대 48.7%)였던 걸 근거로 55%로 잡았다 - 최대관측치에
    // 여유를 좀 둔 값(calc.ts applyCapacityCeiling 참고).
    v62MaxUtilizationRate: 0.55,
    // 2026-08-30 추가(사용자 확인 실측치) — 고객 1명 월평균 방문횟수 3.7회, 1회 평균 이용시간 3시간.
    customerVisitsPerMonth: 3.7,
    customerSessionHours: 3,
    // 08_계산기준!C54:E65 "AA 월별기준" 그대로 (순수익 2,000만원 대당 일매출목표·일수)
    aaMonthlyTargets: AA_MONTHLY_TARGETS_2000,
    aaMonthlyTargets1000: AA_MONTHLY_TARGETS_1000,
    aaMonthlyTargets1500: AA_MONTHLY_TARGETS_1500,
    aaMaxPcCount: 100,
    marketCharacterThreshold: { downtown: 8, mixed: 4 },
    // 2026-09-03 재보정 — 상권성격별 예측 편향을 실측하니 **번화가 14곳을 평균 4.81% 과소예측**
    // 하고 있었다(혼합 -2.65%, 주거중심 +0.48%로 나머지는 거의 정확). 번화가 유효율을 올리고
    // 주거중심을 내리는 방향이 이 편향을 직접 겨냥한다 — 임의 튜닝이 아니라 편향 교정이다.
    // 적용 후 번화가 편향 -4.81%→-4.19%, 번화가 평균절대오차 10.51%→10.25%로 개선.
    // 주의: 교정폭이 4.81%p 중 0.6%p뿐이다(수요 계수가 하한선 0.03으로 작아서). 번화가
    // 과소예측은 유효율만으로 다 잡히지 않는 별도 과제로 남아 있다.
    // 유효율은 절대수준이 아니라 **성격 간 비율**만 예측에 영향을 준다(z-표준화가 일률 배율을
    // 흡수하므로) — 즉 이 변경의 실체는 "번화가:주거중심 = 0.68 → 1.26"으로 뒤집은 것이다.
    marketDemandEffectiveRate: { downtown: 0.689, mixed: 0.61, residential: 0.546 },
    // 2026-08-27 (2차) — 상대평가(상위10/30/60%)를 절대평가로 바꿨다(사용자 확정). 값은 그
    // 상대평가가 실제로 쓰던 경계값(기존 40개 매장 상권수요 분포)을 반올림한 고정 금액이다.
    marketGradeAbsoluteThresholds: { SS: 12000, S: 7500, A: 4800 },
    // 2026-08-28 전면개편 — 기존 "사양25%+좌석30%+먹거리20%+인테리어15%+입지10%"에서
    // "하드웨어30%+인테리어·좌석·관리40%+먹거리20%+입지10%"로 재편(사용자 확정, types.ts
    // ModelSettings.competitivenessWeights 주석 참고).
    // 2026-09-01(6차) — GPT 독립 재평가(기존 DB값·실제매출 미참고)로 40개 매장 입지동선평가를
    // 교체한 뒤 그리드서치(정식검증 26곳, LOOCV): 입지비중을 5%→25%로 올릴수록 MAPE
    // 14.39%→14.24%, 중앙값 14.91%→14.19%로 단조개선, ±20% 적중률도 61.5%→73.1%로 개선(±10%는
    // 20% 부근까지는 유지되다 25%에서 하락). 10%→15%로 상향.
    // 2026-09-02(7차) — 외부유입제한 보정 4건 반영 후 일관된 조건으로 재그리드서치(정식검증
    // 26곳): 15%(MAPE 11.53%/중앙값9.84%)보다 25%(MAPE 11.33%/중앙값9.79%)가 ±10%·±20% 유지한
    // 채 더 낫다는 게 확인돼(사용자 확인) 25%로 재상향. spec/food/interior는 기존 비율
    // (30/20/40) 유지한 채 (1-0.25)/(0.3+0.2+0.4)로 재정규화.
    // 2026-09-03(8차) — 수요 산식을 IP당수요로 바꾸면서(empiricalFeaturesFor 주석 참고) 함께
    // 재최적화. 하드웨어:시설:입지 = 30:40:30 → **20:50:20**(먹거리 16.67%는 유지). 근거는
    // 구성요소별 대당월매출 상관계수 — 시설 0.595 > 입지 0.540 > 하드웨어 0.537로 셋 다
    // 유의하지만(37표본 유의수준 0.33) 시설이 가장 강하다.
    //
    // 먹거리를 왜 안 건드렸나: 자사 먹거리는 **자체 브랜드(쉐프앤클릭)라 37곳 전부 4.00점으로
    // 설계상 상수**다(사용자 확인). 그래서 먹거리는 자사 경쟁력점수에는 상수 오프셋으로만
    // 들어가고(절편이 흡수), 실질 경로는 "경쟁점 먹거리(실사 1.5~3.5점, 평균 2.50) → 경쟁력격차"
    // 하나뿐이다. 즉 표본이 늘어도 자사 쪽은 영원히 상수라 데이터가 최적 비중을 알려줄 수 없고,
    // "자체 브랜드 먹거리가 경쟁점 대비 얼마나 우위인가"라는 사업 판단값이다(경쟁점 먹거리 평균
    // 대비 대당월매출 상관은 0.016으로 통계적 근거 없음). 비중을 5~35%로 흔들어도 성능 차이가
    // 0.05%p 수준이라 기존 사업 판단값 16.67%를 그대로 뒀다. 자사 먹거리 점수를 4.0→2.5로
    // 낮추는 안도 실험했으나 전 매장이 같이 내려가 격차가 평행이동만 해서 효과가 0.01%p였다.
    competitivenessWeights: { spec: (0.2 / 0.9) * (5 / 6), food: 1 / 6, interior: (0.5 / 0.9) * (5 / 6), location: (0.2 / 0.9) * (5 / 6) },
    // 2026-08-30(경쟁력 평가 기준 최종본 §11) 재보정 — "브랜드명만 확인된 경우 기본 3.0, 브랜드만
    // 으로 4점 이상 주지 않는다"로 확정. 쉐프앤클릭만 "최신 우수 운영매장 수준"(4.0) 앵커로 예외.
    // 실제 메뉴 구성·완성도·운영상태를 확인한 직접입력값이 있으면 이 프리셋보다 그 값이 우선한다
    // (computeFoodScore 우선순위 반전 참고).
    foodBrandScores: { 쉐프앤클릭: 4, 한끼의품격: 3, XOXO: 3, PC토랑: 3, 비바쿡: 3, 농심: 3, 기타브랜드: 3 },
    // 2026-08-27 — CPU/RAM을 자동공식(세대·용량 환산)으로 분리 가중치를 줬더니 LOOCV 정확도가
    // 원본(11.6%)보다 나빠져 원복했었다. 2026-08-28 재도입 — 사용자가 하드웨어 내부비중을
    // GPU40%/모니터25%/CPU20%/RAM15%로 확정하고, scoreFromVga/scoreFromCpu의 앵커값 자체를
    // 블랙라벨 현재 표준(RTX5060·울트라5 225F=각 4점) 기준으로 재보정했다(calc.ts 주석 참고).
    // 정확도가 나빠지면 이 값을 {vga:0.7,monitor:0.3,ram:0,cpu:0}으로 되돌리면 된다.
    specWeights: { vga: 0.4, monitor: 0.25, ram: 0.15, cpu: 0.2 },
    // 2026-08-31 전면 교체(옛 interiorWeights 대체) — GPT를 통해 사용자가 재설계한 05_경쟁점정보/
    // 01_점포기본정보 시트의 "공간시설종합점수" 셀 수식을 Sheets API로 직접 읽어 그대로 이식했다
    // (존구성50%+인테리어30%+관리20%). 최신성/청결/편의성은 새 산식에서 완전히 빠졌다 — 옛
    // interiorWeights(좌석70%+최신성5%+청결15%+편의10%)는 폐기.
    facilityWeights: { zoneComposition: 0.5, interior: 0.3, management: 0.2 },
    // 2026-09-01 재설계 — 옛 상권내위치30%+주요동선30%를 "상권위치·동선" 하나로 통합(60%),
    // 나머지는 그대로. 비율 자체는 나중에 재검토 예정(types.ts LocationEvaluation 주석 참고).
    // 2026-09-01(6차) — 그리드서치(50/30/20, 50/25/25, 45/35/20, 70/20/10 등 8종) 결과 60/25/15
    // 대비 유의미한 개선 없음(전부 MAPE 14.2~14.5% 범위, 표본 26곳으로는 구분 불가) — 그대로 유지.
    locationCompositeWeights: { marketPositionFlow: 0.6, preemption: 0.25, visibility: 0.15 },
    brandFilter: "블랙라벨",
    saturationThreshold: 7,
  };
}

/**
 * Firestore에 예전 형식의 설정 문서가 남아 있어도 새 중첩 필드의 기본값을 보존한다.
 * 객체는 재귀 병합하고 배열은 저장된 배열 전체로 교체한다. 얕은 병합을 쓰면 v61Training의
 * 일부 필드만 저장된 문서가 min* 계수 전부를 지워 예측값을 바꾸는 문제가 있다.
 */
export function mergeModelSettings(stored?: Partial<ModelSettings> | null): ModelSettings {
  const defaults: ModelSettings = { ...defaultModelSettings(), updatedAt: 0, updatedBy: null };
  const merge = (base: unknown, override: unknown): unknown => {
    if (override === undefined) return base;
    if (
      base !== null &&
      override !== null &&
      typeof base === "object" &&
      typeof override === "object" &&
      !Array.isArray(base) &&
      !Array.isArray(override)
    ) {
      const result = { ...(base as Record<string, unknown>) };
      for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
        result[key] = merge(result[key], value);
      }
      return result;
    }
    return override;
  };
  return merge(defaults, stored ?? {}) as ModelSettings;
}
