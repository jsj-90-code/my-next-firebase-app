import { describe, expect, it } from "vitest";
import {
  extractFields,
  parsePastedTable,
  parsePastedTableSectioned,
  parseSosangongin365DemographicRow,
  parseSosangongin365FullReport,
  parseSosangongin365TrendLatest,
  SGIS_FIELD_SPECS,
  SOSANGONGIN365_TABLE_VARIANTS,
} from "./marketDataExtract";

// 2026-08-24 — sgis.kostat.go.kr/view/catchmentArea/main에서 실제 지점(대전광역시청새마을금고,
// 반경 0.5km+1km)으로 보고서를 뽑아 그대로 옮긴 실측 데이터. 섹션 제목 아래 "구분/값(/백분율)"
// 형태로 반경이 라벨에 안 붙어 있는 게 실제 레이아웃이다 — 이 문자열이 "표를 복사해 붙여넣기"의
// 정답 시나리오다.
const REAL_SGIS_REPORT_EXCERPT = `
반경 기준 0.5km - 면적
구분	값(km²)
총면적	0.78

- 인구(나이)
구분	값(명)	백분율(%)
전체	7,656	100
0~9세 인구	390	5.1
10~19세 인구	678	8.9
20~29세 인구	1,177	15.4
30~39세 인구	1,312	17.1
40~49세 인구	1,226	16.0
50~59세 인구	1,363	17.8
60~69세 인구	991	12.9
70~79세 인구	319	4.2
80세 이상 인구	199	2.6

- 인구(성별)
구분	값(명)	백분율(%)
전체	7,656	100
남	3,674	48.0
여	3,980	52.0

반경 기준 1km - 면적
구분	값(km²)
총면적	3.05

- 인구(나이)
구분	값(명)	백분율(%)
전체	29,540	100
0~9세 인구	1,450	4.9
10~19세 인구	2,610	8.8
20~29세 인구	4,520	15.3
30~39세 인구	5,010	17.0
40~49세 인구	4,730	16.0
50~59세 인구	5,230	17.7
60~69세 인구	3,780	12.8
70~79세 인구	1,320	4.5
80세 이상 인구	890	3.0

- 인구(성별)
구분	값(명)	백분율(%)
전체	29,540	100
남	14,300	48.4
여	15,240	51.6
`;

// 2026-08-24 — 사용자가 실제로 "보고서" 화면에서 Ctrl+A로 전체 선택해 붙여넣은 텍스트를 그대로
// 옮긴 것(장소만 다름 — 주안내과의원). "면적" 위젯이 표가 아니라 셀 하나씩 완전히 다른 줄로
// 나온다는 게 이걸로 밝혀졌다("구분"/"총 면적"/"값(km2)"/"0.78"이 각각 독립된 줄) — 반경1km
// 면적이 하나도 안 채워진다는 제보로 발견/수정. 가구·주택·사업체·종사자 잡음과 1km 구간의
// 표 중복까지 실제 그대로 포함한다.
const REAL_SGIS_FULL_PASTE = `보고서

PDF

인쇄

닫기
SGIS 오픈플랫폼
통계지리정보서비스 (https://sgis.mods.go.kr)
작성일자 :
2026년 08월 24일 15시 21분
생활권역 통계지도
선택지점
주안내과의원
선택범위
반경 기준 0.5km 1km
선택년도
인구/가구/주택 (2024년), 사업체/종사자 (2024년)
지도 시각화 화면

반경 기준 0.5km - 면적
구분
총 면적
값(km2)
0.78
* 항목별 부분 합계값과 전체 합계값은 기초자료를 기반으로 비밀보호기법을 적용하여 제공하고 있습니다.
    따라서, 부분 합계의 총합이 전체 합계값과 일치하지 않을 수 있습니다.

- 인구(나이)

구분	값(명)	백분율(%)
전체	19,099	100
0~9세 인구	1,167	6.1
10~19세 인구	2,473	12.9
20~29세 인구	2,070	10.8
30~39세 인구	1,908	10.0
40~49세 인구	3,072	16.1
50~59세 인구	3,739	19.6
60~69세 인구	2,513	13.2
70~79세 인구	1,333	7.0
80세 이상 인구	823	4.3
- 인구(성별)

구분	값(명)	백분율(%)
전체	19,099	100
남	9,080	47.5
여	10,017	52.4
- 가구

구분	값(가구)	백분율(%)
전체	8,146	100
친족 가구	5,543	68.0
1인 가구	2,513	30.8
비친족 가구	96	1.2
반경 기준 1km - 면적
구분
총 면적
값(km2)
3.14
* 항목별 부분 합계값과 전체 합계값은 기초자료를 기반으로 비밀보호기법을 적용하여 제공하고 있습니다.
    따라서, 부분 합계의 총합이 전체 합계값과 일치하지 않을 수 있습니다.

- 인구(나이)

구분	값(명)	백분율(%)
전체	40,645	100
0~9세 인구	2,397	5.9
10~19세 인구	4,686	11.5
20~29세 인구	4,760	11.7
30~39세 인구	4,287	10.5
40~49세 인구	6,268	15.4
50~59세 인구	7,718	19.0
60~69세 인구	5,670	14.0
70~79세 인구	2,957	7.3
80세 이상 인구	1,896	4.7
전체	40,645	100
0~9세 인구	2,397	5.9
10~19세 인구	4,686	11.5
20~29세 인구	4,760	11.7
30~39세 인구	4,287	10.5
40~49세 인구	6,268	15.4
50~59세 인구	7,718	19.0
60~69세 인구	5,670	14.0
70~79세 인구	2,957	7.3
80세 이상 인구	1,896	4.7
- 인구(성별)

구분	값(명)	백분율(%)
전체	40,645	100
남	19,687	48.4
여	20,961	51.6
전체	40,645	100
남	19,687	48.4
여	20,961	51.6
메모노트
※메모는 400자 이하로 사용할 수 있습니다.
`;

