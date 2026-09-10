import { buildMinCoefficients, empiricalFeaturesFor, fitEmpiricalRevenueModel, predictEmpiricalRevenue, getV62Rate, isCoreEligibleForV61Training, isValidVisibilityScore, runCohortValidation, toV61TrainingStore, computeCompetitorAppliedPcCount, computeCompetitorScores, redistributeCapacityConstrainedDemand, type ValidationStoreInput, type EmpiricalRevenueModel, type V61TrainingStore } from "./calc";
import type { Competitor, ExistingStoreMonthlySales, ModelSettings } from "./types";
export type RevenueParts = {
  pcRevenueAvg: number;
  productRevenueAvg: number;
  /** 위 두 평균에 실제로 들어간 개월 수 — 학습 목표의 측정오차가 얼마나 큰지를 말해준다. */
  monthCount: number;
};
export type UsageTrainingStore = V61TrainingStore & RevenueParts;
export type UsageRevenueModel = {
  usage: EmpiricalRevenueModel;
  product: EmpiricalRevenueModel;
  sampleCount: number;
  /** Cross-fitted component correction, already incorporated in each fitted intercept. */
  calibration?: { usageFactor: number; productFactor: number; sampleCount: number };
  /**
   * 이용시간 모형이 log(요금)을 피처로 포함해 적합됐는지. 예측할 때 같은 모양의 특징치를
   * 넘겨야 하므로 모형에 실어 나른다(호출부가 플래그를 따로 들고 다니면 어긋난다).
   */
  usageHasTariffFeature: boolean;
  /** 먹거리 모형도 log(요금)을 피처로 포함했는지. */
  productHasTariffFeature: boolean;
  /** 먹거리를 PC대수당이 아니라 이용시간당 지출로 학습했는지(예측에서 곱하는 기준이 달라진다). */
  productScalesWithHours: boolean;
};

/** 요금을 피처로 되돌릴 범위: false=현행(곱셈만), "usage"=이용시간만, "both"=먹거리까지. */
export type TariffFeatureMode = false | "usage" | "both";

/**
 * 이용시간 모형에서 log(요금) 계수의 하한. 표준화 좌표라 |계수|가 1을 넘을 일이 없으므로
 * 사실상 무제한이고, 데이터가 음수를 원하면 음수를 학습한다("요금 올리면 이용시간 준다").
 */
const TARIFF_COEF_LOWER_BOUND = -1;

/**
 * 요금 처리 방식의 기본값. **2026-09-10에 `false`(요금을 곱하기만) → `"usage"`로 바꿨다(사용자 확정).**
 *
 * 무엇이 바뀌나: 예전에는 `PC매출 = 예측이용시간 × 요금`이라 **요금 탄력성이 1.0으로 고정**돼
 * 있었다("요금을 10% 올리면 매출도 10% 는다"). 이제 `log(요금)`이 이용시간 모형의 피처로 들어가고
 * 그 계수만 음수를 허용하므로, `이용시간 ∝ 요금^(c/sd)` → `PC매출 ∝ 요금^(1 + c/sd)`가 되어
 * **탄력성을 데이터가 정한다.**
 *
 * 왜 바꿨나: 정식검증군 38곳이 학습한 탄력성은 **0.405**였다. 요금이 비싼 매장이 그만큼 더 벌지
 * 않는다는 뜻이고, 1.0이라는 값은 애초에 측정된 적 없는 편의상의 가정이었다.
 * - 정확도: MAPE 10.857%→10.129%, 중앙값 9.30%→9.11%, ±20% 33→34곳 (±10%는 21→20곳)
 * - 요금 시나리오: 요금 10% 인상 시 예측 변화 +4.72% → +1.86%. **약해진 게 아니라 실측에 맞게
 *   고쳐진 것이다** — 예전 값은 인상 효과를 두 배 넘게 부풀리고 있었다.
 *
 * ±10%가 한 곳 줄어 사전 등록 조건("±10% 개선 + ±20% 안 줄어듦")에는 걸렸지만, 그 조건은
 * "계수를 적중률에 맞춰 억지로 맞추는 것"을 막으려던 장치이고 이번은 **틀린 가정을 데이터로
 * 교체한 것**이라 성격이 다르다고 판단해 사용자가 채택을 결정했다.
 *
 * 되돌리려면 이 값을 `false`로 바꾸면 된다(검증·후보지 예측이 같은 기본값을 쓰므로 한 곳만 바꾸면
 * 양쪽이 함께 돌아간다). 근거·재현: docs/releases/2026-09-10-tariff-refit.md
 */
