import { describe, expect, it } from "vitest";
import { mergeModelSettings } from "./settings";

describe("mergeModelSettings", () => {
  it("옛 Firestore 문서의 일부 v61Training 값과 새 기본 필드를 깊게 병합한다", () => {
    const merged = mergeModelSettings({
      v61Training: { ridgeLambda: 3, ridgeWeight: 0.7, baselineWeight: 0.3 } as never,
      updatedAt: 123,
      updatedBy: "tester",
    });
    expect(merged.v61Training.ridgeLambda).toBe(3);
    expect(merged.v61Training.ridgeWeight).toBe(0.7);
    expect(merged.v61Training.minSampleCount).toBe(12);
    expect(merged.v61Training.minMarketDemandCoef).toBe(0.03);
    expect(merged.v61Training.minCompetitivenessGapCoef).toBe(0.06);
    expect(merged.v61Training.minBackingDemandCoef).toBe(0.05);
    expect(merged.updatedAt).toBe(123);
  });

  it("설정 배열은 인덱스 병합하지 않고 저장값 전체로 교체한다", () => {
    const demandCaptureTable = [{ gapLowerBound: -99, captureRate: 0.25, growthRate: 0 }];
    expect(mergeModelSettings({ demandCaptureTable }).demandCaptureTable).toEqual(demandCaptureTable);
  });
});

// 2026-09-13 — 깊은 병합의 경계 동작을 못박는다. 이 함수는 **옛 Firestore 문서 호환**을 담당해서
// 조용히 틀리면 잘못된 계수로 계산하고도 아무 신호가 없다. 필드가 추가될 때마다 지나가는 길이다.
describe("mergeModelSettings — 경계 동작", () => {
  it("저장값에 없는 키(undefined)는 기본값을 유지한다 — 신규 필드 호환의 핵심", () => {
    // 2026-09-03에 minBackingDemandCoef가 추가됐을 때 기존 문서엔 이 키가 아예 없었다.
    const merged = mergeModelSettings({ updatedAt: 1 });
    expect(merged.v62MaxUtilizationRate).toBe(0.55);
    expect(merged.measuredForecastProductRatio).toBe(0.5);
    expect(merged.aaMonthlyTargets).toHaveLength(12);
  });

  it("0과 false는 기본값으로 되돌리지 않는다 (falsy라고 버리면 안 된다)", () => {
    expect(mergeModelSettings({ measuredForecastProductRatio: 0 }).measuredForecastProductRatio).toBe(0);
  });

  it("stored가 null이나 undefined면 기본값 전체를 준다", () => {
    expect(mergeModelSettings(null).v62MaxUtilizationRate).toBe(0.55);
    expect(mergeModelSettings(undefined).v62MaxUtilizationRate).toBe(0.55);
  });

  it("중첩 객체는 준 키만 덮고 나머지는 기본값을 남긴다", () => {
    const merged = mergeModelSettings({ v61Training: { ridgeLambda: 9 } as never });
    expect(merged.v61Training.ridgeLambda).toBe(9);
    expect(merged.v61Training.minSampleCount).toBe(12); // 안 준 키는 기본값
  });

  it("기본값에 없는 낯선 키가 저장돼 있어도 터지지 않는다", () => {
    const merged = mergeModelSettings({ 옛날필드: 1 } as never);
    expect(merged.v62MaxUtilizationRate).toBe(0.55);
  });

  /**
   * ⚠️ null은 기본값으로 되돌리지 **않는다** — 저장된 null이 그대로 들어온다.
   *
   * 일부러 이렇게 두는 이유: 이 경로로 null이 들어올 수 없다는 걸 확인했다(2026-09-13).
   *  - 설정 화면은 빈 칸을 0으로 바꾸고(`e.target.value === "" ? 0 : Number(...)`),
   *    표시도 `Number.isFinite(value) ? value : 0`이며, 저장 전 modelSettingsValidationErrors를 돌린다.
   *  - 옛 문서 호환 문제는 키가 **없는**(undefined) 경우이고 그건 위 테스트대로 기본값이 유지된다.
   *  - cronSync는 설정 문서를 쓰지 않는다.
   *
   * 그래서 "null도 기본값으로" 규칙을 넣지 않았다 — 실제로 막아야 할 경로가 없는데 규칙을 늘리면
   * updatedBy처럼 null이 정상인 필드까지 건드리게 된다. 다만 **백업 복원이나 수동 편집으로 null이
   * 들어오면 계산이 깨진다**는 사실은 여기 적어둔다. 그런 사례가 실제로 나오면 이 테스트를 근거로
   * 판단하면 된다.
   */
  it("null은 기본값으로 되돌리지 않는다 (현재 동작 — 위 주석 참고)", () => {
    expect(mergeModelSettings({ v62MaxUtilizationRate: null as never }).v62MaxUtilizationRate).toBeNull();
    expect(mergeModelSettings({ aaMonthlyTargets: null as never }).aaMonthlyTargets).toBeNull();
  });
});
