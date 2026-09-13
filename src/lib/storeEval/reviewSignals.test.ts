// 결재 전 확인 신호 규칙 테스트 (2026-09-13 신설).
//
// 이 신호들은 화면 체크리스트로도 쓰이고, 그중 forReport인 것만 평가기록 초안의 리스크 재료로도
// 넘어간다. **내부 확인용 신호가 결재 문서로 새어 나가면 안 된다**(운영설정 누락 같은 건 우리
// 사정이지 점포 평가 내용이 아니다) — 그 경계를 여기서 고정한다.

import { describe, expect, it } from "vitest";
import { collectReviewSignals, compareOwnVsRivalUtilization, RIVAL_UTILIZATION_WARN_RATIO, type ReviewSignalInput } from "./reviewSignals";
import type { Competitor, EvaluationResult, LocationEvaluation } from "./types";

function makeInput(overrides: Partial<ReviewSignalInput> = {}): ReviewSignalInput {
  return {
    result: {
      v61IsFallback: false,
      capacityCapped: false,
      v62ImpliedUtilization: 0.3,
      competitorOccupiedSeats: 30,
      competitorIp: 100,
      completionStatus: "완료",
      finalJudgement: "평가 완료",
    } as unknown as EvaluationResult,
    candidate: {
      lat: 37.5,
      lng: 127.0,
      expectedPcCount: 100,
      hourlyRate: 1400,
      floor: 2,
      groundLevel: "지상",
      hasElevator: true,
      operatingPcStores500m: 3,
    },
    competitors: [],
    locationEvaluation: {} as LocationEvaluation,
    usedDefaultSettings: false,
    ...overrides,
  };
}

function competitor(over: Partial<Competitor> = {}): Competitor {
  return {
    id: "c1",
    candidateCode: "N001",
    name: "경쟁점",
    investigationStatus: "조사완료",
    pingbotUtilization: 0.3,
    hourlyRateConverted: 1400,
    ...over,
  } as unknown as Competitor;
}

const titles = (input: ReviewSignalInput) => collectReviewSignals(input).map((s) => s.title);

describe("결재 전 확인 신호", () => {
  it("전부 정상이면 신호가 없다", () => {
    // 경쟁점이 실사까지 돼 있고 입력에 구멍이 없는 상태.
    expect(collectReviewSignals(makeInput({ competitors: [competitor()] }))).toEqual([]);
  });

  it("경쟁점이 0곳이면 그 사실 자체를 알려준다 (경고가 아니라 정보)", () => {
    // 계산 전제가 "경쟁 없음"이라는 걸 평가자가 알아야 하고, 평가기록에도 그대로 쓴다.
    const input = makeInput({ competitors: [], candidate: { ...makeInput().candidate, operatingPcStores500m: 0 } });
    const found = collectReviewSignals(input).find((s) => s.title.includes("경쟁점이 없"));
    expect(found?.level).toBe("정보");
    expect(found?.forReport).toBe(true);
  });

  it("운영설정이 없으면 '확인' 등급으로 잡는다", () => {
    const signals = collectReviewSignals(makeInput({ usedDefaultSettings: true }));
    const found = signals.find((s) => s.title.includes("운영설정"));
    expect(found?.level).toBe("확인");
    // 우리 시스템 사정이지 점포 평가 내용이 아니다 — 결재 문서로 새면 안 된다.
    expect(found?.forReport).toBe(false);
  });

  it("500m에 PC방이 있다고 해놓고 경쟁점을 안 넣으면 짚는다", () => {
    const signals = collectReviewSignals(makeInput({ competitors: [], candidate: { ...makeInput().candidate, operatingPcStores500m: 4 } }));
    const found = signals.find((s) => s.title.includes("등록되지 않았"));
    expect(found?.level).toBe("확인");
  });

  it("경쟁점이 8곳 이상이면 밀도 신호를 내고, 이건 문서에 쓴다", () => {
    const many = Array.from({ length: 9 }, (_, i) => competitor({ id: `c${i}` }));
    const found = collectReviewSignals(makeInput({ competitors: many })).find((s) => s.title.includes("밀도"));
    expect(found?.forReport).toBe(true);
  });

  it("계획 요금이 경쟁점 평균보다 15% 넘게 높으면 요금 경쟁 리스크로 잡는다", () => {
    const rivals = [competitor({ hourlyRateConverted: 1000 }), competitor({ id: "c2", hourlyRateConverted: 1100 })];
    const found = collectReviewSignals(makeInput({ competitors: rivals })).find((s) => s.title.includes("요금"));
    expect(found?.forReport).toBe(true);
    // 경계 바로 아래면 안 잡힌다 — 사소한 차이로 경고를 남발하지 않는다.
    const near = [competitor({ hourlyRateConverted: 1300 })];
    expect(titles(makeInput({ competitors: near })).some((t) => t.includes("요금"))).toBe(false);
  });

  it("5층 이상이면 입지 제약을 짚고 문서에도 쓴다 (지하는 층수 규칙에서 제외)", () => {
    const high = makeInput({ candidate: { ...makeInput().candidate, floor: 7 } });
    expect(collectReviewSignals(high).find((s) => s.title.includes("7층"))?.forReport).toBe(true);
    const basement = makeInput({ candidate: { ...makeInput().candidate, floor: 7, groundLevel: "지하" } });
    expect(titles(basement).some((t) => t.includes("층으로 높"))).toBe(false);
  });

  it("특수수요가 있으면 유동인구를 그대로 믿지 말라고 짚는다", () => {
    const input = makeInput({ locationEvaluation: { specialDemandType: "야구장" } as unknown as LocationEvaluation });
    expect(collectReviewSignals(input).find((s) => s.title.includes("특수수요"))?.forReport).toBe(true);
  });

  it('특수수요가 "없음"이면 경고하지 않는다 (없음도 유효한 선택지 문자열이다)', () => {
    // 2026-09-13 실데이터에서 3곳이 "특수수요(없음)에 기대고 있습니다"라는 엉뚱한 경고를 달고
    // 있었다. truthy 검사만 하면 잡히는 함정이라 테스트로 고정한다.
    const input = makeInput({ locationEvaluation: { specialDemandType: '없음' } as unknown as LocationEvaluation });
    expect(titles(input).some((t) => t.includes('특수수요'))).toBe(false);
  });

  it("우리 예상 가동률이 경쟁점 실측보다 1.2배 넘게 높으면 짚는다", () => {
    // 경쟁점 실측 30%, 우리 예상 40% → 1.33배
    const input = makeInput({
      result: { ...makeInput().result, v62ImpliedUtilization: 0.4 } as EvaluationResult,
    });
    const found = collectReviewSignals(input).find((s) => s.title.includes("가동률"));
    expect(found?.level).toBe("주의");
    expect(found?.forReport).toBe(false); // 내부 확인용이다
  });

  it("좌표가 없으면 반경분석 근거가 약하다고 짚는다", () => {
    const input = makeInput({ candidate: { ...makeInput().candidate, lat: null, lng: null } });
    expect(collectReviewSignals(input).find((s) => s.title.includes("좌표"))?.level).toBe("확인");
  });

  it("문서로 넘어가는 신호는 전부 점포 평가 내용이다 (우리 시스템 사정이 아니다)", () => {
    // 여러 문제가 겹친 상태에서도 forReport 집합에 내부 사정이 섞이지 않아야 한다.
    const input = makeInput({
      usedDefaultSettings: true,
      candidate: { ...makeInput().candidate, lat: null, lng: null, floor: 7 },
      locationEvaluation: null,
      competitors: Array.from({ length: 9 }, (_, i) => competitor({ id: `c${i}`, pingbotUtilization: null })),
    });
    const forReport = collectReviewSignals(input).filter((s) => s.forReport).map((s) => s.title);
    expect(forReport.some((t) => t.includes("운영설정"))).toBe(false);
    expect(forReport.some((t) => t.includes("좌표"))).toBe(false);
    expect(forReport.some((t) => t.includes("입지동선평가가 입력"))).toBe(false);
    expect(forReport.some((t) => t.includes("실측 가동률이 없"))).toBe(false);
    // 반면 점포 자체의 조건은 넘어간다.
    expect(forReport.some((t) => t.includes("밀도"))).toBe(true);
    expect(forReport.some((t) => t.includes("7층"))).toBe(true);
  });
});

