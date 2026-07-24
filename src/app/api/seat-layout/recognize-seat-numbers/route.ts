import { NextResponse } from "next/server";
import { getClaudeClient, getClaudeModel } from "@/lib/claude";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedEmail } from "@/lib/seatLayout/authDomain";
import type { SeatNumberRangeEntry } from "@/lib/seatLayout/types";

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
  x: number;
  y: number;
  w: number;
  h: number;
};

type RecognizeSeatNumbersBody = {
  imageBase64?: string;
  mimeType?: string;
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

// 원본 도면 기준 존의 대략적인 위치(사분면)를 설명한다. 좌석번호표는 원본 도면과 다른 그림이라
// 좌표를 그대로 겹칠 수는 없지만, 같은 매장을 그린 것이라 위/아래/좌/우 배치는 대체로 유지된다 —
// 좌석 수가 같은 존이 여러 개일 때 구분하는 보조 힌트로만 쓴다.
function describePosition(z: ZoneInput): string {
  const cx = z.x + z.w / 2;
  const cy = z.y + z.h / 2;
  const horiz = cx < 0.34 ? "왼쪽" : cx > 0.66 ? "오른쪽" : "가운데";
  const vert = cy < 0.34 ? "위쪽" : cy > 0.66 ? "아래쪽" : "중간";
  return `${vert} ${horiz}`;
}

function buildPrompt(zones: ZoneInput[]): string {
  const zoneList = zones
    .map((z) => `- ${z.name}: ${z.seats}석 (원본 도면 기준 대략 ${describePosition(z)})`)
    .join("\n");

  return (
    "이 이미지는 PC방 매장의 좌석번호표(피난안내도 등 좌석마다 번호가 적힌 안내판/도면)입니다.\n" +
    "이 매장은 이미 아래처럼 존(zone)으로 나뉘어 있고, 각 존의 실제 좌석 수도 이미 등록되어 있습니다:\n" +
    `${zoneList}\n\n` +
    "작업 순서:\n" +
    "1. 이미지에서 보이는 모든 좌석 번호를 읽으세요.\n" +
    "2. 도면 위에 실제로 그려진 벽/칸막이/여백 등 시각적 구역 경계를 기준으로 번호들을 그룹으로 나누세요.\n" +
    "3. 각 그룹의 개수를 위 존 목록의 \"좌석 수\"와 대조해서, 개수가 정확히 일치하는 존에 그 그룹을 " +
    "배정하세요. 개수가 같은 존이 여러 개라면 위에 적힌 대략적인 위치를 참고해서 판단하세요.\n" +
    "4. 배정이 끝나면 각 존마다 번호 범위를 정리하세요. 연속된 번호는 물결표로 묶고(예: 1~10), 끊어지는 " +
    "구간은 쉼표로 구분하세요 (예: 1~10, 25~30).\n\n" +
    "각 존마다 정확히 한 줄씩, 다른 설명 없이 이 형식으로만 답하세요 (존 이름은 위 목록에 있는 그대로 " +
    "정확히 옮겨 쓰세요):\n" +
    "ZONE: <존 이름> | RANGES: <번호 범위> | COUNT: <실제 합산 개수>\n" +
    "이미지에서 그 존에 해당하는 번호 그룹을 찾지 못했으면 RANGES 자리에 정확히 \"인식 실패\"라고 쓰세요."
  );
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

  let body: RecognizeSeatNumbersBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { imageBase64, zones } = body;
  const mimeType = ALLOWED_MIME_TYPES.includes(body.mimeType as AllowedMimeType)
    ? (body.mimeType as AllowedMimeType)
    : null;

  if (!imageBase64 || !mimeType) {
    return NextResponse.json({ error: "이미지 데이터가 올바르지 않습니다." }, { status: 400 });
  }
  if (!zones || !zones.length) {
    return NextResponse.json({ error: "먼저 존을 등록해주세요." }, { status: 400 });
  }

  try {
    const response = await client.messages.create({
      model: getClaudeModel(),
      // 단순 개수 세기보다 어려운(문자 인식 + 시각적 그룹핑 + 좌석수 대조) 작업이라 여유 있게 잡는다.
      max_tokens: 4000,
      // Sonnet 5는 기본적으로 adaptive thinking을 켜는데, 이게 토큰 예산을 다 써버리면 정작
      // ZONE:/RANGES: 최종 답변을 쓸 자리가 없어져서 응답이 통째로 비어버린다(recognize 라우트에서
      // 이미 겪은 문제와 동일). thinking을 꺼서 모든 토큰이 눈에 보이는 답변에 쓰이게 한다.
      thinking: { type: "disabled" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType, data: imageBase64 },
            },
            { type: "text", text: buildPrompt(zones) },
          ],
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const matches = [...text.matchAll(/ZONE:\s*(.+?)\s*\|\s*RANGES:\s*(.*?)\s*\|\s*COUNT:\s*(\d+)/g)];
    const zoneNames = new Set(zones.map((z) => z.name));
    const ranges: SeatNumberRangeEntry[] = matches
      .map((m) => ({ zoneName: m[1].trim(), ranges: m[2].trim() }))
      .filter((r) => zoneNames.has(r.zoneName) && r.ranges && !r.ranges.includes("인식 실패"));

    if (!matches.length) {
      return NextResponse.json(
        { error: `좌석번호를 인식하지 못했습니다. 응답: ${text}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ ranges });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claude API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
