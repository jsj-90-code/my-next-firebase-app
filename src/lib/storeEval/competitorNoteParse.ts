// 점포개발자가 현장 조사 후 남기는 "경쟁점 설명" 텍스트를 붙여넣으면 경쟁점 폼 필드로 결정적으로
// (AI 아님, 라벨 매칭) 추출한다 - marketDataExtract.ts와 같은 패턴. 사용자가 실제로 쓰는 원문
// 형식(2026-08-27 제공)을 그대로 픽스처로 삼아 테스트한다.
//
// 한 번에 여러 매장이 붙여넣어질 수 있어("- 매장명 : X" 줄마다 새 매장 시작), 이 줄을 기준으로
// 블록을 나눈 뒤 블록별로 라벨을 찾는다. 값 판단이 애매한 항목(적용대수, 존구성 세부 등)은
// 지어내지 않고 비워둔다 - 사람이 미리보기에서 검토 후 저장한다.

import type { Competitor, FoodBrand } from "./types";

export type ParsedCompetitorNote = {
  name: string;
  totalPcCount: number | null;
  cpu: string | null;
  vgaBase: string | null;
  ram: string | null;
  monitor: string | null;
  coupleZone: number | null;
  // 2026-10-06 — "1인석"(칸막이 개방형)을 1인룸(벽으로 막힌 독립 공간)으로 넣고 있었다. 사용자가 매번 손으로
  // 옮겨 고쳤다. 폼에 1인석 칸(singleSeatCount)이 2026-08-30부터 따로 있으니 그쪽으로 보낸다.
  singleSeatCount: number | null; // "1인석" 줄
  room1: number | null; // "1인룸" 줄이 있을 때만(없으면 null — 1인석을 룸으로 지어내지 않는다)
  room2: number | null; // 2인석 -> 2인룸 수 (근사 매핑, 사람이 검토)
  teamRoom: number | null;
  ratePer1000Won: number | null;
  paidDeduction: string | null;
  visitedAt: string | null; // "YYYY-MM-DD HH:MM"
  visitorCount: number | null;
  foodBasis: string | null; // 먹거리 브랜드
  interiorBasis: string | null; // 인테리어 수준 + 관리상태 + 종합평가
  // 2026-10-07 사용자 "웹에는 자동완성이 안 된다" — 수준 글자를 화면 기준표(InteriorScoringGuide)대로 점수로.
  interiorScore: number | null; // "인테리어 수준 : 중하" -> 2.5
  managementScore: number | null; // "매장 관리 상태 : 중" -> 3.0
  // 먹거리(사용자 2026-10-07): 수준 글자가 있으면 그 점수, "파악안됨"이면 중(3), 브랜드가 적혀 있으면 그 브랜드(목록 밖이면 기타브랜드, 프리셋 3=중).
  foodBrand: FoodBrand | null;
  foodScore: number | null;
  /** 경쟁점 가동률 측정기용 IP 대역(예 "210.221.225.1~106") — 원문에 있을 때만. */
  ipRanges: string | null;
  raw: string; // 원문 블록 (검토용)
};

/** 수준 글자 -> 1~5점. 화면 기준표(formFields.tsx InteriorScoringGuide)와 같은 값: 하 2.0 · 중하 2.5 · 중 3.0 · 중상 3.5 · 상 4.0(2026-10-07 사용자, 옛 4.5 — 자사 신규오픈 기준값 4.0보다 높았다). */
export const LEVEL_WORD_SCORES: { word: string; score: number }[] = [
  { word: "중상", score: 3.5 },
  { word: "중하", score: 2.5 },
  { word: "상", score: 4.0 },
  { word: "중", score: 3.0 },
  { word: "하", score: 2.0 },
];

/** "중하" "중 정도" "상급" -> 점수. 긴 낱말(중상·중하)부터 본다. 수준 글자가 없으면 null. */
export function levelWordScore(text: string | null): number | null {
  if (text == null) return null;
  const t = text.replace(/\s/g, "");
  for (const { word, score } of LEVEL_WORD_SCORES) {
    if (t === word || t.startsWith(word)) return score;
  }
  return null;
}

const FOOD_BRANDS: Exclude<FoodBrand, "기타브랜드" | "브랜드없음">[] = ["쉐프앤클릭", "한끼의품격", "XOXO", "PC토랑", "비바쿡", "농심"];
const FOOD_UNKNOWN_SCORE = 3.0;

