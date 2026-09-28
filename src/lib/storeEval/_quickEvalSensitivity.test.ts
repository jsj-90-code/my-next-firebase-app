// 주소만 초기평가의 **입력 민감도** — 어느 칸이 실제로 결과를 움직이나 (2026-09-22 밤)
//
// 사용자: *"엘베랑 층수 입력하는 게 기대값 딱히 없음. 제거하는 거 고려해보자.
//   PC대수 / 시간당요금도 검토해봐 한번"*
//
// 맞는 물음이다. **움직이지 않는 칸은 사람 손만 잡아먹는다.** 그런데 "움직이는가"는 느낌이
// 아니라 재야 안다. 한 매장을 후보지로 놓고 칸을 하나씩 흔들어 예상매출 변화를 본다.
//
// ⚠️ 층·엘리베이터는 두 경로로 들어간다:
//     (1) AI 입지평가 자료로 넘어가 **가시성 점수**에 반영된다(도구의 주 경로)
//     (2) 입지평가가 아예 없을 때만 층수+엘리베이터 자동계산으로 폴백한다
//    AI는 매번 달라 재현이 안 되므로, (1)은 **가시성 점수를 직접 흔들어** 상한을 잰다.
//    즉 "가시성이 1점에서 5점까지 가도 이만큼밖에 안 움직인다"가 층수 입력의 상한이다.
//
// 실행: npx vitest run src/lib/storeEval/_quickEvalSensitivity.test.ts --disable-console-intercept
import { describe, expect, it } from "vitest";
import { hasValidationSnapshot, loadValidationSnapshot } from "./validationSnapshot";
import { evaluateCandidate } from "./evaluate";
import { migrateCompetitorInvestigationStatus } from "./competitorCompatibility";
import { qscInWindowAverage, type QscRecord } from "./labInput";
import { evaluationSalesIds } from "./evaluationSalesPeriod";
import { mergeModelSettings } from "./settings";
import { blankCompetitorForTraining, QUICK_EVAL_OWN_HARDWARE } from "./quickEval/buildQuickCandidate";
import { fitQuickEvalOwnModel, predictQuickEvalOwnRevenue } from "./quickEval/quickEvalOwnModel";
import { OWN_FOOD_BRAND, withQuickEvalSettings } from "./quickEval/quickEvalDefaults";
import type {
  CandidateInput, Competitor, ExistingStore, ExistingStoreMonthlySales, GroundLevel, LocationEvaluation,
} from "./types";

const describeIf = hasValidationSnapshot() ? describe : describe.skip;

