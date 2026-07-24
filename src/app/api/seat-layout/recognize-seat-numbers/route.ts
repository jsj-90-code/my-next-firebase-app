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

// AI에게는 "번호 읽기 + 시각적 그룹 나누기"만 맡긴다. 그룹의 개수를 세거나, 존 이름과
// 매칭하거나, 번호 범위 문자열("1~10, 25~30")을 만드는 계산/서식 작업은 사람이 코드로 하는 게
// 훨씬 정확하다 — 이전 버전은 이 전부를 한 번에 AI에게 시켜서 어느 한 단계만 삐끗해도 결과가
// 통째로 틀어지는 문제가 있었다.
const PROMPT =
  "이 이미지는 PC방 매장의 좌석번호표(피난안내도 등 좌석마다 번호가 적힌 안내판/도면)입니다.\n" +
  "작업:\n" +
  "1. 이미지에서 보이는 모든 좌석 번호를 최대한 정확히 읽으세요. 작은 글씨라도 최선을 다해 읽고, " +
  "번호를 하나도 빠뜨리지 마세요.\n" +
  "2. 도면 위에 실제로 그려진 벽/칸막이/여백 등 시각적 구역 경계를 기준으로 번호들을 그룹으로 " +
  "나누세요. 같은 벽/칸 안에 있으면 같은 그룹입니다.\n\n" +
  "다른 설명 없이, 그룹마다 정확히 한 줄씩 이 형식으로만 답하세요 (그룹은 이미지에 보이는 순서대로, " +
  "예를 들어 왼쪽 위부터 아래로):\n" +
  "GROUP: <번호1>,<번호2>,<번호3>,...\n" +
  "그룹 안 번호 순서는 상관없습니다 — 그 구역 안에 보이는 번호를 빠짐없이 쉼표로 구분해서 쓰면 " +
  "됩니다. 존 이름이나 좌석 수는 몰라도 되니 신경 쓰지 말고, 오직 어떤 번호들이 같은 구역에 " +
  "있는지만 정확하게 구분해주세요.";

// 연속된 번호는 물결표로 묶고("1~10"), 끊어지는 구간은 쉼표로 구분한다("1~10, 25~30").
function compressRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (!sorted.length) return "";
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}~${prev}`);
    start = n;
    prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}~${prev}`);
  return parts.join(", ");
}

type Group = { numbers: number[]; count: number; ranges: string };

// 그룹을 존에 배정한다: "이 그룹 개수와 정확히 일치하는, 아직 안 배정된 존이 딱 하나"일 때만
// 자동으로 배정한다. 개수가 같은 존/그룹이 여러 개거나 딱 맞는 게 없으면 추측하지 않고 경고로
// 남겨서 사람이 직접 확인하게 한다 — 틀린 값을 자신있게 채워 넣는 것보다 안전하다.
function matchGroupsToZones(
  groups: Group[],
  zones: ZoneInput[],
): { ranges: SeatNumberRangeEntry[]; warnings: string[] } {
  const ranges: SeatNumberRangeEntry[] = [];
  const usedGroupIdx = new Set<number>();
  const usedZoneNames = new Set<string>();

  for (const zone of zones) {
    const candidates = groups
      .map((g, i) => ({ g, i }))
      .filter(({ g, i }) => !usedGroupIdx.has(i) && g.count === zone.seats);
    if (candidates.length === 1) {
      const { g, i } = candidates[0];
      ranges.push({ zoneName: zone.name, ranges: g.ranges });
      usedGroupIdx.add(i);
      usedZoneNames.add(zone.name);
    }
  }

  const warnings: string[] = [];
  const unmatchedZones = zones.filter((z) => !usedZoneNames.has(z.name));
  if (unmatchedZones.length) {
    warnings.push(
      `다음 존은 좌석수가 겹치거나 인식된 그룹과 정확히 일치하지 않아 자동 배정하지 못했습니다: ` +
        `${unmatchedZones.map((z) => `${z.name}(${z.seats}석)`).join(", ")} — 직접 입력해주세요.`,
    );
  }
  const unusedGroups = groups.filter((_, i) => !usedGroupIdx.has(i));
  if (unusedGroups.length) {
    warnings.push(
      `이미지에서 어떤 존과도 좌석수가 맞지 않는 번호 그룹이 ${unusedGroups.length}개 있습니다 ` +
        `(${unusedGroups.map((g) => `${g.ranges} = ${g.count}개`).join(" / ")}) — 벽 경계 인식이 ` +
        `잘못됐거나 번호를 잘못 읽었을 수 있어요.`,
    );
  }

  return { ranges, warnings };
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
      // 번호를 빠짐없이 나열해야 해서(그룹당 최대 수십 개) 여유 있게 잡는다.
      max_tokens: 4000,
      // Sonnet 5는 기본적으로 adaptive thinking을 켜는데, 이게 토큰 예산을 다 써버리면 정작
      // GROUP: 답변을 쓸 자리가 없어져서 응답이 통째로 비어버린다(recognize 라우트에서 이미 겪은
      // 문제와 동일). thinking을 꺼서 모든 토큰이 눈에 보이는 답변에 쓰이게 한다.
      thinking: { type: "disabled" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType, data: imageBase64 },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const groupMatches = [...text.matchAll(/GROUP:\s*([\d,\s]+)/g)];
    const groups: Group[] = groupMatches
      .map((m) => {
        const numbers = m[1]
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n));
        return { numbers, count: new Set(numbers).size, ranges: compressRanges(numbers) };
      })
      .filter((g) => g.count > 0);

    if (!groups.length) {
      return NextResponse.json(
        { error: `좌석번호를 인식하지 못했습니다. 응답: ${text}` },
        { status: 502 },
      );
    }

    const { ranges, warnings } = matchGroupsToZones(groups, zones);
    return NextResponse.json({ ranges, warnings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claude API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