/** 먹거리 줄 -> 브랜드/직접점수. 수준 글자 우선(사용자 "중하/하/중상 적혀 있으면 2.5/2/3.5"). */
export function parseFoodLine(text: string | null): { foodBrand: FoodBrand | null; foodScore: number | null } {
  if (text == null || text.trim() === "") return { foodBrand: null, foodScore: null };
  const level = levelWordScore(text);
  if (level != null) return { foodBrand: null, foodScore: level };
  const compact = text.replace(/\s/g, "").toLowerCase();
  if (/파악안|모름|미확인|확인안|알수없/.test(compact)) return { foodBrand: null, foodScore: FOOD_UNKNOWN_SCORE };
  const known = FOOD_BRANDS.find((b) => compact.includes(b.toLowerCase()));
  return { foodBrand: known ?? "기타브랜드", foodScore: null };
}

/** 블록 안 첫 IP 대역 줄("210.221.225.1~106", "1.2.3.4 - 1.2.3.9"). */
function findIpRanges(block: string): string | null {
  const m = block.match(/\b\d{1,3}(?:\.\d{1,3}){3}(?:\s*[~-]\s*\d{1,3}(?:\.\d{1,3}){0,3})?/);
  return m ? m[0].replace(/\s+/g, "") : null;
}

type SpecKind = "cpu" | "vga" | "ram";

/**
 * 사양 값 하나를 모양으로 가려 표준 표기로 바꾼다(2026-10-07 사용자 "14400 32 3060 -> i5 14400F / 32GB / RTX 3060").
 * 조사표엔 "VGA : 32 · RAM : 3060"처럼 칸이 뒤바뀐 채 오기도 한다 — 그대로 두면 점수 계산이 3060GB 램으로 읽는다.
 * 모양으로 못 가리는 값은 null(원래 칸에 원문 그대로 둔다).
 */
export function classifySpecValue(text: string): { kind: SpecKind; value: string } | null {
  const t = text.trim().replace(/\s+/g, " ");
  // 그래픽카드 — 접두어가 있으면 띄어쓰기만 고른다. 숫자만 있으면 1050~5090 꼴(둘째 자리 0·6, 끝 0)만.
  const gpu = t.match(/^(RTX|GTX|RX)\s*-?\s*(\d{3,4})\s*(TI|SUPER|XT)?$/i);
  if (gpu) {
    const suffix = gpu[3] ? ` ${/^ti$/i.test(gpu[3]) ? "Ti" : gpu[3].toUpperCase()}` : "";
    return { kind: "vga", value: `${gpu[1].toUpperCase()} ${gpu[2]}${suffix}` };
  }
  const bareGpu = t.match(/^([1-5])([06])([5-9])0\s*(TI|SUPER)?$/i);
  if (bareGpu) {
    const num = `${bareGpu[1]}${bareGpu[2]}${bareGpu[3]}0`;
    const prefix = num.startsWith("10") || num.startsWith("16") ? "GTX" : "RTX";
    const suffix = bareGpu[4] ? (/ti/i.test(bareGpu[4]) ? " Ti" : " SUPER") : "";
    return { kind: "vga", value: `${prefix} ${num}${suffix}` };
  }
  // 램 — 4~128 사이 2의 거듭제곱(+48), 단위 G/GB/기가는 있어도 없어도.
  const ram = t.match(/^(\d{1,3})\s*(?:G|GB|기가)?$/i);
  if (ram && [4, 8, 16, 32, 48, 64, 128].includes(Number(ram[1]))) return { kind: "ram", value: `${ram[1]}GB` };
  // 인텔 10~14세대 — "14400"·"i5-14400F"·"14600KF". 접미어가 없으면 PC방 표준인 F로 본다(사용자 예시).
  const intel = t.match(/^(?:I([3579])\s*-?\s*)?(1[0-4])([1-9])00\s*(KF|F|K)?$/i);
  if (intel) {
    const tierDigit = Number(intel[3]);
    const tier = intel[1] ?? (tierDigit <= 3 ? "3" : tierDigit <= 6 ? "5" : tierDigit <= 8 ? "7" : "9");
    return { kind: "cpu", value: `i${tier} ${intel[2]}${intel[3]}00${(intel[4] ?? "F").toUpperCase()}` };
  }
  // 라이젠 — 접미어(X·F·X3D)가 있어야 그래픽카드 번호와 안 헷갈린다.
  const ryzen = t.match(/^(?:라이젠|RYZEN|R)?\s*([579])?\s*([5-9])(\d)00(X3D|X|F|G)$/i);
  if (ryzen) {
    const tier = ryzen[1] ?? (Number(ryzen[3]) >= 8 ? "7" : "5");
    return { kind: "cpu", value: `Ryzen ${tier} ${ryzen[2]}${ryzen[3]}00${ryzen[4].toUpperCase()}` };
  }
  return null;
}

