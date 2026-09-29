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
import { buildQuickEvalReviewContext } from "./quickEvalReviewPrompt";

export const QUICK_EVAL_CHAT_COLLECTION = "quickEvalChatRuns";

/**
 * AI 조정 의견을 낼 문턱 — 산식보다 이만큼 이상 높게/낮게 볼 근거가 있을 때만 "특이점"이다. (사용자 2026-09-29 확정)
 * 근거: AI 입지 점수는 조회마다 한 칸쯤 흔들리고 그것만으로 금액이 4% 안팎 움직인다(김포 한강2로23번길 60: 5,800 vs 6,030).
 * 그보다 작은 차이는 흔들림이지 특이점이 아니다.
 */
export const QUICK_EVAL_CHAT_ADJUST_THRESHOLD = 0.1;

/**
 * 채팅 평가문 지침 (2026-09-29 사용자 확정 구도). 웹 평가문(QUICK_EVAL_REVIEW_SYSTEM_PROMPT)에서 갈라졌다:
 *   - 예상 월매출은 **하나만**(화면 요약의 값). AI가 금액을 따로 내면 두 금액이 떠서 헷갈린다(사용자 지적).
 *   - AI 몫은 "조정 의견" — 특이점이 있을 때만 방향·크기·이유. '산식값과의 차이' 섹션은 조정 의견이 대신한다.
 * 웹 평가문의 기본 규칙(근거는 주어진 자료뿐·하루 대당·쉬운 말·동그라미 숫자 금지)은 그대로 옮겼다.
 */