const TARIFF_FEATURE_DEFAULT: TariffFeatureMode = "usage";

/** 등록요금으로 추정한 월평균 PC 이용시간 — 이용시간 모형의 학습 목표와 같은 값이다. */
function usageHoursEstimate(store: UsageTrainingStore): number {
  return store.pcRevenueAvg / store.hourlyRate;
}

/**
 * 먹거리를 "PC대수당"이 아니라 **"이용시간당"** 지출로 학습할지.
 *
 * 왜 이런 선택지가 있나: 손님이 오래 머물수록 먹거리를 더 산다는 게 상식이고, 실제로 이 코드의
 * 초과수요 계산은 이미 그렇게 가정하고 있다(`extraFood = food / hours * extraPcHours`).
 * 그런데 정작 본 모형은 먹거리를 PC대수로 나눠 학습해서, 같은 파일 안에서 가정이 어긋나 있었다.
 *
 * 자사 먹거리평가는 37곳 전부 4.00점 상수라(자체 브랜드) 먹거리를 설명할 자사 측 변수가
 * 아예 없다 — 그래서 "이용시간"이 유일하게 남은 물리적 설명이다.
 *
 * ⚠️ **2026-09-10 측정 결과: 중간은 좋아지고 꼬리가 터져서 기각(기본값 off).**
 * 정식검증군 38곳 — 중앙값 9.11%→**7.31%**, ±10% 20→**23곳**으로 크게 좋아지는데,
 * ±20%가 34→**32곳**으로 줄고 최악 매장이 26.9%→**39.6%**로 터진다. 사전 등록한 채택 조건
 * ("±10% 개선 + ±20% 안 줄어듦")에 정확히 걸리는 형태다.
 *
 * 손상이 신생 매장에만 몰린 것도 아니다 — 완료월 12개월인 수원인계점이 −2.2%에서 +12.1%로
 * 14%p 튀는 등, 잘 맞던 성숙 매장을 망가뜨린다(평균으로는 3개월 이상 −0.63%p로 좋아지지만
 * 개별 진폭이 크다). 표본 38곳에서 진폭이 이 정도면 신규 후보지에서 어느 쪽으로 튈지 모른다.
 *
 * 다만 중앙값 1.8%p 개선은 큰 신호다 — **가설 자체가 틀린 게 아니라 지금 표본으로는 꼬리를
 * 감당 못 하는 것**으로 본다. 표본이 45~50곳으로 늘면 다시 검정할 것(backlog B-1).
 * 근거·재현: docs/releases/2026-09-10-product-scaling.md
 */
