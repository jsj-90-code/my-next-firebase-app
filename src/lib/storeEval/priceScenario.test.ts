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
  it("유한한 입력의 계산 결과가 넘치면 거부한다", () => {
    expect(computeFixedUsagePriceScenario({...input, nextHourlyRate:1e308})).toBeNull();
    expect(computeFixedUsagePriceScenario({...input, currentHourlyRate:Number.MIN_VALUE})).toBeNull();
  });
  it("원 단위 정확도를 보장할 수 없는 합계를 거부한다", () => {
    expect(computeFixedUsagePriceScenario({...input, pcRevenue:Number.MAX_SAFE_INTEGER, nextHourlyRate:1500})).toBeNull();
  });
  it("요금 비율이 같으면 중간 곱셈이 넘칠 큰 요금도 계산한다", () => {
    expect(computeFixedUsagePriceScenario({...input, currentHourlyRate:1e308, nextHourlyRate:1e308})?.nextRevenue).toBe(70_000_000);
  });
  it.each([1000,1500,2000])("소수 매출도 표시 구성 합계와 증감이 일치한다 (%s원)", nextHourlyRate => {
    const result = computeFixedUsagePriceScenario({pcRevenue:0.5, productRevenue:0.5, currentHourlyRate:1000, nextHourlyRate})!;
    expect(result.nextRevenue).toBe(result.nextPcRevenue + result.nextProductRevenue);
    expect(result.revenueChange).toBe(result.nextRevenue - result.currentRevenue);
    if (nextHourlyRate === 1000) expect(result.revenueChange).toBe(0);
  });
});
