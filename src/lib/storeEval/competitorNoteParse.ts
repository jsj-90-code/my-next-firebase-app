// 점포개발자가 현장 조사 후 남기는 "경쟁점 설명" 텍스트를 붙여넣으면 경쟁점 폼 필드로 결정적으로
// (AI 아님, 라벨 매칭) 추출한다 - marketDataExtract.ts와 같은 패턴. 사용자가 실제로 쓰는 원문
// 형식(2026-08-27 제공)을 그대로 픽스처로 삼아 테스트한다.
//
// 한 번에 여러 매장이 붙여넣어질 수 있어("- 매장명 : X" 줄마다 새 매장 시작), 이 줄을 기준으로
// 블록을 나눈 뒤 블록별로 라벨을 찾는다. 값 판단이 애매한 항목(적용대수, 존구성 세부 등)은
// 지어내지 않고 비워둔다 - 사람이 미리보기에서 검토 후 저장한다.

export type ParsedCompetitorNote = {
  name: string;
  totalPcCount: number | null;
  cpu: string | null;
  vgaBase: string | null;
  ram: string | null;
  monitor: string | null;
  premiumZone: number | null;
  coupleZone: number | null;
  room1: number | null; // 1인석 -> 1인룸 수 (근사 매핑, 사람이 검토)
  room2: number | null; // 2인석 -> 2인룸 수 (근사 매핑, 사람이 검토)
  teamRoom: number | null;
  ratePer1000Won: number | null;
  paidDeduction: string | null;
  visitedAt: string | null; // "YYYY-MM-DD HH:MM"
  visitorCount: number | null;
  foodBasis: string | null; // 먹거리 브랜드
  interiorBasis: string | null; // 인테리어 수준 + 관리상태 + 종합평가
  raw: string; // 원문 블록 (검토용)
};

function matchLine(block: string, label: RegExp): string | null {
  const m = block.match(label);
  return m ? m[1].trim() : null;
}

/** "없음" -> 0, "10개"/"11석"처럼 숫자+단위가 있으면 첫 숫자, 그 외 판단 불가면 null. */
function parseCountLike(text: string | null): number | null {
  if (text == null) return null;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.includes("없음")) return 0;
  const m = trimmed.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** "4인1개 5인4개" 같은 "N개"들을 전부 더한다("없음"이면 0). */
function sumGaeCounts(text: string | null): number | null {
  if (text == null) return null;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.includes("없음")) return 0;
  const matches = [...trimmed.matchAll(/(\d+)\s*개/g)];
  if (matches.length === 0) return parseCountLike(text);
  return matches.reduce((sum, m) => sum + Number(m[1]), 0);
}

/** "26년 3월23일 오전 11시30분 9명 이용중" -> {visitedAt: "2026-03-23 11:30", visitorCount: 9} */
function parseVisitLine(text: string | null): { visitedAt: string | null; visitorCount: number | null } {
  if (text == null) return { visitedAt: null, visitorCount: null };
  const yearM = text.match(/(\d{2,4})년/);
  const monthM = text.match(/(\d{1,2})월/);
  const dayM = text.match(/(\d{1,2})일/);
  const hourM = text.match(/(\d{1,2})시/);
  const minuteM = text.match(/(\d{1,2})분/);
  const isPm = text.includes("오후");
  const isAm = text.includes("오전");
  const visitorM = text.match(/(\d+)\s*명/);

  let visitedAt: string | null = null;
  if (yearM && monthM && dayM) {
    const year = yearM[1].length === 2 ? 2000 + Number(yearM[1]) : Number(yearM[1]);
    const month = String(monthM[1]).padStart(2, "0");
    const day = String(dayM[1]).padStart(2, "0");
    if (hourM && minuteM) {
      let hour = Number(hourM[1]);
      if (isPm && hour < 12) hour += 12;
      if (isAm && hour === 12) hour = 0;
      visitedAt = `${year}-${month}-${day} ${String(hour).padStart(2, "0")}:${minuteM[1].padStart(2, "0")}`;
    } else {
      visitedAt = `${year}-${month}-${day}`;
    }
  }
  return { visitedAt, visitorCount: visitorM ? Number(visitorM[1]) : null };
}

