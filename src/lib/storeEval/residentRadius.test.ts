// 주거 상권 반경(사람 확인 사실) — 2026-09-24 밤 채택. 양주덕정·문경·진주혁신·영월 2km.
//
// 지키는 것:
//   1. residentRadiusM 2000이면 주거 원이 2km **누적** 인구로 바뀐다 — 점유율·배수는 그대로(고리가 아니다).
//   2. 누적 자료가 없으면 1km로 떨어지고 missing에 적힌다 — 지어내지 않는다.
//   3. 반경을 넓힌 매장에 고리를 켜면 고리는 **그 반경 밖**에서 시작한다(이중계산 없음).
//   4. 문서 -> 맵 변환은 근거(note) 없는 문서를 싣지 않는다. 1500·2000 말고는 안 싣는다.
import { describe, expect, it } from "vitest";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, type ResidentAges, type TextbookInput, type TextbookParams } from "./textbookModel";
import { residentRadiusByCodeFromDocs } from "./labInput";

const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, residentRingDecayM: 0 };
const ages = (k: number): ResidentAges => ({ age0s: 200 * k, age10s: 200 * k, age20s: 400 * k, age30s: 400 * k, age40s: 300 * k, age50s: 300 * k, age60plus: 200 * k });

function input(over: Partial<TextbookInput>): TextbookInput {
  return {
    storeCode: "T", storeName: "테스트", pcCount: 100, hourlyRate: 1343,
    actualUtilization: null, specialDemandType: "없음",
    competitivenessGap: 1, competitorIp: 0, competitorCount: 0,
    ownQualityParts: null, rivals: null, location: null,
    pop500m: 5000, pop1km: 20000,
    residentAges: ages(10),
    // 누적 원: 1.5km는 1km의 1.4배, 2km는 2배, 5km는 7배
    residentAgesByRadius: { 1500: ages(14), 2000: ages(20), 5000: ages(70) },
    ringBlockedDirections: null,
    residentMaleRatio: 0.5, floatingMaleRatioByRadius: {}, floatingByRadius: { 500: 0 }, floatingAgesByRadius: {},
    ...over,
  };
}

describe("주거 상권 반경 — 원만 넓힌다", () => {
  it("2000이면 주거 이용자가 2km 누적 인구 비율(2배)만큼 커지고 점유율은 그대로다", () => {
    const b1 = computeTextbook(input({}), P);
    const b2 = computeTextbook(input({ residentRadiusM: 2000 }), P);
    expect(b1.residentRadiusM).toBe(1000);
    expect(b2.residentRadiusM).toBe(2000);
    expect(b2.residentDemandUsers! / b1.residentDemandUsers!).toBeCloseTo(2, 6);
    expect(b2.share).toBeCloseTo(b1.share!, 10);
    expect(b2.missing).not.toContain("2000m 주거인구(상권 반경)");
  });

  it("1500도 같다 — 1.4배", () => {
    const b1 = computeTextbook(input({}), P);
    const b15 = computeTextbook(input({ residentRadiusM: 1500 }), P);
    expect(b15.residentRadiusM).toBe(1500);
    expect(b15.residentDemandUsers! / b1.residentDemandUsers!).toBeCloseTo(1.4, 6);
  });

  it("null·1000이면 아무 일도 없다 — 기존 40곳·후보지의 숫자가 소수점까지 같아야 한다", () => {
    const a = computeTextbook(input({}), P), b = computeTextbook(input({ residentRadiusM: null }), P), c = computeTextbook(input({ residentRadiusM: 1000 }), P);
    expect(b.utilization).toBe(a.utilization);
    expect(c.utilization).toBe(a.utilization);
    expect(c.residentRadiusM).toBe(1000);
  });

  it("누적 자료가 없으면 1km로 떨어지고 missing에 적힌다", () => {
    const b = computeTextbook(input({ residentRadiusM: 2000, residentAgesByRadius: null }), P);
    const b1 = computeTextbook(input({}), P);
    expect(b.residentRadiusM).toBe(1000);
    expect(b.utilization).toBe(b1.utilization);
    expect(b.missing).toContain("2000m 주거인구(상권 반경)");
  });

  it("허용값 밖(3000)은 1km로 두고 missing에 적는다", () => {
    const b = computeTextbook(input({ residentRadiusM: 3000 }), P);
    expect(b.residentRadiusM).toBe(1000);
    expect(b.missing).toContain("3000m 주거인구(상권 반경)");
  });

  it("고리를 켜면 넓힌 반경 밖에서 시작한다 — 2km 원 + 고리(2~5km)는 1km 원 + 고리(1~5km)보다 작다(안쪽 띠 이중계산 없음)", () => {
    const ring: TextbookParams = { ...P, residentRingDecayM: 10_000, residentRingShare: "core" };
    const wide = computeTextbook(input({ residentRadiusM: 2000 }), ring);
    const narrow = computeTextbook(input({}), ring);
    // λ가 아주 크면 무게 ≈ 1: 1km 원 + (1~1.5, 1.5~2, 2~5km 띠) ≈ 5km 누적(7배). 2km 원 + (2~5km 띠) 도 ≈ 7배 — 같은 사람을 두 번 세지 않으면 같다.
    expect(wide.residentDemandUsers! / narrow.residentDemandUsers!).toBeGreaterThan(0.9);
    expect(wide.residentDemandUsers! / narrow.residentDemandUsers!).toBeLessThan(1.1);
    // 고리 몫은 2~5km만이라 좁은 쪽(1~5km)보다 작아야 한다
    expect(wide.residentRingUsers!).toBeLessThan(narrow.residentRingUsers!);
  });
});

describe("residentRadiusByCodeFromDocs — 근거 없는 문서는 안 싣는다", () => {
  it("note가 있고 1500·2000인 문서만 맵에 든다", () => {
    const m = residentRadiusByCodeFromDocs([
      { code: "A", residentRadiusM: 2000, note: "2km 안 다른 PC방 상권 없음" },
      { code: "B", residentRadiusM: 2000, note: "" },
      { code: "C", residentRadiusM: 3000, note: "허용값 밖" },
      { code: "D", residentRadiusM: 1500, note: "ok" },
      { code: 5, residentRadiusM: 2000, note: "숫자 코드도 문자열로" },
    ]);
    expect([...m.entries()]).toEqual([["A", 2000], ["D", 1500], ["5", 2000]]);
  });
});
