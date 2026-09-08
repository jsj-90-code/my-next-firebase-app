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
};
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
export function fitUsageRevenueModel(stores: UsageTrainingStore[], settings: Pick<ModelSettings, "v61Training">): UsageRevenueModel | null {
  const floors = buildMinCoefficients(settings.v61Training).slice(1);
  const fit = (kind: "usage" | "product") => fitEmpiricalRevenueModel(stores.map(store => ({
    featuresRaw: empiricalFeaturesFor(store).slice(1),
    revenuePerPc: (kind === "usage" ? store.pcRevenueAvg / store.hourlyRate : store.productRevenueAvg)
      / store.pcCount / (store.trainingRevenueFactor ?? 1),
  })), settings.v61Training.ridgeLambda, settings.v61Training.minSampleCount, floors);
  const usage = fit("usage"), product = fit("product");
  return usage && product ? { usage, product, sampleCount: stores.length } : null;
}
export function predictUsageRevenue(model: UsageRevenueModel, featuresRaw: number[], pcCount: number, hourlyRate: number, settings: Pick<ModelSettings, "v61Training" | "v62MaxUtilizationRate">, inflowFactor = 1, extraPcHours = 0): UsageRevenueBreakdown | null {
  if (!Number.isFinite(pcCount) || pcCount <= 0 || !Number.isFinite(settings.v62MaxUtilizationRate)
    || settings.v62MaxUtilizationRate <= 0 || settings.v62MaxUtilizationRate > 1
    || !Number.isFinite(hourlyRate) || hourlyRate < 0 || !Number.isFinite(inflowFactor) || inflowFactor <= 0
    || !Number.isFinite(extraPcHours) || extraPcHours < 0)
    return null;
  const predict = (part: EmpiricalRevenueModel) => {
    const output = predictEmpiricalRevenue(part, featuresRaw.slice(1), pcCount, settings.v61Training.ridgeWeight, settings.v61Training.baselineWeight);
    return output ? output.explain.ridgeRevenue * settings.v61Training.ridgeWeight + output.explain.baselineRevenue * settings.v61Training.baselineWeight : null;
  };
  const hours = predict(model.usage), food = predict(model.product);
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
export function runUsageCohortValidation(stores: ValidationStoreInput[], sales: ExistingStoreMonthlySales[], settings: Pick<ModelSettings, "v61Training" | "inflowAdjustment" | "v62MaxUtilizationRate" | "measuredForecastProductRatio">, asOf = new Date()) {
  const useVisibility = settings.v61Training.modelVariant === "visibility-inflow";
  const training = attachRevenueParts(stores.filter(isCoreEligibleForV61Training)
    .filter(store => !useVisibility || isValidVisibilityScore(store.visibilityScore))
    .map(store => toV61TrainingStore(store, settings)), buildRevenuePartsByStore(stores, sales, asOf));
  const trainingStoreCodes = new Set(training.map(store => store.storeCode));
  const fullModel = fitUsageRevenueModel(training, settings);
  return runCohortValidation(stores, settings, {
    trainingStoreCodes,
    predict(store) {
      const pcCount = store.evaluationPcCount ?? store.pcCount;
      if (!pcCount || store.hourlyRate == null || store.marketDemand == null
        || store.competitorIp == null || store.competitivenessScore == null)
        return null;
      const model = trainingStoreCodes.has(store.storeCode)
        ? fitUsageRevenueModel(training.filter(row => row.storeCode !== store.storeCode), settings)
        : fullModel;
      if (!model)
        return null;
      const features = empiricalFeaturesFor(toV61TrainingStore(store, settings));
      return predictUsageRevenue(model, features, pcCount, store.hourlyRate, settings, 1 + (getV62Rate(store.inflowRestriction ?? null, settings) ?? 0), store.extraPcHours ?? 0);
    },
  });
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
