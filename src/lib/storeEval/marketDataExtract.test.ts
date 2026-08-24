import { describe, expect, it } from "vitest";
import {
  extractFields,
  parsePastedTable,
  parsePastedTableSectioned,
  SGIS_FIELD_SPECS,
  SOSANGONGIN365_FIELD_SPECS,
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

describe("extractFields — 소상공인365", () => {
  it("500m/1km 유동인구 항목을 서로 혼동하지 않고 구분한다", () => {
    const pairs = [
      { label: "유동인구 일평균(500m)", value: "166,062" },
      { label: "유동인구 일평균(1km)", value: "500,000" },
    ];
    const result = extractFields(pairs, SOSANGONGIN365_FIELD_SPECS);
    expect(result.find((r) => r.fieldKey === "floating500Avg")?.parsedValue).toBe(166062);
    expect(result.find((r) => r.fieldKey === "floating1kmAvg")?.parsedValue).toBe(500000);
  });

  it("인허가/실영업 PC방업소수를 서로 혼동하지 않는다", () => {
    const pairs = [
      { label: "인허가 PC방업소수(500m)", value: "6" },
      { label: "실영업 PC방업소수(500m)", value: "5" },
    ];
    const result = extractFields(pairs, SOSANGONGIN365_FIELD_SPECS);
    expect(result.find((r) => r.fieldKey === "licensedPcStores500m")?.parsedValue).toBe(6);
    expect(result.find((r) => r.fieldKey === "operatingPcStores500m")?.parsedValue).toBe(5);
  });

  it("직장인구 남/여를 전체와 구분한다", () => {
    const pairs = [
      { label: "직장인구 전체(500m)", value: "1000" },
      { label: "직장인구 남성(500m)", value: "600" },
      { label: "직장인구 여성(500m)", value: "400" },
    ];
    const result = extractFields(pairs, SOSANGONGIN365_FIELD_SPECS);
    expect(result.find((r) => r.fieldKey === "employ500Total")?.parsedValue).toBe(1000);
    expect(result.find((r) => r.fieldKey === "employ500Male")?.parsedValue).toBe(600);
    expect(result.find((r) => r.fieldKey === "employ500Female")?.parsedValue).toBe(400);
  });

  it("상권_기준연월은 숫자로 파싱하지 않고 문자열 그대로 남긴다", () => {
    const pairs = [{ label: "상권 기준연월", value: "2026-07" }];
    const result = extractFields(pairs, SOSANGONGIN365_FIELD_SPECS);
    expect(result.find((r) => r.fieldKey === "commercialDataYearMonth")?.parsedValue).toBe("2026-07");
  });

  it("세대수(500m)와 세대수(1km)를 구분한다", () => {
    const pairs = [
      { label: "세대수(500m)", value: "3000" },
      { label: "세대수(1km)", value: "9000" },
    ];
    const result = extractFields(pairs, SOSANGONGIN365_FIELD_SPECS);
    expect(result.find((r) => r.fieldKey === "facility500Households")?.parsedValue).toBe(3000);
    expect(result.find((r) => r.fieldKey === "facility1kmHouseholds")?.parsedValue).toBe(9000);
  });
});