/** "1000원 40분" -> 40 */
function parseRatePer1000Won(text: string | null): number | null {
  if (text == null) return null;
  const m = text.match(/(\d+)\s*분/);
  return m ? Number(m[1]) : null;
}

function parseOneBlock(block: string): ParsedCompetitorNote | null {
  const name = matchLine(block, /매장명\s*[:：]\s*(.+)/);
  if (!name) return null;

  const totalPcCountText = matchLine(block, /전체\s*대수\s*[:：]\s*(.+)/);
  const totalPcCount = totalPcCountText ? Number(totalPcCountText.match(/(\d+)/)?.[1] ?? "") || null : null;

  const cpu = matchLine(block, /CPU\s*[:：]\s*(.+)/);
  const vgaBase = matchLine(block, /VGA\s*[:：]\s*(.+)/);
  const ram = matchLine(block, /RAM\s*[:：]\s*(.+)/);
  const monitor = matchLine(block, /모니터\s*[:：]\s*(.+)/);

  const premiumZone = parseCountLike(matchLine(block, /프리미엄석\s*[:：]?\s*(.+)/));
  const coupleZone = parseCountLike(matchLine(block, /커플석\s*[:：]?\s*(.+)/));
  const room1 = parseCountLike(matchLine(block, /1인석\s*[:：]?\s*(.+)/));
  const room2 = parseCountLike(matchLine(block, /2인석\s*[:：]?\s*(.+)/));
  const teamRoom = sumGaeCounts(matchLine(block, /팀룸\s*[:：]?\s*(.+)/));

  const { visitedAt, visitorCount } = parseVisitLine(matchLine(block, /방문\s*일시\s*고객수\s*[:：]\s*(.+)/));
  const interiorLevel = matchLine(block, /인테리어\s*수준\s*[:：]\s*(.+)/);
  const manageLevel = matchLine(block, /매장\s*관리\s*상태[^:：\n]*[:：]\s*(.+)/);
  const foodBasis = matchLine(block, /먹거리\s*브랜드\s*[:：]\s*(.+)/);
  const ratePer1000Won = parseRatePer1000Won(matchLine(block, /1,?000원\s*시간\s*[:：]\s*(.+)/));
  const paidDeduction = matchLine(block, /유료차감\s*[:：]\s*(.+)/);

  const summaryM = block.match(/종합\s*평가\s*[:：]?\s*([\s\S]*)$/);
  // 블록 경계에 다음 매장의 날짜줄("26.03.23")만 딸려 들어오는 경우가 있어 끝에서부터 정리한다.
  const summary = summaryM
    ? summaryM[1]
        .trim()
        .replace(/(\n+\d{2}\.\d{2}\.\d{2}\.?\s*)+$/, "")
        .trim() || null
    : null;

  const interiorBasisParts = [
    interiorLevel ? `인테리어 수준: ${interiorLevel}` : null,
    manageLevel ? `관리상태: ${manageLevel}` : null,
  ].filter(Boolean);
  const interiorBasis = [interiorBasisParts.join(" · ") || null, summary].filter(Boolean).join("\n\n") || null;

  return {
    name,
    totalPcCount,
    cpu,
    vgaBase,
    ram,
    monitor,
    premiumZone,
    coupleZone,
    room1,
    room2,
    teamRoom,
    ratePer1000Won,
    paidDeduction,
    visitedAt,
    visitorCount,
    foodBasis,
    interiorBasis,
    raw: block.trim(),
  };
}

/** 붙여넣은 텍스트 전체에서 "- 매장명 : X" 줄마다 새 경쟁점 블록으로 나눠 각각 파싱한다. */
export function parseCompetitorNotes(text: string): ParsedCompetitorNote[] {
  const markerRe = /^[ \t]*-?\s*매장명\s*[:：]/gm;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(text)) !== null) {
    starts.push(m.index);
  }
  if (starts.length === 0) return [];
  const blocks = starts.map((start, i) => text.slice(start, i + 1 < starts.length ? starts[i + 1] : text.length));
  return blocks.map(parseOneBlock).filter((v): v is ParsedCompetitorNote => v != null);
}
