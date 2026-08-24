// SGIS 생활권역 통계지도 / 소상공인365 상권분석 원본(엑셀·CSV·붙여넣기 표)에서 값을 뽑아내는
// 순수 로직. 공식 API가 없어 반자동(사람이 사이트에서 조회 → 파일/표를 여기 붙여넣음) 방식만
// 가능하다(2026-08-24 조사 확인) — 그래서 이 파일은 "결정적 라벨매칭"만 한다. AI가 숫자를
// 추정/생성하지 않는다는 원칙 때문에 LLM을 쓰지 않는다.
//
// 실제 SGIS/소상공인365 원본파일 형식을 아직 못 봐서(사용자가 추후 전달 예정), 라벨 후보는
// 그럴듯한 여러 변형으로 넓게 잡았다 — 실제 파일로 테스트해보면 보정이 필요할 가능성이 높다.
// 매칭에 실패한 항목은 지어내지 않고 빈 값으로 남겨 사용자가 직접 확인/수정하게 한다.

export type FieldKind = "count" | "ratio" | "yearMonth" | "date";

export type MarketFieldSpec = {
  key: string; // CandidateInput 필드명
  displayLabel: string; // 화면 표시용 한글명
  matchLabels: string[]; // 원본에서 찾을 라벨 후보(정규화 후 부분일치)
  kind: FieldKind;
  // 2026-08-24 실제 SGIS 생활권역 통계지도 보고서 확인 후 추가 — 이 사이트는 "전체"/"남"/
  // "0~9세 인구"처럼 반경을 라벨에 안 붙이고, "반경 기준 0.5km"/"반경 기준 1km" 섹션 제목
  // 아래에 표를 반복해서 배치한다. 그래서 라벨만 봐서는 500m 값인지 1km 값인지 구분이 안 되고,
  // 섹션 문맥(radiusKm)까지 같이 봐야 한다. radiusKm이 지정된 스펙은 parsePastedTableSectioned가
  // 매긴 섹션 태그가 일치하는 후보만 매칭 대상으로 삼는다(소상공인365처럼 라벨 자체에 반경이
  // 박혀 있는 스펙은 이 필드를 안 쓴다).
  radiusKm?: number;
};

export type LabelValuePair = { label: string; value: string; radiusKm?: number | null };

export type ExtractedFieldDraft = {
  fieldKey: string;
  displayLabel: string;
  matchedLabel: string | null;
  rawValue: string | null;
  parsedValue: number | string | null;
  autoExtracted: boolean;
};

function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, "").replace(/[():：·]/g, "");
}

