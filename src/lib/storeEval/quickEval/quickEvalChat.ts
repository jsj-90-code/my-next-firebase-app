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
  OWN_FOOD_BRAND, QUICK_EVAL_ENTRY_THRESHOLD_WON, QUICK_EVAL_PLAN_DEFAULTS,
} from "./quickEvalDefaults";
import type { GroundLevel } from "../types";
import { formatManwon, formatManwonRough } from "../format";
import { buildQuickEvalReviewContext, QUICK_EVAL_REVIEW_SYSTEM_PROMPT } from "./quickEvalReviewPrompt";

export const QUICK_EVAL_CHAT_COLLECTION = "quickEvalChatRuns";

/** 채팅 결과 끝에 붙는 안내 — 주소만 본 참고치라는 것과, 보고 때 더할 것. */
export const QUICK_EVAL_CHAT_REPORT_NOTE = [
  "※ 주소와 공개 자료만으로 낸 참고치입니다. 보고할 때는 아래를 현장에서 확인해 더해 주세요.",
  "  - 주변 경쟁 PC방의 실제 상태(대수·시설 수준·요금·손님 수)",
  "  - 건물 여건(간판 위치·입구·주차·임대 조건)",
  "  - 이 평가에 없는 동네 사정(개발 계획, 입주 시기, 학교·공장 근무 시간대 등)",
].join("\n");

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


/**
 * submit_location_scores가 채팅에 돌려주는 글.
 *
 * 2026-09-29 사용자: 웹 주소만 초기평가 화면 구성이 더 좋다 → **웹 화면 순서를 그대로 따른다.**
 *   1. [화면 요약] 웹 KeyVerdict·결과 카드와 같은 숫자(금액 표기도 웹과 같은 100만원 단위 formatManwonRough)
 *   2. [평가문] 웹 "AI 상권평가"와 **같은 지시문·같은 자료**(QUICK_EVAL_REVIEW_SYSTEM_PROMPT · buildQuickEvalReviewContext)로
 *      사용자 AI가 직접 쓴다 — 웹은 제미나이 무료 키, 채팅은 사용자 요금제. 가맹점 실적 비교표도 같이 준다.
 *   3. [보고 안내] 정밀평가는 사용자 본인만 쓰므로 "정밀평가로 내라" 대신 "현장에서 본 것을 더하라".
 * 판정 이유 문장(quickEvalVerdict, 웹과 공용)의 "(실험실)"·"V62가"는 다른 직원에게 안 보이게 뗀다.
 */
export function buildResultSummary(args: {
  address: string;
  computed: QuickEvalComputed;
  defaultsUsed: string[];
  collectErrors: string[];
  sourcesCount: number;
  modelName: string | null;
  rationale?: string | null;
}): { text: string; verdict: "가능" | "불가" | "판정 불가"; finalRevenue: number | null } {
  const { computed } = args;
  const r = computed.evaluated;
  const finalRevenue = computed.final.value;
  const T = QUICK_EVAL_ENTRY_THRESHOLD_WON;
  const verdict = finalRevenue == null ? "판정 불가" : finalRevenue > T ? "가능" : "불가";
  const counted = computed.built.competitorRows.filter((row) => row.counted);
  const warnings = [
    ...(args.sourcesCount === 0 ? ["참고한 웹 주소가 없습니다 — 웹 검색 없이 매긴 입지 점수일 수 있습니다."] : []),
    ...args.collectErrors,
  ];
  const plainReason = computed.final.reason?.replace(/\s*\((실험실|V62)\)/g, "").replace(/V62가/g, "기본 추정이") ?? null;
  const plan = computed.built.candidate;
  const isDefault = (label: string) => (args.defaultsUsed.some((d) => d.startsWith(label)) ? "(기본값)" : "");
  const fmt = (v: number | null | undefined) => (v == null ? "-" : Math.round(v).toLocaleString("ko-KR"));

  const summary = [
    `■ ${plan.roadAddress ?? args.address} — 주소만 초기평가`,
    `예상 월매출: ${formatManwonRough(finalRevenue)}  (PC ${plan.expectedPcCount ?? "-"}대${isDefault("PC대수")} · 기본요금 ${plan.hourlyRate?.toLocaleString("ko-KR") ?? "-"}원${isDefault("시간당 요금")} 기준)`,
    `입점 가능여부: ${verdict === "판정 불가" ? "판정 불가" : `입점 ${verdict}`}  (기준: 예상 월매출 ${formatManwon(T)} 초과)`,
    plainReason ? `  · ${plainReason}` : "",
    finalRevenue != null ? `±20%로 보면 ${formatManwonRough(finalRevenue * 0.8)} ~ ${formatManwonRough(finalRevenue * 1.2)}` : "",
    `상권수요 ${fmt(r.marketDemand)} · 상권등급/성격 ${r.marketGrade ?? "-"} / ${r.marketCharacter ?? "-"} · 경쟁IP ${fmt(r.competitorIp)} · IP당수요 ${r.ipPerDemand == null ? "-" : r.ipPerDemand.toFixed(1)}`,
    `경쟁점 ${counted.length}곳 · 반경 500m${counted.length ? `: ${counted.map((row) => `${row.place.name}(${Math.round(row.place.distanceM)}m)`).join(", ")}` : ""}`,
    warnings.length ? `주의: ${warnings.join(" / ")}` : "",
  ].filter((l) => l !== "").join("\n");

  const reviewContext = buildQuickEvalReviewContext({
    result: r,
    assembly: computed.built,
    collectErrors: args.collectErrors,
    peers: computed.peers,
    locationDraftRationale: args.rationale ?? null,
    finalEstimate: computed.final,
  });

  const text = [
    "[AI에게 — 답을 이 순서로 쓸 것]",
    "1. 아래 [화면 요약]을 숫자 그대로 맨 먼저 보여준다(웹 화면의 핵심 카드와 같은 내용).",
    "2. 이어서 [평가문 지침]대로 평가문을 쓴다. 근거는 [평가문 자료]뿐이다. 금액 셈은 자료의 가맹점 실적표로만.",
    "   'V62'·'실험실'이라는 이름은 쓰지 말고, 산식 금액은 '산식 예상 매출액'이라고 부른다. '정밀 평가로 내라'는 말은 쓰지 않는다.",
    "3. 입지 점수표(7항목·근거)를 짧게 붙인다.",
    "4. 맨 끝에 [보고 안내]를 그대로 붙인다.",
    "",
    "[화면 요약]",
    summary,
    "",
    "[평가문 지침]",
    QUICK_EVAL_REVIEW_SYSTEM_PROMPT,
    "",
    "[평가문 자료]",
    reviewContext,
    "",
    "[보고 안내]",
    QUICK_EVAL_CHAT_REPORT_NOTE,
  ].join("\n");
  return { text, verdict, finalRevenue };
}
