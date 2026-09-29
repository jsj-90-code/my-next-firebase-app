import { describe, expect, it } from "vitest";
import { buildResultSummary, buildScoringBrief, chatPlanInput } from "./quickEvalChat";
import { QUICK_EVAL_PLAN_DEFAULTS } from "./quickEvalDefaults";
import { LOCATION_EVAL_FIELD_KEYS } from "../locationEvalAi";

describe("채팅 결과 요약 말투", () => {
  it("내부 산식 이름(V62·실험실)을 사용자 문장에 내지 않는다", () => {
    const computed = {
      final: { value: 25_320_000, source: "실험실", reason: "고립 상권이라 주민으로 쌓은 수요(실험실)로 판정했습니다. V62가 값을 내지 못해" },
      evaluated: { v62Final: 30_360_000 },
      built: { competitorRows: [], missing: [], candidate: { expectedPcCount: 90, hourlyRate: 1500 } },
    } as unknown as Parameters<typeof buildResultSummary>[0]["computed"];
    const { text, verdict } = buildResultSummary({ address: "주소", computed, defaultsUsed: [], collectErrors: [], sourcesCount: 2, modelName: "m" });
    expect(verdict).toBe("불가");
    const userPart = text.split("[AI에게]")[0];
    expect(userPart).not.toMatch(/V62|실험실/);
    expect(userPart).toContain("예상 월매출: 2,532만원");
    expect(userPart).toContain("입점 불가");
  });
});

describe("채팅 입지평가 입력", () => {
  it("비운 칸은 주소만평가 화면과 같은 기본값을 쓰고, 무엇을 기본값으로 썼는지 남긴다", () => {
    const { plan, defaultsUsed } = chatPlanInput({ address: "  충남 천안시 동남구 테스트로 1 " });
    expect(plan.address).toBe("충남 천안시 동남구 테스트로 1");
    expect(plan.expectedPcCount).toBe(QUICK_EVAL_PLAN_DEFAULTS.expectedPcCount);
    expect(plan.hourlyRate).toBe(QUICK_EVAL_PLAN_DEFAULTS.hourlyRate);
    expect(plan.floor).toBe(QUICK_EVAL_PLAN_DEFAULTS.floor);
    expect(plan.hasElevator).toBe(QUICK_EVAL_PLAN_DEFAULTS.hasElevator === "있음");
    expect(defaultsUsed).toHaveLength(5);
    expect(defaultsUsed.join(" ")).not.toMatch(/true|false/);
  });

  it("넣은 값은 그대로 쓴다(0층·엘리베이터 없음도 기본값으로 덮지 않는다)", () => {
    const { plan, defaultsUsed } = chatPlanInput({ address: "주소", pcCount: 80, hourlyRate: 1500, floor: 1, groundLevel: "지하", hasElevator: false });
    expect(plan).toMatchObject({ expectedPcCount: 80, hourlyRate: 1500, floor: 1, groundLevel: "지하", hasElevator: false });
    expect(defaultsUsed).toEqual([]);
  });

  it("채점 안내문에 평가 번호와 7개 항목 기준이 다 들어간다", () => {
    const brief = buildScoringBrief({ runId: "abc123", contextText: "사실 자료", collectErrors: ["유동 실패"] });
    expect(brief).toContain("abc123");
    expect(brief).toContain("유동 실패");
    for (const k of LOCATION_EVAL_FIELD_KEYS) expect(brief).toContain(`- ${k}:`);
  });
});