// 2026-09-13 — 같은 계산이 화면 경고와 확인 신호 두 곳에 있던 것을 하나로 합쳤다.
// 임계값과 경계 동작을 여기서 고정한다(두 곳이 같은 함수를 쓰므로 한 번만 검사하면 된다).
describe("우리 vs 경쟁점 가동률 비교", () => {
  const res = (over: Record<string, unknown>) =>
    ({ v62ImpliedUtilization: 0.4, competitorOccupiedSeats: 30, competitorIp: 100, ...over }) as unknown as EvaluationResult;

  it("경쟁점 평균 가동률은 실가동좌석 ÷ 경쟁IP다", () => {
    const c = compareOwnVsRivalUtilization(res({}));
    expect(c?.rivals).toBeCloseTo(0.3, 10);
    expect(c?.ours).toBeCloseTo(0.4, 10);
    expect(c?.ratio).toBeCloseTo(0.4 / 0.3, 10);
  });

  it(`${RIVAL_UTILIZATION_WARN_RATIO}배 경계에서 갈린다`, () => {
    // 경쟁점 30% 기준 — 우리가 36%면 정확히 1.2배
    const at = compareOwnVsRivalUtilization(res({ v62ImpliedUtilization: 0.36 }));
    expect(at!.ratio).toBeGreaterThanOrEqual(RIVAL_UTILIZATION_WARN_RATIO);
    const below = compareOwnVsRivalUtilization(res({ v62ImpliedUtilization: 0.35 }));
    expect(below!.ratio).toBeLessThan(RIVAL_UTILIZATION_WARN_RATIO);
  });

  it("비교할 수 없으면 null (0으로 나누지 않는다)", () => {
    expect(compareOwnVsRivalUtilization(res({ v62ImpliedUtilization: null }))).toBeNull();
    expect(compareOwnVsRivalUtilization(res({ competitorOccupiedSeats: null }))).toBeNull();
    expect(compareOwnVsRivalUtilization(res({ competitorIp: 0 }))).toBeNull();
    expect(compareOwnVsRivalUtilization(res({ competitorIp: null }))).toBeNull();
    expect(compareOwnVsRivalUtilization(res({ competitorOccupiedSeats: 0 }))).toBeNull();
  });

  it("신호 생성이 이 비교와 같은 결과를 낸다", () => {
    // 경계 아래면 신호가 없고, 위면 있다 — 화면 경고도 같은 함수를 쓰므로 자동으로 일치한다.
    const below = makeInput({ result: res({ v62ImpliedUtilization: 0.35 }), competitors: [competitor()] });
    expect(titles(below).some((t) => t.includes("가동률"))).toBe(false);
    const above = makeInput({ result: res({ v62ImpliedUtilization: 0.4 }), competitors: [competitor()] });
    expect(titles(above).some((t) => t.includes("가동률"))).toBe(true);
  });
});