const PRODUCT_PER_HOUR_DEFAULT = false;
export type UsageRevenueBreakdown = {
  pcHours: number;
  uncappedPcHours: number;
  pcRevenue: number;
  productRevenue: number;
  monthlyRevenue: number;
  revenueBeforeCap: number;
  capacityCapped: boolean;
  baselineRevenue: number;
  overflowRevenue: number;
  sampleCount: number;
};
/** Same elapsed-month window as computeStabilizedPerformance; missing components are not zero sales. */
export function buildRevenuePartsByStore(stores: {
  storeCode: string;
  openedAt: string | null;
}[], sales: ExistingStoreMonthlySales[], asOf = new Date()): Map<string, RevenueParts> {
  const currentMonth = asOf.toISOString().slice(0, 7);
  const byStore = new Map<string, ExistingStoreMonthlySales[]>();
  for (const row of sales) {
    const rows = byStore.get(row.storeCode) ?? [];
    rows.push(row);
    byStore.set(row.storeCode, rows);
  }
  const parts = new Map<string, RevenueParts>();
  for (const store of stores) {
    const match = store.openedAt?.match(/^(\d{4})-(\d{2})/);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12)
      continue;
    const openYear = Number(match[1]), openMonth = Number(match[2]);
    const window = (byStore.get(store.storeCode) ?? []).filter(row => /^\d{4}-(0[1-9]|1[0-2])$/.test(row.yearMonth) && row.yearMonth < currentMonth)
      .map(row => { const [y, m] = row.yearMonth.split("-").map(Number); return { ...row, elapsed: (y - openYear) * 12 + m - openMonth }; })
      .filter(row => row.elapsed >= 1 && row.elapsed <= 12 && (row.pcSales ?? 0) + (row.productSales ?? 0) > 0);
    const later = window.filter(row => row.elapsed >= 2), selected = later.length ? later : window;
    if (!selected.length || selected.some(row => row.pcSales == null || row.productSales == null
      || !Number.isFinite(row.pcSales) || !Number.isFinite(row.productSales) || row.pcSales < 0 || row.productSales < 0))
      continue;
    const pcRevenueAvg = selected.reduce((sum, row) => sum + row.pcSales!, 0) / selected.length;
    const productRevenueAvg = selected.reduce((sum, row) => sum + row.productSales!, 0) / selected.length;
    if (Number.isFinite(pcRevenueAvg) && Number.isFinite(productRevenueAvg) && pcRevenueAvg > 0 && productRevenueAvg > 0)
      parts.set(store.storeCode, { pcRevenueAvg, productRevenueAvg, monthCount: selected.length });
  }
  return parts;
}
export function attachRevenueParts(stores: V61TrainingStore[], parts: Map<string, RevenueParts>): UsageTrainingStore[] {
  return stores.flatMap(store => {
    const part = parts.get(store.storeCode);
    // Prevent mixing sales from a different target period with the reported validation target.
    return part && Number.isFinite(store.hourlyRate) && store.hourlyRate > 0
      && Math.abs(part.pcRevenueAvg + part.productRevenueAvg - store.actualMonthlyRevenueAvg) <= 1
      ? [{ ...store, ...part }] : [];
  });
}
/**
 * 학습 목표의 개월 수로 행 가중치를 정한다. `null`이면 전부 1(=가중 없음, 종전 동작).
 *
 * 근거: 학습 목표 y는 "월매출 m개월 평균"이다. 개월 수가 적을수록 그 평균 자체가 시끄럽다
 * (분산 ∝ 1/m). 그런데 모형이 못 맞히는 부분에는 개월 수와 무관한 몫도 있으므로, 순수
 * 역분산 가중(w ∝ m)은 12개월 매장을 1개월 매장의 12배로 밀어 과하다.
 *
 * 그래서 역분산 가중에 "개월 수로는 줄지 않는 오차"를 더한 형태를 쓴다.
 *
 *     w ∝ 1 / (σ²_모형 + σ²_월변동/m) ∝ 1 / (1 + k/m) = m / (m + k),   k = σ²_월변동 / σ²_모형
 *
 * 즉 **k는 임의로 돌리는 손잡이가 아니라 측정할 수 있는 값**이다 — 한 매장 안에서 월별 매출이
 * 얼마나 출렁이는지를, 모형이 못 맞히는 정도로 나눈 비율.
 *
 * k가 **작을수록 평평**하고(k=1이면 1개월 매장 대 11개월 매장이 1:1.83), **클수록 순수
 * 역분산**(w ∝ m, 1:11)에 가까워진다. `k = 0`은 순수 역분산으로 특수처리하고, `null`이면
 * 아예 가중하지 않는다(현행).
 */
