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
  const rateRatio = nextHourlyRate / currentHourlyRate;
  const currentPcRevenue = Math.round(pcRevenue);
  const nextPcRevenue = Math.round(pcRevenue * rateRatio);
  const nextProductRevenue = Math.round(productRevenue);
  const result = {
    currentRevenue: currentPcRevenue + nextProductRevenue,
    nextPcRevenue,
    nextProductRevenue,
    nextRevenue: nextPcRevenue + nextProductRevenue,
    revenueChange: nextPcRevenue - currentPcRevenue,
    pcRevenueChangeRatio: rateRatio - 1,
  };
  // Reject overflow and amounts beyond exact whole-won representation.
  const { pcRevenueChangeRatio, ...amounts } = result;
  if (!Number.isFinite(pcRevenueChangeRatio)
    || !Object.values(amounts).every(Number.isSafeInteger)) return null;
  return result;
}
