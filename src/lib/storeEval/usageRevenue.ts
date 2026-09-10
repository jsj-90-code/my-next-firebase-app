import { buildMinCoefficients, empiricalFeaturesFor, fitEmpiricalRevenueModel, predictEmpiricalRevenue, getV62Rate, isCoreEligibleForV61Training, isValidVisibilityScore, runCohortValidation, toV61TrainingStore, computeCompetitorAppliedPcCount, computeCompetitorScores, redistributeCapacityConstrainedDemand, type ValidationStoreInput, type EmpiricalRevenueModel, type V61TrainingStore } from "./calc";
import type { Competitor, ExistingStoreMonthlySales, ModelSettings } from "./types";
export type RevenueParts = {
  pcRevenueAvg: number;
  productRevenueAvg: number;
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
      parts.set(store.storeCode, { pcRevenueAvg, productRevenueAvg });
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
  tariffFeature: TariffFeatureMode = TARIFF_FEATURE_DEFAULT): UsageRevenueModel | null {
  const allFloors = buildMinCoefficients(settings.v61Training);
  // 요금 계수만 음수를 허용하고 나머지 하한선은 그대로 둔다.
  const withTariffFloors = [TARIFF_COEF_LOWER_BOUND, ...allFloors.slice(1)];
  const fit = (kind: "usage" | "product") => {
    const withTariff = tariffFeature === "both" || (kind === "usage" && tariffFeature === "usage");
    return fitEmpiricalRevenueModel(stores.map(store => {
      const features = empiricalFeaturesFor(store);
      return {
        featuresRaw: withTariff ? features : features.slice(1),
        revenuePerPc: (kind === "usage" ? store.pcRevenueAvg / store.hourlyRate : store.productRevenueAvg)
          / store.pcCount / (store.trainingRevenueFactor ?? 1),
      };
    }), settings.v61Training.ridgeLambda, settings.v61Training.minSampleCount,
      withTariff ? withTariffFloors : allFloors.slice(1));
  };
  const usage = fit("usage"), product = fit("product");
  return usage && product ? { usage, product, sampleCount: stores.length,
    usageHasTariffFeature: tariffFeature !== false,
    productHasTariffFeature: tariffFeature === "both" } : null;
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
  calibrate = true, tariffFeature: TariffFeatureMode = TARIFF_FEATURE_DEFAULT): UsageRevenueModel | null {
  const model = fitRawUsageRevenueModel(stores, settings, tariffFeature);
  if (!model || !calibrate || stores.length - 1 < settings.v61Training.minSampleCount) return model;
  const usagePairs: { predicted: number; actual: number }[] = [];
  const productPairs: { predicted: number; actual: number }[] = [];
  for (const target of stores) {
    // Outer validation removes its target before calling this function. Each inner target
    // is also excluded here: its sales can influence the correction, never its prediction.
    const inner = fitRawUsageRevenueModel(stores.filter(s => s.storeCode !== target.storeCode), settings, tariffFeature);
    if (!inner) return model;
    const full = empiricalFeaturesFor(target);
    const features = full.slice(1);
    const estimate = (part: EmpiricalRevenueModel, withTariff = false) =>
      predictEmpiricalRevenue(part, withTariff ? full : features, target.pcCount,
        settings.v61Training.ridgeWeight, settings.v61Training.baselineWeight);
    const usage = estimate(inner.usage, inner.usageHasTariffFeature), product = estimate(inner.product, inner.productHasTariffFeature);
    if (!usage || !product) return model;
    const unrounded = (value: NonNullable<typeof usage>) => value.explain.ridgeRevenue * settings.v61Training.ridgeWeight
      + value.explain.baselineRevenue * settings.v61Training.baselineWeight;
    const factor = target.trainingRevenueFactor ?? 1;
    usagePairs.push({ predicted: unrounded(usage), actual: target.pcRevenueAvg / target.hourlyRate / factor });
    productPairs.push({ predicted: unrounded(product), actual: target.productRevenueAvg / factor });
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
  const predict = (part: EmpiricalRevenueModel, withTariff = false) => {
    const output = predictEmpiricalRevenue(part, withTariff ? featuresRaw : featuresRaw.slice(1), pcCount, settings.v61Training.ridgeWeight, settings.v61Training.baselineWeight);
    return output ? output.explain.ridgeRevenue * settings.v61Training.ridgeWeight + output.explain.baselineRevenue * settings.v61Training.baselineWeight : null;
  };
  const hours = predict(model.usage, model.usageHasTariffFeature), food = predict(model.product, model.productHasTariffFeature);
  if (hours == null || food == null || !Number.isFinite(hours) || hours <= 0 || !Number.isFinite(food) || food < 0)
    return null;
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
export function runUsageCohortValidation(stores: ValidationStoreInput[], sales: ExistingStoreMonthlySales[], settings: Pick<ModelSettings, "v61Training" | "inflowAdjustment" | "v62MaxUtilizationRate" | "measuredForecastProductRatio">, asOf = new Date(), tariffFeature: TariffFeatureMode = TARIFF_FEATURE_DEFAULT) {
  const parts = buildRevenuePartsByStore(stores, sales, asOf);
  const useVisibility = settings.v61Training.modelVariant === "visibility-inflow";
  const training = attachRevenueParts(stores.filter(isCoreEligibleForV61Training)
    .filter(store => !useVisibility || isValidVisibilityScore(store.visibilityScore))
    .map(store => toV61TrainingStore(store, settings)), parts);
  const trainingStoreCodes = new Set(training.map(store => store.storeCode));
  const fullModel = fitUsageRevenueModel(training, settings, true, tariffFeature);
  const result = runCohortValidation(stores, settings, {
    trainingStoreCodes,
    predict(store) {
      const pcCount = store.evaluationPcCount ?? store.pcCount;
      if (!pcCount || store.hourlyRate == null || store.marketDemand == null
        || store.competitorIp == null || store.competitivenessScore == null)
        return null;
      const model = trainingStoreCodes.has(store.storeCode)
        ? fitUsageRevenueModel(training.filter(row => row.storeCode !== store.storeCode), settings, true, tariffFeature)
        : fullModel;
      if (!model)
        return null;
      const features = empiricalFeaturesFor(toV61TrainingStore(store, settings));
      return predictUsageRevenue(model, features, pcCount, store.hourlyRate, settings, 1 + (getV62Rate(store.inflowRestriction ?? null, settings) ?? 0), store.extraPcHours ?? 0);
    },
  });
  return { ...result, rows: result.rows.map(row => {
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
