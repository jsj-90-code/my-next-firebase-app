import { Type } from "@google/genai";
import { getLocationEvalGeminiClient, getLocationEvalGeminiModel } from "@/lib/gemini";
import type { InflowRestriction, SpecialDemandIntensity, SpecialDemandType } from "./types";

// 입지동선평가 AI 초안의 핵심 로직(스키마·프롬프트·2단계 Gemini 호출·응답 검증). 원래
// ai-location-eval/route.ts 안에 있던 것을 그대로 옮겼다 — 신규후보지 라우트와 4단계
// (기존 매장 AI채점검증) 러너가 이 함수 하나를 공유해서 로직이 두 곳에서 갈라지지 않게 한다.
//
// 09_입지동선평가 D/E/F/G/J/K/L/M/N/O열(공식 판단기준표 없음, docs/data-issues.md #2)은 여전히
// "사람이 GPT/AI에게 물어보고 옮겨 적던" 과정을 앱 안으로 옮겨온 것뿐이다 — AI 결과는 항상 사람이
// 검토·수정 후 직접 저장하는 초안일 뿐 자동저장하지 않는다(2026-08-22 원칙 유지).
//
// Gemini API는 googleSearch 그라운딩 도구와 responseSchema 강제 구조화 출력을 같은 호출에 섞기
// 어렵다고 알려져 있어(2026-08-25 확인), "조사 → 구조화 추출" 2단계로 분리한다.

const SPECIAL_DEMAND_TYPES: SpecialDemandType[] = ["없음", "대학가", "군부대", "산업단지", "관광유흥", "기타"];
const SPECIAL_DEMAND_INTENSITIES: SpecialDemandIntensity[] = ["없음", "낮음", "보통", "높음"];
const INFLOW_LEVELS: InflowRestriction[] = ["없음", "보통", "강함"];

// 2026-09-01 재설계 — flowScore/attractionScore를 AI 채점 대상에서 제외했다(47개 매장 실측
// 상관분석 결과 locationScore와 87%/72% 동점 — 사실상 같은 질문을 3번 물었던 것으로 확인,
// LocationEvaluation.locationScore 주석 참고). locationScore가 이제 "상권위치·동선점수"(통합)다.
// demandLeakageRisk(수요이탈위험)도 같은 날 제외 — 애초에 계산에 안 쓰이던 참고용이었는데
// 정의 자체가 애매했다(인근 코인노래방·패스트푸드 등을 "수요를 뺏는 경쟁"으로만 가정했지만
// 실제로는 같이 놀러다니는 동선이라 오히려 유리할 수 있음, 사용자 지적).
export const LOCATION_EVAL_FIELD_KEYS = [
  "locationScore",
  "preemptionScore",
  "visibilityScore",
  "specialDemandType",
  "specialDemandIntensity",
  "inflowRestriction",
  "marketStructureMemo",
] as const;
export type LocationEvalFieldKey = (typeof LOCATION_EVAL_FIELD_KEYS)[number];

export type LocationEvalDraft = {
  fields: Record<LocationEvalFieldKey, number | string | null>;
  confidence: Record<LocationEvalFieldKey, number>;
  rationale: string;
};

function scoreProp(description: string) {
  return { type: Type.INTEGER, minimum: 1, maximum: 5, nullable: true, description };
}
function enumProp(values: string[], description: string) {
  return { type: Type.STRING, format: "enum", enum: values, nullable: true, description };
}
function textProp(description: string) {
  return { type: Type.STRING, nullable: true, description };
}
function confidenceProp(description: string) {
  return { type: Type.NUMBER, minimum: 0, maximum: 1, description };
}

