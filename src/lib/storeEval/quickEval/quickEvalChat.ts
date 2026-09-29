// 채팅 입지평가(MCP)의 **글 부분** — 사용자 AI에게 줄 안내문과, 계산 결과를 채팅에 돌려줄 요약문. (2026-09-29)
//
// 배경(사용자 2026-09-29): 유료 API 대신 각자 AI 요금제(ChatGPT·Claude)로 입지평가를 돌린다. 휴대폰에서도 쓰므로 채팅 앱만.
// 흐름: get_site_data(주소 → 자료·채점 기준) → 사용자 AI가 웹 검색으로 조사·채점 → submit_location_scores(점수 → 예상매출)
//
// ⚠️ 채점 기준 문장은 여기서 새로 쓰지 않는다 — 제미나이 초안과 같은 문장(locationEvalAi.ts)을 그대로 읽는다.
// ⚠️ 숫자(기준선 5,500만·기본 대수 등)는 quickEvalDefaults에서 읽는다(CLAUDE.md 규칙).
import {
  INFLOW_LEVELS,
  LOCATION_EVAL_FIELD_DESCRIPTIONS,
  LOCATION_EVAL_SYSTEM_PROMPT,
  SPECIAL_DEMAND_INTENSITIES,
  SPECIAL_DEMAND_TYPES,
} from "../locationEvalAi";
import type { QuickEvalPlanInput } from "./buildQuickCandidate";
import type { QuickEvalComputed } from "./quickEvalCompute";
import {
  OWN_FOOD_BRAND, QUICK_EVAL_ENTRY_THRESHOLD_WON, QUICK_EVAL_PLAN_DEFAULTS, QUICK_EVAL_USAGE_LIMIT, QUICK_EVAL_VERDICT_BACKTEST as B,
} from "./quickEvalDefaults";
import type { GroundLevel } from "../types";

export const QUICK_EVAL_CHAT_COLLECTION = "quickEvalChatRuns";

export type ChatPlanArgs = {
  address: string;
  pcCount?: number | null;
  hourlyRate?: number | null;
  floor?: number | null;
  groundLevel?: GroundLevel | null;
  hasElevator?: boolean | null;
};

/** 채팅 입력 → 계산 입력. 비운 칸은 주소만평가 화면과 같은 기본값(QUICK_EVAL_PLAN_DEFAULTS). */
export function chatPlanInput(a: ChatPlanArgs): { plan: QuickEvalPlanInput; defaultsUsed: string[] } {
  const d = QUICK_EVAL_PLAN_DEFAULTS;
  const defaultsUsed: string[] = [];
  const pick = <T,>(v: T | null | undefined, fallback: T, label: string): T => {
    if (v == null) {
      defaultsUsed.push(`${label} ${String(fallback)}`);
      return fallback;
    }
    return v;
  };
  const hasElevator = pick(a.hasElevator, d.hasElevator === "있음", "엘리베이터");
  return {
    plan: {
      name: a.address.trim(),
      address: a.address.trim(),
      expectedPcCount: pick(a.pcCount, d.expectedPcCount, "PC대수"),
      hourlyRate: pick(a.hourlyRate, d.hourlyRate, "시간당 요금"),
      floor: pick(a.floor, d.floor, "층"),
      groundLevel: pick(a.groundLevel, d.groundLevel as GroundLevel, "지상/지하"),
      hasElevator,
      ownFoodBrand: OWN_FOOD_BRAND,
      plannedOpenMonth: null,
    },
    defaultsUsed: defaultsUsed.map((s) => s.replace("엘리베이터 true", "엘리베이터 있음").replace("엘리베이터 false", "엘리베이터 없음")),
  };
}

