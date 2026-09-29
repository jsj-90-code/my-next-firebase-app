import { describe, expect, it } from "vitest";
import { buildScoringBrief, chatPlanInput } from "./quickEvalChat";
import { QUICK_EVAL_PLAN_DEFAULTS } from "./quickEvalDefaults";
import { LOCATION_EVAL_FIELD_KEYS } from "../locationEvalAi";

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
