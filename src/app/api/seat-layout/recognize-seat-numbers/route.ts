import { NextResponse } from "next/server";
import { getGeminiClient, getSeatNumberGeminiModel } from "@/lib/gemini";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedEmail } from "@/lib/seatLayout/authDomain";
import type { SeatNumberRangeEntry } from "@/lib/seatLayout/types";
import { buildSeatNumberPrompt as buildPrompt, compressRanges } from "@/lib/seatLayout/recognizePrompt";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

type ZoneInput = {
  name: string;
  seats: number;
};

type ImageInput = {
  data: string;
  mimeType: string;
};

type RecognizeSeatNumbersBody = {
  // 존 이름/색상 박스가 그려진 책상 배치도 1장 — 피난안내도의 어느 구역이 어느 존인지 위치로
  // 대응시키는 기준이 된다.
  zoneImage?: ImageInput;
  // 피난안내도(좌석번호표) 이미지들. 전체 1장 + 확대한 사분면 4장.
  images?: ImageInput[];
  zones?: ZoneInput[];
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

const IMAGE_LABELS = [
  "① 책상 배치도 (존 이름/색상 박스 표시됨)",
  "② 피난안내도 전체",
  "③ 피난안내도 좌상단 확대",
  "④ 피난안내도 우상단 확대",
  "⑤ 피난안내도 좌하단 확대",
  "⑥ 피난안내도 우하단 확대",
];

// 클릭 복사용 칩으로 보여주기 좋게, 연속된 구간별로 따로따로 쪼갠다 (하나로 뭉친 문자열이면
// 필요한 부분만 복사하기 번거롭다).
function toRangeChips(numbers: number[]): { ranges: string; count: number }[] {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const chips: { ranges: string; count: number }[] = [];
  let run: number[] = [];
  for (const n of sorted) {
    if (run.length && n !== run[run.length - 1] + 1) {
      chips.push({ ranges: compressRanges(run), count: run.length });
      run = [];
    }
    run.push(n);
  }
  if (run.length) chips.push({ ranges: compressRanges(run), count: run.length });
  return chips;
}

function parseNumberList(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function toImagePart(img: ImageInput) {
  return {
    inlineData: { mimeType: img.mimeType, data: img.data },
  };
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

  let body: RecognizeSeatNumbersBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { zoneImage, zones } = body;
  const plateImages = (body.images ?? []).filter((img) =>
    ALLOWED_MIME_TYPES.includes(img.mimeType as AllowedMimeType),
  );

  if (!zoneImage || !ALLOWED_MIME_TYPES.includes(zoneImage.mimeType as AllowedMimeType)) {
    return NextResponse.json({ error: "배치도 이미지가 올바르지 않습니다." }, { status: 400 });
  }
  if (!plateImages.length) {
    return NextResponse.json({ error: "피난안내도 이미지가 올바르지 않습니다." }, { status: 400 });
  }
  if (!zones || !zones.length) {
    return NextResponse.json({ error: "먼저 존을 등록해주세요." }, { status: 400 });
  }

  try {
    const allImages = [zoneImage, ...plateImages];
    const imageContent = allImages.flatMap((img, i) => [
      toImagePart(img),
      { text: IMAGE_LABELS[i] ?? `이미지 ${i + 1}` },
    ]);
    const prompt = buildPrompt(zones, plateImages.length > 1);

    // thinking(동적 예산) + 실제 답변(존별 번호 나열 + UNSURE 목록)을 합친 한도라서 넉넉히
    // 잡는다. 지침이 늘어나며 AI가 더 오래 생각하다가 답을 쓸 자리가 없어 응답이 통째로 비는
    // 걸 실제로 겪어서, 여유를 크게 늘렸다.
    const response = await client.models.generateContent({
      model: getSeatNumberGeminiModel(),
      contents: [
        {
          role: "user",
          parts: [...imageContent, { text: prompt }],
        },
      ],
      config: {
        // 생각(thinking)만 하다 답을 못 쓰고 끝나는 사례가 있어서 여유 있게 잡는다.
        maxOutputTokens: 32000,
        // 고정 예산을 주지 않고 모델이 필요한 만큼 스스로 생각하도록 동적으로 맡긴다.
        thinkingConfig: { thinkingBudget: -1 },
      },
    });

    const text = response.text ?? "";

    // gemini-3.5-flash-lite로 바꾼 뒤로 "ZONE:"/"UNSURE:" 접두어를 빠뜨리거나 줄바꿈 없이
    // 한 줄로 쭉 이어붙여("팀룸A = 84,85,86,87 팀룸B = ...") 응답하는 경우가 있어, 줄 구분이나
    // 접두어 없이도 파싱되게 관대하게 둔다. 이름 캡처는 non-greedy + 번호 캡처는 숫자/쉼표/공백만
    // 허용하는 문자 클래스라서, 다음 존 이름(한글/영문)이 나오는 지점에서 자연히 끊긴다.
    const ranges: SeatNumberRangeEntry[] = [];
    const matchedNames = new Set<string>();
    for (const m of text.matchAll(/(?:ZONE:\s*)?(.+?)\s*=\s*([\d][\d,\s]*)/g)) {
      const zoneName = m[1].trim();
      if (/^UNSURE$/i.test(zoneName)) continue;
      const zone = zones.find((z) => z.name === zoneName);
      if (!zone || matchedNames.has(zone.name)) continue;
      const numbers = parseNumberList(m[2]);
      if (!numbers.length) continue;
      ranges.push({ zoneName: zone.name, ranges: compressRanges(numbers) });
      matchedNames.add(zone.name);
    }

    const unsureMatch = text.match(/UNSURE\s*[:=]\s*([\d,\s]+)/i);
    const unmatchedGroups = unsureMatch ? toRangeChips(parseNumberList(unsureMatch[1])) : [];

    if (!ranges.length && !unmatchedGroups.length) {
      // finishReason이 "MAX_TOKENS"면 생각(thinking)만 하다가 답을 쓸 자리가 없어서 응답이
      // 비어버린 것 — 사람이 재시도하면 되지만, 원인을 알 수 있게 메시지에 남겨둔다.
      const reasonHint =
        response.candidates?.[0]?.finishReason === "MAX_TOKENS"
          ? " (AI가 생각하다가 답변을 쓰기 전에 토큰 한도를 다 썼습니다 — 다시 시도해보세요.)"
          : "";
      return NextResponse.json(
        { error: `좌석번호를 인식하지 못했습니다.${reasonHint} 응답: ${text}` },
        { status: 502 },
      );
    }

    const warnings: string[] = [];
    const unmatchedZones = zones.filter((z) => !matchedNames.has(z.name));
    if (unmatchedZones.length) {
      warnings.push(
        `다음 존은 배치도-피난안내도 위치 대응에 확신이 서지 않아 자동으로 채우지 못했습니다: ` +
          `${unmatchedZones.map((z) => `${z.name}(${z.seats}석)`).join(", ")} — 아래 번호 그룹 ` +
          `버튼을 눌러 복사한 뒤, 도면과 비교하며 직접 입력해주세요.`,
      );
    }
    if (unmatchedGroups.length) {
      warnings.push(
        `어느 존에도 확신 있게 배정하지 못한 번호가 ${unmatchedGroups.length}개 구간 있습니다 — ` +
          `아래 목록에서 복사해 알맞은 존에 나눠 넣어주세요.`,
      );
    }

    return NextResponse.json({ ranges, warnings, unmatchedGroups });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