/** "14.1%", "1,234명", "52.3" 같은 표시 문자열에서 숫자만 뽑는다. 못 뽑으면 null(지어내지 않음). */
function parseNumberLoose(raw: string): number | null {
  const cleaned = raw.replace(/[,%명건가구원세대개]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function parseByKind(raw: string, kind: FieldKind): number | string | null {
  if (kind === "yearMonth" || kind === "date") {
    const trimmed = raw.trim();
    return trimmed === "" ? null : trimmed;
  }
  const n = parseNumberLoose(raw);
  if (n == null) return null;
  // 저장 관례(calc.ts normalizePercentLike)와 동일 — 비율은 0~1로 저장, ">1이면 %로 보고 /100.
  return kind === "ratio" ? (n > 1 ? n / 100 : n) : n;
}

/**
 * 복사한 표를 그대로 붙여넣었을 때 파싱한다. 탭 구분을 우선 시도하고, 없으면 연속 공백 2칸
 * 이상을 구분자로 본다 — 한 줄에 "라벨 값" 또는 "라벨\t값" 형태만 지원한다(원본 파일을 지원
 * 못 할 때만 쓰는 최후수단이라 스펙에 명시된 대로 단순하게 둔다).
 */
export function parsePastedTable(text: string): LabelValuePair[] {
  const pairs: LabelValuePair[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.includes("\t") ? line.split("\t") : line.split(/ {2,}/);
    const trimmedCols = cols.map((c) => c.trim()).filter((c) => c !== "");
    if (trimmedCols.length < 2) continue;
    pairs.push({ label: trimmedCols[0], value: trimmedCols[trimmedCols.length - 1] });
  }
  return pairs;
}

/**
 * SGIS 생활권역 통계지도 보고서 전용 — "반경 기준 0.5km" 같은 섹션 제목을 기준으로 그 아래
 * 표의 각 행(구분/값[/백분율]을 붙여넣은 줄)에 반경(km)을 태깅한다. 섹션 제목이 안 나오면
 * radiusKm은 null로 남는다(그 경우 radiusKm이 지정된 스펙과는 매칭되지 않는다 — 지어내지 않음).
 */
const RADIUS_SECTION_RE = /반경\s*(?:기준)?\s*([\d.]+)\s*km/i;

// "선택년도" 줄 바로 다음에 오는 "인구/가구/주택 (2024년), 사업체/종사자 (2024년)" 같은 문장형
// 텍스트에서 연도만 뽑는다 — 이 항목만 표가 아니라 문장이라 위 라벨/값 로직과 별개로 처리한다
// (2026-08-24 실사용자 붙여넣기로 확인).
const YEAR_SENTENCE_RE = /인구[\s\S]*?\((\d{4})년\)/;

/**
 * "면적" 위젯은 표가 아니라 셀 하나씩 완전히 다른 줄로 복사된다 — "구분"/"총 면적"/"값(km2)"/
 * "0.78"이 각각 독립된 줄로 나온다(2026-08-24 실사용자 붙여넣기로 확인, 반경1km 면적이 계속
 * 안 채워진다는 제보로 발견). 탭/공백 구분자가 있는 정상 행과 섞여 나오므로, 토큰이 하나뿐인
 * "외톨이" 줄들을 모아뒀다가 "구분 / 표시명 / 값(...) / 숫자" 4개 묶음을 만나면 (표시명 → 숫자)
 * 쌍으로 합친다. 그 조합이 아닌 외톨이 줄(제목·안내문구 등)은 그냥 버린다 — 지어내지 않는다.
 */
function flushLoneBuffer(buffer: string[], radiusKm: number | null, pairs: LabelValuePair[]): void {
  for (let i = 0; i + 3 < buffer.length; i += 4) {
    const [capA, name, capB, value] = buffer.slice(i, i + 4);
    if (normalizeLabel(capA) === "구분" && normalizeLabel(capB).startsWith("값")) {
      pairs.push({ label: name, value, radiusKm });
    }
  }
}

export function parsePastedTableSectioned(text: string): LabelValuePair[] {
  const pairs: LabelValuePair[] = [];
  let currentRadius: number | null = null;
  let loneBuffer: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sectionMatch = line.match(RADIUS_SECTION_RE);
    if (sectionMatch) {
      flushLoneBuffer(loneBuffer, currentRadius, pairs);
      loneBuffer = [];
      currentRadius = Number(sectionMatch[1]);
      continue;
    }
    const cols = line.includes("\t") ? line.split("\t") : line.split(/ {2,}/);
    const trimmedCols = cols.map((c) => c.trim()).filter((c) => c !== "");
    if (trimmedCols.length < 2) {
      loneBuffer.push(line);
      continue;
    }
    flushLoneBuffer(loneBuffer, currentRadius, pairs);
    loneBuffer = [];
    // 실제 보고서 표는 "구분 | 값(명) | 백분율(%)" 3열이다 — 마지막 열(백분율)을 값으로 삼으면
    // 총인구 같은 개수 항목이 죄다 "100"(퍼센트)으로 잘못 채워진다(2026-08-24 테스트로 발견).
    // 2열이면 그대로 값으로 쓰고, 3열 이상이면 "값" 열(두 번째)과 "비율" 열(마지막)을 각각
    // 별도 라벨("원라벨"/"원라벨 비율")로 둘 다 내보내 male1kmRatio처럼 비율이 필요한 스펙도
    // 찾을 수 있게 한다.
    if (trimmedCols.length === 2) {
      pairs.push({ label: trimmedCols[0], value: trimmedCols[1], radiusKm: currentRadius });
    } else {
      pairs.push({ label: trimmedCols[0], value: trimmedCols[1], radiusKm: currentRadius });
      pairs.push({ label: `${trimmedCols[0]} 비율`, value: trimmedCols[trimmedCols.length - 1], radiusKm: currentRadius });
    }
  }
  flushLoneBuffer(loneBuffer, currentRadius, pairs);

  const yearMatch = text.match(YEAR_SENTENCE_RE);
  if (yearMatch) pairs.push({ label: "상권데이터기준연도", value: yearMatch[1], radiusKm: null });

  return pairs;
}

/** 실제 라벨이 후보 문자열을 포함하면 매칭으로 본다(단방향 — 실제라벨 ⊇ 후보). 후보가 실제
 * 라벨을 포함하는 반대 방향은 보지 않는다: "남"처럼 짧은 실제 라벨이 있으면 "남비율" 같은
 * (그 라벨을 접두어로 포함하는) 후보가 엉뚱하게 같이 걸려버린다(2026-08-24 테스트로 발견 — "남
 * 비율" 후보가 "남"(원시 인원수) 행까지 잘못 집어 비율 계산이 100배 틀어졌었다).
 * spec에 radiusKm이 있으면 그 반경으로 태깅된 후보만 본다(둘 다 없으면(untagged) radiusKm 지정
 * 스펙과는 매칭 안 함 — 500m 값과 1km 값을 구분 못 하는 채로 아무거나 채우면 안 되기 때문). */
function findMatch(
  pairs: (LabelValuePair & { normLabel: string })[],
  matchLabels: string[],
  radiusKm?: number,
): (LabelValuePair & { normLabel: string }) | null {
  const candidates = matchLabels.map(normalizeLabel);
  const scoped = radiusKm == null ? pairs : pairs.filter((p) => p.radiusKm === radiusKm);
  return scoped.find((p) => candidates.some((c) => c.length > 0 && p.normLabel.includes(c))) ?? null;
}

export function extractFields(pairs: LabelValuePair[], specs: MarketFieldSpec[]): ExtractedFieldDraft[] {
  const normalized = pairs.map((p) => ({ ...p, normLabel: normalizeLabel(p.label) }));
  return specs.map((spec) => {
    const match = findMatch(normalized, spec.matchLabels, spec.radiusKm);
    if (!match) {
      return { fieldKey: spec.key, displayLabel: spec.displayLabel, matchedLabel: null, rawValue: null, parsedValue: null, autoExtracted: false };
    }
    const parsedValue = parseByKind(match.value, spec.kind);
    return {
      fieldKey: spec.key,
      displayLabel: spec.displayLabel,
      matchedLabel: match.label,
      rawValue: match.value,
      parsedValue,
      autoExtracted: parsedValue != null,
    };
  });
}

// ---- 필드 스펙 정의 ----

const AGE_BANDS: { suffix: string; label: string; matches: string[] }[] = [
  { suffix: "0_9", label: "0~9세", matches: ["0~9세", "0-9세"] },
  { suffix: "10_19", label: "10~19세", matches: ["10~19세", "10-19세"] },
  { suffix: "20_29", label: "20~29세", matches: ["20~29세", "20-29세"] },
  { suffix: "30_39", label: "30~39세", matches: ["30~39세", "30-39세"] },
  { suffix: "40_49", label: "40~49세", matches: ["40~49세", "40-49세"] },
  { suffix: "50_59", label: "50~59세", matches: ["50~59세", "50-59세"] },
  { suffix: "60_69", label: "60~69세", matches: ["60~69세", "60-69세"] },
  { suffix: "70_79", label: "70~79세", matches: ["70~79세", "70-79세"] },
  { suffix: "80plus", label: "80세이상", matches: ["80세이상", "80세+", "80대이상"] },
];

const FLOATING_DECADE_BANDS: { suffix: string; label: string; matches: string[] }[] = [
  { suffix: "10s", label: "10대", matches: ["10대"] },
  { suffix: "20s", label: "20대", matches: ["20대"] },
  { suffix: "30s", label: "30대", matches: ["30대"] },
  { suffix: "40s", label: "40대", matches: ["40대"] },
  { suffix: "50s", label: "50대", matches: ["50대"] },
  { suffix: "60plus", label: "60대이상", matches: ["60대이상", "60대+"] },
];

// 2026-08-24 — 실제 SGIS 생활권역 통계지도 보고서(sgis.kostat.go.kr/view/catchmentArea/main)를
// 직접 조회해 확인한 라벨 그대로다: "반경 기준 0.5km"/"반경 기준 1km" 섹션 아래 "구분/값(/백분율)"
// 표에 "전체"/"남"/"여"/"0~9세 인구"/"총면적" 같은 짧은 라벨만 나온다(반경이 라벨에 안 붙음).
// 그래서 parsePastedTableSectioned로 섹션을 태깅해야만 500m/1km를 구분할 수 있다 — radiusKm 없이
// "전체"/"남" 같은 짧은 라벨만으로 매칭하면 엉뚱한 표(가구/주택 합계 등)나 다른 반경 값을 잘못
// 가져올 위험이 커서, 이 파일에서 로직으로 강제한다(findMatch가 radiusKm 불일치·미태깅 후보는
// 아예 안 봄).
export const SGIS_FIELD_SPECS: MarketFieldSpec[] = [
  {
    key: "pop500m",
    displayLabel: "반경500m 총인구(거주)",
    matchLabels: ["전체", "총인구"],
    kind: "count",
    radiusKm: 0.5,
  },
  {
    key: "area1kmKm2",
    displayLabel: "반경1km 면적(㎢)",
    matchLabels: ["총면적", "조회면적"],
    kind: "count",
    radiusKm: 1,
  },
  {
    key: "pop1km",
    displayLabel: "반경1km 총인구",
    matchLabels: ["전체", "총인구"],
    kind: "count",
    radiusKm: 1,
  },
  {
    key: "male1kmRatio",
    displayLabel: "반경1km 남성비율",
    // "인구(성별)" 표는 "남 | 3,674 | 48.0"(구분/값/백분율) 3열이라, parsePastedTableSectioned가
    // "남 비율" 라벨로 백분율(48.0) 열을 따로 내보낸다 — kind:"ratio"가 그 값을 /100 처리한다.
    matchLabels: ["남비율"],
    kind: "ratio",
    radiusKm: 1,
  },
  ...AGE_BANDS.map((b) => ({
    key: `age1km_${b.suffix}`,
    displayLabel: `1km ${b.label}`,
    matchLabels: b.matches,
    kind: "count" as const,
    radiusKm: 1,
  })),
  {
    key: "demographicsYear",
    displayLabel: "상권데이터기준연도",
    // 보고서엔 "선택년도: 인구/가구/주택 (2024년)" 식 문장으로만 나와 표 형태가 아니다 —
    // 이 항목은 자동매칭 기대하지 말고 사용자가 직접 입력하는 게 안전하다(지어내지 않음).
    matchLabels: ["상권데이터기준연도", "통계기준연도", "데이터기준연도"],
    kind: "count",
  },
];

// ---- 소상공인365 상세분석 리포트 (2026-08-24 실제 사이트 확인 후 전면 재설계) ----
//
// SGIS와 완전히 다른 표 구조였다: 라벨:값 한 줄짜리가 아니라 "지역 × 성별/연령대"(또는
// "지역 × 기간") 매트릭스 표다 — 한 행에 여러 숫자가 쭉 나열된다. 게다가:
//   - 한 리포트가 반경 하나만 다룬다(SGIS처럼 500m+1km가 같이 안 나옴 — 500m/1km를 각각 따로
//     조회해야 하고, 붙여넣은 텍스트만 봐서는 어느 반경인지 알 수 없다 → 사용자가 직접 골라야 함).
//   - "유동인구"와 "직장인구" 표가 서로 모양이 완전히 똑같다(둘 다 "선택 영역 | 인구 | 전체 |
//     남성 | 여성 | 10대...60대이상") → 텍스트만 봐서는 어느 표인지 구분이 안 됨 → 사용자가 직접
//     "지금 붙여넣는 게 어느 표인지" 골라야 함.
// 그래서 라벨 매칭만으로 전부 자동판별하는 대신, 사용자가 (반경, 표 종류)를 먼저 고르면 그에 맞는
// 파서+필드스펙을 골라 쓰는 방식으로 바꿨다.
//
// 확인 안 된 것(이번 재설계 범위 밖, 자동추출 대상에서 제외 — 그냥 수동 입력으로 남겨둠):
//   - "지하철역/버스정류장 개수"(교통시설 현황(시군구 기준))는 매칭 안 함 — "지하철 승하차 인원"
//     ("지하철 이용 현황" 표, 역이 있는 후보지로 실사용자가 확인해준 원문으로 구현함)만 매칭한다.
//   - 초/중/고등학생 수는 "학교시설(학교수/학생수)" 표에서 확인해 자동추출함(아래 참고).
//   - 상권_기준연월/업소수_기준시점은 문장형 텍스트라 표가 아니다(사용자 직접 입력 전용).
//   - 소상공인365 "업소수"는 등록 사업체 집계 성격이라 "인허가" 쪽에 대응시킨다(사용자 확인,
//     2026-08-24 5차). "실영업"은 네이버 로드뷰 등으로 실제 영업 여부를 사용자가 직접 확인해서
//     넣는 값이라 자동추출 대상이 아니다 — 500m/1km 둘 다.

// 2026-08-24 (5차) — 실제 리포트(강원 춘천시 석사동)로 확인: 유동인구 표는 "10대"부터 있지만
// 직장인구 표는 "20대"부터 시작한다(10세 미만 직장인이 없으니 당연함) — 그래서 두 표의 값 개수가
// 다르다(유동인구: 전체+8분류=9칸, 직장인구: 전체+7분류=8칸). 같은 8칸이라고 유동인구용 8분류
// 표(전체 없이 8분류만)로 잘못 해석하면 "전체" 항목이 아예 안 잡히고 남은 값도 한 칸씩 밀려서
// 다 틀어진다 — 그래서 표 종류별로 분류 목록을 따로 둔다.
const SB365_DEMO_CATEGORIES: { key: string; matches: string[] }[] = [
  { key: "남성", matches: ["남성"] },
  { key: "여성", matches: ["여성"] },
  { key: "10대", matches: ["10대"] },
  { key: "20대", matches: ["20대"] },
  { key: "30대", matches: ["30대"] },
  { key: "40대", matches: ["40대"] },
  { key: "50대", matches: ["50대"] },
  { key: "60대이상", matches: ["60대이상", "60대+"] },
];

const SB365_EMPLOY_CATEGORIES: { key: string; matches: string[] }[] = [
  { key: "남성", matches: ["남성"] },
  { key: "여성", matches: ["여성"] },
  { key: "20대", matches: ["20대"] },
  { key: "30대", matches: ["30대"] },
  { key: "40대", matches: ["40대"] },
  { key: "50대", matches: ["50대"] },
  { key: "60대이상", matches: ["60대이상", "60대+"] },
];

function isNumericToken(t: string): boolean {
  return parseNumberLoose(t) != null;
}

function tokenizeMatrixLine(line: string): string[] {
  const cols = line.includes("\t") ? line.split("\t") : line.split(/ {2,}/);
  return cols.map((c) => c.trim()).filter((c) => c !== "");
}

/** 라벨(선행 비숫자 토큰들)과 값(후행 숫자 토큰들)을 한 줄에서 분리한다. */
function splitLabelAndValues(tokens: string[]): { label: string; values: string[] } {
  let splitIdx = tokens.length;
  while (splitIdx > 0 && isNumericToken(tokens[splitIdx - 1])) splitIdx--;
  return { label: tokens.slice(0, splitIdx).join(" "), values: tokens.slice(splitIdx) };
}

/**
 * "성별/연령대별 일평균 유동인구"/"성별/연령대별 직장인구" 표 전용. 표 모양(선택 영역 | 인구 |
 * 전체 | 남성 | 여성 | 연령대...)은 같지만 **연령대 목록이 다르다**(유동인구는 10대부터,
 * 직장인구는 20대부터 — 미성년 직장인이 없어서 칸 수 자체가 하나 적다) — 그래서 어느 표인지에
 * 따라 categories를 다르게 넘겨야 한다(기본값은 유동인구 기준). 비교 지역(소공동/중구 등) 행과
 * "비율"/"증감률" 행은 무시하고 우리 후보지("선택 영역")의 인원수 행만 본다.
 */
export function parseSosangongin365DemographicRow(
  text: string,
  categories: { key: string; matches: string[] }[] = SB365_DEMO_CATEGORIES
): LabelValuePair[] {
  const pairs: LabelValuePair[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const tokens = tokenizeMatrixLine(line);
    if (tokens.length < 2) continue;
    const { label, values } = splitLabelAndValues(tokens);
    const normLabel = normalizeLabel(label);
    if (!normLabel.includes("선택영역")) continue; // 소공동/중구 등 비교 지역은 우리 후보지가 아니다
    if (normLabel.includes("비율") || normLabel.includes("증감률")) continue;
    if (values.length === categories.length + 1) {
      pairs.push({ label: "전체", value: values[0] });
      categories.forEach((cat, i) => pairs.push({ label: cat.key, value: values[i + 1] }));
    } else if (values.length === categories.length) {
      categories.forEach((cat, i) => pairs.push({ label: cat.key, value: values[i] }));
    }
  }
  return pairs;
}

/**
 * "세대 수 추이"/"업소수 추이"처럼 "선택 영역"(+선택적으로 "업소수" 같은 라벨) 뒤에 기간별
 * 숫자가 쭉 나오는 시계열 표 — 가장 최근(마지막) 값만 쓴다. rowLabelHint를 주면 그 문자열이
 * 행 라벨에 포함될 때만 인정한다("업소수"를 지정하면 세대수 표와 안 섞인다 — 세대수 표는
 * "선택 영역" 라벨만 단독으로 온다).
 */
export function parseSosangongin365TrendLatest(text: string, rowLabelHint?: string): number | null {
  const hintNorm = rowLabelHint ? normalizeLabel(rowLabelHint) : null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const tokens = tokenizeMatrixLine(line);
    if (tokens.length < 2) continue;
    const { label, values } = splitLabelAndValues(tokens);
    const normLabel = normalizeLabel(label);
    if (!normLabel.includes("선택영역")) continue;
    if (normLabel.includes("증감률")) continue;
    if (hintNorm ? !normLabel.includes(hintNorm) : normLabel !== "선택영역") continue;
    if (values.length === 0) continue;
    return parseNumberLoose(values[values.length - 1]);
  }
  return null;
}

