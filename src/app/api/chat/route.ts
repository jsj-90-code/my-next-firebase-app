import { NextResponse } from "next/server";
import { getClaudeClient, getClaudeModel, type ChatMessage } from "@/lib/claude";
import { adminAuth } from "@/lib/firebase-admin";

type ChatRequestBody = {
  messages?: ChatMessage[];
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

  let body: ChatRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const messages = body.messages?.filter(
    (message): message is ChatMessage =>
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.trim().length > 0,
  );

  if (!messages?.length) {
    return NextResponse.json(
      { error: "메시지를 입력해주세요." },
      { status: 400 },
    );
  }

  try {
    const response = await client.messages.create({
      model: getClaudeModel(),
      max_tokens: 1024,
      messages,
    });

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return NextResponse.json({ reply });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Claude API 요청에 실패했습니다.";

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
