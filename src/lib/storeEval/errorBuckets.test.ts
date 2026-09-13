import { describe, expect, it } from "vitest";
import { bucketizeErrors } from "./calc";

describe("검증 오차 구간 집계", () => {
  it("0%와 경계값을 빠뜨리거나 중복하지 않고 한 구간에만 집계한다", () => {
    const values = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.31];
    const buckets = bucketizeErrors(values.map((absoluteErrorPct, index) => ({ storeName: `매장${index}`, absoluteErrorPct })));
    expect(buckets.map(bucket => bucket.count)).toEqual([2, 1, 1, 1, 1, 1]);
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(values.length);
    expect(buckets[0].storeNames).toContain("매장0");
  });

  it("예측 불가 자료를 제외하고 정확히 맞힌 매장만 있으면 첫 구간 100%다", () => {
    const buckets = bucketizeErrors([{ storeName: "적중", absoluteErrorPct: 0 }, { storeName: "미확인", absoluteErrorPct: null }]);
    expect(buckets[0]).toMatchObject({ count: 1, ratio: 1, storeNames: ["적중"] });
    expect(buckets.slice(1).every(bucket => bucket.count === 0)).toBe(true);
  });
});
