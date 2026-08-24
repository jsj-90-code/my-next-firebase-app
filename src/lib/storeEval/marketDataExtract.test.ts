import { describe, expect, it } from "vitest";
import { extractFields, parsePastedTable, SGIS_FIELD_SPECS, SOSANGONGIN365_FIELD_SPECS } from "./marketDataExtract";

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

describe("extractFields — SGIS", () => {
  it("정확히 일치하는 라벨을 찾아 숫자로 파싱한다", () => {
    const pairs = [
      { label: "반경500m 총인구", value: "10,338" },
      { label: "반경1km 남성비율", value: "49.63%" },
    ];
    const result = extractFields(pairs, SGIS_FIELD_SPECS);
    const pop500m = result.find((r) => r.fieldKey === "pop500m");
    expect(pop500m?.parsedValue).toBe(10338);
    expect(pop500m?.autoExtracted).toBe(true);

    const maleRatio = result.find((r) => r.fieldKey === "male1kmRatio");
    expect(maleRatio?.parsedValue).toBeCloseTo(0.4963, 4);
  });

  it("비율이 이미 0~1이면 다시 나누지 않는다", () => {
    const pairs = [{ label: "반경1km 남성비율", value: "0.4963" }];
    const result = extractFields(pairs, SGIS_FIELD_SPECS);
    expect(result.find((r) => r.fieldKey === "male1kmRatio")?.parsedValue).toBeCloseTo(0.4963, 4);
  });

  it("매칭되는 라벨이 없으면 지어내지 않고 null로 남긴다", () => {
    const result = extractFields([], SGIS_FIELD_SPECS);
    expect(result.every((r) => r.parsedValue === null && r.autoExtracted === false)).toBe(true);
  });

  it("연령대 9개 밴드를 전부 찾는다", () => {
    const pairs = [
      { label: "0~9세", value: "100" },
      { label: "10~19세", value: "200" },
      { label: "20~29세", value: "300" },
      { label: "30~39세", value: "400" },
      { label: "40~49세", value: "500" },
      { label: "50~59세", value: "600" },
      { label: "60~69세", value: "700" },
      { label: "70~79세", value: "800" },
      { label: "80세이상", value: "900" },
    ];
    const result = extractFields(pairs, SGIS_FIELD_SPECS);
    const ageFields = result.filter((r) => r.fieldKey.startsWith("age1km_"));
    expect(ageFields).toHaveLength(9);
    expect(ageFields.every((f) => f.autoExtracted)).toBe(true);
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