const FIELD_SCHEMAS: Record<LocationEvalFieldKey, ReturnType<typeof scoreProp> | ReturnType<typeof enumProp> | ReturnType<typeof textProp>> = {
  locationScore: scoreProp(
    "상권위치·동선점수 — 이 지점이 상권(동네) 전체에서 핵심부/중심가에 가깝고(변두리=1~2점, 중심가=4~5점), " +
      "동시에 사람이 실제로 걸어다니는 동선(역 출구, 버스정류장 앞, 대로변) 위에 있는가를 종합 판단. " +
      "유동인구·상권 규모 같은 인구 수치는 이미 다른 정량 지표로 따로 계산되니 여기서 다시 고려하지 말 것 " +
      "— 순수하게 '위치·동선'만 볼 것.",
  ),
  preemptionScore: scoreProp(
    "선점경쟁점수 — 경쟁 PC방의 '개수'가 아니라, 그중 특정 경쟁점이 이 후보지보다 명백히 더 좋은 자리" +
      "(역 출구 바로 앞, 코너 자리, 상권 초입 등)를 이미 차지하고 있는지만 판단. 경쟁점이 여러 곳이어도 " +
      "다들 애매한 자리면 감점하지 말고, 경쟁점이 1곳뿐이어도 그곳이 명백히 더 좋은 자리면 감점할 것" +
      "(불리할수록 낮은 점수). 경쟁점 수 자체는 다른 곳에서 이미 따로 집계된다.",
  ),
  visibilityScore: scoreProp("접근가시성점수 — 간판/입구가 잘 보이고 들어가기 쉬운가(층수/계단·엘리베이터 포함)"),
  specialDemandType: enumProp(SPECIAL_DEMAND_TYPES, "특수수요유형"),
  specialDemandIntensity: enumProp(SPECIAL_DEMAND_INTENSITIES, "특수수요강도"),
  inflowRestriction: enumProp(
    INFLOW_LEVELS,
    "외부유입제한 — 이 상권이 주변 동네에서 손님을 끌어오기 얼마나 어려운가(강할수록 이 동네 주민 수요에만 의존)",
  ),
  marketStructureMemo: textProp("상권구조에 대한 자유서술 메모(1~2문장)"),
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    fields: {
      type: Type.OBJECT,
      properties: FIELD_SCHEMAS,
      required: LOCATION_EVAL_FIELD_KEYS as unknown as string[],
    },
    confidence: {
      type: Type.OBJECT,
      description: "fields의 각 항목에 대해 0(전혀 확신 없음)~1(매우 확신) 사이 자기평가 신뢰도",
      properties: Object.fromEntries(LOCATION_EVAL_FIELD_KEYS.map((k) => [k, confidenceProp(`${k} 신뢰도`)])),
      required: LOCATION_EVAL_FIELD_KEYS as unknown as string[],
    },
    rationale: { type: Type.STRING, description: "3개 점수 + 판단 필드 전체에 대한 근거를 한국어로 종합 서술" },
  },
  required: ["fields", "confidence", "rationale"],
};

const SYSTEM_PROMPT =
  "당신은 PC방 프랜차이즈 신규 후보지의 입지를 평가하는 전문가입니다. 아래에 이미 수집된 사실 자료" +
  "(경쟁점·수요거점 거리, 행정동 인구통계, 소상공인365 참고자료, 지도 이미지)가 주어집니다. 이것만으로" +
  "부족한 부분(상권 성격, 실제 동선, 특수수요 등)은 웹 검색으로 그 주소를 직접 조사해서 보완하세요.\n\n" +
  "판단할 항목:\n" +
  "- 상권위치·동선점수/선점경쟁점수/접근가시성점수(1~5점, 공식 채점기준표 없음 — 각 항목 설명 참고)\n" +
  "- 특수수요유형·강도(대학가/군부대/산업단지/관광유흥 등 특수 수요원이 있는가)\n" +
  "- 외부유입제한(없음/보통/강함)\n" +
  "- 상권구조메모(자유서술)\n\n" +
  "중요 — 2026-09-01 실측 검토로 확인된 문제이니 반드시 지킬 것:\n" +
  "1. '상권위치·동선점수'는 유동인구 수치가 아니라 순수 위치/동선 판단입니다. 인구·상권 규모는 이미 " +
  "다른 정량 데이터로 따로 계산되므로 이 점수에서 다시 반영하면 안 됩니다.\n" +
  "2. '선점경쟁점수'는 경쟁점 개수와 절대 혼동하지 마세요. 경쟁점이 8곳이어도 다들 애매한 자리면 " +
  "감점하지 말고(예: 3~4점), 경쟁점이 1곳뿐이어도 그곳이 역 출구 바로 앞 같은 명백한 요지면 감점하세요" +
  "(예: 1~2점). 경쟁점 수는 다른 지표로 이미 따로 계산되니 여기서 다시 세지 마세요.\n\n" +
  "확실하지 않은 부분은 추측해서 극단적인 값을 주지 말고 중간값(점수는 3점, 유형/강도는 '없음' 또는 " +
  "'보통') 쪽으로 보수적으로 판단하세요. 근거를 전혀 못 찾은 항목은 null로 남기고 절대 지어내지 마세요.";