function monthWeightFor(monthCount: number, k: number | null): number {
  if (k == null) return 1;
  const m = Number.isFinite(monthCount) && monthCount > 0 ? monthCount : 1;
  return k <= 0 ? m : m / (m + k);
}

/**
 * 개월 수 가중의 기본값. **2026-09-10에 `null`(가중 없음) → `2.46`으로 바꿨다.**
 *
 * 왜: 학습 목표가 매장마다 1~11개월 평균이라 목표의 측정오차가 제각각인데(1개월 6곳, 11개월
 * 27곳), 종전에는 전부 같은 무게로 학습했다. 1개월 평균 한 장을 11개월 평균과 동등하게 믿는
 * 셈이었다.
 *
 * **2.46은 정확도를 보고 고른 값이 아니다.** 위 식이 말하는 k = σ²_월변동/σ²_모형을 그대로
 * 측정했다 — 매장 내 월별 로그매출 분산 중앙값 0.02318(34곳), 모형 로그오차 총분산 0.01515에서
 * 측정오차 몫 0.00573을 뺀 σ²_모형 0.00942. 0.02318/0.00942 = 2.46.
 *
 * 결과(정식검증군 38곳): MAPE 10.129%→**9.881%**, 중앙값 9.11%→9.02%, 최악 +26.9%→+26.0%,
 * ±10% 20곳·±20% 34곳은 그대로. **나빠지는 지표가 없다.**
 *
 * ±10%가 안 늘어 사전 등록 조건("±10% 개선 + ±20% 안 줄어듦")은 문자로는 충족되지 않는다.
 * 그래도 채택한 근거는 **기전**이다 — 같은 날 기각한 "어린 매장 잘라내기"는 계수를 하한선에
 * 더 달라붙게 만들었는데(사람이 정한 기본값으로 후퇴), 이 변경은 반대로 하한선에 붙은 계수를
 * 6개→5개로 **줄인다**(먹거리 가시성 0.0500→0.0537로 바닥에서 벗어남). 데이터를 버리지 않고
 * 41곳을 다 쓰면서 데이터가 더 말하게 하는 방향이다.
 *
 * k에 민감하지 않다는 것도 확인했다 — k=1~12 구간에서 MAPE가 9.98~9.77%로 완만하다.
 *
 * ⚠️ 표본이 늘면 **다시 측정할 것**. 하네스의 "k를 데이터로 측정" 절이 위 세 숫자를 그대로
 * 출력하므로 그 값으로 갈아끼우면 된다. 되돌리려면 `null`로 바꾼다.
 * 근거·재현: docs/releases/2026-09-10-month-weighting.md
 */
const MONTH_WEIGHTING_DEFAULT: number | null = 2.46;

/**
 * ⚠️ 2026-09-10 실험 결과: PC 학습목표를 `pcRevenueAvg / hourlyRate`(등록요금으로 추정한 이용시간)
 * 대신 **실측 이용시간**(대수x24x일수x매출DB 월별 가동률)으로 바꿔봤으나 **악화해서 기각**했다.
 * 정식검증군 38곳 MAPE 10.857%→11.318%, 중앙값 9.30%→10.37%, ±10% 21→18곳(±20%는 33곳 동일).
 * 특정 매장의 데이터 문제가 아니라 전반적으로 퍼진 악화였다. 실측 이용시간 보유율은 38/38이라
 * 표본 손실 없이 갈아끼운 결과다.
 *
 * 이유: 지금 구조는 목표를 등록요금으로 나누고 예측할 때 같은 등록요금을 다시 곱하므로 **매출 오차를
 * 직접 최소화**한다. 목표를 실측 이용시간으로 바꾸면 *이용시간* 정확도를 최소화하게 되고, 등록요금과
 * 실효요금의 괴리(중앙값 8.8%)가 그대로 매출 오차로 새어 나온다. 지금 방식은 코호트 평균 실효/등록
 * 비율을 계수에 흡수해 그 괴리를 완충하고 있다.
 *
 * 실측 가동률 자체는 순환값이 아니고 쓸 만한 자료다 — 다만 쓸 곳이 학습목표가 아니라 **등록요금
 * 데이터 정정**이다. 그런데 요금이 완벽할 때의 상한을 재보니(순환 진단이라 모형 후보는 아님)
 * 그 효과도 작다: MAPE 10.857%→10.550%, 중앙값 9.30%→7.36%, **±10%는 21곳 그대로**, ±20%는
 * 33→32곳으로 오히려 하나 준다. 요금 정정은 중간 구간을 조금 조일 뿐 적중률을 못 올린다.
 * 근거·재현: docs/releases/2026-09-10-tariff-history.md
 */
