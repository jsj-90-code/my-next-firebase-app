import { NextResponse } from "next/server";
import { getClaudeClient, getClaudeModel } from "@/lib/claude";
import { adminAuth } from "@/lib/firebase-admin";
import { DESK_SIZE_OPTIONS } from "@/lib/seatLayout/constants";
import type { DeskSize, RecognizeResult } from "@/lib/seatLayout/types";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

type RecognizeRequestBody = {
  imageBase64?: string;
  mimeType?: string;
  mode?: "desk" | "pc";
};

async function getVerifiedUserId(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token || !adminAuth) {
    return null;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

function buildPrompt(mode: "desk" | "pc") {
  if (mode === "pc") {
    return (
      "이 이미지는 PC방 도면의 한 구역을 잘라낸 것입니다.\n" +
      "개별 좌석(PC 1대) 아이콘의 개수를 세어주세요.\n" +
      "아래 형식으로만, 다른 설명 없이 한 줄로 답하세요:\n" +
      "COUNT: 숫자"
    );
  }

  return (
    "이 이미지는 PC방 도면의 한 구역을 잘라낸 것입니다.\n" +
    "1) 개별 좌석(책상+의자+모니터 1세트) 아이콘의 개수를 세어주세요.\n" +
    "2) 책상 옆/위에 작게 적힌 치수 텍스트(예: 820*680, 850*680 등)를 읽고, 폭(mm) 값을 820/850/910/950/1000 중 가장 가까운 표준 사이즈로 판단해주세요. 텍스트가 안 보이거나 판단이 어려우면 UNKNOWN이라고 답하세요.\n" +
    "아래 형식으로만, 다른 설명 없이 정확히 두 줄로 답하세요:\n" +
    "COUNT: 숫자\n" +
    "SIZE: 820mm 또는 850mm 또는 910mm 또는 950mm 또는 1000mm 또는 UNKNOWN"
  );
}

export async function POST(request: Request) {
  const userId = await getVerifiedUserId(request);

  if (!userId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const client = getClaudeClient();

  if (!client) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  let body: RecognizeRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { imageBase64 } = body;
  const mode = body.mode === "pc" ? "pc" : "desk";
  const mimeType = ALLOWED_MIME_TYPES.includes(body.mimeType as AllowedMimeType)
    ? (body.mimeType as AllowedMimeType)
    : null;

  if (!imageBase64 || !mimeType) {
    return NextResponse.json(
      { error: "이미지 데이터가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const response = await client.messages.create({
      model: getClaudeModel(),
      max_tokens: 60,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType, data: imageBase64 },
            },
            { type: "text", text: buildPrompt(mode) },
          ],
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const countMatch = text.match(/COUNT:\s*(\d+)/i);
    if (!countMatch) {
      return NextResponse.json(
        { error: `좌석 수를 인식하지 못했습니다. 응답: ${text}` },
        { status: 502 },
      );
    }

    const seats = parseInt(countMatch[1], 10);
    let deskSize: DeskSize | null = null;

    if (mode === "desk") {
      const sizeMatch = text.match(/SIZE:\s*(\d{3,4}mm|UNKNOWN)/i);
      const candidate = sizeMatch?.[1]?.toLowerCase() as DeskSize | undefined;
      if (candidate && (DESK_SIZE_OPTIONS as string[]).includes(candidate)) {
        deskSize = candidate;
      }
    }

    const result: RecognizeResult = { seats, deskSize };
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Claude API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