export const QUICK_EVAL_CHAT_REVIEW_GUIDE = [
  "당신은 PC방 프랜차이즈 점포개발 담당자를 돕는 상권 분석가입니다. 주소만으로 낸 초기평가 결과를 설명합니다.",
  "",
  "반드시 지킬 것:",
  "1. 예상 월매출은 [화면 요약]의 금액 하나만 씁니다. 당신이 새 금액을 따로 제시하지 마세요. 범위(±%·보수·상한·○○만~○○만)도 쓰지 마세요.",
  "2. 근거는 [평가문 자료]와 당신이 웹 검색으로 확인한 사실뿐입니다. 기억 속 숫자·업계 평균을 끌어오지 마세요.",
  "3. 'V62'·'실험실'이라는 이름을 쓰지 마세요. 필요하면 '산식 예상 매출액'이라고 부르세요. '정밀 평가로 내라'는 말도 쓰지 마세요.",
  "4. 가맹점 실적표의 대당은 하루 대당입니다(PC 1대가 하루 버는 돈). 셈할 때는 하루대당 × 30 × PC대수.",
  "5. 경쟁점 PC 대수·품질은 조사값이 아니라 기본값입니다. '기본값이라 변동될 수 있다'는 문구는 쓰지 말고, 확인할 것은 '현장에서 확인할 것'에만 적으세요.",
  "6. 한국어로, 초보자도 이해하게 씁니다. 동그라미 숫자(①②③)는 쓰지 말고 1. 2. 3.으로 씁니다.",
  "",
  "형식(마크다운, 제목은 ##). 이 순서를 지키세요:",
  "## 한 줄 결론",
  "## 이 상권은 어떤 상권인가",
  "   상권 성격(주거 밀집 생활상권·역세권·대학가·산업단지 배후 등)과 그렇게 본 근거 수치(주거인구·유동인구·주변 시설 거리). 자세히 쓰세요.",
  "## 장점",
  "## 단점·특이점",
  "   좋은 말만 쓰지 마세요. 웹 검색으로 찾은 상권 사정(침체·공실·개발 등)도 여기 적습니다.",
  "## AI 조정 의견",
  `   아래 '특이점' 중 하나가 있고, 그 때문에 산식 예상 매출액보다 ${Math.round(QUICK_EVAL_CHAT_ADJUST_THRESHOLD * 100)}% 이상 높게 또는 낮게 봐야 할 때만 씁니다.`,
  "   특이점:",
  "   1. 산식에 안 들어가는 사실을 웹 검색으로 확인했을 때 — 상권 침체·공실 증가 기사, 대형 개발·입주 예정, 경쟁점 개업·폐업 소식, 주변 요금 경쟁, 역·도로 개통 같은 동선 변화",
  `   2. [평가문 자료]의 비슷한 가맹점 하루 대당으로 셈한 값이 산식 예상 매출액과 ${Math.round(QUICK_EVAL_CHAT_ADJUST_THRESHOLD * 100)}% 넘게 벌어질 때`,
  "   3. 자료에 구멍이 있을 때 — 유동인구 수집 실패, 경쟁점 목록 잘림, 기존 가맹점에 없던 고립 상권",
  "   쓸 때는 금액을 새로 내지 말고 '방향 · 크기 · 이유' 한두 줄로: 예) 산식보다 10~15% 낮게 볼 여지 — 라베니체 1층 공실률 40% 보도(경기신문).",
  "   특이점이 없으면 이 한 줄만: 산식값과 다르게 볼 뚜렷한 이유 없음.",
  "## 현장에서 확인할 것",
  "   체크리스트. 담당자가 그대로 들고 나갑니다.",
].join("\n");

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

  // 시작 문장 — 사용자 2026-09-29 "시작 멘트는 기존 것이 좋았다": 결론부터(가능/불가 · 금액 · 기준선과의 차이).
  // 금액은 웹 화면과 같은 100만원 단위(formatManwonRough)로 셈해서, 화면과 채팅 숫자가 어긋나 보이지 않게 한다.
  const place = plan.roadAddress ?? args.address;
  const roughMan = finalRevenue == null ? null : Math.round(finalRevenue / 1_000_000) * 100;
  const gapMan = roughMan == null ? null : roughMan - T / 10_000;
  const opening =
    finalRevenue == null
      ? `${place} 자리는 예상 월매출을 계산하지 못해 판정할 수 없었습니다(자료 수집 실패).`
      : `${place} 자리는 입점 ${verdict}으로 나왔습니다. 예상 월매출은 약 ${formatManwonRough(finalRevenue)}으로, 기준선 ${formatManwon(T)}보다 ` +
        (gapMan === 0 ? "거의 같습니다." : `${Math.abs(gapMan!).toLocaleString("ko-KR")}만원가량 ${gapMan! > 0 ? "높습니다" : "낮습니다"}.`);

  const summary = [
    opening,
    "",
    "평가 결과 (주소만 넣은 초기평가)",
    `- 조건: PC ${plan.expectedPcCount ?? "-"}대${isDefault("PC대수")} · 기본요금 ${plan.hourlyRate?.toLocaleString("ko-KR") ?? "-"}원${isDefault("시간당 요금")} · ${plan.groundLevel ?? "지상"} ${plan.floor ?? "-"}층${isDefault("층")} · 엘리베이터 ${plan.hasElevator ? "있음" : "없음"}${isDefault("엘리베이터")}`,
    // 2026-09-29 사용자: "매출 범위 노출 안 하는 쪽 — 그냥 매출만 딱". ±20%·보수·상한은 채팅에 안 낸다.
    `- 예상 월매출 ${formatManwonRough(finalRevenue)} (입점 기준: ${formatManwon(T)} 초과면 가능)`,
    plainReason ? `- 판정 참고: ${plainReason}` : "",
    `- 상권수요 ${fmt(r.marketDemand)} · 상권등급/성격 ${r.marketGrade ?? "-"} / ${r.marketCharacter ?? "-"} · 경쟁IP ${fmt(r.competitorIp)} · IP당수요 ${r.ipPerDemand == null ? "-" : r.ipPerDemand.toFixed(1)}`,
    `- 반경 500m 경쟁 PC방 ${counted.length}곳${counted.length ? `: ${counted.map((row) => `${row.place.name}(${Math.round(row.place.distanceM)}m)`).join(", ")}` : ""}`,
    warnings.length ? `- 주의: ${warnings.join(" / ")}` : "",
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n");

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
    "1. 아래 [화면 요약]을 숫자와 문장 그대로 맨 먼저 보여준다(시작 문장 + 평가 결과).",
    "2. 이어서 [평가문 지침]대로 평가문을 쓴다. 근거는 [평가문 자료]와 당신이 웹 검색으로 확인한 사실뿐이다.",
    "3. 입지 점수표(7항목·근거)를 짧게 붙인다.",
    "4. 맨 끝에 [보고 안내]를 그대로 붙인다.",
    "",
    "[화면 요약]",
    summary,
    "",
    "[평가문 지침]",
    QUICK_EVAL_CHAT_REVIEW_GUIDE,
    "",
    "[평가문 자료]",
    reviewContext,
    "",
    "[보고 안내]",
    QUICK_EVAL_CHAT_REPORT_NOTE,
  ].join("\n");
  return { text, verdict, finalRevenue };
}
