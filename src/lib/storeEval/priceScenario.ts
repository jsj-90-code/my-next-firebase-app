/** A same-usage price scenario, not an estimate of demand response to discounts. */
export function computeFixedUsagePriceScenario(input: {
  pcRevenue: number;
  productRevenue: number;
  currentHourlyRate: number;
  nextHourlyRate: number;
}) {
  const { pcRevenue, productRevenue, currentHourlyRate, nextHourlyRate } = input;
  if (![pcRevenue, productRevenue, currentHourlyRate, nextHourlyRate].every(Number.isFinite)
    || pcRevenue < 0 || productRevenue < 0 || currentHourlyRate <= 0 || nextHourlyRate < 0) return null;
  const nextPcRevenue = pcRevenue * nextHourlyRate / currentHourlyRate;
  return {
    currentRevenue: Math.round(pcRevenue + productRevenue),
    nextPcRevenue: Math.round(nextPcRevenue),
    nextProductRevenue: Math.round(productRevenue),
    nextRevenue: Math.round(nextPcRevenue + productRevenue),
    revenueChange: Math.round(nextPcRevenue - pcRevenue),
    pcRevenueChangeRatio: nextHourlyRate / currentHourlyRate - 1,
  };
}