function floatingSpecs(radiusKey: "500" | "1km", displayRadius: string): MarketFieldSpec[] {
  const prefix = radiusKey === "500" ? "floating500" : "floating1km";
  return [
    { key: `${prefix}Avg`, displayLabel: `유동인구 평균(${displayRadius})`, matchLabels: ["유동인구:전체"], kind: "count" },
    { key: `${prefix}Male`, displayLabel: `유동인구 남(${displayRadius})`, matchLabels: ["유동인구:남성"], kind: "count" },
    { key: `${prefix}Female`, displayLabel: `유동인구 여(${displayRadius})`, matchLabels: ["유동인구:여성"], kind: "count" },
    ...FLOATING_DECADE_BANDS.map((b) => ({
      key: `${prefix}_${b.suffix}`,
      displayLabel: `유동 ${b.label}(${displayRadius})`,
      matchLabels: b.matches.map((m) => `유동인구:${m}`),
      kind: "count" as const,
    })),
  ];
}

function employSpecs(radiusKey: "500" | "1km", displayRadius: string): MarketFieldSpec[] {
  const prefix = radiusKey === "500" ? "employ500" : "employ1km";
  return [
    { key: `${prefix}Total`, displayLabel: `직장인구 전체(${displayRadius})`, matchLabels: ["직장인구:전체"], kind: "count" },
    { key: `${prefix}Male`, displayLabel: `직장인구 남(${displayRadius})`, matchLabels: ["직장인구:남성"], kind: "count" },
    { key: `${prefix}Female`, displayLabel: `직장인구 여(${displayRadius})`, matchLabels: ["직장인구:여성"], kind: "count" },
  ];
}

