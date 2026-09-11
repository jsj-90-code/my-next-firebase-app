import { describe, expect, it } from "vitest";
import { defaultModelSettings } from "./settings";
import { modelSettingsValidationErrors, sumWarning } from "./settingsValidation";
import type { ModelSettings } from "./types";

const base = (): ModelSettings => ({ ...defaultModelSettings(), updatedAt: 0, updatedBy: null });

describe("modelSettingsValidationErrors", () => {
  it("기본 설정은 통과한다", () => {
    expect(modelSettingsValidationErrors(base())).toEqual([]);
  });

  // 화면 입력에 min/max가 없어서 0.55 대신 55를 치면 그대로 들어온다.
  // predictUsageRevenue는 상한이 1을 넘으면 null을 돌려주므로 예측이 통째로 안 나온다.
  it("가동률 상한이 1을 넘으면 막는다", () => {
    const errors = modelSettingsValidationErrors({ ...base(), v62MaxUtilizationRate: 55 });
    expect(errors.some(e => e.includes("물리적 가동률 상한"))).toBe(true);
  });

  it("가동률 상한 0도 막는다 (예측이 0이 된다)", () => {
    expect(modelSettingsValidationErrors({ ...base(), v62MaxUtilizationRate: 0 }).length).toBeGreaterThan(0);
  });

  // 유효수요율이 10배로 들어가면 오류 없이 모든 예측이 부풀려진다 — 가장 조용한 사고다.
  it("상권 유효수요율이 1을 넘으면 막는다", () => {
    const f = base();
    const errors = modelSettingsValidationErrors({
      ...f,
      marketDemandEffectiveRate: { ...f.marketDemandEffectiveRate, mixed: 6.1 },
    });
    expect(errors.some(e => e.includes("상권 유효수요율 - mixed"))).toBe(true);
  });

  it("상품매출비율이 음수면 막는다", () => {
    expect(modelSettingsValidationErrors({ ...base(), measuredForecastProductRatio: -0.1 }).length).toBeGreaterThan(0);
  });

  it("하한 계수가 상한 계수보다 크면 막는다", () => {
    const errors = modelSettingsValidationErrors({ ...base(), lowerBoundFactor: 1.3, upperBoundFactor: 1.15 });
    expect(errors.some(e => e.includes("하한 계수") && e.includes("상한 계수"))).toBe(true);
  });

  it("상권성격 경계가 뒤집히면 막는다", () => {
    const f = base();
    const errors = modelSettingsValidationErrors({
      ...f,
      marketCharacterThreshold: { downtown: 3, mixed: 4 },
    });
    expect(errors.some(e => e.includes("상권성격 경계가 뒤집혔습니다"))).toBe(true);
  });

  it("가중치 합이 1이 아니면 막는다", () => {
    const f = base();
    const errors = modelSettingsValidationErrors({
      ...f,
      competitivenessWeights: { ...f.competitivenessWeights, spec: f.competitivenessWeights.spec + 0.2 },
    });
    expect(errors.some(e => e.includes("경쟁력 가중치 합"))).toBe(true);
  });

  it("외부유입 보정률이 양수면 막는다 (할인율이라 0 이하여야 한다)", () => {
    const f = base();
    const key = Object.keys(f.inflowAdjustment)[0] as keyof typeof f.inflowAdjustment;
    const errors = modelSettingsValidationErrors({
      ...f,
      inflowAdjustment: { ...f.inflowAdjustment, [key]: 0.1 },
    });
    expect(errors.some(e => e.includes("외부유입 보정률"))).toBe(true);
  });

  it("NaN도 막는다", () => {
    expect(modelSettingsValidationErrors({ ...base(), v62MaxUtilizationRate: Number.NaN }).length).toBeGreaterThan(0);
  });

  it("문제가 여러 개면 전부 모아서 알려준다", () => {
    const f = base();
    const errors = modelSettingsValidationErrors({
      ...f,
      v62MaxUtilizationRate: 55,
      measuredForecastProductRatio: 9,
      lowerBoundFactor: 2,
      upperBoundFactor: 1,
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("sumWarning", () => {
  it("합이 1이면 경고가 없다", () => {
    expect(sumWarning(1, "테스트")).toBeNull();
    expect(sumWarning(0.9999, "테스트")).toBeNull();
  });

  it("합이 어긋나면 현재 합을 알려준다", () => {
    expect(sumWarning(0.8, "경쟁력")).toContain("80.0%");
  });
});
