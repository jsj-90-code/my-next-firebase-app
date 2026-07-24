import { NextResponse } from "next/server";
import { getClaudeClient, getClaudeModel } from "@/lib/claude";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedEmail } from "@/lib/seatLayout/authDomain";
import { DESK_SIZE_OPTIONS } from "@/lib/seatLayout/constants";
import type { DeskSize, RecognizeResult, SizeBreakdownEntry } from "@/lib/seatLayout/types";

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

const EXCLUDE_NOTE =
  "이 구역 안에는 좌석이 아닌 다른 도면 기호(에어컨 실내기, 소화기, 기둥, 콘센트, 배관, 문, 화분, 카운터, 안내판 등)도 " +
  "함께 표시되어 있을 수 있습니다. 이런 기호는 세지 말고, 실제 이용자가 앉는 자리, 즉 책상(사각형 모양) 아이콘만 " +
  "기준으로 세어주세요. 이 도면에는 모니터는 따로 표시되지 않고, 의자는 있거나 없거나 모양이 제각각이라 신뢰할 수 " +
  "없으니 의자 유무는 무시하고 책상 개수만 세어주세요. 또한 도면 위에 좌석들을 가로지르는 점선 원이나 점선 곡선(반경/동선 표시용 보조선)이 겹쳐 " +
  "그려져 있을 수 있는데, 이 점선은 무시하고 그 밑에 있는 실제 좌석 아이콘만 기준으로 세어주세요. " +
  "아이콘이 겹치거나 잘려 보이더라도 하나의 완전한 자리 세트로 보이면 1개로 계산하세요.\n" +
  "중요: 두 줄이 서로 등을 맞대고(back-to-back) 붙어있는 배치가 자주 있습니다 (한쪽 줄 좌석들이 위를 보고, " +
  "바로 붙은 반대쪽 줄 좌석들이 아래를 보는 식). 이런 경우 앞줄과 뒷줄은 서로 다른 좌석이므로 반드시 각각 " +
  "따로 세어야 합니다 — 등을 맞댄 한 쌍을 절대 1개로 합쳐서 세지 마세요. 줄 하나에 보이는 좌석 수를 센 " +
  "다음, 등을 맞댄 줄이 있다면 그 줄의 좌석 수도 별도로 세어 합산하세요.\n" +
  "또한 다음 두 가지도 좌석이 아니니 세지 마세요: (1) [1인석], [멀티존A]처럼 대괄호로 감싼 존 이름 라벨 " +
  "박스 — 이건 사각형이라 책상처럼 보일 수 있지만 텍스트 라벨일 뿐입니다. (2) 복도/통로(사람이 지나다니는 " +
  "빈 동선 공간) 주변에 놓인 가구나 표시 — 실제 좌석 줄에서 벗어나 통로 쪽에 걸쳐 있는 것은 좌석이 아닙니다.\n" +
  "예외: 커플석처럼 긴 책상 하나에 의자 2개가 나란히 붙어있는 형태는, 책상이 하나로 이어져 보여도 실제 앉는 " +
  "자리 수(의자 수)만큼, 즉 2개로 세어주세요.";

// 바로 "몇 개다"라고 답하게 하면 겹치거나 줄이 많을 때 셈이 잘 틀린다.
// 순서대로 세면서 번호만 나열하게 하면(그 다음 나열한 개수를 COUNT로 쓰게 하면) 빠뜨리거나
// 중복으로 세는 실수가 줄어든다 — 비전 모델의 개수 세기 정확도를 높이는 일반적인 방법이다.
// 다만 위치 설명까지 길게 쓰게 하면 응답이 길어져 느려지므로, 숫자만 나열하도록 최소화했다.
const LIST_THEN_COUNT_NOTE =
  "바로 개수만 답하지 말고, 왼쪽 위부터 순서대로 책상을 하나씩 짚어가면서 숫자만 한 줄에 하나씩 " +
  "나열하세요 (설명 없이 숫자만, 예: 1개면 \"1\", 3개면 \"1\\n2\\n3\"). 등을 맞댄 뒷줄이 있으면 이어서 " +
  "번호를 매기세요. 다 나열한 다음에만 COUNT를 쓰고, COUNT는 나열한 숫자의 개수와 정확히 같아야 합니다.";