function householdsSpec(radiusKey: "500" | "1km", displayRadius: string): MarketFieldSpec[] {
  return [
    {
      key: radiusKey === "500" ? "facility500Households" : "facility1kmHouseholds",
      displayLabel: `세대수(${displayRadius})`,
      matchLabels: ["세대수"],
      kind: "count",
    },
  ];
}

function pcStoreSpec(radiusKey: "500" | "1km", displayRadius: string): MarketFieldSpec[] {
  // 2026-08-24 (5차) — 사용자 확인: 소상공인365 "업소수"는 등록된 사업체 집계 성격이라 "인허가"
  // 쪽에 대응시켜야 맞다("실영업"은 네이버 로드뷰로 실제 영업 중인지 사용자가 직접 확인해서 넣는
  // 값 — 500m은 V62 공식(computeCompetitorIp)의 핵심값이기도 해서 자동 덮어쓰면 안 됨). 그래서
  // "실영업 PC방업소수"는 이 자동추출 대상에서 빼고(500m/1km 둘 다), "인허가"만 자동추출한다.
  return [
    {
      key: radiusKey === "500" ? "licensedPcStores500m" : "licensedPcStores1km",
      displayLabel: `인허가 PC방업소수(${displayRadius})`,
      matchLabels: ["업소수"],
      kind: "count",
    },
  ];
}

