// 요인별 기여도 표시 변환 테스트 (2026-09-13 신설).
//
// 이 값은 평가자가 점포팀에 "왜 이 평가인지" 설명할 근거로 쓴다. 조용히 틀리면 근거가 거짓이
// 되므로, 특히 **라벨과 값이 어긋날 수 있는 경로**를 집중적으로 막는다.

import { describe, expect, it } from "vitest";
import { summarizeDrivers, DRIVER_MIN_ABS_PCT } from "./revenueDrivers";

/** 퍼센트를 로그 기여분으로 되돌린다(테스트 입력을 읽기 쉽게 쓰려고). */
const fromPct = (pct: number) => Math.log(1 + pct);

describe("기여도 변환", () => {
  it("로그 기여분을 퍼센트로 바꾼다", () => {
    const s = summarizeDrivers({ labels: ["A"], contributions: [fromPct(0.124)] });
    expect(s?.rows[0].pct).toBeCloseTo(0.124, 10);
  });

  it("음수 기여도 그대로 나온다", () => {
    const s = summarizeDrivers({ labels: ["A"], contributions: [fromPct(-0.182)] });
    expect(s?.rows[0].pct).toBeCloseTo(-0.182, 10);
  });

  it("영향이 큰 순으로 정렬한다 (부호가 아니라 크기 기준)", () => {
    const s = summarizeDrivers({
      labels: ["작은플러스", "큰마이너스", "중간플러스"],
      contributions: [fromPct(0.02), fromPct(-0.3), fromPct(0.1)],
    });
    expect(s?.rows.map((r) => r.label)).toEqual(["큰마이너스", "중간플러스", "작은플러스"]);
  });

  it("가장 큰 절대값이 maxAbs가 된다 (막대 길이 기준)", () => {
    const s = summarizeDrivers({ labels: ["A", "B"], contributions: [fromPct(0.1), fromPct(-0.3)] });
    expect(s?.maxAbs).toBeCloseTo(0.3, 10);
    expect(s!.maxAbs).toBeGreaterThan(0); // 0이면 화면에서 0으로 나눈다
  });
});

describe("걸러내기", () => {
  it(`±${DRIVER_MIN_ABS_PCT * 100}% 미만은 숨긴다`, () => {
    const s = summarizeDrivers({
      labels: ["보임", "안보임"],
      contributions: [fromPct(0.02), fromPct(0.001)],
    });
    expect(s?.rows.map((r) => r.label)).toEqual(["보임"]);
  });

  it("경계 근처에서 갈린다 (살짝 위는 남고 살짝 아래는 걸러진다)", () => {
    // 정확히 경계값으로 검사하지 않는다 — exp(log(1+x))가 x를 부동소수점 오차 없이 되돌려주지
    // 않아서 경계에 딱 붙이면 실행할 때마다 결과가 갈릴 수 있다. 의미상 중요한 건 경계 근처에서
    // 단조롭게 갈리는 것이다.
    const above = summarizeDrivers({ labels: ["위"], contributions: [fromPct(DRIVER_MIN_ABS_PCT * 1.1)] });
    const below = summarizeDrivers({ labels: ["아래"], contributions: [fromPct(DRIVER_MIN_ABS_PCT * 0.9)] });
    expect(above?.rows).toHaveLength(1);
    expect(below).toBeNull();
  });

  it("전부 걸러지면 null (빈 상자를 그리지 않는다)", () => {
    expect(summarizeDrivers({ labels: ["A", "B"], contributions: [fromPct(0.001), fromPct(-0.001)] })).toBeNull();
  });

  it("걸러낸 항도 총합에는 포함한다 (예측에는 들어간 값이다)", () => {
    const s = summarizeDrivers({
      labels: ["보임", "안보임"],
      contributions: [fromPct(0.1), fromPct(0.001)],
    });
    expect(s?.rows).toHaveLength(1);
    // 0.1과 0.001을 곱한 효과 ≈ 1.1 × 1.001 - 1
    expect(s?.totalPct).toBeCloseTo(1.1 * 1.001 - 1, 10);
  });
});

describe("표시하지 않는 경우 — 어긋난 값을 그리느니 숨긴다", () => {
  it("drivers가 없으면 null", () => {
    expect(summarizeDrivers(null)).toBeNull();
    expect(summarizeDrivers(undefined)).toBeNull();
  });

  it("라벨이 비면 null", () => {
    expect(summarizeDrivers({ labels: [], contributions: [] })).toBeNull();
  });

  it("라벨과 기여도 개수가 다르면 통째로 숨긴다 (잘라 맞추지 않는다)", () => {
    // 잘라 맞추면 "경쟁력 우위 +12%"라고 적어놓고 실제로는 요금 항인 사고가 난다.
    expect(summarizeDrivers({ labels: ["A", "B"], contributions: [fromPct(0.1)] })).toBeNull();
    expect(summarizeDrivers({ labels: ["A"], contributions: [fromPct(0.1), fromPct(0.2)] })).toBeNull();
  });

  it("숫자가 아닌 기여도가 섞이면 null", () => {
    expect(summarizeDrivers({ labels: ["A", "B"], contributions: [fromPct(0.1), NaN] })).toBeNull();
    expect(summarizeDrivers({ labels: ["A"], contributions: [Infinity] })).toBeNull();
  });
});

describe("실데이터에서 나온 모양", () => {
  it("산본점 사례가 그대로 재현된다", () => {
    // 2026-09-13 프로브 출력(가시성 -18.2%가 최대 요인, 전부 곱하면 -19.5%)
    const s = summarizeDrivers({
      labels: ["시간당 요금", "공급 대비 수요", "자사 경쟁력", "경쟁력 우위 정도", "배후수요 상권 해당 없음", "접근성·가시성"],
      contributions: [fromPct(-0.069), fromPct(0.019), fromPct(0.047), fromPct(0.009), fromPct(-0.017), fromPct(-0.182)],
    });
    expect(s?.rows[0].label).toBe("접근성·가시성");
    expect(s?.rows[0].pct).toBeCloseTo(-0.182, 10);
    expect(s?.rows).toHaveLength(6); // 전부 0.5% 이상이라 다 보인다
    expect(s!.totalPct).toBeLessThan(0); // 합쳐서 마이너스
    expect(s!.totalPct).toBeGreaterThan(-0.25); // 터무니없는 값이 아니다
  });
});
