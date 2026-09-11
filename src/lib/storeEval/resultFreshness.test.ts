// 이 판정이 틀리면 두 방향으로 나쁘다 — 안 뜨면 옛 숫자를 사실로 믿고, 매번 뜨면
// 배지가 무시당해서 결국 같은 일이 된다. 경계를 못박아 둔다.
import { describe, expect, it } from "vitest";
import { freshnessHint, resultFreshness, type FreshnessInput } from "./resultFreshness";

const BASE = 1_000_000;
const input = (over: Partial<FreshnessInput> = {}): FreshnessInput => ({
  calculatedAt: BASE,
  candidateUpdatedAt: BASE - 100,
  competitorUpdatedAts: [BASE - 200],
  locationEvaluationUpdatedAt: BASE - 300,
  settingsUpdatedAt: BASE - 400,
  ...over,
});

describe("resultFreshness", () => {
  it("모든 입력이 계산 시각보다 오래됐으면 최신이다", () => {
    expect(resultFreshness(input())).toEqual({ state: "최신" });
  });

  it("결과가 아직 없으면 결과없음이다", () => {
    expect(resultFreshness(input({ calculatedAt: null }))).toEqual({ state: "결과없음" });
    expect(resultFreshness(input({ calculatedAt: 0 }))).toEqual({ state: "결과없음" });
  });

  // N009 사례 — 경쟁점만 바뀌었고 나머지는 그대로였다.
  it("경쟁점 하나만 나중에 바뀌어도 재계산 필요다", () => {
    const f = resultFreshness(input({ competitorUpdatedAts: [BASE - 200, BASE + 50] }));
    expect(f.state).toBe("재계산필요");
    if (f.state === "재계산필요") {
      expect(f.reasons).toEqual(["경쟁점"]);
      expect(f.newestInputAt).toBe(BASE + 50);
    }
  });

  it("운영설정이 바뀌면 재계산 필요다 (모든 후보지가 영향을 받는다)", () => {
    const f = resultFreshness(input({ settingsUpdatedAt: BASE + 1 }));
    expect(f.state).toBe("재계산필요");
    if (f.state === "재계산필요") expect(f.reasons).toEqual(["운영설정"]);
  });

  it("여러 개가 바뀌면 전부 사유로 모은다", () => {
    const f = resultFreshness(
      input({ candidateUpdatedAt: BASE + 10, locationEvaluationUpdatedAt: BASE + 20 }),
    );
    expect(f.state).toBe("재계산필요");
    if (f.state === "재계산필요") {
      expect(f.reasons).toEqual(["후보지 입력", "입지동선평가"]);
      expect(f.newestInputAt).toBe(BASE + 20);
    }
  });

  // 같은 시각이면 그 계산에 이미 반영된 것으로 본다. 아니면 저장 직후마다 배지가 뜬다.
  it("계산 시각과 정확히 같으면 최신이다", () => {
    expect(resultFreshness(input({ candidateUpdatedAt: BASE })).state).toBe("최신");
  });

  it("경쟁점이 한 곳도 없어도 판정한다", () => {
    expect(resultFreshness(input({ competitorUpdatedAts: [] })).state).toBe("최신");
  });

  // 2026-09-11 1차 커플존 정정 스크립트가 coupleZone만 update하고 updatedAt을 안 남겨서
  // 이 판정으로도 못 잡았다. 그래서 값이 없는 건 "안 바뀐 것"으로 본다 — 다만 그런 경로를
  // 만들지 않는 게 진짜 대책이다.
  it("updatedAt이 없는 입력은 판정에서 뺀다", () => {
    expect(resultFreshness(input({ competitorUpdatedAts: [null, undefined] })).state).toBe("최신");
    expect(resultFreshness(input({ settingsUpdatedAt: null })).state).toBe("최신");
  });

  it("숫자가 아니거나 0 이하인 시각은 없는 것으로 본다", () => {
    expect(resultFreshness(input({ candidateUpdatedAt: Number.NaN })).state).toBe("최신");
    expect(resultFreshness(input({ candidateUpdatedAt: -1 })).state).toBe("최신");
  });
});

describe("freshnessHint", () => {
  it("최신이면 아무 말도 하지 않는다", () => {
    expect(freshnessHint({ state: "최신" })).toBeNull();
  });

  it("재계산 필요면 무엇이 바뀌었고 어떻게 없애는지 말한다", () => {
    const hint = freshnessHint({ state: "재계산필요", reasons: ["경쟁점", "운영설정"], newestInputAt: 1 });
    expect(hint).toContain("경쟁점·운영설정");
    expect(hint).toContain("결과 탭");
  });

  it("결과가 없으면 그렇게 말한다", () => {
    expect(freshnessHint({ state: "결과없음" })).toContain("아직 계산된 결과가 없습니다");
  });
});