// 2026-08-24 (5차) — 실제 리포트의 "학교시설 (학교수/학생수)" 표에서 확인: 대학교/고등학교/
// 중학교/초등학교/유치원 5개 컬럼 순서. CandidateInput엔 고등/중/초등학생 수 필드만 있어(대학교·
// 유치원 대응 필드 없음) 그 3개만 spec으로 노출한다.
const SB365_SCHOOL_CATEGORIES: { key: string; matches: string[] }[] = [
  { key: "대학교", matches: ["대학교"] },
  { key: "고등학교", matches: ["고등학교"] },
  { key: "중학교", matches: ["중학교"] },
  { key: "초등학교", matches: ["초등학교"] },
  { key: "유치원", matches: ["유치원"] },
];

function facilitySchoolSpecs(radiusKey: "500" | "1km", displayRadius: string): MarketFieldSpec[] {
  const prefix = radiusKey === "500" ? "facility500" : "facility1km";
  return [
    { key: `${prefix}HighSchool`, displayLabel: `고등학생 수(${displayRadius})`, matchLabels: ["학교시설:고등학교"], kind: "count" },
    { key: `${prefix}MiddleSchool`, displayLabel: `중학생 수(${displayRadius})`, matchLabels: ["학교시설:중학교"], kind: "count" },
    {
      key: `${prefix}ElementarySchool`,
      displayLabel: `초등학생 수(${displayRadius})`,
      matchLabels: ["학교시설:초등학교"],
      kind: "count",
    },
  ];
}