/** CPU·VGA·RAM 칸을 모양으로 다시 나눈다. 가린 값이 그 칸을 차지하고, 못 가린 원문은 빈 제 칸에만 남는다. */
export function normalizeSpecSlots(raw: Record<SpecKind, string | null>): Record<SpecKind, string | null> {
  const out: Record<SpecKind, string | null> = { cpu: null, vga: null, ram: null };
  const unknown: [SpecKind, string][] = [];
  for (const slot of ["cpu", "vga", "ram"] as const) {
    const v = raw[slot];
    if (v == null || v.trim() === "") continue;
    const c = classifySpecValue(v);
    if (c && out[c.kind] == null) out[c.kind] = c.value;
    else unknown.push([slot, v.trim()]);
  }
  for (const [slot, v] of unknown) if (out[slot] == null) out[slot] = v;
  return out;
}

function matchLine(block: string, label: RegExp): string | null {
  const m = block.match(label);
  const v = m ? m[1].trim() : "";
  return v === "" ? null : v;
}

/** "없음" -> 0, "10개"/"11석"처럼 숫자+단위가 있으면 첫 숫자, 그 외 판단 불가면 null. */
function parseCountLike(text: string | null): number | null {
  if (text == null) return null;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.includes("없음")) return 0;
  const m = trimmed.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * 존/룸 개수를 두 가지 표기 방식으로 더한다("없음"이면 0):
 * - "4인1개 5인4개"(구 형식) - "N개"를 전부 더함
 * - "40 (3인 1, 4인 8, 5인 1)"(신 형식, 2026-08-27) - 괄호 앞 숫자는 좌석 합계(3×1+4×8+5×1=40)라
 *   존/룸 "개수"가 아니다. 괄호 안 "N인 M" 쌍에서 M(그 크기의 룸 개수)만 더한다.
 * 둘 다 없으면(괄호도 "개"도 없는 단순 숫자) 그 숫자를 그대로 개수로 본다(기존 동작 유지).
 */
function sumGaeCounts(text: string | null): number | null {
  if (text == null) return null;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.includes("없음")) return 0;
  const gaeMatches = [...trimmed.matchAll(/(\d+)\s*개/g)];
  if (gaeMatches.length > 0) return gaeMatches.reduce((sum, m) => sum + Number(m[1]), 0);
  const inMatches = [...trimmed.matchAll(/\d+\s*인\s*(\d+)/g)];
  if (inMatches.length > 0) return inMatches.reduce((sum, m) => sum + Number(m[1]), 0);
  return parseCountLike(text);
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

/** "1000원 40분" -> 40 · "2시간 3000원" -> 40(2026-10-07, 묶음 요금을 1,000원당 분으로 환산) */
function parseRatePer1000Won(text: string | null): number | null {
  if (text == null) return null;
  const bundle = text.match(/(\d+(?:\.\d+)?)\s*시간\s*(\d[\d,]*)\s*원/);
  if (bundle) {
    const won = Number(bundle[2].replace(/,/g, ""));
    return won > 0 ? Math.round((Number(bundle[1]) * 60 * 1000) / won) : null;
  }
  const m = text.match(/(\d+)\s*분/);
  if (m) return Number(m[1]);
  // 2026-10-15 군산점 — "1,000원 시간 : 45"처럼 단위 없이 숫자만 적기도 한다. 줄 라벨이 이미 "1,000원 시간"이라
  // 숫자 하나뿐이면 분으로 읽는다(1,000원에 10~120분 밖이면 다른 뜻일 수 있어 비운다).
  const bare = text.trim().match(/^(\d+)$/);
  return bare && Number(bare[1]) >= 10 && Number(bare[1]) <= 120 ? Number(bare[1]) : null;
}