describeIf("주소만 초기평가 입력 민감도", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = loadValidationSnapshot<any>();
  // 2026-09-29 — 09-25에 prepareQuickEvalTrainingStores·applyQuickEvalQscFloor가 지워져(운영이 표본을 직접 넣음)
  // 하네스가 깨져 있었다. 지금 도구 배선대로: 표본은 스냅샷 그대로, 설정은 withQuickEvalSettings(수요 천장 켬).
  const settings = withQuickEvalSettings(mergeModelSettings(snap.settings));
  const allCompetitors: Competitor[] = snap.competitors.map(migrateCompetitorInvestigationStatus);
  const allStores = snap.existingStores as ExistingStore[];
  const locations = snap.locationEvaluations as LocationEvaluation[];
  const wanted = new Set(evaluationSalesIds(allStores));
  const sales: ExistingStoreMonthlySales[] = (snap.sales ?? [])
    .filter((s: ExistingStoreMonthlySales) => wanted.has(`${s.storeCode}_${s.yearMonth}`));
  const qsc = new Map<string, number>();
  for (const d of (snap.labQscScores ?? []) as { storeCode?: string; openedAt?: string | null; records?: QscRecord[] }[]) {
    if (!d.storeCode) continue;
    const avg = qscInWindowAverage(d.records ?? [], d.openedAt ?? null);
    if (avg != null && avg > 0) qsc.set(d.storeCode, avg);
  }

  /** 기준 후보지 — 중간쯤 되는 매장 하나를 골라 그 상권 자료를 쓴다. */
  const base = allStores.find(
    (s) => s.brandType === "블랙라벨" && !s.excludedFromModel && (s.actualMonthlyRevenueAvg ?? 0) > 0,
  )!;
  const g = base as unknown as Record<string, unknown>;
  const pick = (k: string) => (g[k] ?? null) as number | null;

  const makeCandidate = (over: Partial<CandidateInput>): CandidateInput => ({
    code: "SENS", name: base.storeName, address: "",
    lat: null, lng: null, roadAddress: null, jibunAddress: null, buildingName: null, geocodedAt: null,
    reviewDate: null, reviewStatus: "진행",
    expectedPcCount: 100, floor: 2, groundLevel: "지상" as GroundLevel, hasElevator: true,
    hourlyRate: 1300, demographicsYear: null, plannedOpenMonth: null,
    pop500m: pick("pop500m"), area1kmKm2: pick("area1kmKm2"), pop1km: pick("pop1km"),
    male1kmRatio: pick("male1kmRatio"),
    age1km_0_9: pick("age1km_0_9"), age1km_10_19: pick("age1km_10_19"), age1km_20_29: pick("age1km_20_29"),
    age1km_30_39: pick("age1km_30_39"), age1km_40_49: pick("age1km_40_49"), age1km_50_59: pick("age1km_50_59"),
    age1km_60_69: pick("age1km_60_69"), age1km_70_79: pick("age1km_70_79"), age1km_80plus: pick("age1km_80plus"),
    floating500Avg: pick("floating500Avg"), floating500Male: pick("floating500Male"),
    floating500_10s: pick("floating500_10s"), floating500_20s: pick("floating500_20s"),
    floating500_30s: pick("floating500_30s"), floating500_40s: pick("floating500_40s"),
    floating500_50s: pick("floating500_50s"), floating500_60plus: pick("floating500_60plus"),
    operatingPcStores500m: 3,
    commercialDataYearMonth: null, businessCountAsOfDate: null, operatingPcStores1km: null,
    employ500Total: null, employ500Male: null, employ500Female: null,
    employ1kmTotal: null, employ1kmMale: null, employ1kmFemale: null,
    facility500SubwayRiders: null, facility1kmSubwayRiders: null,
    ownCpu: QUICK_EVAL_OWN_HARDWARE.ownCpu, ownCpuTop1: null, ownCpuTop2: null,
    ownRam: QUICK_EVAL_OWN_HARDWARE.ownRam, ownRamTop: null,
    ownVgaBase: QUICK_EVAL_OWN_HARDWARE.ownVgaBase, ownVgaTop: null, ownVgaTop2: null,
    ownMonitorBase: QUICK_EVAL_OWN_HARDWARE.ownMonitorBase, ownMonitorTop: QUICK_EVAL_OWN_HARDWARE.ownMonitorTop,
    ownSingleSeatCount: null, ownRoom1: null, ownRoom2: null, ownTeamRoom: null, ownCoupleZone: null,
    ownVipZone: null, ownFriendsZone: null, ownFirstClassZone: null,
    ownTeamRoomTotalSeats: null, ownTeamRoomTotalSeatsBasis: null,
    ownFoodScore: null, ownInteriorScore: null, ownManagementScore: null, ownFoodBrand: OWN_FOOD_BRAND,
    ownInteriorLevelScore: null, ownInteriorConditionScore: null, ownSeatZoneScore: null, ownComfortScore: null,
    judgedRevenue: null, judgedReason: null, judgedAt: null, judgedBy: null,
    createdAt: 0, updatedAt: 0, updatedBy: null, isDraft: true,
    ...over,
  });

  const makeLoc = (visibility: 1 | 2 | 3 | 4 | 5 | null): LocationEvaluation => ({
    candidateCode: "SENS", name: base.storeName, address: "",
    locationScore: 3, flowScore: null, attractionScore: null, demandLeakageRisk: null,
    preemptionScore: 3, visibilityScore: visibility, mapMemo: null,
    specialDemandType: null, specialDemandIntensity: null, inflowRestriction: null,
    marketStructureMemo: null, brandType: "블랙라벨", updatedAt: 0, updatedBy: null,
  });

  /** 도구와 같은 배선으로 한 번 돌린다. */
  const evalOnce = (candidate: CandidateInput, loc: LocationEvaluation | null) =>
    evaluateCandidate({
      candidate,
      competitors: [], // 경쟁점 유무는 이 시험의 관심이 아니다 — 입력 칸 민감도만 본다
      locationEvaluation: loc,
      settings,
      existingStores: allStores,
      trainingLocationEvaluations: locations,
      trainingCompetitors: allCompetitors.map(blankCompetitorForTraining),
      trainingSales: sales,
      trainingQscScores: qsc,
    }).v62Final;

  const pctDiff = (a: number | null, b: number | null) =>
    a == null || b == null || b === 0 ? "-" : `${(((a - b) / b) * 100).toFixed(1)}%`;

  it("⭐ 층·엘리베이터를 흔들면 예상매출이 움직이나", () => {
    const ref = evalOnce(makeCandidate({}), makeLoc(3));
    console.log(`\n[기준 후보지] PC 100대 · 시급 1300원 · 지상 2층 · 엘리베이터 있음 · 가시성 3점`);
    console.log(`  기준 예상매출 ${ref?.toLocaleString("ko-KR")}원`);

    console.log(`\n(1) 입지평가가 **있을 때**(도구의 실제 경로) — 층/엘베를 바꿔도 되나`);
    for (const [label, over] of [
      ["지상 1층 · 엘베 있음", { floor: 1, groundLevel: "지상" as GroundLevel, hasElevator: true }],
      ["지상 7층 · 엘베 없음", { floor: 7, groundLevel: "지상" as GroundLevel, hasElevator: false }],
      ["지하 1층 · 엘베 없음", { floor: 1, groundLevel: "지하" as GroundLevel, hasElevator: false }],
      ["층수 모름(비움)", { floor: null, groundLevel: null, hasElevator: null }],
    ] as const) {
      const v = evalOnce(makeCandidate(over), makeLoc(3));
      console.log(`  ${String(label).padEnd(22)} ${v?.toLocaleString("ko-KR")} (${pctDiff(v, ref)})`);
    }

    console.log(`\n(2) 층/엘베가 실제로 닿는 곳 = **가시성 점수**. 그걸 직접 흔들면`);
    for (const vis of [1, 2, 3, 4, 5] as const) {
      const v = evalOnce(makeCandidate({}), makeLoc(vis));
      console.log(`  가시성 ${vis}점              ${v?.toLocaleString("ko-KR")} (${pctDiff(v, ref)})`);
    }

    console.log(`\n(3) 입지평가가 **없을 때**(AI 실패 시 폴백) — 이때만 층/엘베가 직접 쓰인다`);
    for (const [label, over] of [
      ["지상 1층 · 엘베 있음", { floor: 1, groundLevel: "지상" as GroundLevel, hasElevator: true }],
      ["지상 7층 · 엘베 없음", { floor: 7, groundLevel: "지상" as GroundLevel, hasElevator: false }],
    ] as const) {
      const v = evalOnce(makeCandidate(over), null);
      console.log(`  ${String(label).padEnd(22)} ${v?.toLocaleString("ko-KR")}`);
    }
    expect(ref).not.toBeNull();
  });

  it("⭐ PC대수·시급을 흔들면", () => {
    const ref = evalOnce(makeCandidate({}), makeLoc(3));
    const model = fitQuickEvalOwnModel(allStores);
    const own = (pc: number, rate: number) => predictQuickEvalOwnRevenue(model, { pcCount: pc, hourlyRate: rate });
    const ownRef = own(100, 1300);

    console.log(`\n(4) PC대수 (시급 1300 고정)        V62              전용 산식`);
    for (const pc of [80, 90, 100, 110, 130]) {
      const v = evalOnce(makeCandidate({ expectedPcCount: pc }), makeLoc(3));
      const o = own(pc, 1300);
      console.log(`  ${String(pc).padStart(4)}대  ${v?.toLocaleString("ko-KR").padStart(12)} (${pctDiff(v, ref)})`
        + `   ${o?.toLocaleString("ko-KR").padStart(12)} (${pctDiff(o, ownRef)})`);
    }
    console.log(`\n(5) 시간당요금 (PC 100대 고정)     V62              전용 산식`);
    for (const rate of [1000, 1200, 1300, 1500, 1800]) {
      const v = evalOnce(makeCandidate({ hourlyRate: rate }), makeLoc(3));
      const o = own(100, rate);
      console.log(`  ${String(rate).padStart(5)}원 ${v?.toLocaleString("ko-KR").padStart(12)} (${pctDiff(v, ref)})`
        + `   ${o?.toLocaleString("ko-KR").padStart(12)} (${pctDiff(o, ownRef)})`);
    }
    expect(ownRef).not.toBeNull();
  });
});