// 2026-08-24 (5차) — 인천 남동구 논현2동(지하철역 있는 실제 후보지) 리포트로 확인: "지하철 이용
// 현황" 표만 다른 표와 완전히 다른 모양이다 — "선택 영역" 표기가 아예 없고, 노선명+역명이 라벨로
// 나오고("수인선 호구포역"), 그 뒤로 최근 3개년 승하차 인원이 이어진다. 반경 안에 역이 여러 개면
// 행이 여러 줄 나올 수 있어(안 겪어봤지만 구조상 가능) 전부 더한다. 최신 연도(마지막 칸)만 쓴다.
function facilitySubwaySpecs(radiusKey: "500" | "1km", displayRadius: string): MarketFieldSpec[] {
  return [
    {
      key: radiusKey === "500" ? "facility500SubwayRiders" : "facility1kmSubwayRiders",
      displayLabel: `지하철 승하차(${displayRadius})`,
      matchLabels: ["지하철승하차"],
      kind: "count",
    },
  ];
}

// 2026-08-24 — 사용자 제안으로 재설계: "표 종류"를 매번 고르지 말고 "반경 500m 설정 > 분석하기 >
// 전체 복사 후 붙여넣기 / 반경 1km 설정 > 전체 복사 후 붙여넣기" 두 번만 하면 되도록 바꿨다.
// 유동인구/직장인구 표는 행 모양이 똑같아 구분이 안 됐지만, 리포트 전체를 복사하면 각 표 앞에
// 실제 소제목("성별/연령대별 일평균 유동인구" / "성별/연령대별 직장인구" / "세대 수 추이" /
// "업소수 추이")이 함께 딸려온다 — 이 소제목을 섹션 마커로 삼아 SGIS의 "반경 기준 Xkm" 처리와
// 같은 방식으로 어느 표인지 자동 판별한다. 소제목이 지나간 뒤에 나오는 "선택 영역" 행만 그 표의
// 데이터로 취급하므로, 표 종류 선택 버튼 자체가 필요 없어졌다(반경 선택만 남는다).
type Sb365Table = "유동인구" | "직장인구" | "세대수" | "업소수" | "학교시설" | "지하철";

