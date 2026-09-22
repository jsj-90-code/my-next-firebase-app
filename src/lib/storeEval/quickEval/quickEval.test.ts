// 주소만 초기평가 도구의 순수 로직 시험.
//
// 여기서 지키려는 것은 셋이다:
//   1. **좌표변환** — 틀리면 SGIS·소상공인365가 에러 없이 빈 결과를 준다(조용한 실패).
//   2. **이름 규칙** — 성인PC방·오락실이 경쟁점으로 새어들면 경쟁IP가 부풀려진다.
//   3. **조립** — `_addressOnlyMode.test.ts`가 잰 L3 조건과 같은 모양이어야 화면의 오차율이
//      거짓이 되지 않는다(경쟁점 대수 null + 조사수준 "간략" + 품질 전부 null).
//
// 실행: npx vitest run src/lib/storeEval/quickEval/quickEval.test.ts
import { describe, expect, it } from "vitest";
import { TM_SELFTEST_CASES, to5179, to5181, tmSelfTestFailures } from "./tm";
import { judgePcBangName, NON_PCBANG_NAME_PATTERN } from "./pcBangNameFilter";
import { buildQuickCandidate, buildQuickLocationEvaluation, type QuickEvalPlanInput } from "./buildQuickCandidate";
import { computeCompetitorAppliedPcCount, DEFAULT_UNSURVEYED_PC_COUNT } from "../calc";
import { haversineM } from "./kakaoPcBangs";
import { QUICK_EVAL_FIELD_NOTES } from "./quickEvalDefaults";

describe("좌표변환", () => {
  it("scripts/lib/tm.mjs와 같은 검산점을 통과한다", () => {
    expect(tmSelfTestFailures()).toEqual([]);
  });

  it("검산점이 비어 있지 않다 — 시험이 아무것도 안 재는 상태를 막는다", () => {
    expect(TM_SELFTEST_CASES.length).toBeGreaterThan(0);
  });

  it("5181과 5179는 서로 다른 좌표를 준다(둘을 섞어 쓰면 수백 m 어긋난다)", () => {
    const a = to5181(126.978, 37.5665);
    const b = to5179(126.978, 37.5665);
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(100000);
  });
});

describe("PC방 이름 규칙", () => {
  it("카카오 업종이 PC방이면 센다", () => {
    expect(judgePcBangName({ name: "레드포스PC", categoryName: "가정,생활 > PC방" }).counted).toBe(true);
  });

  it("업종이 PC방이 아니면 뺀다", () => {
    const v = judgePcBangName({ name: "무슨PC방", categoryName: "음식점 > 치킨" });
    expect(v.counted).toBe(false);
    expect(v.excludedReason).toContain("치킨");
  });

  it("업종이 비어 있으면 뺴지 않는다 — 분류만 없는 실재 매장을 놓치지 않는다", () => {
    expect(judgePcBangName({ name: "이름만있는PC", categoryName: null }).counted).toBe(true);
  });

  it("오락실·성인업태는 상호로 뺀다(인계문 4절 예시)", () => {
    for (const name of ["지구성인게임랜드", "메가오락실", "슈팅존스크린사격", "캠프VR"]) {
      const v = judgePcBangName({ name, categoryName: "가정,생활 > PC방" });
      expect(v.counted, name).toBe(false);
      expect(v.excludedReason, name).toContain("규칙");
    }
  });

  it("규칙이 진짜 PC방 상호를 잡아먹지 않는다", () => {
    for (const name of ["불독PC", "녹스PC방", "지원피씨", "레드포스 구리점"]) {
      expect(NON_PCBANG_NAME_PATTERN.test(name), name).toBe(false);
    }
  });
});

