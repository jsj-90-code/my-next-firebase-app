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

// 예전 버전은 "벽 경계로 그룹 나누고 좌석수가 맞는 존에 끼워 맞추기"를 시켰는데, 피난안내도의
// 방/벽 구획이 이 툴의 존 구분과 안 맞는 경우가 많아서(방 하나에 여러 존이 섞여 있거나, 존
// 하나가 여러 박스로 쪼개져 그려짐) 좌석수만으로는 자동 배정이 거의 항상 틀렸다. 실제로 사람이
// 하는 방식은 "배치도에서 이 존이 물리적으로 어디 있는지 보고, 피난안내도에서 같은 위치를 찾아
// 번호를 확인하는" 것이므로, AI에게도 두 이미지를 같이 주고 위치로 대응시키게 한다.
function buildPrompt(zones: ZoneInput[], multiTile: boolean): string {
  const zoneList = zones.map((z) => `- ${z.name} (${z.seats}석)`).join("\n");
  return (
    "①번 이미지는 이 PC방 매장의 책상 배치도이고, 각 존이 이름표가 붙은 색깔 박스로 표시되어 " +
    "있습니다 — 이 박스들의 상대적 위치/모양/이웃 관계가 매장 안에서 그 존이 실제로 있는 " +
    "위치입니다.\n" +
    (multiTile
      ? "②번 이미지부터는 같은 매장의 피난안내도(좌석번호표)입니다: ②전체, ③좌상단 확대, " +
        "④우상단 확대, ⑤좌하단 확대, ⑥우하단 확대 (확대 이미지들은 경계가 겹치게 잘랐습니다). " +
        "벽/칸막이 구조는 ①번 배치도와 비슷하게 그려져 있습니다.\n\n"
      : "②번 이미지는 같은 매장의 피난안내도(좌석번호표)입니다. 벽/칸막이 구조는 ①번 배치도와 " +
        "비슷하게 그려져 있습니다.\n\n") +
    "이 매장의 존 목록 (이름과 좌석수):\n" +
    zoneList +
    "\n\n" +
    "작업:\n" +
    "1. ①번 배치도에서 각 존 박스의 위치(매장 입구/벽/이웃한 다른 존 기준)를 파악하세요.\n" +
    "2. 피난안내도에서 같은 위치에 해당하는 좌석 번호 구역을 찾으세요. 절대로 \"좌석수가 " +
    "같으니까 여기겠지\"처럼 개수만으로 먼저 추측하지 마세요 — 반드시 실제 물리적 위치/모양이 " +
    "대응되는지로 먼저 판단하세요. 방 하나에 여러 존이 같이 있거나, 존 하나가 피난안내도에는 " +
    "여러 칸으로 나뉘어 그려졌을 수도 있습니다. 아주 드물게는 한 존이 하나의 방이 아니라 다른 " +
    "존의 방 안에 흩어져 박힌 개별 좌석 몇 개일 수도 있으니, 배치도에서 그 존 박스가 유난히 " +
    "작거나 다른 방 안에 겹쳐 있는지도 확인하세요.\n" +
    "3. 벽 없이 한 줄로 쭉 이어진 좌석 안에 여러 존이 나란히 붙어 있는 경우, 정확히 몇 번째 " +
    "자리에서 다음 존으로 넘어가는지 놓치기 쉽습니다(사람도 숫자를 하나씩 세다가 실수하는 " +
    "부분입니다). 이런 구간은 한 자리씩 다시 세어 경계를 재확인하세요.\n" +
    "4. 각 존에 번호를 배정한 뒤, 배정한 번호 개수를 세어 위 목록에 적힌 그 존의 좌석수와 " +
    "일치하는지 반드시 검산하세요. 개수가 안 맞으면 3번의 경계 재확인으로 돌아가 다시 " +
    "맞추세요 (이웃한 존과 경계가 한두 자리 밀렸을 가능성이 높습니다).\n" +
    (multiTile
      ? "5. 작은 글씨나 빽빽하게 몰린 구역의 번호는 ③~⑥ 확대 이미지에서 정확히 확인하세요. " +
        "확대 이미지들은 경계가 겹치므로 같은 번호를 중복해서 넣지 마세요.\n\n"
      : "\n") +
    "답변 형식 (다른 설명 없이, 이 형식만 사용):\n" +
    "ZONE: <위 목록의 존 이름을 정확히 그대로> = <번호1>,<번호2>,...\n" +
    "위치 대응에 확신이 서는 존만 쓰세요 — 확신이 없는 존은 그 줄을 아예 쓰지 마세요 (틀리게 " +
    "추측해서 채우는 것보다, 사람이 직접 확인하게 비워두는 게 낫습니다).\n" +
    "마지막 줄에는 반드시 이것도 추가하세요 (어느 존에도 확신 있게 배정하지 못한, 이미지에서 " +
    "보이는 나머지 모든 번호):\n" +
    "UNSURE: <번호1>,<번호2>,..."
  );
}

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

function toImageBlock(img: ImageInput) {
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: img.mimeType as AllowedMimeType,
      data: img.data,
    },
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
      toImageBlock(img),
      { type: "text" as const, text: IMAGE_LABELS[i] ?? `이미지 ${i + 1}` },
    ]);
    const prompt = buildPrompt(zones, plateImages.length > 1);

    // thinking(적응형) + 실제 답변(존별 번호 나열 + UNSURE 목록)을 합친 한도라서 넉넉히 잡는다.
    // 지침이 늘어나며 AI가 더 오래 생각하다가 답을 쓸 자리가 없어 응답이 통째로 비는 걸 실제로
    // 겪어서, 여유를 크게 늘렸다. 이만큼 큰 max_tokens는 논스트리밍이면 타임아웃 위험이 있어
    // 스트리밍으로 받는다.
    const stream = client.messages.stream({
      model: getClaudeModel(),
      // 생각(thinking)만 하다 답을 못 쓰고 끝나는 사례가 있어서 여유 있게 잡는다.
      max_tokens: 32000,
      // Sonnet 5부터는 고정 토큰 예산(budget_tokens) 방식이 제거되고 "adaptive"만 지원한다.
      // 9/11 존이 맞았던 조합(이미지 5장 + effort "high") — 여기서 확정하고 더 손대지 않는다.
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      messages: [
        {
          role: "user",
          content: [...imageContent, { type: "text", text: prompt }],
        },
      ],
    });
    const response = await stream.finalMessage();

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const ranges: SeatNumberRangeEntry[] = [];
    const matchedNames = new Set<string>();
    for (const m of text.matchAll(/ZONE:\s*(.+?)\s*=\s*([\d,\s]+)/g)) {
      const zoneName = m[1].trim();
      const zone = zones.find((z) => z.name === zoneName);
      if (!zone || matchedNames.has(zone.name)) continue;
      const numbers = parseNumberList(m[2]);
      if (!numbers.length) continue;
      ranges.push({ zoneName: zone.name, ranges: compressRanges(numbers) });
      matchedNames.add(zone.name);
    }

    const unsureMatch = text.match(/UNSURE:\s*([\d,\s]+)/);
    const unmatchedGroups = unsureMatch ? toRangeChips(parseNumberList(unsureMatch[1])) : [];

    if (!ranges.length && !unmatchedGroups.length) {
      // stop_reason이 "max_tokens"면 생각(thinking)만 하다가 답을 쓸 자리가 없어서 응답이
      // 비어버린 것 — 사람이 재시도하면 되지만, 원인을 알 수 있게 메시지에 남겨둔다.
      const reasonHint =
        response.stop_reason === "max_tokens"
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
    const message = error instanceof Error ? error.message : "Claude API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
