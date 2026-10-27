import { NextResponse } from "next/server";
import { getGeminiClient, getSuggestZonesGeminiModel } from "@/lib/gemini";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedEmail } from "@/lib/seatLayout/authDomain";
import {
  buildSuggestZonesPrompt as buildPrompt,
  parseZoneSuggestions as parseSuggestions,
  SUGGEST_ZONES_IMAGE_LABELS as IMAGE_LABELS,
} from "@/lib/seatLayout/suggestZonesPrompt";

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
      model: getSuggestZonesGeminiModel(),
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