describe("parsePastedTable", () => {
  it("탭 구분 표를 라벨/값 쌍으로 파싱한다", () => {
    const text = "반경500m 총인구\t10338\n반경1km 총인구\t67450";
    expect(parsePastedTable(text)).toEqual([
      { label: "반경500m 총인구", value: "10338" },
      { label: "반경1km 총인구", value: "67450" },
    ]);
  });

  it("탭이 없으면 연속 공백 2칸 이상을 구분자로 쓴다", () => {
    const text = "반경500m 총인구   10338";
    expect(parsePastedTable(text)).toEqual([{ label: "반경500m 총인구", value: "10338" }]);
  });

  it("값이 없는 줄(구분자 없음)은 무시한다", () => {
    const text = "그냥한줄짜리텍스트";
    expect(parsePastedTable(text)).toEqual([]);
  });

  it("빈 줄은 건너뛴다", () => {
    const text = "라벨\t값\n\n라벨2\t값2";
    expect(parsePastedTable(text)).toHaveLength(2);
  });
});

describe("parsePastedTableSectioned", () => {
  it("'반경 기준 X km' 섹션 제목으로 이후 행을 태깅하고, 제목 줄 자체는 데이터로 넣지 않는다", () => {
    const pairs = parsePastedTableSectioned(REAL_SGIS_REPORT_EXCERPT);
    expect(pairs.some((p) => p.label.includes("반경 기준"))).toBe(false);
    const totalPairs = pairs.filter((p) => p.label === "전체");
    expect(totalPairs.map((p) => p.radiusKm)).toEqual([0.5, 0.5, 1, 1]); // 인구(나이)+인구(성별) 각 섹션의 "전체"
  });
});