const SB365_SECTION_MARKERS: { re: RegExp; table: Sb365Table }[] = [
  { re: /성별\s*\/?\s*연령대별[\s\S]{0,10}유동인구/, table: "유동인구" },
  { re: /성별\s*\/?\s*연령대별[\s\S]{0,10}직장인구/, table: "직장인구" },
  { re: /세대\s*수[\s\S]{0,6}추이/, table: "세대수" },
  { re: /업소수[\s\S]{0,6}추이/, table: "업소수" },
  { re: /학교시설\s*\(\s*학교수\s*\/\s*학생수\s*\)/, table: "학교시설" },
  { re: /지하철\s*이용\s*현황/, table: "지하철" },
];

/**
 * 500m 또는 1km로 반경을 맞춘 뒤 소상공인365 상세분석 리포트 페이지 전체를 Ctrl+A로 복사해
 * 붙여넣은 텍스트에서 유동인구/직장인구/세대수/업소수 4개 표를 한 번에 뽑아낸다. 표 종류는
 * SB365_SECTION_MARKERS로 만난 소제목으로 판별하고, 그 표의 라벨엔 "유동인구:"/"직장인구:"
 * 접두어를 붙여 이후 floatingSpecs/employSpecs의 matchLabels와 짝을 맞춘다.
 */
