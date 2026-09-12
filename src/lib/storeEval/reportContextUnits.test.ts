// 보고서 컨텍스트의 단위 처리 회귀 테스트 (2026-09-13).
//
// 핑봇 가동률은 시트 관례상 "30"처럼 % 표기로 저장된다 — 운영 데이터 54건이 전부 5.5~52.1이다.
// calc.ts는 normalizePercentLike로 정규화해서 쓰는데, 2026-09-13에 보고서 컨텍스트를 만들면서
// 그 정규화를 빠뜨려 "가동률 3000%"가 AI에게 넘어가고 있었다. 전수 점검(.local-tools/
// audit-competitors.mjs)에서 발견했다. 같은 실수가 다시 생기지 않게 고정한다.

import { describe, expect, it } from "vitest";
import { buildDaouReportContext } from "./reportContext";
import type { Competitor, EvaluationResult } from "./types";

const result = {
  marketDemand: 4000, marketCharacter: "혼합", competitorIp: 300, ipPerDemand: 10,
  competitivenessGap: 1.3, demandCaptureRate: 0.6, expectedOwnDemand: 1800,
  expectedPcCount: 100, hourlyRate: 1400, v62Final: 58000000, v62ImpliedUtilization: 0.3,
  aaBaselineRevenue: 56000000, aaBaselineRevenue1500: 50000000, aaBaselineRevenue1000: 44000000,
  completionStatus: "완료", finalJudgement: "평가 완료",
} as unknown as EvaluationResult;

const candidate = {
  name: "테스트", address: "테스트주소", pop500m: 10000, floating500Avg: 100000,
  facility500SubwayRiders: null, floor: 2, groundLevel: "지상", hasElevator: true, expectedPcCount: 100,
};

const competitor = (over: Partial<Competitor> = {}) => ({
  name: "경쟁점A", distanceM: 200, investigationStatus: "조사완료",
  totalPcCount: 100, pingbotUtilization: 30, ...over,
}) as unknown as Competitor;

describe("보고서 컨텍스트 — 핑봇 가동률 단위", () => {
  it("% 표기(30)를 30%로 쓴다 (3000%가 아니다)", () => {
    const text = buildDaouReportContext({ candidate, competitors: [competitor()], result });
    expect(text).toContain("가동률 30.0%");
    expect(text).not.toContain("3000");
  });

  it("비율 표기(0.3)도 30%로 쓴다 (두 관례를 모두 받는다)", () => {
    const text = buildDaouReportContext({ candidate, competitors: [competitor({ pingbotUtilization: 0.3 })], result });
    expect(text).toContain("가동률 30.0%");
  });

  it("실제 운영값 범위(5.5~52.1)가 전부 100% 이하로 나온다", () => {
    for (const v of [5.5, 13.7, 22.2, 40.3, 52.1]) {
      const text = buildDaouReportContext({ candidate, competitors: [competitor({ pingbotUtilization: v })], result });
      const m = text.match(/가동률 ([\d.]+)%/);
      expect(m, `${v} 에서 가동률 표기를 못 찾음`).not.toBeNull();
      expect(Number(m![1]), `${v} → ${m![1]}%`).toBeLessThanOrEqual(100);
    }
  });
});