describe("extractFields — SGIS (실제 보고서 레이아웃)", () => {
  const pairs = parsePastedTableSectioned(REAL_SGIS_REPORT_EXCERPT);
  const result = extractFields(pairs, SGIS_FIELD_SPECS);
  const byKey = (key: string) => result.find((r) => r.fieldKey === key);

  it("반경이 같은 라벨('전체')이라도 섹션(0.5km/1km)으로 pop500m/pop1km를 정확히 구분한다", () => {
    expect(byKey("pop500m")?.parsedValue).toBe(7656);
    expect(byKey("pop1km")?.parsedValue).toBe(29540);
  });

  it("면적은 1km 섹션의 '총면적'만 area1kmKm2에 매칭한다(500m 섹션 값은 무시)", () => {
    expect(byKey("area1kmKm2")?.parsedValue).toBe(3.05);
  });

  it("'남' 라벨의 백분율(%) 열을 male1kmRatio로 쓰고 0~1 비율로 변환한다(1km 섹션 기준)", () => {
    expect(byKey("male1kmRatio")?.parsedValue).toBeCloseTo(0.484, 3);
  });

  it("연령대 9개 밴드를 1km 섹션 값으로 전부 찾는다(500m 섹션 값과 혼동하지 않음)", () => {
    expect(byKey("age1km_0_9")?.parsedValue).toBe(1450);
    expect(byKey("age1km_80plus")?.parsedValue).toBe(890);
    const ageFields = result.filter((r) => r.fieldKey.startsWith("age1km_"));
    expect(ageFields.every((f) => f.autoExtracted)).toBe(true);
  });

  it("radiusKm이 지정된 스펙은 섹션 태깅이 없는(plain) 붙여넣기에서는 매칭되지 않는다 — 지어내지 않음", () => {
    const untaggedPairs = parsePastedTable(REAL_SGIS_REPORT_EXCERPT);
    const untaggedResult = extractFields(untaggedPairs, SGIS_FIELD_SPECS);
    expect(untaggedResult.find((r) => r.fieldKey === "pop500m")?.parsedValue).toBeNull();
    expect(untaggedResult.find((r) => r.fieldKey === "pop1km")?.parsedValue).toBeNull();
  });

  it("매칭되는 라벨이 없으면 지어내지 않고 null로 남긴다", () => {
    const empty = extractFields([], SGIS_FIELD_SPECS);
    expect(empty.every((r) => r.parsedValue === null && r.autoExtracted === false)).toBe(true);
  });
});

describe("extractFields — SGIS 실사용자 붙여넣기(Ctrl+A 전체선택, '면적'이 줄바꿈으로 쪼개진 실제 사례)", () => {
  const pairs = parsePastedTableSectioned(REAL_SGIS_FULL_PASTE);
  const result = extractFields(pairs, SGIS_FIELD_SPECS);
  const byKey = (key: string) => result.find((r) => r.fieldKey === key);

  it("면적 위젯이 셀마다 다른 줄로 쪼개져 있어도(구분/총 면적/값(km2)/0.78 각각 독립된 줄) 1km 값을 정확히 찾는다", () => {
    expect(byKey("area1kmKm2")?.parsedValue).toBe(3.14);
  });

  it("가구/주택 잡음이 섞여 있어도 인구수는 정확히 구분된다(0.5km=19099, 1km=40645)", () => {
    expect(byKey("pop500m")?.parsedValue).toBe(19099);
    expect(byKey("pop1km")?.parsedValue).toBe(40645);
  });

  it("1km 구간의 표 중복(같은 값이 두 번 나옴)에도 값이 똑같이 정확하다", () => {
    expect(byKey("male1kmRatio")?.parsedValue).toBeCloseTo(0.484, 3);
    expect(byKey("age1km_0_9")?.parsedValue).toBe(2397);
  });

  it("'선택년도: 인구/가구/주택 (2024년)...' 문장에서 기준연도를 뽑아낸다", () => {
    expect(byKey("demographicsYear")?.parsedValue).toBe(2024);
  });

  it("제목·안내문구·가구/주택 통계 같은 잡음은 어떤 필드에도 잘못 매칭되지 않는다", () => {
    expect(result.every((r) => r.rawValue !== "5,543" && r.rawValue !== "68.0")).toBe(true); // 친족 가구 값
  });
});

// 2026-08-24 — bigdata.sbiz.or.kr 상세분석(대전광역시청새마을금고 인근, 서울 구로3동 등으로
// 실제 조회)에서 그대로 옮긴 실측 데이터. SGIS와 달리 "지역 × 성별/연령대" 매트릭스 표라
// 한 행에 여러 숫자가 나열되고, 비교 지역(소공동/중구 등) 행이 같이 섞여 있다.
const REAL_SB365_FLOATING_EXCERPT = `
지역	구분	일일	남성	여성	10대	20대	30대	40대	50대	60대이상
선택 영역	인구	184,038	103,612	80,426	7,165	27,188	30,914	37,904	38,103	42,764
선택 영역	비율		56.3	43.7	4.0	15.0	17.0	21.0	21.0	23.0
소공동	인구	186,497	104,715	81,782	7,082	27,024	31,816	38,863	38,789	42,924
소공동	비율		56.1	43.9	4.0	14.0	17.0	21.0	21.0	23.0
`;

