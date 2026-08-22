import { NextResponse } from "next/server";
import { getClaudeClient } from "@/lib/claude";
import { adminAuth } from "@/lib/firebase-admin";
import type Anthropic from "@anthropic-ai/sdk";

// 09_입지동선평가 D/E/F/G/J열(상권내위치/주요동선/선점경쟁/접근가시성/상권흡인력 점수, 1~5점)은
// 원본 시트에도 공식 판단기준표가 없다(docs/data-issues.md #2, 2026-08-21 확인 — 사용자가 GPT에게
// 물어보고 손으로 옮겨 적은 값이었다, 예: 시트 메모 "AI 재평가: 아파트 배후 내부 입지..." 사례).
// 이 라우트는 그 "GPT에게 물어보고 옮겨 적는" 과정을 앱 안으로 그대로 옮겨온 것뿐이다 — 기준표를
// 새로 만들거나 "객관적 정답"을 지어내지 않는다. 웹검색으로 실제 그 주소를 조사해서 근거를 남기고,
// 결과는 항상 사람이 검토 후 저장(자동저장 아님)하는 초안으로만 쓴다(2026-08-22 결정).

const SCORE_TOOL_NAME = "submit_location_scores";

const SYSTEM_PROMPT =
  "당신은 PC방 프랜차이즈 신규 후보지의 입지를 평가하는 전문가입니다. " +
  "주어진 주소를 웹 검색으로 실제 조사한 뒤(지도, 인근 역/버스정류장, 상권 성격, 주변 PC방 등), " +
  "아래 4가지 항목을 1~5점으로 평가하고 판단 근거를 남기세요.\n\n" +
  "- 상권내위치점수: 이 위치가 유동인구가 몰리는 상권(역세권/먹자골목 등)의 중심부에 가까운가\n" +
  "- 주요동선점수: 사람들이 실제로 많이 지나다니는 주요 이동경로(역 출구, 큰 도로, 버스정류장 앞 등)에 있는가\n" +
  "- 선점경쟁점수: 주변 경쟁 PC방들이 이미 더 좋은 자리를 선점하고 있어서 이 후보지가 상대적으로 불리한가(경쟁점이 더 좋은 자리면 낮은 점수)\n" +
  "- 접근가시성점수: 도로에서 간판/입구가 잘 보이고 들어가기 쉬운가(층수, 계단/엘리베이터 여부 포함)\n" +
  "- 상권흡인력점수: 이 상권 자체가 얼마나 사람을 끌어모으는 힘이 있는가(전체적인 상권 규모/활력)\n\n" +
  "이 5개 항목에는 공식적으로 정해진 채점 기준표가 없습니다 — 검색으로 확인한 실제 사실에 근거해서 " +
  "합리적으로 판단하되, 확실하지 않은 부분은 추측해서 극단적인 점수를 주지 말고 중간값(3점) 쪽으로 " +
  "보수적으로 평가하세요. 검색으로 못 찾은 내용을 지어내지 마세요.\n\n" +
  "충분히 조사했으면 반드시 submit_location_scores 도구를 호출해서 결과를 제출하세요.";

const SCORE_TOOL: Anthropic.Tool = {
  name: SCORE_TOOL_NAME,
  description: "조사를 마친 뒤 입지동선평가 점수와 근거를 제출한다.",
  input_schema: {
    type: "object",
    properties: {
      locationScore: { type: "integer", enum: [1, 2, 3, 4, 5], description: "상권내위치점수" },
      flowScore: { type: "integer", enum: [1, 2, 3, 4, 5], description: "주요동선점수" },
      preemptionScore: { type: "integer", enum: [1, 2, 3, 4, 5], description: "선점경쟁점수" },
      visibilityScore: { type: "integer", enum: [1, 2, 3, 4, 5], description: "접근가시성점수" },
      attractionScore: { type: "integer", enum: [1, 2, 3, 4, 5], description: "상권흡인력점수" },
      rationale: {
        type: "string",
        description: "5개 점수 각각의 판단 근거를 한국어로 간결하게 서술 (실제 검색으로 확인한 사실 위주)",
      },
    },
    required: ["locationScore", "flowScore", "preemptionScore", "visibilityScore", "attractionScore", "rationale"],
    additionalProperties: false,
  },
  // strict: 스키마를 벗어난 입력이 오지 않도록 강제한다.
  strict: true,
};

type AiLocationEvalBody = {
  address?: string;
  name?: string;
};

type ScoreResult = {
  locationScore: 1 | 2 | 3 | 4 | 5;
  flowScore: 1 | 2 | 3 | 4 | 5;
  preemptionScore: 1 | 2 | 3 | 4 | 5;
  visibilityScore: 1 | 2 | 3 | 4 | 5;
  attractionScore: 1 | 2 | 3 | 4 | 5;
  rationale: string;
};

async function getVerifiedUserId(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !adminAuth) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

function findScoreToolUse(content: Anthropic.ContentBlock[]): Anthropic.ToolUseBlock | null {
  return (content.find((b) => b.type === "tool_use" && b.name === SCORE_TOOL_NAME) as Anthropic.ToolUseBlock | undefined) ?? null;
}

function isScoreResult(input: unknown): input is ScoreResult {
  if (!input || typeof input !== "object") return false;
  const r = input as Record<string, unknown>;
  const scoreFields = ["locationScore", "flowScore", "preemptionScore", "visibilityScore", "attractionScore"];
  return (
    scoreFields.every((k) => typeof r[k] === "number" && [1, 2, 3, 4, 5].includes(r[k] as number)) &&
    typeof r.rationale === "string"
  );
}

export async function POST(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const client = getClaudeClient();
  if (!client) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." }, { status: 500 });
  }

  let body: AiLocationEvalBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const address = body.address?.trim();
  if (!address) {
    return NextResponse.json({ error: "주소가 필요합니다." }, { status: 400 });
  }
  const name = body.name?.trim() || "(이름 미입력)";

  const userMessage = `후보지명: ${name}\n주소: ${address}\n\n이 위치를 웹 검색으로 조사한 뒤 5개 항목을 평가해주세요.`;

  try {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];

    const tools: Anthropic.ToolUnion[] = [
      { type: "web_search_20260318", name: "web_search", max_uses: 6 },
      SCORE_TOOL,
    ];

    let response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    let toolUse = findScoreToolUse(response.content);

    // 첫 응답이 검색만 하고 도구 제출을 안 했으면, 지금까지의 결과를 바탕으로 반드시
    // submit_location_scores를 호출하도록 한 번 더 강제 요청한다(최대 2회 왕복으로 제한).
    if (!toolUse) {
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: "지금까지 조사한 내용을 바탕으로 submit_location_scores 도구를 호출해서 결과를 제출하세요." });
      response = await client.messages.create({
        model: "claude-opus-5",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        tool_choice: { type: "tool", name: SCORE_TOOL_NAME },
        messages,
      });
      toolUse = findScoreToolUse(response.content);
    }

    if (!toolUse || !isScoreResult(toolUse.input)) {
      return NextResponse.json({ error: "AI가 점수를 제출하지 않았습니다. 다시 시도해주세요." }, { status: 502 });
    }

    return NextResponse.json(toolUse.input satisfies ScoreResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claude API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
