import { NextResponse } from "next/server";
import { getGeminiClient, getGeminiModel } from "@/lib/gemini";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedEmail } from "@/lib/seatLayout/authDomain";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

type ImageInput = { data: string; mimeType: string };

type SuggestZonesBody = {
  // 하위호환: 예전 프론트가 이미지 1장만 보내는 경우도 받아준다.
  image?: ImageInput;
  // 전체 이미지 1장 + 좌상단/우상단/좌하단/우하단 확대 4장 (좌석번호 인식과 동일한 구성).
  images?: ImageInput[];
};

const IMAGE_LABELS = [
  "① 전체 도면",
  "② 좌상단 확대",
  "③ 우상단 확대",
  "④ 좌하단 확대",
  "⑤ 우하단 확대",
];

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
//
// 전체 이미지 1장만 주면 구역 경계가 책상 한가운데를 가로지르거나 책상 몇 개를 빠뜨리는 문제가
// 있었다 — 좌석번호 인식에서 겪었던 것과 같은 원인(통짜 이미지는 촘촘한 구역이 축소되며 경계선이
// 뭉개짐)이라, 같은 해법으로 확대 사분면 이미지를 같이 주고 경계를 확대본에서 다시 확인시킨다.
function buildPrompt(multiTile: boolean): string {
  return (
    "①번 이미지는 PC방 매장의 책상 배치 도면(평면도)입니다.\n" +
    (multiTile
      ? "②번 이미지부터는 같은 도면을 확대한 것입니다: ②좌상단, ③우상단, ④좌하단, ⑤우하단 " +
        "(경계가 겹치게 잘랐습니다). 전체 구도(어디까지가 한 구역인지)는 ①번으로 판단하고, " +
        "구역 경계선이 정확히 어느 책상까지 포함하는지는 해당 위치의 확대 이미지로 다시 확인하세요.\n\n"
      : "\n") +
    "작업:\n" +
    "1. 이미지에서 책상/좌석이 물리적으로 한 덩어리로 묶여 보이는 구역을 찾으세요 (같은 줄로 " +
    "나란히 붙어있거나, 벽/통로로 분리된 섬 모양 덩어리 등). 통로, 벽, 카운터, 화장실, 창고처럼 " +
    "좌석이 없는 공간은 구역으로 잡지 마세요.\n" +
    "2. 각 구역의 사각형 경계는 그 구역에 포함되는 책상들 중 가장 바깥쪽(맨 위/맨 아래/맨 왼쪽/" +
    "맨 오른쪽) 책상의 바깥쪽 테두리에 정확히 맞추세요. 여백을 남기거나 책상을 파고들지 마세요.\n" +
    "3. 절대로 책상 하나를 두 구역이 반씩 나눠 갖지 않도록 하세요 — 책상이 경계에 걸쳐 " +
    "보이면, 그 책상 전체가 확실히 들어가는 쪽으로 경계를 옮기세요.\n" +
    "4. 이미지 안의 모든 책상이 어느 한 구역에는 반드시 포함되어야 합니다. 어느 구역 상자에도 " +
    "들어가지 않는 책상이 남아있는지 마지막에 한 번 더 확인하고, 있다면 그 책상을 포함하도록 " +
    "가장 가까운 구역의 경계를 넓히거나 구역을 새로 추가하세요.\n" +
    "5. 각 구역 안 좌석(책상) 개수를 세어 답하세요. 구역끼리 겹치지 않게 하세요.\n\n" +
    "구역 사각형 위치는 ①번 전체 이미지 기준 왼쪽 위 원점의 비율 좌표(0~1 사이 값)로 답하세요.\n" +
    "다른 설명 없이, 구역마다 정확히 한 줄씩 이 형식으로만 답하세요 (왼쪽 위부터 아래로, 보이는 " +
    "순서대로):\n" +
    "ZONE: seats=<좌석수> x=<0~1> y=<0~1> w=<0~1> h=<0~1>"
  );
}

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

  const client = getGeminiClient();
  if (!client) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  let body: SuggestZonesBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const images = (body.images?.length ? body.images : body.image ? [body.image] : []).filter(
    (img) => ALLOWED_MIME_TYPES.includes(img.mimeType as AllowedMimeType),
  );
  if (!images.length) {
    return NextResponse.json({ error: "도면 이미지가 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const imageContent = images.flatMap((img, i) => [
      { inlineData: { mimeType: img.mimeType, data: img.data } },
      { text: IMAGE_LABELS[i] ?? `이미지 ${i + 1}` },
    ]);
    const response = await client.models.generateContent({
      model: getGeminiModel(),
      contents: [
        {
          role: "user",
          parts: [...imageContent, { text: buildPrompt(images.length > 1) }],
        },
      ],
      config: {
        maxOutputTokens: 16000,
        // Claude의 "adaptive thinking + high effort"에 대응 — 모델이 필요한 만큼 스스로
        // 생각하도록 예산을 고정하지 않고 동적으로 맡긴다.
        thinkingConfig: { thinkingBudget: -1 },
      },
    });

    const text = response.text ?? "";

    const zones = parseSuggestions(text);
    if (!zones.length) {
      return NextResponse.json(
        { error: `구역을 인식하지 못했습니다. 응답: ${text}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ zones });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