function fitRawUsageRevenueModel(stores: UsageTrainingStore[], settings: Pick<ModelSettings, "v61Training">,
  tariffFeature: TariffFeatureMode = TARIFF_FEATURE_DEFAULT,
  productPerHour = PRODUCT_PER_HOUR_DEFAULT,
  monthWeighting: number | null = MONTH_WEIGHTING_DEFAULT): UsageRevenueModel | null {
  const allFloors = buildMinCoefficients(settings.v61Training);
  // 요금 계수만 음수를 허용하고 나머지 하한선은 그대로 둔다.
  const withTariffFloors = [TARIFF_COEF_LOWER_BOUND, ...allFloors.slice(1)];
  const fit = (kind: "usage" | "product") => {
    const withTariff = tariffFeature === "both" || (kind === "usage" && tariffFeature === "usage");
    return fitEmpiricalRevenueModel(stores.map(store => {
      const features = empiricalFeaturesFor(store);
      // 먹거리를 "이용시간당 지출"로 학습할 때는 분모가 PC대수가 아니라 이용시간이다.
      const denominator = kind === "product" && productPerHour
        ? usageHoursEstimate(store)
        : store.pcCount;
      return {
        featuresRaw: withTariff ? features : features.slice(1),
        revenuePerPc: (kind === "usage" ? store.pcRevenueAvg / store.hourlyRate : store.productRevenueAvg)
          / denominator / (store.trainingRevenueFactor ?? 1),
        weight: monthWeightFor(store.monthCount, monthWeighting),
      };
    }), settings.v61Training.ridgeLambda, settings.v61Training.minSampleCount,
      withTariff ? withTariffFloors : allFloors.slice(1));
  };
  const usage = fit("usage"), product = fit("product");
  return usage && product ? { usage, product, sampleCount: stores.length,
    usageHasTariffFeature: tariffFeature !== false,
    productHasTariffFeature: tariffFeature === "both",
    productScalesWithHours: productPerHour } : null;
}

/**
 * MAPE-optimal multiplicative correction from cross-fitted residuals.
 *
 * Every residual is generated by a model that excluded that store, and the
 * outer LOOCV target is excluded again by the caller.  The residual correction
 * is deliberately shrunk halfway to avoid sacrificing ±10% hit rate while
 * reducing average error.
 */
export function crossFittedCorrection(pairs: { predicted: number; actual: number }[]): number {
  if (!pairs.length || pairs.some(p => !Number.isFinite(p.predicted) || p.predicted <= 0
    || !Number.isFinite(p.actual) || p.actual <= 0)) return 1;
  const ratios = pairs.map(p => ({ value: p.actual / p.predicted, weight: p.predicted / p.actual }))
    .sort((a, b) => a.value - b.value);
  const halfWeight = ratios.reduce((sum, r) => sum + r.weight, 0) / 2;
  let cumulative = 0;
  for (const ratio of ratios) {
    cumulative += ratio.weight;
    if (cumulative >= halfWeight) return (1 + ratio.value) / 2;
  }
  return 1;
}

