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
};

export type LabelValuePair = { label: string; value: string };

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

/** 라벨 후보 중 하나라도 (정규화 후) 서로 포함관계면 매칭으로 본다. */
function findMatch(pairs: (LabelValuePair & { normLabel: string })[], matchLabels: string[]): (LabelValuePair & { normLabel: string }) | null {
  const candidates = matchLabels.map(normalizeLabel);
  return (
    pairs.find((p) => candidates.some((c) => c.length > 0 && (p.normLabel.includes(c) || c.includes(p.normLabel)))) ?? null
  );
}

export function extractFields(pairs: LabelValuePair[], specs: MarketFieldSpec[]): ExtractedFieldDraft[] {
  const normalized = pairs.map((p) => ({ ...p, normLabel: normalizeLabel(p.label) }));
  return specs.map((spec) => {
    const match = findMatch(normalized, spec.matchLabels);
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

export const SGIS_FIELD_SPECS: MarketFieldSpec[] = [
  {
    key: "pop500m",
    displayLabel: "반경500m 총인구(거주)",
    matchLabels: ["반경500m총인구", "500m총인구", "500m거주인구", "반경500m인구"],
    kind: "count",
  },
  {
    key: "area1kmKm2",
    displayLabel: "반경1km 면적(㎢)",
    matchLabels: ["반경1km조회면적", "1km조회면적", "1km면적", "조회면적"],
    kind: "count",
  },
  {
    key: "pop1km",
    displayLabel: "반경1km 총인구",
    matchLabels: ["반경1km총인구", "1km총인구", "1km거주인구"],
    kind: "count",
  },
  {
    key: "male1kmRatio",
    displayLabel: "반경1km 남성비율",
    matchLabels: ["1km남성비율", "남성비율", "남자비율"],
    kind: "ratio",
  },
  ...AGE_BANDS.map((b) => ({
    key: `age1km_${b.suffix}`,
    displayLabel: `1km ${b.label}`,
    matchLabels: b.matches,
    kind: "count" as const,
  })),
  {
    key: "demographicsYear",
    displayLabel: "상권데이터기준연도",
    matchLabels: ["상권데이터기준연도", "기준연도", "통계기준연도", "데이터기준연도"],
    kind: "count",
  },
];

function floatingSpecs(radiusKey: "500" | "1km", displayRadius: string): MarketFieldSpec[] {
  const prefix = radiusKey === "500" ? "floating500" : "floating1km";
  const matchRadiusTokens = radiusKey === "500" ? ["500m", "500"] : ["1km", "1000m", "1000"];
  // 반경 토큰(500m/1km 등)을 반드시 붙여서만 후보로 삼는다 — bare 라벨까지 후보에 넣으면 500m
  // 항목과 1km 항목이 서로의 값을 가로채는 오매칭이 생긴다(2026-08-24 테스트로 발견/수정).
  const withRadius = (base: string[]) => base.flatMap((m) => matchRadiusTokens.map((r) => `${m}${r}`));
  return [
    {
      key: `${prefix}Avg`,
      displayLabel: `유동인구 평균(${displayRadius})`,
      matchLabels: withRadius(["유동인구일평균", "일평균유동인구", "유동인구평균"]),
      kind: "count",
    },
    {
      key: `${prefix}Male`,
      displayLabel: `유동인구 남(${displayRadius})`,
      matchLabels: withRadius(["유동인구남성", "유동인구남"]),
      kind: "count",
    },
    {
      key: `${prefix}Female`,
      displayLabel: `유동인구 여(${displayRadius})`,
      matchLabels: withRadius(["유동인구여성", "유동인구여"]),
      kind: "count",
    },
    ...FLOATING_DECADE_BANDS.map((b) => ({
      key: `${prefix}_${b.suffix}`,
      displayLabel: `유동 ${b.label}(${displayRadius})`,
      matchLabels: withRadius(b.matches.map((m) => `유동인구${m}`)),
      kind: "count" as const,
    })),
  ];
}

function employSpecs(radiusKey: "500" | "1km", displayRadius: string): MarketFieldSpec[] {
  const prefix = radiusKey === "500" ? "employ500" : "employ1km";
  const matchRadiusTokens = radiusKey === "500" ? ["500m", "500"] : ["1km", "1000m", "1000"];
  // 반경 토큰(500m/1km 등)을 반드시 붙여서만 후보로 삼는다 — bare 라벨까지 후보에 넣으면 500m
  // 항목과 1km 항목이 서로의 값을 가로채는 오매칭이 생긴다(2026-08-24 테스트로 발견/수정).
  const withRadius = (base: string[]) => base.flatMap((m) => matchRadiusTokens.map((r) => `${m}${r}`));
  return [
    { key: `${prefix}Total`, displayLabel: `직장인구 전체(${displayRadius})`, matchLabels: withRadius(["직장인구전체", "직장인구"]), kind: "count" },
    { key: `${prefix}Male`, displayLabel: `직장인구 남(${displayRadius})`, matchLabels: withRadius(["직장인구남성", "직장인구남"]), kind: "count" },
    { key: `${prefix}Female`, displayLabel: `직장인구 여(${displayRadius})`, matchLabels: withRadius(["직장인구여성", "직장인구여"]), kind: "count" },
  ];
}

function facilitySpecs(radiusKey: "500" | "1km", displayRadius: string): MarketFieldSpec[] {
  const prefix = radiusKey === "500" ? "facility500" : "facility1km";
  const matchRadiusTokens = radiusKey === "500" ? ["500m", "500"] : ["1km", "1000m", "1000"];
  // 반경 토큰(500m/1km 등)을 반드시 붙여서만 후보로 삼는다 — bare 라벨까지 후보에 넣으면 500m
  // 항목과 1km 항목이 서로의 값을 가로채는 오매칭이 생긴다(2026-08-24 테스트로 발견/수정).
  const withRadius = (base: string[]) => base.flatMap((m) => matchRadiusTokens.map((r) => `${m}${r}`));
  return [
    { key: `${prefix}HighSchool`, displayLabel: `고등학생 수(${displayRadius})`, matchLabels: withRadius(["고등학생수", "고등학생"]), kind: "count" },
    { key: `${prefix}MiddleSchool`, displayLabel: `중학생 수(${displayRadius})`, matchLabels: withRadius(["중학생수", "중학생"]), kind: "count" },
    { key: `${prefix}ElementarySchool`, displayLabel: `초등학생 수(${displayRadius})`, matchLabels: withRadius(["초등학생수", "초등학생"]), kind: "count" },
    { key: `${prefix}SubwayRiders`, displayLabel: `지하철 승하차(${displayRadius})`, matchLabels: withRadius(["지하철승하차인원", "지하철승하차", "지하철이용객"]), kind: "count" },
    { key: `${prefix}Households`, displayLabel: `세대수(${displayRadius})`, matchLabels: withRadius(["세대수"]), kind: "count" },
  ];
}

export const SOSANGONGIN365_FIELD_SPECS: MarketFieldSpec[] = [
  { key: "commercialDataYearMonth", displayLabel: "상권_기준연월", matchLabels: ["상권기준연월", "기준연월", "데이터기준월"], kind: "yearMonth" },
  { key: "businessCountAsOfDate", displayLabel: "업소수_기준시점", matchLabels: ["업소수기준시점", "업소기준일", "업종기준일"], kind: "date" },
  { key: "licensedPcStores500m", displayLabel: "인허가 PC방업소수(500m)", matchLabels: ["인허가PC방업소수500m", "인허가PC방업소수", "PC방인허가업소수"], kind: "count" },
  { key: "operatingPcStores500m", displayLabel: "실영업 PC방업소수(500m)", matchLabels: ["실영업PC방업소수500m", "실영업PC방업소수", "PC방실영업업소수"], kind: "count" },
  { key: "licensedPcStores1km", displayLabel: "인허가 PC방업소수(1km)", matchLabels: ["인허가PC방업소수1km", "인허가PC방업소수1000m"], kind: "count" },
  { key: "operatingPcStores1km", displayLabel: "실영업 PC방업소수(1km)", matchLabels: ["실영업PC방업소수1km", "실영업PC방업소수1000m"], kind: "count" },
  ...floatingSpecs("500", "500m"),
  ...floatingSpecs("1km", "1km"),
  ...employSpecs("500", "500m"),
  ...employSpecs("1km", "1km"),
  ...facilitySpecs("500", "500m"),
  ...facilitySpecs("1km", "1km"),
];
