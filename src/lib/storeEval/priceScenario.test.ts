import { describe, expect, it } from "vitest";
import { computeFixedUsagePriceScenario } from "./priceScenario";

describe("요금 변경 — 이용시간과 먹거리 매출 고정", () => {
  const input = {pcRevenue:35_000_000, productRevenue:35_000_000, currentHourlyRate:1500, nextHourlyRate:1000};
  it("1500원에서 1000원으로 내리면 PC매출만 1/3 줄어든다", () => {
    expect(computeFixedUsagePriceScenario(input)).toEqual({
      currentRevenue:70_000_000, nextPcRevenue:23_333_333, nextProductRevenue:35_000_000,
      nextRevenue:58_333_333, revenueChange:-11_666_667, pcRevenueChangeRatio:1000/1500-1,
    });
  });
  it("요금을 유지하면 매출도 유지한다", () => {
    expect(computeFixedUsagePriceScenario({...input,nextHourlyRate:1500})?.revenueChange).toBe(0);
  });
  it("무료 PC 이용이어도 먹거리 매출을 요금에 비례해 없애지 않는다", () => {
    expect(computeFixedUsagePriceScenario({...input,nextHourlyRate:0})?.nextRevenue).toBe(35_000_000);
  });
  it.each([NaN,Infinity,-1,0])("기준요금 %s를 거부한다", currentHourlyRate => {
    expect(computeFixedUsagePriceScenario({...input,currentHourlyRate})).toBeNull();
  });
  it.each([NaN,Infinity,-1])("변경요금 %s를 거부한다", nextHourlyRate => {
    expect(computeFixedUsagePriceScenario({...input,nextHourlyRate})).toBeNull();
  });
});