const REAL_SB365_HOUSEHOLDS_EXCERPT = `
지역	세대수
2024년 하반기	2025년 상반기	2025년 하반기	2026년 상반기
선택 영역	827	823	818	817
소공동	1,257	1,249	1,241	1,240
`;

const REAL_SB365_BUSINESS_COUNT_EXCERPT = `
지역	구분	25.05	25.06	25.07	25.08	25.09	25.10	25.11	25.12	26.01	26.02	26.03	26.04	26.05
선택 영역	업소수	1	1	1	2	2	2	2	2	3	3	3	3	3
선택 영역	증감률	0.0	0.0	0.0	100.0	0.0	0.0	0.0	0.0	50.0	0.0	0.0	0.0	0.0
중구	업소수	21	21	21	20	20	20	20	20	20	20	20	21	20
`;

describe("parseSosangongin365DemographicRow — 실제 리포트(유동인구/직장인구 공용 표 모양)", () => {
  it("'선택 영역'의 인구 행만 뽑고 비교 지역·비율 행은 무시한다", () => {
    const pairs = parseSosangongin365DemographicRow(REAL_SB365_FLOATING_EXCERPT);
    expect(pairs.find((p) => p.label === "전체")?.value).toBe("184,038");
    expect(pairs.find((p) => p.label === "남성")?.value).toBe("103,612");
    expect(pairs.find((p) => p.label === "60대이상")?.value).toBe("42,764");
    // 소공동(비교 지역)의 값(186,497 등)이 섞여 들어오면 안 된다.
    expect(pairs.some((p) => p.value === "186,497")).toBe(false);
  });

  it("매칭되는 '선택 영역' 행이 없으면 빈 배열을 반환한다(지어내지 않음)", () => {
    expect(parseSosangongin365DemographicRow("소공동\t인구\t100\t50\t50\t10\t10\t10\t10\t10\t10")).toEqual([]);
  });
});

describe("parseSosangongin365TrendLatest — 세대수/업소수 시계열 표", () => {
  it("세대수 표에서 '선택 영역'의 가장 최근(마지막) 값을 가져온다", () => {
    expect(parseSosangongin365TrendLatest(REAL_SB365_HOUSEHOLDS_EXCERPT)).toBe(817);
  });

  it("rowLabelHint로 업소수 표를 구분해서 가져오고, 증감률 행은 건너뛴다", () => {
    expect(parseSosangongin365TrendLatest(REAL_SB365_BUSINESS_COUNT_EXCERPT, "업소수")).toBe(3);
  });

  it("힌트 없이 업소수 표를 읽으면(라벨이 '선택 영역' 단독이 아니라서) 못 찾는다 — 표 종류를 반드시 구분해야 함", () => {
    expect(parseSosangongin365TrendLatest(REAL_SB365_BUSINESS_COUNT_EXCERPT)).toBeNull();
  });
});

// 2026-08-24 — 사용자 제안으로 재설계: "표 종류"를 매번 고르지 않고 "반경 설정 → 분석하기 →
// 리포트 전체 복사후 붙여넣기"만 하도록 바꿨다. 유동인구/직장인구/세대수/업소수 네 표를 실제
// 리포트에 딸려오는 소제목("성별/연령대별 일평균 유동인구" 등)과 함께 한 번에 붙여넣은 텍스트로
// 재현한 픽스처.
const REAL_SB365_FULL_REPORT_EXCERPT = `
상권분석 상세분석 리포트

성별/연령대별 일평균 유동인구
지역	구분	일일	남성	여성	10대	20대	30대	40대	50대	60대이상
선택 영역	인구	184,038	103,612	80,426	7,165	27,188	30,914	37,904	38,103	42,764
선택 영역	비율		56.3	43.7	4.0	15.0	17.0	21.0	21.0	23.0
소공동	인구	186,497	104,715	81,782	7,082	27,024	31,816	38,863	38,789	42,924

성별/연령대별 직장인구
지역	구분	일일	남성	여성	10대	20대	30대	40대	50대	60대이상
선택 영역	인구	52,300	28,150	24,150	1,200	9,800	12,400	13,900	10,500	4,500
선택 영역	비율		53.8	46.2	2.3	18.7	23.7	26.6	20.1	8.6
소공동	인구	53,900	29,000	24,900	1,300	9,900	12,600	14,000	10,600	4,600

세대 수 추이
지역	세대수
2024년 하반기	2025년 상반기	2025년 하반기	2026년 상반기
선택 영역	827	823	818	817
소공동	1,257	1,249	1,241	1,240

업소수 추이
지역	구분	25.05	25.06	25.07	25.08	25.09	25.10	25.11	25.12	26.01	26.02	26.03	26.04	26.05
선택 영역	업소수	1	1	1	2	2	2	2	2	3	3	3	3	3
선택 영역	증감률	0.0	0.0	0.0	100.0	0.0	0.0	0.0	0.0	50.0	0.0	0.0	0.0	0.0
중구	업소수	21	21	21	20	20	20	20	20	20	20	20	21	20
`;