describe("거리 계산", () => {
  it("같은 점은 0m", () => {
    expect(haversineM({ lat: 37.5, lng: 127 }, { lat: 37.5, lng: 127 })).toBe(0);
  });

  it("위도 1도는 약 111km", () => {
    const d = haversineM({ lat: 37.5, lng: 127 }, { lat: 38.5, lng: 127 });
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
});

const PLAN: QuickEvalPlanInput = {
  name: "시험후보지",
  address: "서울특별시 중구 세종대로 110",
  expectedPcCount: 100,
  hourlyRate: 1300,
  floor: 2,
  groundLevel: "지상",
  hasElevator: true,
  ownFoodBrand: null,
  plannedOpenMonth: 3,
};

const COLLECTED = {
  geocode: { lat: 37.5665, lng: 126.978, roadAddress: "서울 중구 세종대로 110", jibunAddress: null, buildingName: null },
  sgis: {
    baseYear: "2024",
    byRadius: {
      500: {
        radiusM: 500,
        totalPopulation: 5000,
        malePopulation: 2500,
        femalePopulation: 2500,
        ageBands: [100, 200, 300, 400, 500, 600, 700, 800, 900],
        areaSizeM2: Math.PI * 500 * 500,
        areaOffRatio: 0,
      },
      1000: {
        radiusM: 1000,
        totalPopulation: 20000,
        malePopulation: 9000,
        femalePopulation: 11000,
        ageBands: [1000, 2000, 3000, 4000, 5000, 1500, 1200, 900, 400],
        areaSizeM2: Math.PI * 1000 * 1000,
        areaOffRatio: 0,
      },
    },
  },
  floating: {
    radiusM: 500,
    avg: 90000,
    months: ["25.09"],
    monthly: [90000],
    scale: 1,
    scaled: {
      total: 90000,
      male: 46000,
      female: 44000,
      age10s: 5000,
      age20s: 20000,
      age30s: 22000,
      age40s: 18000,
      age50s: 15000,
      age60plus: 10000,
    },
    admiCd: "1114055",
    admiNm: "명동",
  },
  pcBangs: [
    { id: "1", name: "불독PC", categoryName: "가정,생활 > PC방", address: null, lat: 37.567, lng: 126.979, distanceM: 120 },
    { id: "2", name: "메가오락실", categoryName: "가정,생활 > PC방", address: null, lat: 37.568, lng: 126.98, distanceM: 300 },
    { id: "3", name: "녹스PC", categoryName: null, address: null, lat: 37.569, lng: 126.981, distanceM: 450 },
  ],
  pcBangsPossiblyTruncated: false,
};

describe("V62 입력 조립", () => {
  const built = buildQuickCandidate(PLAN, COLLECTED, 1_700_000_000_000);

  it("주거인구·연령·남녀비를 SGIS 값 그대로 옮긴다", () => {
    expect(built.candidate.pop500m).toBe(5000);
    expect(built.candidate.pop1km).toBe(20000);
    expect(built.candidate.male1kmRatio).toBeCloseTo(0.45, 5);
    expect(built.candidate.age1km_10_19).toBe(2000);
    expect(built.candidate.age1km_80plus).toBe(400);
  });

  it("유동인구는 12개월 평균과 환산된 성별·연령을 쓴다", () => {
    expect(built.candidate.floating500Avg).toBe(90000);
    expect(built.candidate.floating500Male).toBe(46000);
    expect(built.candidate.floating500_20s).toBe(20000);
  });

  it("⭐ 경쟁점은 대수 미조사 + 조사수준 간략 — 기본대수 장치가 켜져야 한다", () => {
    for (const c of built.competitors) {
      expect(c.totalPcCount).toBeNull();
      expect(c.appliedPcCount).toBeNull();
      expect(c.surveyLevel).toBe("간략");
      // 이 한 줄이 L2/L3 측정 조건과 같은지를 지킨다.
      expect(computeCompetitorAppliedPcCount(c)).toBe(DEFAULT_UNSURVEYED_PC_COUNT);
    }
  });

  it("⭐ 경쟁점 품질 칸은 전부 비어 있다 — 반만 채우면 오히려 더 틀린다", () => {
    for (const c of built.competitors) {
      expect(c.vgaBase).toBeNull();
      expect(c.foodScore).toBeNull();
      expect(c.interiorScore).toBeNull();
      expect(c.managementScore).toBeNull();
      expect(c.singleSeatCount).toBeNull();
    }
  });

  it("오락실은 경쟁점에서 빠지고, 목록에는 이유와 함께 남는다", () => {
    expect(built.competitors.map((c) => c.name)).toEqual(["불독PC", "녹스PC"]);
    const dropped = built.competitorRows.find((r) => !r.counted);
    expect(dropped?.place.name).toBe("메가오락실");
    expect(dropped?.excludedReason).toBeTruthy();
  });

  it("실영업 PC방업소수는 센 경쟁점 수와 같다", () => {
    expect(built.candidate.operatingPcStores500m).toBe(2);
  });

  it("업종이 비어 있으면 화면에 표시할 수 있게 표시가 남는다", () => {
    expect(built.competitorRows.find((r) => r.place.id === "3")?.categoryUnknown).toBe(true);
  });

  it("자사 시설 구성은 비운다 — 회사 표준 존 구성이 들어가야 한다", () => {
    expect(built.candidate.ownSingleSeatCount).toBeNull();
    expect(built.candidate.ownTeamRoom).toBeNull();
    expect(built.candidate.ownManagementScore).toBeNull();
    expect(built.candidate.ownInteriorScore).toBeNull();
  });

  it("자사 기획값은 비우지 않는다", () => {
    expect(built.candidate.expectedPcCount).toBe(100);
    expect(built.candidate.hourlyRate).toBe(1300);
    expect(built.candidate.floor).toBe(2);
    expect(built.candidate.hasElevator).toBe(true);
    expect(built.candidate.ownVgaBase).toBeTruthy(); // 하드웨어는 표준 기획값
  });

  it("운영 후보지 코드와 겹치지 않는다(저장하지 않지만 섞이면 안 된다)", () => {
    expect(built.candidate.code).not.toMatch(/^N\d/);
  });

  it("수집이 실패하면 지어내지 않고 '못 채운 것'으로 남긴다", () => {
    const partial = buildQuickCandidate(PLAN, { ...COLLECTED, sgis: null, floating: null }, 1);
    expect(partial.candidate.pop1km).toBeNull();
    expect(partial.candidate.floating500Avg).toBeNull();
    expect(partial.missing.join(" ")).toContain("SGIS");
    expect(partial.missing.join(" ")).toContain("소상공인365");
  });

  it("기획값이 비면 사람이 넣을 항목으로 알려준다", () => {
    const noPlan = buildQuickCandidate({ ...PLAN, expectedPcCount: null, hourlyRate: null }, COLLECTED, 1);
    expect(noPlan.missing.join(" ")).toContain("PC대수");
    expect(noPlan.missing.join(" ")).toContain("요금");
  });
});

describe("AI 입지평가 초안 옮기기", () => {
  it("1~5 점수와 열거값을 그대로 옮긴다", () => {
    const loc = buildQuickLocationEvaluation(PLAN, {
      fields: {
        locationScore: 4,
        preemptionScore: 3,
        visibilityScore: 5,
        specialDemandType: "대학가",
        specialDemandIntensity: "높음",
        inflowRestriction: "없음",
        marketStructureMemo: "메모",
      },
    });
    expect(loc?.visibilityScore).toBe(5);
    expect(loc?.specialDemandType).toBe("대학가");
    expect(loc?.brandType).toBe("블랙라벨"); // 브랜드는 조사값이 아니라 우리가 정하는 값
  });

  it("범위를 벗어난 점수는 버린다 — 지어낸 값이 계산에 들어가면 안 된다", () => {
    const loc = buildQuickLocationEvaluation(PLAN, { fields: { visibilityScore: 9, locationScore: 0 } });
    expect(loc?.visibilityScore).toBeNull();
    expect(loc?.locationScore).toBeNull();
  });

  it("초안이 없으면 null — 입지 항이 통째로 빠진다", () => {
    expect(buildQuickLocationEvaluation(PLAN, null)).toBeNull();
  });
});

describe("재고 표", () => {
  it("기본값 설명에 실제 상수가 들어가 있다 — 화면이 낡은 숫자를 말하지 않게", () => {
    const pcCountNote = QUICK_EVAL_FIELD_NOTES.find((n) => n.label.includes("PC 대수"));
    expect(pcCountNote?.basis).toContain(String(DEFAULT_UNSURVEYED_PC_COUNT));
  });

  it("현장 확인이 필요한 항목이 표시돼 있다(= 조사 체크리스트)", () => {
    expect(QUICK_EVAL_FIELD_NOTES.filter((n) => n.needsFieldCheck).length).toBeGreaterThan(0);
  });
});