export function fitUsageRevenueModel(stores: UsageTrainingStore[], settings: Pick<ModelSettings, "v61Training">,
  calibrate = true, tariffFeature: TariffFeatureMode = TARIFF_FEATURE_DEFAULT,
  productPerHour = PRODUCT_PER_HOUR_DEFAULT,
  monthWeighting: number | null = MONTH_WEIGHTING_DEFAULT): UsageRevenueModel | null {
  const model = fitRawUsageRevenueModel(stores, settings, tariffFeature, productPerHour, monthWeighting);
  if (!model || !calibrate || stores.length - 1 < settings.v61Training.minSampleCount) return model;
  const usagePairs: { predicted: number; actual: number }[] = [];
  const productPairs: { predicted: number; actual: number }[] = [];
  for (const target of stores) {
    // Outer validation removes its target before calling this function. Each inner target
    // is also excluded here: its sales can influence the correction, never its prediction.
    const inner = fitRawUsageRevenueModel(stores.filter(s => s.storeCode !== target.storeCode), settings, tariffFeature, productPerHour, monthWeighting);
    if (!inner) return model;
    const full = empiricalFeaturesFor(target);
    const features = full.slice(1);
    // 먹거리를 이용시간당으로 학습했으면 예측도 이용시간을 곱해야 단위가 맞는다.
    const estimate = (part: EmpiricalRevenueModel, withTariff = false, perHour = false) =>
      predictEmpiricalRevenue(part, withTariff ? full : features,
        perHour ? usageHoursEstimate(target) : target.pcCount,
        settings.v61Training.ridgeWeight, settings.v61Training.baselineWeight);
    const usage = estimate(inner.usage, inner.usageHasTariffFeature), product = estimate(inner.product, inner.productHasTariffFeature, inner.productScalesWithHours);
    if (!usage || !product) return model;
    const unrounded = (value: NonNullable<typeof usage>) => value.explain.ridgeRevenue * settings.v61Training.ridgeWeight
      + value.explain.baselineRevenue * settings.v61Training.baselineWeight;
    const factor = target.trainingRevenueFactor ?? 1;
    usagePairs.push({ predicted: unrounded(usage), actual: target.pcRevenueAvg / target.hourlyRate / factor });
    productPairs.push({ predicted: unrounded(product), actual: target.productRevenueAvg / factor });
    // (먹거리를 이용시간당으로 학습해도 보정은 "예측 먹거리매출 대 실제 먹거리매출" 비율이라
    //  분모가 무엇이든 같은 금액끼리 비교된다 — estimate가 이미 단위를 맞춰 곱해뒀다.)
  }
  const usageFactor = crossFittedCorrection(usagePairs), productFactor = crossFittedCorrection(productPairs);
  const corrected = (part: EmpiricalRevenueModel, factor: number): EmpiricalRevenueModel => ({ ...part,
    yMean: part.yMean + Math.log(factor), perPcMedian: part.perPcMedian * factor });
  return { ...model, usage: corrected(model.usage, usageFactor), product: corrected(model.product, productFactor),
    calibration: { usageFactor, productFactor, sampleCount: stores.length } };
}
export function predictUsageRevenue(model: UsageRevenueModel, featuresRaw: number[], pcCount: number, hourlyRate: number, settings: Pick<ModelSettings, "v61Training" | "v62MaxUtilizationRate">, inflowFactor = 1, extraPcHours = 0): UsageRevenueBreakdown | null {
  if (!Number.isFinite(pcCount) || pcCount <= 0 || !Number.isFinite(settings.v62MaxUtilizationRate)
    || settings.v62MaxUtilizationRate <= 0 || settings.v62MaxUtilizationRate > 1
    || !Number.isFinite(hourlyRate) || hourlyRate < 0 || !Number.isFinite(inflowFactor) || inflowFactor <= 0
    || !Number.isFinite(extraPcHours) || extraPcHours < 0)
    return null;
  // `count`는 "무엇 하나당" 학습했는지에 맞춰야 한다 — 이용시간은 PC대수당, 먹거리는 설정에 따라
  // PC대수당 또는 이용시간당이다. 그래서 이용시간을 먼저 구하고 먹거리에 그 값을 넘긴다.
  const predict = (part: EmpiricalRevenueModel, withTariff: boolean, count: number) => {
    const output = predictEmpiricalRevenue(part, withTariff ? featuresRaw : featuresRaw.slice(1), count, settings.v61Training.ridgeWeight, settings.v61Training.baselineWeight);
    return output ? output.explain.ridgeRevenue * settings.v61Training.ridgeWeight + output.explain.baselineRevenue * settings.v61Training.baselineWeight : null;
  };
  const hours = predict(model.usage, model.usageHasTariffFeature, pcCount);
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return null;
  const food = predict(model.product, model.productHasTariffFeature,
    model.productScalesWithHours ? hours : pcCount);
  if (food == null || !Number.isFinite(food) || food < 0) return null;
  const extraFood = food / hours * extraPcHours;
  const uncappedPcHours = hours * inflowFactor + extraPcHours;
  const pcHours = Math.min(uncappedPcHours, pcCount * 24 * 30 * settings.v62MaxUtilizationRate);
  const pcRevenue = Math.round(pcHours * hourlyRate), productRevenue = Math.round(food * inflowFactor + extraFood);
  const result = { pcHours, uncappedPcHours, pcRevenue, productRevenue, monthlyRevenue: pcRevenue + productRevenue,
    revenueBeforeCap: Math.round(uncappedPcHours * hourlyRate) + productRevenue, capacityCapped: pcHours < uncappedPcHours,
    baselineRevenue: Math.round(hours * hourlyRate) + Math.round(food),
    overflowRevenue: Math.round(extraPcHours * hourlyRate) + Math.round(extraFood), sampleCount: model.sampleCount };
  return [result.monthlyRevenue, result.revenueBeforeCap, result.baselineRevenue, result.overflowRevenue].every(Number.isSafeInteger) ? result : null;
}
/** Every validation target is excluded from both fitted components. Current tariff is a proxy for historical tariff. */
export function runUsageCohortValidation(stores: ValidationStoreInput[], sales: ExistingStoreMonthlySales[], settings: Pick<ModelSettings, "v61Training" | "inflowAdjustment" | "v62MaxUtilizationRate" | "measuredForecastProductRatio">, asOf = new Date(), tariffFeature: TariffFeatureMode = TARIFF_FEATURE_DEFAULT, productPerHour = PRODUCT_PER_HOUR_DEFAULT,
  /**
   * 학습 표본에 넣을 최소 완료월. **1 = 현행(전부 학습)**.
   *
   * ⚠️ 2026-09-10 실험: 개점 1~2개월 매장을 학습에서만 빼봤으나 **기각**했다. 숫자만 보면
   * 하한을 올릴수록 좋아지지만(12개월에서 MAPE 10.129%→9.645%, ±20% 34→36곳), 대조 실험이
   * 이걸 뒤집는다.
   * - **무작위 부분표본 200회 대조군**: ±10% 개선(20→21곳)은 같은 크기 무작위 표본의 평균
   *   (21.1곳)이 그대로 재현한다. **나이 때문이 아니라 표본을 줄여서 생긴 값이다.**
   * - **계수 변화**: 어린 매장을 빼면 계수가 더 잘 배우는 게 아니라 **하한선에 더 달라붙는다**
   *   (이용시간 가시성 0.0660→0.0500, 먹거리 경쟁력×격차 0.0696→0.0600 — 둘 다 바닥). 즉
   *   학습 34%를 버려서 얻는 건 "데이터가 정한 계수"가 아니라 "사람이 정한 하한선"이다.
   * - 하한을 4개 값(1/3/6/12)에서 골랐으므로 다중비교 보정을 하면 p≈0.05가 사실상 유의하지 않다.
   *
   * 가설의 알맹이("완료월 1~2개월 매장은 학습 목표 자체가 1~2개월 평균이라 노이즈가 크다")는
   * 여전히 맞다. 다만 해법은 **잘라내기가 아니라 표본 가중**이다 — backlog B-2 참조.
   * 근거·재현: docs/releases/2026-09-10-training-age-cut.md
   */
  minTrainingCompletedMonths = 1,
  monthWeighting: number | null = MONTH_WEIGHTING_DEFAULT,
  /** 진단 전용: 주어지면 학습 표본을 이 코드 집합으로 제한한다(무작위 부분표본 대조군용). */
  trainingSubset?: Set<string>) {
  const parts = buildRevenuePartsByStore(stores, sales, asOf);
  const useVisibility = settings.v61Training.modelVariant === "visibility-inflow";
  const coreEligible = stores.filter(isCoreEligibleForV61Training)
    .filter(store => !useVisibility || isValidVisibilityScore(store.visibilityScore));
  const training = attachRevenueParts(coreEligible
    // 개점 직후 몇 달은 오픈 프로모션이 섞여 실적이 불안정하다. 그 매장을 **학습에서만** 뺄 수
    // 있게 한다(평가 대상에서는 빼지 않는다 — 빼면 코호트가 달라져 before/after 비교가 안 된다).
    .filter(store => store.completedMonths >= minTrainingCompletedMonths)
    .filter(store => !trainingSubset || trainingSubset.has(store.storeCode))
    .map(store => toV61TrainingStore(store, settings)), parts);
  // 코호트 판정은 "학습 자격이 있는 매장" 전체로 유지한다. 학습에서 빠진 매장은 애초에 모형에
  // 안 들어갔으므로 리브원아웃에서 자기 자신을 뺄 것도 없다(누출 없음).
  const trainingStoreCodes = new Set(attachRevenueParts(coreEligible
    .map(store => toV61TrainingStore(store, settings)), parts).map(store => store.storeCode));
  const fullModel = fitUsageRevenueModel(training, settings, true, tariffFeature, productPerHour, monthWeighting);
  const result = runCohortValidation(stores, settings, {
    trainingStoreCodes,
    predict(store) {
      const pcCount = store.evaluationPcCount ?? store.pcCount;
      if (!pcCount || store.hourlyRate == null || store.marketDemand == null
        || store.competitorIp == null || store.competitivenessScore == null)
        return null;
      const model = trainingStoreCodes.has(store.storeCode)
        ? fitUsageRevenueModel(training.filter(row => row.storeCode !== store.storeCode), settings, true, tariffFeature, productPerHour, monthWeighting)
        : fullModel;
      if (!model)
        return null;
      const features = empiricalFeaturesFor(toV61TrainingStore(store, settings));
      return predictUsageRevenue(model, features, pcCount, store.hourlyRate, settings, 1 + (getV62Rate(store.inflowRestriction ?? null, settings) ?? 0), store.extraPcHours ?? 0);
    },
  });
  // fullModel도 함께 돌려준다 — 진단 하네스가 계수를 들여다볼 때 학습 표본을 다시 만들 필요가 없다.
  return { fullModel, ...result, rows: result.rows.map(row => {
    const actual = parts.get(row.storeCode);
    // Show components only when their period matches the total used by validation.
    return actual && row.actualRevenueAvg != null && Math.abs(actual.pcRevenueAvg + actual.productRevenueAvg - row.actualRevenueAvg) <= 1
      ? { ...row, actualRevenueBreakdown: actual } : row;
  }) };
}
export function computeOverflowPcHours(marketDemand: number | null, own: {
  pcCount: number | null;
  competitivenessScore: number | null;
}, competitors: Competitor[], settings: ModelSettings) {
  const redistribution = redistributeCapacityConstrainedDemand(marketDemand, own, competitors.map(competitor => ({
    pcCount: computeCompetitorAppliedPcCount(competitor),
    competitivenessScore: computeCompetitorScores(competitor, settings).total,
  })), settings);
  const { ownDemandAfterRedistribution: after, ownDemandBeforeRedistribution: before } = redistribution;
  return after == null || before == null ? 0 : Math.max(0, after - before) * settings.customerVisitsPerMonth * settings.customerSessionHours;
}
