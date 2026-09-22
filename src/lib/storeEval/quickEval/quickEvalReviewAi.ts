// AI 평가문을 **Gemini**로 쓴다. (주소만 초기평가 도구 전용 · 서버)
//
// ── 왜 Gemini 무료 티어인가 (사용자 결정 2026-09-22) ──────────────────────
// 평가문은 **웹검색이 필요 없다** — 우리가 준 숫자만 읽고 문장으로 옮기는 일이다. 그래서
// 입지평가 초안과 사정이 다르다:
//
//   입지평가 초안  googleSearch 그라운딩이 필요 -> 유료 티어만 제공 -> 전용 유료 키
//                 (`GEMINI_API_KEY_LOCATION_EVAL`, gemini.ts 주석의 분리 원칙)
//   평가문        웹검색 불필요 -> **무료 티어 키로 0원**  ← 이 파일
//
// ⚠️ 무료 티어 키(`GEMINI_API_KEY`)는 **좌석배치도 자동화와 같은 할당량**을 쓴다. 평가문을
//    연달아 돌리면 좌석배치도 쪽에서 429가 날 수 있다.
// ⚠️ 무료 티어는 구글이 입력을 제품 개선에 쓸 수 있다. 후보지 주소·예상매출이 걸리면
//    `GEMINI_API_KEY_QUICK_EVAL`에 유료 키를 넣어라 — 있으면 그 키가 우선한다(아래).
// ⚠️ 여기서 **스키마를 강제하지 않는다.** 평가문은 사람이 읽는 글이라 자유서술이 맞다.
//    대신 숫자를 지어내지 못하게 프롬프트로 막는다(quickEvalReviewPrompt.ts).

import { GoogleGenAI } from "@google/genai";
import { QUICK_EVAL_REVIEW_SYSTEM_PROMPT } from "./quickEvalReviewPrompt";

let client: GoogleGenAI | null = null;
let clientKey: string | null = null;

/**
 * 평가문용 Gemini 클라이언트.
 *
 * 키 우선순위: `GEMINI_API_KEY_QUICK_EVAL`(유료로 돌리고 싶을 때) -> `GEMINI_API_KEY`(무료 티어).
 * 입지평가 전용 유료 키(`GEMINI_API_KEY_LOCATION_EVAL`)로는 **폴백하지 않는다** — 그 키는
 * 그라운딩 과금을 한 프로젝트에 묶어두려고 분리한 것이라, 조용히 끌어다 쓰면 그 분리가 무너진다.
 */
function getQuickEvalGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY_QUICK_EVAL ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!client || clientKey !== apiKey) {
    client = new GoogleGenAI({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

export function getQuickEvalGeminiModel(): string {
  return process.env.GEMINI_MODEL_QUICK_EVAL ?? process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
}

/** 무료 티어 키를 쓰는 중인가 — 화면에 "무료 할당량 공유 중"이라고 알려주려고 같이 돌려준다. */
export function isQuickEvalUsingFreeTierKey(): boolean {
  return !process.env.GEMINI_API_KEY_QUICK_EVAL && !!process.env.GEMINI_API_KEY;
}

export type QuickEvalReview = {
  review: string;
  model: string;
  usingFreeTierKey: boolean;
  /** 토큰 사용량. 무료 티어에서도 할당량을 얼마나 먹었는지 보이게 둔다 */
  usage: { inputTokens: number | null; outputTokens: number | null };
};

export async function runQuickEvalReview(contextText: string): Promise<QuickEvalReview> {
  const genai = getQuickEvalGeminiClient();
  if (!genai) {
    throw new Error(
      "GEMINI_API_KEY가 설정되지 않았습니다(평가문은 무료 티어 키를 씁니다). " +
        "유료 키로 돌리려면 GEMINI_API_KEY_QUICK_EVAL을 설정하세요.",
    );
  }
  const model = getQuickEvalGeminiModel();
  const response = await genai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `${contextText}\n\n` +
              "위 자료로 점포개발 초기 평가문을 써 주세요. 주어진 숫자만 인용하고, 없는 값은 '자료 없음'으로 두세요.",
          },
        ],
      },
    ],
    config: { systemInstruction: QUICK_EVAL_REVIEW_SYSTEM_PROMPT },
  });
  const text = (response.text ?? "").trim();
  if (!text) throw new Error("AI가 빈 응답을 보냈습니다. 다시 시도해주세요.");
  return {
    review: text,
    model,
    usingFreeTierKey: isQuickEvalUsingFreeTierKey(),
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
    },
  };
}
