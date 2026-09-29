import { describe, expect, it } from "vitest";
import { buildResultSummary, buildScoringBrief, chatPlanInput } from "./quickEvalChat";
import { QUICK_EVAL_PLAN_DEFAULTS } from "./quickEvalDefaults";
import { LOCATION_EVAL_FIELD_KEYS } from "../locationEvalAi";

describe("채팅 결과 요약 말투", () => {
  it("내부 산식 이름(V62·실험실)을 사용자 문장에 내지 않는다", () => {
    // 모르는 칸은 전부 null로 읽히는 가짜 결과(평가문 자료 함수가 여러 칸을 읽는다)
    const nulls = <T extends object>(o: T) => new Proxy(o, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : null) });
    const computed = {
      final: { value: 25_320_000, source: "실험실", reason: "고립 상권이라 주민으로 쌓은 수요(실험실)로 판정했습니다. V62가 값을 내지 못해" },
      evaluated: nulls({ v62Final: 30_360_000, marketDemand: 344, marketGrade: "B" }),
      built: { competitorRows: [], missing: [], candidate: nulls({ expectedPcCount: 90, hourlyRate: 1500, roadAddress: "충남 천안시 풍세산단로 277" }) },
      peers: null,
    } as unknown as Parameters<typeof buildResultSummary>[0]["computed"];
    const { text, verdict } = buildResultSummary({ address: "주소", computed, defaultsUsed: [], collectErrors: [], sourcesCount: 2, modelName: "m" });
    expect(verdict).toBe("불가");
    const screen = text.split("\n[화면 요약]\n")[1].split("\n[평가문 지침]\n")[0];
    const note = text.split("\n[보고 안내]\n")[1];
    expect(screen).not.toMatch(/V62|실험실/);
    // 시작 문장은 결론부터, 금액은 웹 화면과 같은 100만원 단위(사용자 2026-09-29)
    expect(screen).toContain("자리는 입점 불가으로 나왔습니다. 예상 월매출은 약 2,500만원으로, 기준선 5,500만원보다 3,000만원가량 낮습니다.");
    expect(screen).not.toMatch(/±|보수|상한|~/); // 매출은 하나만(사용자 2026-09-29 "그냥 매출만 딱")
    // AI가 금액을 따로 내지 않는다(두 금액 금지) · 산식값과의 차이 섹션 없음 · 조정 의견은 특이점 있을 때만
    expect(text).toContain("## AI 조정 의견");
    expect(text).not.toContain("## AI가 판단한 예상매출");
    expect(text).not.toContain("## 산식값과의 차이");
    // 정밀평가는 사용자 본인만 쓴다 — 다른 직원에게 정밀평가로 내라고 하지 않는다(2026-09-29)
    expect(note).not.toMatch(/정밀|신규후보지/);
    expect(note).toContain("현장에서 확인");
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