export function parseSosangongin365FullReport(text: string): LabelValuePair[] {
  const pairs: LabelValuePair[] = [];
  let currentTable: Sb365Table | null = null;
  // "학교시설" 표만 "선택 영역 | 학교수 | ..." 행 바로 다음 줄에 라벨 없이 "학생수 | ..."만 이어지는
  // 특수 구조라(우리가 원하는 건 학교수가 아니라 학생수 행이다) 별도 상태로 다음 줄을 기다린다.
  let awaitingSchoolStudentRow = false;
  // "지하철" 표는 "선택 영역" 표기가 아예 없고 노선명+역명이 라벨로 나온다 — 반경 안에 역이
  // 여러 개면 행이 여러 줄이라(다 더해야 함) 한 줄 보고 바로 currentTable을 안 비운다.
  let subwayRidersSum: number | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const marker = SB365_SECTION_MARKERS.find((m) => m.re.test(line));
    if (marker) {
      currentTable = marker.table;
      awaitingSchoolStudentRow = false;
      continue;
    }
    if (!currentTable) continue; // 표 소제목을 아직 못 만났으면(안내문 등) 건너뛴다
    const tokens = tokenizeMatrixLine(line);
    if (tokens.length < 2) continue;
    const { label, values } = splitLabelAndValues(tokens);
    const normLabel = normalizeLabel(label);

    if (currentTable === "지하철") {
      // "노선명 역명 | 2023년값 2024년값 2025년값" 모양의 역 데이터 행만 받는다(라벨이 정확히
      // 두 토큰) — 안내문·표 헤더·연도행("2023 2024 2025")은 토큰 수가 안 맞아 자연히 무시된다.
      // "선택 영역"도 공백이 하나 있어 우연히 "두 토큰"이 되는데, 이건 뒤에 이어지는 "교통시설
      // 현황(시군구 기준)" 표("선택 영역 | 1 | 22")라 명시적으로 제외해야 한다(실측 중 발견한
      // 버그: 제외 안 하면 역 개수까지 승하차 인원에 더해져 버림).
      const labelTokens = label.split(" ").filter(Boolean);
      if (labelTokens.length === 2 && !normLabel.includes("선택영역") && values.length >= 2) {
        const latest = parseNumberLoose(values[values.length - 1]);
        if (latest != null) subwayRidersSum = (subwayRidersSum ?? 0) + latest;
      }
      continue;
    }

    if (currentTable === "학교시설" && awaitingSchoolStudentRow) {
      // "선택 영역"이 안 붙어있는 계속행이라 일반 필터를 우회해서 봐야 한다.
      awaitingSchoolStudentRow = false;
      currentTable = null;
      if (normLabel === "학생수" && values.length === SB365_SCHOOL_CATEGORIES.length) {
        SB365_SCHOOL_CATEGORIES.forEach((cat, i) => pairs.push({ label: `학교시설:${cat.key}`, value: values[i] }));
      }
      continue;
    }

    if (!normLabel.includes("선택영역")) continue; // 비교 지역 행은 우리 후보지가 아니다
    if (normLabel.includes("비율") || normLabel.includes("증감률")) continue;

    if (currentTable === "학교시설") {
      // "선택 영역 | 학교수 | ..." 행 자체엔 학교 '개수'만 있다 — 다음 줄의 학생수를 기다린다.
      if (normLabel.includes("학교수")) awaitingSchoolStudentRow = true;
      else currentTable = null; // 예상과 다른 행이면 안전하게 포기(지어내지 않음)
      continue;
    }

    // 표마다 우리가 볼 "선택 영역" 데이터 행은 정확히 하나뿐이다(그 아래 "비율"/"증감률" 계속행,
    // 다른 지역 비교행은 이미 위에서 걸러짐). 그 한 줄을 찾으면 즉시 currentTable을 비워서, 다음
    // 소제목(마커)을 만나기 전까지 나오는 전혀 무관한 표(공동주택/교통시설 등)의 "선택 영역" 행이
    // 같은 표로 계속 잘못 누적되는 걸 막는다 — 실사용자 리포트(세대수 1km)에서 세대수 표 뒤로
    // 마커 없는 표가 여러 개 이어져 값이 계속 덮어써지던 버그를 이렇게 재현/수정했다.
    const table = currentTable;
    currentTable = null;
    if (table === "유동인구" || table === "직장인구") {
      // 유동인구는 10대부터, 직장인구는 20대부터라 분류 개수(따라서 값 칸 수)가 다르다.
      const categories = table === "직장인구" ? SB365_EMPLOY_CATEGORIES : SB365_DEMO_CATEGORIES;
      if (values.length === categories.length + 1) {
        pairs.push({ label: `${table}:전체`, value: values[0] });
        categories.forEach((cat, i) => pairs.push({ label: `${table}:${cat.key}`, value: values[i + 1] }));
      } else if (values.length === categories.length) {
        categories.forEach((cat, i) => pairs.push({ label: `${table}:${cat.key}`, value: values[i] }));
      }
    } else if (table) {
      // 세대수/업소수: "선택 영역 | (업소수) | 기간별 숫자..." 시계열의 마지막(최신) 값만 쓴다
      if (values.length > 0) pairs.push({ label: table, value: values[values.length - 1] });
    }
  }
  if (subwayRidersSum != null) pairs.push({ label: "지하철승하차", value: String(subwayRidersSum) });
  return pairs;
}

export type Sosangongin365TableVariant = {
  key: "전체";
  label: string;
  buildSpecs: (radiusKey: "500" | "1km", displayRadius: string) => MarketFieldSpec[];
  extract: (text: string) => LabelValuePair[];
};

// 표 종류 선택 버튼 없이 반경만 고르면 되도록 단일 항목으로 둔다(MarketDataUploadPanel은
// tableVariants.length === 1이면 표 종류 버튼 자체를 숨긴다).
export const SOSANGONGIN365_TABLE_VARIANTS: Sosangongin365TableVariant[] = [
  {
    key: "전체",
    label: "상권분석 리포트 전체",
    buildSpecs: (radiusKey, displayRadius) => [
      ...floatingSpecs(radiusKey, displayRadius),
      ...employSpecs(radiusKey, displayRadius),
      ...householdsSpec(radiusKey, displayRadius),
      ...pcStoreSpec(radiusKey, displayRadius),
      ...facilitySchoolSpecs(radiusKey, displayRadius),
      ...facilitySubwaySpecs(radiusKey, displayRadius),
    ],
    extract: parseSosangongin365FullReport,
  },
];
