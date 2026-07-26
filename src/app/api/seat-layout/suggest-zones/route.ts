import { NextResponse } from "next/server";
import { getClaudeClient, getClaudeModel } from "@/lib/claude";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedEmail } from "@/lib/seatLayout/authDomain";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

type SuggestZonesBody = {
  image?: { data: string; mimeType: string };
};

async function getVerifiedUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token || !adminAuth) {
    return null;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    return null;
  }
}

// 도면에는 존 이름표가 그려져 있지 않다(그건 이 툴에서 사람이 정하는 것) — 그래서 AI에게는
// "이 자리들이 시각적으로 하나의 구역으로 묶여 보이는지"(줄/섬 단위로 붙어 있는 책상 덩어리)와
// 대략적인 위치/좌석수만 물어본다. 존 이름/유형(멀티존, LOL존 등)은 도면만 보고는 알 수 없는
// 정보라 AI에게 시키지 않고, 사람이 초안을 보고 직접 고르게 한다.
const PROMPT =
  "이 이미지는 PC방 매장의 책상 배치 도면(평면도)입니다.\n" +
  "작업: 이미지에서 책상/좌석이 물리적으로 한 덩어리로 묶여 보이는 구역을 찾아주세요 " +
  "(같은 줄로 나란히 붙어있거나, 벽/통로로 분리된 섬 모양 덩어리 등). 통로, 벽, 카운터, " +
  "화장실, 창고처럼 좌석이 없는 공간은 구역으로 잡지 마세요.\n" +
  "각 구역에 대해 이미지 안에서의 대략적인 사각형 위치(왼쪽 위 기준 비율 좌표, 0~1 사이 값)와 " +
  "그 구역 안 좌석(책상) 개수를 세어 답하세요. 구역끼리 겹치지 않게 하고, 실제 좌석이 있는 " +
  "영역만 딱 감싸세요(여백을 너무 크게 잡지 마세요).\n\n" +
  "다른 설명 없이, 구역마다 정확히 한 줄씩 이 형식으로만 답하세요 (왼쪽 위부터 아래로, 보이는 " +
  "순서대로):\n" +
  "ZONE: seats=<좌석수> x=<0~1> y=<0~1> w=<0~1> h=<0~1>";

type ZoneSuggestion = { seats: number; x: number; y: number; w: number; h: number };

function parseSuggestions(text: string): ZoneSuggestion[] {
  const zones: ZoneSuggestion[] = [];
  for (const m of text.matchAll(
    /ZONE:\s*seats=(\d+)\s+x=([\d.]+)\s+y=([\d.]+)\s+w=([\d.]+)\s+h=([\d.]+)/g,
  )) {
    const seats = parseInt(m[1], 10);
    const x = parseFloat(m[2]);
    const y = parseFloat(m[3]);
    const w = parseFloat(m[4]);
    const h = parseFloat(m[5]);
    if (!Number.isFinite(seats) || seats <= 0) continue;
    if (![x, y, w, h].every((v) => Number.isFinite(v))) continue;
    if (w <= 0 || h <= 0) continue;
    zones.push({
      seats,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      w: Math.max(0.001, Math.min(1, w)),
      h: Math.max(0.001, Math.min(1, h)),
    });
  }
  return zones;
}

export async function POST(request: Request) {
  const user = await getVerifiedUser(request);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!isAllowedEmail(user.email)) {
    return NextResponse.json({ error: "회사 계정으로만 이용할 수 있습니다." }, { status: 403 });
  }

  const client = getClaudeClient();
  if (!client) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  let body: SuggestZonesBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const image = body.image;
  if (!image || !ALLOWED_MIME_TYPES.includes(image.mimeType as AllowedMimeType)) {
    return NextResponse.json({ error: "도면 이미지가 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const stream = client.messages.stream({
      model: getClaudeModel(),
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mimeType as AllowedMimeType,
                data: image.data,
              },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    const response = await stream.finalMessage();

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const zones = parseSuggestions(text);
    if (!zones.length) {
      return NextResponse.json(
        { error: `구역을 인식하지 못했습니다. 응답: ${text}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ zones });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claude API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