function parseOneBlock(block: string): ParsedCompetitorNote | null {
  const name = matchLine(block, /매장\s*명\s*[:：][ \t]*(.+)/);
  if (!name) return null;

  const totalPcCountText = matchLine(block, /전체\s*대수\s*[:：][ \t]*(.+)/);
  const totalPcCountMatch = totalPcCountText?.match(/(\d+)/)?.[1];
  const totalPcCount = totalPcCountMatch != null ? Number(totalPcCountMatch) : null;

  const { cpu, vga: vgaBase, ram } = normalizeSpecSlots({
    cpu: matchLine(block, /CPU\s*[:：][ \t]*(.+)/),
    vga: matchLine(block, /VGA\s*[:：][ \t]*(.+)/),
    ram: matchLine(block, /RAM\s*[:：][ \t]*(.+)/),
  });
  const monitor = matchLine(block, /모니터\s*[:：][ \t]*(.+)/);

  const coupleZone = sumGaeCounts(matchLine(block, /커플석\s*[:：]?[ \t]*(.+)/));
  const singleSeatCount = parseCountLike(matchLine(block, /1인석\s*[:：]?[ \t]*(.+)/));
  const room1 = parseCountLike(matchLine(block, /1인\s*룸\s*[:：]?[ \t]*(.+)/));
  const room2 = parseCountLike(matchLine(block, /2인석\s*[:：]?[ \t]*(.+)/));
  const teamRoom = sumGaeCounts(matchLine(block, /팀룸\s*[:：]?[ \t]*(.+)/));

  // "방문일시 고객수" 순서가 형식마다 다르다 - 구형식은 "26년 3월23일 오전 11시30분 9명 이용중"
  // (날짜 먼저), 신형식은 "56명 (4시 30분)"(인원 먼저, 날짜 자체가 없음) - 라벨 뒤 전체를 그대로
  // parseVisitLine에 넘기면 두 형식 다 정규식이 알아서 필요한 조각만 뽑아온다.
  const { visitedAt, visitorCount } = parseVisitLine(matchLine(block, /방문\s*일시\s*고객수\s*[:：][ \t]*(.+)/));
  const interiorLevel = matchLine(block, /인테리어\s*수준\s*[:：][ \t]*(.+)/);
  const manageLevel = matchLine(block, /매장\s*관리\s*상태[^:：\n]*[:：][ \t]*(.+)/);
  // "먹거리 브랜드"(구형식)와 "먹거리 수준, 브랜드"(신형식, 값이 브랜드명이 아니라 "중" 같은 수준일
  // 수도 있음) 둘 다 받는다 - "먹거리"와 콜론 사이에 어떤 텍스트가 와도 매칭한다.
  const foodBasis = matchLine(block, /먹거리[^:：\n]*[:：][ \t]*(.+)/);
  // "1,000원 시간"(구형식, 붙여씀)과 "1,000 원 시간"(신형식, 띄어씀) 둘 다 받는다.
  const ratePer1000Won = parseRatePer1000Won(matchLine(block, /1,?000\s*원\s*시간\s*[:：][ \t]*(.+)/));
  const paidDeduction = matchLine(block, /유료차감\s*[:：][ \t]*(.+)/);

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
    coupleZone,
    singleSeatCount,
    room1,
    room2,
    teamRoom,
    ratePer1000Won,
    paidDeduction,
    visitedAt,
    visitorCount,
    foodBasis,
    interiorBasis,
    interiorScore: levelWordScore(interiorLevel),
    managementScore: levelWordScore(manageLevel),
    ...parseFoodLine(foodBasis),
    ipRanges: findIpRanges(block),
    raw: block.trim(),
  };
}

/**
 * 붙여넣은 텍스트 전체에서 "- 매장명 : X"(구형식) 또는 "■ 매장명: X"(신형식, 2026-08-27) 줄마다
 * 새 경쟁점 블록으로 나눠 각각 파싱한다.
 * 2026-10-07 — "1. 매장명", "▶ 매장명", "매장 명"처럼 앞 기호·번호·띄어쓰기가 다르면 0곳으로 끝나고
 * 화면엔 아무 반응이 없었다(사용자 "분석 눌렀는데 반응이 없다"). 줄 앞 기호·번호를 넓게 받는다.
 */