describe("parseSosangongin365FullReport — 리포트 전체를 한 번에 붙여넣었을 때", () => {
  it("소제목으로 유동인구/직장인구 표를 구분해서 서로 안 섞인다", () => {
    const pairs = parseSosangongin365FullReport(REAL_SB365_FULL_REPORT_EXCERPT);
    expect(pairs.find((p) => p.label === "유동인구:전체")?.value).toBe("184,038");
    expect(pairs.find((p) => p.label === "유동인구:남성")?.value).toBe("103,612");
    expect(pairs.find((p) => p.label === "직장인구:전체")?.value).toBe("52,300");
    expect(pairs.find((p) => p.label === "직장인구:여성")?.value).toBe("24,150");
    // 소공동(비교 지역) 값이 섞여 들어오면 안 된다.
    expect(pairs.some((p) => p.value === "186,497" || p.value === "53,900")).toBe(false);
  });

  it("세대수/업소수도 같은 붙여넣기 안에서 최신값만 뽑는다(증감률 행 제외)", () => {
    const pairs = parseSosangongin365FullReport(REAL_SB365_FULL_REPORT_EXCERPT);
    expect(pairs.find((p) => p.label === "세대수")?.value).toBe("817");
    expect(pairs.find((p) => p.label === "업소수")?.value).toBe("3");
  });
});

describe("SOSANGONGIN365_TABLE_VARIANTS — 표 종류 선택 없이 반경만 골라 4개 지표를 한 번에 매칭", () => {
  it("리포트 전체 붙여넣기 한 번으로 유동인구/직장인구/세대수/업소수가 모두 매칭된다(500m)", () => {
    const variant = SOSANGONGIN365_TABLE_VARIANTS[0];
    const pairs = variant.extract(REAL_SB365_FULL_REPORT_EXCERPT);
    const result = extractFields(pairs, variant.buildSpecs("500", "500m"));
    expect(result.find((r) => r.fieldKey === "floating500Avg")?.parsedValue).toBe(184038);
    expect(result.find((r) => r.fieldKey === "floating500Male")?.parsedValue).toBe(103612);
    expect(result.find((r) => r.fieldKey === "employ500Total")?.parsedValue).toBe(52300);
    expect(result.find((r) => r.fieldKey === "employ500Female")?.parsedValue).toBe(24150);
    expect(result.find((r) => r.fieldKey === "facility500Households")?.parsedValue).toBe(817);
    expect(result.find((r) => r.fieldKey === "operatingPcStores500m")?.parsedValue).toBe(3);
    expect(result.some((r) => r.fieldKey === "licensedPcStores500m")).toBe(false);
  });

  it("반경을 1km로 바꾸면 1km 전용 필드 키로 매칭된다", () => {
    const variant = SOSANGONGIN365_TABLE_VARIANTS[0];
    const pairs = variant.extract(REAL_SB365_FULL_REPORT_EXCERPT);
    const result = extractFields(pairs, variant.buildSpecs("1km", "1km"));
    expect(result.find((r) => r.fieldKey === "floating1kmAvg")?.parsedValue).toBe(184038);
    expect(result.find((r) => r.fieldKey === "facility1kmHouseholds")?.parsedValue).toBe(817);
  });

  it("표 종류 버튼이 필요 없도록 변형이 단 하나('전체')뿐이다", () => {
    expect(SOSANGONGIN365_TABLE_VARIANTS.length).toBe(1);
    expect(SOSANGONGIN365_TABLE_VARIANTS[0].key).toBe("전체");
  });
});