function isLocationEvalDraft(input: unknown): input is LocationEvalDraft {
  if (!input || typeof input !== "object") return false;
  const r = input as Record<string, unknown>;
  if (typeof r.rationale !== "string") return false;
  const fields = r.fields as Record<string, unknown> | undefined;
  const confidence = r.confidence as Record<string, unknown> | undefined;
  if (!fields || typeof fields !== "object" || !confidence || typeof confidence !== "object") return false;

  for (const key of LOCATION_EVAL_FIELD_KEYS) {
    const conf = confidence[key];
    if (typeof conf !== "number" || conf < 0 || conf > 1) return false;

    const v = fields[key];
    if (v === null) continue;
    if (key === "marketStructureMemo") {
      if (typeof v !== "string") return false;
    } else if (key === "specialDemandType") {
      if (!SPECIAL_DEMAND_TYPES.includes(v as SpecialDemandType)) return false;
    } else if (key === "specialDemandIntensity") {
      if (!SPECIAL_DEMAND_INTENSITIES.includes(v as SpecialDemandIntensity)) return false;
    } else if (key === "inflowRestriction") {
      if (!INFLOW_LEVELS.includes(v as InflowRestriction)) return false;
    } else {
      if (typeof v !== "number" || v < 1 || v > 5) return false;
    }
  }
  return true;
}

/**
 * 컨텍스트 텍스트(+선택적 지도 이미지)로 Gemini 2단계 호출(웹검색 조사 → 구조화 추출)을 실행한다.
 * 실패 시 사람이 읽을 수 있는 메시지의 Error를 던진다 — 호출부(API 라우트/검증 러너)가 각자
 * 맥락에 맞게 처리한다(예: 라우트는 502 JSON, 검증 러너는 해당 매장을 "실패"로 기록).
 */
export async function runLocationEvalDraft(input: { contextText: string; mapImageBase64?: string | null }): Promise<LocationEvalDraft> {
  const client = getLocationEvalGeminiClient();
  if (!client) throw new Error("GEMINI_API_KEY_LOCATION_EVAL가 설정되지 않았습니다.");

  const model = getLocationEvalGeminiModel();
  const { contextText, mapImageBase64 } = input;

  // 1단계 — 웹검색 조사(자유서술). 지도 이미지가 있으면 함께 준다.
  const researchParts: object[] = [];
  if (mapImageBase64) researchParts.push({ inlineData: { mimeType: "image/png", data: mapImageBase64 } });
  researchParts.push({
    text:
      `아래는 이미 수집된 사실 자료입니다.\n\n${contextText}\n\n` +
      "이 주소를 웹 검색으로 조사해서(지도, 인근 역/버스정류장, 상권 성격, 주변 PC방 등) 위 판단 항목들의 근거가 될 내용을 정리하세요.",
  });

  const researchResponse = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts: researchParts }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ googleSearch: {} }],
    },
  });
  const researchText = researchResponse.text ?? "";

  // 2단계 — 구조화 추출(도구 없이, responseSchema로 강제).
  const extractResponse = await client.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `[수집된 사실 자료]\n${contextText}\n\n[조사 결과]\n${researchText}\n\n` +
              "위 내용을 바탕으로 판단 항목들을 스키마에 맞춰 제출하세요. 근거가 부족한 항목은 null로 " +
              "남기고 절대 지어내지 마세요.",
          },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractResponse.text ?? "");
  } catch {
    throw new Error("AI가 올바른 형식으로 응답하지 않았습니다. 다시 시도해주세요.");
  }
  if (!isLocationEvalDraft(parsed)) {
    throw new Error("AI 응답 형식이 예상과 달랐습니다. 다시 시도해주세요.");
  }
  return parsed;
}
