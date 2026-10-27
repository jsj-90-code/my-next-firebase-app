import { NextResponse } from "next/server";
import { getGeminiClient, getGeminiModel } from "@/lib/gemini";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedEmail } from "@/lib/seatLayout/authDomain";
import { DESK_SIZE_OPTIONS } from "@/lib/seatLayout/constants";
import type { DeskSize, RecognizeResult, SizeBreakdownEntry } from "@/lib/seatLayout/types";
import { buildRecognizePrompt as buildPrompt } from "@/lib/seatLayout/recognizePrompt";

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
    const response = await client.models.generateContent({
      model: getGeminiModel(),
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: buildPrompt(mode) },
          ],
        },
      ],
      config: {
        // gemini-3.6-flash는 thinkingBudget: 0(완전 끄기)을 지원하지 않아 400 INVALID_ARGUMENT가
        // 발생하므로 -1(모델이 알아서 판단)을 쓴다. 이때 "생각" 토큰도 maxOutputTokens 안에서
        // 함께 소비되므로, 너무 작게 잡으면 책상이 많은 구역에서 리스트가 다 나오기 전에 잘려서
        // 인식 실패로 보인다(예: "4: 910"에서 끊김). 다른 seat-layout 라우트들과 비슷한 수준으로
        // 넉넉하게 잡는다.
        maxOutputTokens: 16000,
        thinkingConfig: { thinkingBudget: -1 },
      },
    });

    const text = response.text ?? "";

    // 나열 목록 다음에 오는 마지막 COUNT 줄을 최종 값으로 쓴다.
    const countMatches = [...text.matchAll(/COUNT:\s*(\d+)/gi)];
    if (!countMatches.length) {
      return NextResponse.json(
        { error: `좌석 수를 인식하지 못했습니다. 응답: ${text}` },
        { status: 502 },
      );
    }

    const seats = parseInt(countMatches[countMatches.length - 1][1], 10);
    let deskSize: DeskSize | null = null;
    let sizeBreakdown: SizeBreakdownEntry[] | undefined;
    let bagShelfCount: number | undefined;

    if (mode === "desk") {
      // 사이즈 그룹 줄(GROUP: 850mm x3)을 모두 모은다. UNKNOWN으로 나온 그룹은 사이즈를
      // 특정할 수 없으니 기본 사이즈로 잡아두고, 결과 메시지에서 "확인 필요"로 안내한다
      // (프론트에서 사용자가 직접 고쳐야 함을 알 수 있도록).
      const groupMatches = [...text.matchAll(/GROUP:\s*(\d{3,4}mm|UNKNOWN)\s*[x×]\s*(\d+)/gi)];
      const grouped = new Map<DeskSize, number>();
      for (const match of groupMatches) {
        const qty = parseInt(match[2], 10);
        if (!qty) continue;
        const raw = match[1].toLowerCase();
        const size = ((DESK_SIZE_OPTIONS as string[]).includes(raw) ? raw : DESK_SIZE_OPTIONS[0]) as DeskSize;
        grouped.set(size, (grouped.get(size) ?? 0) + qty);
      }
      if (grouped.size) {
        sizeBreakdown = [...grouped.entries()].map(([ds, qty]) => ({ deskSize: ds, qty }));
        deskSize = sizeBreakdown[0].deskSize;
      }

      const bracketMatch = text.match(/BRACKET:\s*(\d+)/i);
      if (bracketMatch) {
        // 가방 선반 브라켓 표시가 있는 좌석은 전체 좌석 수를 넘을 수 없다.
        bagShelfCount = Math.min(parseInt(bracketMatch[1], 10), seats);
      }
    }

    const result: RecognizeResult = { seats, deskSize, sizeBreakdown, bagShelfCount };
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Gemini API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
