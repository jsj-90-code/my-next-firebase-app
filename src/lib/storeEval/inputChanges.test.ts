import { describe, expect, it } from "vitest";
import { mergeInputChanges } from "./inputChanges";

describe("입력 변경 병합", () => {
  const baseline = { name: "원본", judgedRevenue: null as number | null, lat: null as number | null, updatedAt: 1 };
  it("기본정보 저장이 다른 화면에서 저장한 판단과 좌표를 되돌리지 않는다", () => {
    const latest = { ...baseline, judgedRevenue: 45000000, lat: 37.5, updatedAt: 3 };
    const edited = { ...baseline, name: "수정" };
    expect(mergeInputChanges(latest, baseline, edited)).toEqual({ ...latest, name: "수정" });
    expect(baseline.name).toBe("원본");
  });
  it("같은 항목을 서로 다르게 수정했다면 저장을 중단한다", () => {
    expect(() => mergeInputChanges({ ...baseline, name: "다른 수정" }, baseline, { ...baseline, name: "내 수정" })).toThrow("다른 화면");
  });
  it("의도적으로 값을 지우거나 0을 넣은 변경도 반영한다", () => {
    const previous: typeof baseline = { ...baseline, judgedRevenue: 100 };
    expect(mergeInputChanges(previous, previous, { ...previous, judgedRevenue: null }).judgedRevenue).toBeNull();
    expect(mergeInputChanges(previous, previous, { ...previous, judgedRevenue: 0 }).judgedRevenue).toBe(0);
  });
  it("동일한 값으로 저장된 재시도는 충돌로 오인하지 않는다", () => {
    const edited = { ...baseline, name: "수정" };
    expect(mergeInputChanges(edited, baseline, edited)).toEqual(edited);
  });
});