function buildPrompt(mode: "desk" | "pc") {
  if (mode === "pc") {
    return (
      "이 이미지는 PC방 도면의 한 구역을 잘라낸 것입니다.\n" +
      `개별 좌석(PC 1대가 놓인 책상) 아이콘의 개수를 정확히 세어야 합니다. ${EXCLUDE_NOTE}\n` +
      `${LIST_THEN_COUNT_NOTE}\n` +
      "나열이 끝나면 마지막 줄에 다른 설명 없이 이 형식으로만 쓰세요:\n" +
      "COUNT: 숫자"
    );
  }

  return (
    "이 이미지는 PC방 도면의 한 구역을 잘라낸 것입니다.\n" +
    `개별 좌석을 나타내는 책상 아이콘의 개수를 정확히 세어야 합니다. ${EXCLUDE_NOTE}\n` +
    `${LIST_THEN_COUNT_NOTE}\n` +
    "그다음, 방금 나열한 것과 별개로 이 구역 안에 보이는 책상 치수 텍스트 라벨(예: 820*680, 850*680처럼 " +
    "책상마다 붙어있는 작은 숫자)이 총 몇 개인지 다시 세어서 다음 줄에 이 형식으로만 쓰세요:\n" +
    "LABELCOUNT: 숫자\n" +
    "치수 텍스트는 책상마다 하나씩 있는 게 정상이고, 아이콘끼리 겹치거나 잘리는 것과 달리 텍스트는 " +
    "겹치는 경우가 적어 훨씬 정확하게 셀 수 있습니다. 만약 LABELCOUNT가 방금 나열한 책상 개수와 다르다면, " +
    "치수 텍스트가 없는 책상(라벨 없이도 확실히 책상으로 보이는 경우)이 있는지, 또는 아이콘을 세면서 " +
    "겹친 책상을 놓쳤거나 중복으로 센 곳은 없는지 다시 확인하고, 실제 책상 개수를 가장 정확히 반영하는 " +
    "값으로 최종 COUNT를 다시 정하세요 (치수 텍스트 라벨 쪽이 더 신뢰할 수 있는 근거이니, 특별히 라벨 " +
    "없는 책상이 눈에 띄지 않는 이상 LABELCOUNT를 우선하세요). 다시 정한 최종 값을 다음 줄에 이 형식으로 " +
    "쓰세요 (이 줄이 최종 COUNT입니다):\n" +
    "COUNT: 숫자\n" +
    "이제 최종 COUNT에 해당하는 책상들을 사이즈별로 묶으세요. 각 책상 옆/위에 작게 적힌 치수 텍스트를 " +
    "읽고 폭(mm) 값을 820/850/910/950/1000 중 가장 가까운 표준 사이즈로 판단하세요. " +
    "한 구역 안에 서로 다른 사이즈가 섞여 있는 경우가 있으니, 절대로 하나로 뭉뚱그리지 말고 사이즈가 " +
    "다르면 반드시 그룹을 나누세요. 텍스트가 안 보이거나 판단이 어려운 책상은 UNKNOWN 그룹으로 묶으세요.\n" +
    "다른 설명 없이 사이즈 그룹마다 한 줄씩 이 형식으로 쓰세요 (실제 존재하는 사이즈 그룹만, 필요한 " +
    "만큼 여러 줄):\n" +
    "GROUP: 820mm x숫자\n" +
    "GROUP: 850mm x숫자\n" +
    "모든 GROUP 숫자의 합은 최종 COUNT와 반드시 같아야 합니다.\n" +
    "마지막으로, 방금 나열한 책상들 중 주황/빨간색 점과 선으로 이어진 표시('가방 선반 브라켓' 설치 " +
    "표시, 보통 마주보는 책상 줄 위에 그어져 있음)가 있는 책상이 몇 개인지 세세요. 이 표시가 등을 맞댄 " +
    "앞줄/뒷줄 사이에 걸쳐 있으면 양쪽 줄의 책상을 모두 포함해서 세고, 표시가 없는 책상은 포함하지 " +
    "마세요. 이 표시가 전혀 없으면 0으로 답하세요. GROUP 줄들 다음, 마지막 줄에 이 형식으로만 쓰세요:\n" +
    "BRACKET: 숫자"
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
      // 답변 전에 책상을 하나씩 세면서 번호만 나열하게 하므로(개수 세기 정확도 향상 목적)
      // 약간의 여유를 두되, 설명 없이 숫자만 쓰게 했으니 너무 크게 잡을 필요는 없다
      // (여기를 너무 크게 잡으면 응답이 길어질수록 체감 속도만 늦어진다). desk 모드는 라벨 개수
      // 대조/재확정 줄이 추가로 붙으니 여유를 조금 더 둔다.
      max_tokens: 750,
      // 단순 개수 세기 작업이라 thinking은 끈다 (adaptive thinking이 토큰을 다 써버리면
      // 복잡한 구역에서 정작 COUNT/SIZE 답변이 잘려서 인식 실패로 보이는 문제가 있었다).
      thinking: { type: "disabled" },
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
      error instanceof Error ? error.message : "Claude API 요청에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
