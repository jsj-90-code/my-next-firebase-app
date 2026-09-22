// 주소만 초기평가 도구의 순수 로직 시험.
//
// 여기서 지키려는 것은 셋이다:
//   1. **좌표변환** — 틀리면 SGIS·소상공인365가 에러 없이 빈 결과를 준다(조용한 실패).
//   2. **이름 규칙** — 성인PC방·오락실이 경쟁점으로 새어들면 경쟁IP가 부풀려진다.
//   3. **조립** — `_addressOnlyMode.test.ts`가 잰 L3 조건과 같은 모양이어야 화면의 오차율이
//      거짓이 되지 않는다(경쟁점 대수·품질 모두 **실측 대표값**, 조사수준은 "간략" 유지).
//      ⚠️ 품질은 3차(2026-09-22 밤), 대수는 4차에 null -> 대표값으로 바뀌었다.
//
// 실행: npx vitest run src/lib/storeEval/quickEval/quickEval.test.ts
import { describe, expect, it } from "vitest";
import { TM_SELFTEST_CASES, to5179, to5181, tmSelfTestFailures } from "./tm";
import { judgePcBangName, NON_PCBANG_NAME_PATTERN } from "./pcBangNameFilter";
import {
  buildQuickCandidate,
  buildQuickLocationEvaluation,
  type QuickEvalPlanInput,
} from "./buildQuickCandidate";
import { computeCompetitorAppliedPcCount, DEFAULT_UNSURVEYED_PC_COUNT } from "../calc";
import { haversineM } from "./kakaoPcBangs";
import { OWN_FOOD_BRAND, QUICK_EVAL_FIELD_NOTES } from "./quickEvalDefaults";
import { appendSiteFactsToContext, describeSiteFacts } from "./quickEvalLocationContext";
import { QUICK_EVAL_REVIEW_SYSTEM_PROMPT } from "./quickEvalReviewPrompt";
import { applyQuickEvalQscFloor, buildQuickEvalPeers, prepareQuickEvalTrainingStores } from "./quickEvalPeers";
import {
  fitQuickEvalOwnModel,
  predictQuickEvalOwnRevenue,
  QUICK_EVAL_OWN_MODEL_ACCURACY,
} from "./quickEvalOwnModel";
import { defaultModelSettings } from "../settings";
import type { ExistingStore } from "../types";

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

  // ⛔ 2026-09-23 **되돌렸다** — 대수 129대·품질 대표값으로 채웠다가 원복했다.
  //    되짚기로는 좋아졌는데 실제 후보지 예상매출이 45% 떨어졌다(되짚기가 조사된 경쟁점
  //    중앙 4곳으로 도는 탓에 카카오 10~20곳 구간을 대표하지 못했다).
  it("⭐ 경쟁점은 대수 미조사 + 조사수준 간략 — 기본대수 장치가 켜져야 한다", () => {
    for (const c of built.competitors) {
      expect(c.totalPcCount).toBeNull();
      expect(c.appliedPcCount).toBeNull();
      expect(c.surveyLevel).toBe("간략");
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

describe("AI에게 넘기는 물건 정보(층·엘리베이터)", () => {
  it("층·엘리베이터를 사람이 읽는 한 줄로 만든다", () => {
    expect(describeSiteFacts({ floor: 2, groundLevel: "지상", hasElevator: true })).toBe(
      "지상 2층 · 엘리베이터 있음",
    );
    expect(describeSiteFacts({ floor: 1, groundLevel: "지하", hasElevator: false })).toBe(
      "지하 1층 · 엘리베이터 없음",
    );
  });

  it("모르는 값을 빈칸으로 두지 않는다 — 비우면 AI가 1층으로 가정해 후하게 매긴다", () => {
    const text = appendSiteFactsToContext("기존자료", { floor: null, groundLevel: null, hasElevator: null });
    expect(text).toContain("층수 모름");
    expect(text).toContain("1층으로 가정하지 말고");
  });

  it("1층이 아니면 불리하다는 사실을 AI에게 분명히 넘긴다", () => {
    const upstairs = appendSiteFactsToContext("기존자료", { floor: 3, groundLevel: "지상", hasElevator: false });
    expect(upstairs).toContain("1층이 아니다");
    const basement = appendSiteFactsToContext("기존자료", { floor: 1, groundLevel: "지하", hasElevator: true });
    expect(basement).toContain("1층이 아니다");
  });

  it("1층이면 불리 경고를 붙이지 않는다", () => {
    const ground = appendSiteFactsToContext("기존자료", { floor: 1, groundLevel: "지상", hasElevator: true });
    expect(ground).not.toContain("1층이 아니다");
    expect(ground).not.toContain("층수 모름");
  });

  it("운영 공용 컨텍스트를 덮지 않고 뒤에 붙인다", () => {
    const text = appendSiteFactsToContext("원래자료 첫줄", { floor: 2, groundLevel: "지상", hasElevator: null });
    expect(text.startsWith("원래자료 첫줄")).toBe(true);
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

describe("가맹점 실적 비교표 (AI 자체 매출 판단의 근거)", () => {
  const store = (over: Partial<ExistingStore>): ExistingStore =>
    ({
      storeCode: over.storeCode ?? "S1",
      storeName: over.storeName ?? "가",
      brandType: "블랙라벨",
      excludedFromModel: false,
      openedAt: "2025-01-01",
      pcCount: 100,
      evaluationPcCount: null,
      hourlyRate: 1400,
      marketDemand: 10000,
      competitorIp: 200,
      actualMonthlyRevenueAvg: 50_000_000,
      ...over,
    }) as ExistingStore;

  it("블랙라벨·학습제외 아님·실매출 있음만 쓴다", () => {
    const peers = buildQuickEvalPeers(
      [
        store({ storeCode: "A", storeName: "블랙" }),
        store({ storeCode: "B", storeName: "리그", brandType: "리그PC방" }),
        store({ storeCode: "C", storeName: "제외", excludedFromModel: true }),
        store({ storeCode: "D", storeName: "매출없음", actualMonthlyRevenueAvg: null }),
      ],
      10000,
    );
    expect(peers.totalCount).toBe(1);
    expect(peers.nearest.map((p) => p.storeName)).toEqual(["블랙"]);
  });

  it("대당 월매출을 계산한다 — 대수가 다른 매장을 비교할 수 있게", () => {
    const peers = buildQuickEvalPeers([store({ pcCount: 100, actualMonthlyRevenueAvg: 60_000_000 })], 10000);
    expect(peers.nearest[0].revenuePerPc).toBe(600_000);
  });

  it("평가용 대수가 있으면 그걸 쓴다(현재 운영 대수보다 우선)", () => {
    const peers = buildQuickEvalPeers(
      [store({ pcCount: 120, evaluationPcCount: 100, actualMonthlyRevenueAvg: 50_000_000 })],
      10000,
    );
    expect(peers.nearest[0].pcCount).toBe(100);
    expect(peers.nearest[0].revenuePerPc).toBe(500_000);
  });

  it("⭐ 상권수요가 가까운 순으로 고른다 — 배수로 재서 크고 작은 쪽을 같게 취급한다", () => {
    const peers = buildQuickEvalPeers(
      [
        store({ storeCode: "A", storeName: "절반", marketDemand: 5_000 }),
        store({ storeCode: "B", storeName: "두배", marketDemand: 20_000 }),
        store({ storeCode: "C", storeName: "근접", marketDemand: 10_500 }),
        store({ storeCode: "D", storeName: "열배", marketDemand: 100_000 }),
      ],
      10_000,
      3,
    );
    expect(peers.nearest.map((p) => p.storeName)).toEqual(["근접", "절반", "두배"]);
    expect(peers.nearest[0].demandRatio).toBeCloseTo(1.05, 5);
  });

  it("후보지 상권수요를 모르면(수집 실패) 매출 높은 순으로 대신 고른다", () => {
    const peers = buildQuickEvalPeers(
      [
        store({ storeCode: "A", storeName: "작음", actualMonthlyRevenueAvg: 30_000_000 }),
        store({ storeCode: "B", storeName: "큼", actualMonthlyRevenueAvg: 90_000_000 }),
      ],
      null,
      2,
    );
    expect(peers.nearest.map((p) => p.storeName)).toEqual(["큼", "작음"]);
    expect(peers.nearest[0].demandRatio).toBeNull();
  });

  it("대당매출 범위와 중앙값을 같이 준다 — AI가 이 안에서 가늠하게 하는 근거다", () => {
    const peers = buildQuickEvalPeers(
      [
        store({ storeCode: "A", pcCount: 100, actualMonthlyRevenueAvg: 40_000_000 }),
        store({ storeCode: "B", pcCount: 100, actualMonthlyRevenueAvg: 50_000_000 }),
        store({ storeCode: "C", pcCount: 100, actualMonthlyRevenueAvg: 60_000_000 }),
      ],
      10000,
    );
    expect(peers.nearestRevenuePerPc.min).toBe(400_000);
    expect(peers.nearestRevenuePerPc.median).toBe(500_000);
    expect(peers.nearestRevenuePerPc.max).toBe(600_000);
  });

  it("학습제외 매장 둘을 이 도구에서만 포함한다 — 원본은 안 건드린다", () => {
    const excluded = { ...store({ storeCode: "20250124421", storeName: "동탄북광장점" }), excludedFromModel: true };
    const prepared = prepareQuickEvalTrainingStores([excluded]);
    expect(prepared[0].excludedFromModel).toBe(false);
    expect(excluded.excludedFromModel).toBe(true); // 원본 객체는 그대로다
  });

  it("QSC 없는 매장에 가맹점 최저점을 채운다 — 상수로 박지 않는다", () => {
    const qsc = new Map([["A", 95], ["B", 73.9], ["C", 88]]);
    const out = applyQuickEvalQscFloor(qsc);
    expect(out.get("20250124421")).toBe(73.9);
    expect(out.get("A")).toBe(95); // 있는 값은 안 건드린다
    expect(qsc.has("20250124421")).toBe(false); // 원본은 그대로다
  });

  it("QSC 기록이 아예 없으면 아무 값도 지어내지 않는다", () => {
    expect(applyQuickEvalQscFloor(new Map()).size).toBe(0);
  });

  it("비교할 매장이 없으면 빈 표를 준다 — 지어낸 근거를 만들지 않는다", () => {
    const peers = buildQuickEvalPeers([], 10000);
    expect(peers.totalCount).toBe(0);
    expect(peers.nearest).toEqual([]);
    expect(peers.medians.revenuePerPc).toBeNull();
  });
});

describe("자동화 전용 산식", () => {
  const store = (pc: number, rate: number, revenue: number, code: string): ExistingStore =>
    ({
      storeCode: code, storeName: code, brandType: "블랙라벨", excludedFromModel: false,
      openedAt: "2025-01-01", pcCount: pc, evaluationPcCount: null, hourlyRate: rate,
      actualMonthlyRevenueAvg: revenue,
    }) as ExistingStore;

  /** 대수·시급이 커질수록 매출이 커지는 가짜 자료. 계수 부호가 맞는지 본다. */
  const sample = Array.from({ length: 20 }, (_, i) =>
    store(80 + i * 3, 1000 + i * 40, (80 + i * 3) * (1000 + i * 40) * 300, `S${i}`),
  );

  it("표본이 모자라면 산식을 만들지 않는다 — 계수를 지어내지 않는다", () => {
    expect(fitQuickEvalOwnModel(sample.slice(0, 5))).toBeNull();
  });

  it("학습 대상은 V62와 같은 조건이다(블랙라벨·학습제외 아님·실매출 있음)", () => {
    const dirty = [
      ...sample,
      { ...sample[0], storeCode: "X1", brandType: "리그PC방" } as ExistingStore,
      { ...sample[0], storeCode: "X2", excludedFromModel: true } as ExistingStore,
      { ...sample[0], storeCode: "X3", actualMonthlyRevenueAvg: null } as ExistingStore,
    ];
    expect(fitQuickEvalOwnModel(dirty)?.sampleCount).toBe(sample.length);
  });

  it("대수가 많을수록 예측이 커진다", () => {
    const model = fitQuickEvalOwnModel(sample);
    const small = predictQuickEvalOwnRevenue(model, { pcCount: 90, hourlyRate: 1300 });
    const big = predictQuickEvalOwnRevenue(model, { pcCount: 120, hourlyRate: 1300 });
    expect(small).not.toBeNull();
    expect(big as number).toBeGreaterThan(small as number);
  });

  it("입력이 비면 null — 지어내지 않는다", () => {
    const model = fitQuickEvalOwnModel(sample);
    expect(predictQuickEvalOwnRevenue(model, { pcCount: null, hourlyRate: 1300 })).toBeNull();
    expect(predictQuickEvalOwnRevenue(model, { pcCount: 100, hourlyRate: null })).toBeNull();
    expect(predictQuickEvalOwnRevenue(null, { pcCount: 100, hourlyRate: 1300 })).toBeNull();
  });

  it("측정값이 기준선(전부 평균)을 이긴다고 적혀 있다 — 못 이기면 쓸 이유가 없다", () => {
    expect(QUICK_EVAL_OWN_MODEL_ACCURACY.mape).toBeLessThan(QUICK_EVAL_OWN_MODEL_ACCURACY.flatBaselineMape);
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

  it("먹거리 고정 브랜드는 운영 설정에 점수가 있는 브랜드다 — 없는 이름을 박으면 점수가 빈다", () => {
    const scores = defaultModelSettings().foodBrandScores as Record<string, number>;
    expect(Object.keys(scores)).toContain(OWN_FOOD_BRAND);
    expect(scores[OWN_FOOD_BRAND]).toBeGreaterThan(0);
  });

  it("먹거리·예상오픈월이 입력칸에서 빠진 사실이 재고 표에 적혀 있다", () => {
    const labels = QUICK_EVAL_FIELD_NOTES.map((n) => n.label).join(" ");
    expect(labels).toContain("먹거리");
    expect(labels).toContain("오픈월");
    // 입력받는 항목 목록에는 더 이상 브랜드·오픈월이 없어야 한다(화면과 설명이 어긋나지 않게).
    const humanNote = QUICK_EVAL_FIELD_NOTES.find((n) => n.source === "사람이 입력");
    expect(humanNote?.label).not.toContain("브랜드");
    expect(humanNote?.label).not.toContain("오픈월");
  });
});

// ⭐ 2026-09-23 사용자 지시 — AI 평가문에서 **예상매출을 맨 위로** 올렸다
//    ("AI 예상매출부분을 위로좀 올려달라는말"). 화면(QuickEvalReview)은 제목 이름이 아니라
//    **첫 번째 제목**을 카드로 강조하므로, 순서가 뒤집히면 엉뚱한 섹션이 강조된다.
describe("AI 평가문 형식", () => {
  const headings = QUICK_EVAL_REVIEW_SYSTEM_PROMPT.split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());

  it("제목 목록이 비어 있지 않다 — 시험이 아무것도 안 재는 상태를 막는다", () => {
    expect(headings.length).toBeGreaterThan(3);
  });

  it("⭐ 예상매출이 첫 번째 제목이다", () => {
    expect(headings[0]).toContain("예상매출");
  });

  it("나머지 섹션도 그대로 남아 있다 — 순서만 바꾼 것이지 지운 게 아니다", () => {
    for (const must of ["한 줄 결론", "이 상권은 어떤 상권인가", "장점", "단점·특이점", "현장에서 확인할 것"]) {
      expect(headings.some((h) => h.includes(must)), must).toBe(true);
    }
  });
});