/** get_site_data가 AI에게 돌려주는 안내문 — 사실 자료 + 채점 기준 + 다음 할 일. */
export function buildScoringBrief(args: { runId: string; contextText: string; collectErrors: string[] }): string {
  const fieldLines = Object.entries(LOCATION_EVAL_FIELD_DESCRIPTIONS).map(([k, v]) => `- ${k}: ${v}`);
  return [
    `평가 번호(runId): ${args.runId}`,
    "",
    "[이미 수집된 사실 자료]",
    args.contextText,
    args.collectErrors.length ? `\n[수집 중 빠진 자료]\n${args.collectErrors.map((e) => `- ${e}`).join("\n")}` : "",
    "",
    "[채점 지침]",
    LOCATION_EVAL_SYSTEM_PROMPT,
    "",
    "[항목별 기준]",
    ...fieldLines,
    `허용 값 — specialDemandType: ${SPECIAL_DEMAND_TYPES.join("/")} · specialDemandIntensity: ${SPECIAL_DEMAND_INTENSITIES.join("/")} · inflowRestriction: ${INFLOW_LEVELS.join("/")}`,
    "",
    "[다음 할 일]",
    "1. 위 자료만으로 부족한 부분(상권 성격, 실제 동선, 간판 노출, 특수수요)을 웹 검색으로 이 주소를 직접 조사하세요. 지도·로드뷰·지역 기사·부동산 정보가 도움이 됩니다.",
    "2. 조사가 끝나면 submit_location_scores를 부르세요. runId, 7개 항목, 근거(rationale), 참고한 웹 주소(sources), 지금 쓰고 있는 모델 이름(modelName)을 함께 넣습니다.",
    "3. 근거를 못 찾은 항목은 null로 두세요. 지어내면 예상매출이 틀립니다.",
  ].filter((l) => l !== "").join("\n");
}

const won = (v: number | null | undefined) => (v == null ? "계산 불가" : `${Math.round(v / 10_000).toLocaleString("ko-KR")}만원`);

/** submit_location_scores가 채팅에 돌려주는 요약. 사용자에게 그대로 보여주라고 적는다. */
export function buildResultSummary(args: {
  address: string;
  computed: QuickEvalComputed;
  defaultsUsed: string[];
  collectErrors: string[];
  sourcesCount: number;
  modelName: string | null;
}): { text: string; verdict: "가능" | "불가" | "판정 불가"; finalRevenue: number | null } {
  const { computed } = args;
  const finalRevenue = computed.final.value;
  const T = QUICK_EVAL_ENTRY_THRESHOLD_WON;
  const verdict = finalRevenue == null ? "판정 불가" : finalRevenue > T ? "가능" : "불가";
  const counted = computed.built.competitorRows.filter((r) => r.counted).length;
  const warnings = [
    ...(args.sourcesCount === 0 ? ["참고한 웹 주소가 없습니다 — 웹 검색 없이 매긴 점수일 수 있습니다."] : []),
    ...args.collectErrors,
    ...computed.built.missing,
  ];
  // 2026-09-29 사용자: "주소만 초기평가하는데 실험실이 어쩌니 V62가 어쩌니 이런 소리" — 다른 직원도 쓰는 도구라
  // 웹 화면(quick-eval KeyVerdict)과 같은 두 칸(예상 월매출·입점 가능여부)만 보이고, 내부 산식 이름은 쓰지 않는다.
  // 판정 이유 문장(quickEvalVerdict, 웹과 공용)에 붙은 "(실험실)" 같은 괄호 이름도 여기서 뗀다.
  const plainReason = computed.final.reason?.replace(/\s*\((실험실|V62)\)/g, "").replace(/V62가/g, "기본 추정이") ?? null;
  const plan = computed.built.candidate;
  const lines = [
    `■ ${args.address} 주소만 초기평가`,
    `- 예상 월매출: ${won(finalRevenue)} (PC ${plan.expectedPcCount ?? "-"}대 · 기본요금 ${plan.hourlyRate?.toLocaleString("ko-KR") ?? "-"}원 기준)`,
    `- 입점 가능여부: ${verdict === "판정 불가" ? "판정 불가" : `입점 ${verdict}`} (기준: 예상 월매출 ${won(T)} 초과)`,
    plainReason ? `  · ${plainReason}` : "",
    `- 반경 500m 경쟁 PC방: ${counted}곳`,
    args.defaultsUsed.length ? `- 기본값으로 계산한 칸: ${args.defaultsUsed.join(", ")}` : "",
    warnings.length ? `- 주의: ${warnings.join(" / ")}` : "",
    "",
    `초기 심사용 참고치입니다(기존 가맹점 ${B.sampleCount}곳 되짚기에서 가능·불가를 ${B.correct}곳 맞힘). ${QUICK_EVAL_USAGE_LIMIT.replace(/\*\*/g, "")}`,
    "",
    "[AI에게] 위 요약의 숫자와 판정을 그대로 사용자에게 보여줄 것. 'V62'·'실험실'·'산식' 같은 내부 이름은 쓰지 말고, 예상 월매출과 입점 가능여부로만 말할 것. 입지 점수표는 짧게 덧붙여도 된다.",
  ];
  return { text: lines.filter((l) => l !== "").join("\n"), verdict, finalRevenue };
}
