import { Type } from "@google/genai";
import { getGeminiClient, getGeminiModel } from "@/lib/gemini";

// 다우오피스 평가기록 보고서 텍스트 초안 - Gemini 호출부.
// 웹검색/지도 이미지가 필요 없는(이미 계산된 숫자를 문장으로만 정리하는) 단순 작업이라
// 기존 좌석배치도 자동화가 쓰는 무료 티어 공유 키(getGeminiClient/getGeminiModel)를 그대로
// 쓴다 — 입지동선평가 전용 유료 키(getLocationEvalGeminiClient)는 필요 없다(2026-08-25 확인).
// 사람이 직접 다우오피스에 옮겨 적을 "초안"일 뿐 자동 저장/자동 기입은 하지 않는다.

export type DaouReportDraft = {
  marketSection: string;
  competitionSection: string;
  summarySection: string;
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    marketSection: { type: Type.STRING, description: "[상권] 섹션 본문 — 대괄호 라벨은 붙이지 않고 문장만" },
    competitionSection: { type: Type.STRING, description: "[경쟁] 섹션 본문 — 대괄호 라벨은 붙이지 않고 문장만" },
    summarySection: { type: Type.STRING, description: "[종합 의견] 섹션 본문 — 대괄호 라벨은 붙이지 않고 문장만" },
  },
  required: ["marketSection", "competitionSection", "summarySection"],
};

const SYSTEM_PROMPT =
  "당신은 PC방 프랜차이즈 신규 후보지 평가 보고서를 작성하는 담당자입니다. 회사 내부 그룹웨어" +
  "(다우오피스) 결재/평가 기록에 올릴 짧은 서술형 코멘트를 씁니다. 아래에 주어지는, 이미 계산이 " +
  "끝난 사실 자료만 근거로 삼아 자연스러운 한국어 문장으로 정리하세요.\n\n" +
  "규칙:\n" +
  "- 절대 새로운 숫자를 계산하거나 지어내지 마세요. 손익계산(투자비/회수기간/순이익 등)은 이 " +
  "보고서에 포함하지 않습니다 — 주어진 상권·경쟁·매출예측 데이터만 서술합니다.\n" +
  "- 경쟁점이 0곳이면 그 사실 그대로(경쟁 없음) 서술하고, 데이터가 없거나 '-'로 표시된 항목은 " +
  "언급을 생략하세요(빈 값을 지어내지 마세요).\n" +
  "- 3개 섹션으로 나눠 씁니다: 상권(배후수요·상권성격), 경쟁(경쟁점과의 비교우위/열위), " +
  "종합 의견(상권수요와 자사가 확보할 것으로 예상되는 수요를 근거로 제시하고, 그 결과 산정된 " +
  "V62 최종예상월매출을 한두 문장으로 요약).\n" +
  "- [참고]에 나오는 예상가동률/수요확보율은 V62 최종예상월매출과는 다른 별도 계산(경쟁점 실가동" +
  "좌석 기반, 미검증)이므로 V62의 산출근거인 것처럼 섞어서 쓰지 마세요. V62의 근거는 [매출 예측]에 " +
  "있는 상권수요·확보 예상수요만 쓰세요.\n" +
  "- 각 섹션은 1~3문장, 간결한 보고서체(~로 판단됨/~로 보임/~로 추정됨 등)로 씁니다.\n" +
  "- 대괄호 라벨([상권] 등)은 붙이지 마세요 — 화면에서 별도로 붙입니다.";

function isDaouReportDraft(input: unknown): input is DaouReportDraft {
  if (!input || typeof input !== "object") return false;
  const r = input as Record<string, unknown>;
  return typeof r.marketSection === "string" && typeof r.competitionSection === "string" && typeof r.summarySection === "string";
}

export async function runDaouReportDraft(contextText: string): Promise<DaouReportDraft> {
  const client = getGeminiClient();
  if (!client) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  const model = getGeminiModel();

  const response = await client.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: `[이미 계산된 사실 자료]\n${contextText}\n\n위 자료만 근거로 보고서 3개 섹션을 작성하세요.` }],
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
    parsed = JSON.parse(response.text ?? "");
  } catch {
    throw new Error("AI가 올바른 형식으로 응답하지 않았습니다. 다시 시도해주세요.");
  }
  if (!isDaouReportDraft(parsed)) {
    throw new Error("AI 응답 형식이 예상과 달랐습니다. 다시 시도해주세요.");
  }
  return parsed;
}