export function parseCompetitorNotes(text: string): ParsedCompetitorNote[] {
  const markerRe = /^[ \t]*(?:[■□▶▷►●○•·◆◇★☆※*\-]+\s*|\d+\s*[.)]\s*)?(?:경쟁점\s*)?매장\s*명\s*[:：]/gm;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(text)) !== null) {
    starts.push(m.index);
  }
  if (starts.length === 0) return [];
  const blocks = starts.map((start, i) => text.slice(start, i + 1 < starts.length ? starts[i + 1] : text.length));
  return blocks.map(parseOneBlock).filter((v): v is ParsedCompetitorNote => v != null);
}

/**
 * 붙여넣기 파싱 결과를 경쟁점 폼에 얹는다 - 판단이 애매해서 파서가 null로 둔 값(주소·거리·적용대수·
 * 경쟁력 점수 등)은 그대로 비워둬서 사람이 직접 채우게 한다.
 * base가 새 빈 경쟁점이면 매장명도 붙여넣은 이름 그대로 쓰지만, 이미 등록된 경쟁점에 병합하는
 * 경우(2026-08-27 수정)에는 기존 매장명(보통 카카오 자동수집으로 이미 깔끔하게 들어있음)을
 * 점포개발자가 줄여 쓴 이름으로 덮어쓰지 않는다 — 이름이 서로 완전히 다를 수 있다는 사용자 확인
 * ("탑스타pc방" vs "탑스타PC 울산삼산점")으로 발견된 문제.
 *
 * 2026-10-15 — 화면(CompetitorsTab)에만 있던 것을 여기로 옮겼다. 다우 심사글 등록 스킬도 같은 규칙으로 채운다.
 */
export function applyParsedNote(base: Competitor, note: ParsedCompetitorNote, options: { overwriteName: boolean }): Competitor {
  return {
    ...base,
    name: options.overwriteName ? note.name : base.name,
    surveyLevel: "상세",
    totalPcCount: note.totalPcCount,
    cpu: note.cpu,
    vgaBase: note.vgaBase,
    ram: note.ram,
    monitorBase: note.monitor,
    coupleZone: note.coupleZone,
    // 2026-10-06 — "1인석" 줄은 1인석 칸으로(예전엔 1인룸으로 들어가 사용자가 매번 옮겨 고쳤다). 원문에 줄이 없으면
    // 이미 손으로 넣어 둔 값을 지우지 않는다.
    singleSeatCount: note.singleSeatCount ?? base.singleSeatCount,
    room1: note.room1 ?? base.room1,
    room2: note.room2,
    teamRoom: note.teamRoom,
    // 2026-10-07 — 시간당환산요금은 폼에서 분을 손으로 칠 때만 채워져, 붙여넣기 땐 분을 지우고 다시 쳐야 했다(사용자).
    // 폼 칸과 같은 식(60000 / 분)으로 같이 채운다. 원문에 요금 줄이 없으면 기존 값을 지우지 않는다.
    ratePer1000Won: note.ratePer1000Won ?? base.ratePer1000Won,
    hourlyRateConverted:
      note.ratePer1000Won != null && note.ratePer1000Won > 0 ? Math.round(60000 / note.ratePer1000Won) : base.hourlyRateConverted,
    paidDeduction: note.paidDeduction,
    visitedAt: note.visitedAt,
    visitorCount: note.visitorCount,
    foodBasis: note.foodBasis,
    interiorBasis: note.interiorBasis,
    ipRanges: note.ipRanges ?? base.ipRanges ?? null,
    // 2026-10-07 사용자 "먹거리·인테리어·관리 평가가 자동완성이 안 된다" — 원문에 수준 글자가 있을 때만 채우고,
    // 없으면 이미 넣어 둔 값을 지우지 않는다. 먹거리는 브랜드나 직접점수 중 하나만 채워진다(competitorNoteParse.parseFoodLine).
    interiorScore: note.interiorScore ?? base.interiorScore,
    managementScore: note.managementScore ?? base.managementScore,
    ...(note.foodBrand != null || note.foodScore != null ? { foodBrand: note.foodBrand, foodScore: note.foodScore } : {}),
  };
}
