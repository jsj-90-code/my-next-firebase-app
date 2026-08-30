// 골든 데이터 테스트: reference/점포평가_V62_원본.xlsx의 실제 셀 값과 웹 계산 결과를 비교한다.
// 아래 표는 12_운영판정!A36:N61 (블랙라벨·검증사용 26곳 전체)을 그대로 옮긴 것이다.
// V61 예측값은 원본 시트 값을 그대로 쓴다 - Apps Script 회귀식 자체는 재현 대상이 아니고
// (docs/data-issues.md #1), V62 보정·오차지표·판정 로직만 검증한다.

import { describe, expect, it } from "vitest";
import {
  bucketizeErrors,
  buildParityComparisonRows,
  buildV61TrainingStores,
  classifyErrorCause,
  classifyTenureCohort,
  computeAaBaselineRevenue,
  computeBoundedSales,
  computeCompetitorInvestigationSummary,
  computeCompetitorOccupiedSeats,
  computeCompetitivenessScore,
  computeDataCompleteness,
  computeExistingStoreDemandEvaluation,
  computeExistingStoreMeasuredForecast,
  computeOperationalStatus,
  computeSpecialDemandScore,
  computeCompletedMonthsCount,
  computeCompletionStatus,
  computeCumulativeAverageSales,
  computeStabilizedPerformance,
  computeExpectedOccupiedSeats,
  computeExpectedOwnDemand,
  computeExpectedUtilization,
  computeFinalJudgement,
  computeFoodScore,
  computeInteriorSeatManagementScore,
  combineHardwareTiers,
  computeCompetitorAppliedPcCount,
  computeFloatingRawDemand,
  computeFreshnessFromYear,
  computeImpliedUtilizationFromRevenue,
  computeLocationCompositeScore,
  computeLocationScoreFromFacts,
  computeMarketCharacter,
  computeMarketDemand,
  computeMarketGrade,
  computeMeasuredForecast,
  computeOwnLocationScore,
  computeSingleSeatBonus,
  computeSpecScore,
  computeV61Fallback,
  computeV62Final,
  computeValidationRow,
  computeZoneAchievement,
  computeZoneScore,
  resolveFreshnessScore,
  resolveSeatZoneScore,
  applyStandardOwnFacilityDefaults,
  describeNotVerifiableReason,
  diagnoseLoocvSensitivity,
  empiricalFeaturesFor,
  fitEmpiricalRevenueModel,
  fitNonnegativeRidgeRegression,
  getV62Rate,
  isCoreEligibleForV61Training,
  isEligibleForV61Training,
  judgeAaGrade,
  lookupDemandCapture,
  predictEmpiricalRevenue,
  runCohortValidation,
  runLeaveOneOutValidation,
  scoreFromCpu,
  scoreFromCpuSpec,
  scoreFromMonitor,
  scoreFromMonitorSpec,
  scoreFromRam,
  scoreFromRamSpec,
  scoreFromVga,
  scoreFromVgaSpec,
  summarizeValidation,
  summarizeValidationRows,
  toEmpiricalSample,
  toV61TrainingStore,
  type EmpiricalRevenueSample,
  type V61TrainingStore,
  type ValidationInputRow,
  type ValidationStoreInput,
  type ValidationStoreRow,
} from "./calc";
import type { CandidateInput } from "./types";
import { defaultModelSettings } from "./settings";

const settings = { ...defaultModelSettings(), updatedAt: 0, updatedBy: null };

// [가맹점코드, 가맹점명, 실제매출, V61예측, 외부유입제한, 보정률(참고용,미사용), V62예측(기대값),
//  절대오차(기대값), 편향(기대값), 점포판정(기대값), 85%(기대값), 115%(기대값), 브랜드구분, 표본사용]
const VALIDATION_ROWS: [string, string, number, number, "없음" | "보통" | "강함", number, number, number, number, string, number, number, string, string][] = [
  ["20241108419", "광주각화점", 76157831.09, 74613398, "보통", -0.03, 72374996, 0.04967099295, -0.04967099295, "양호", 61518747, 83231245, "블랙라벨", "사용"],
  ["20230901400", "구미산동점", 35482790.91, 58022769, "강함", -0.2, 46418215, 0.3081895141486002, 0.3081895141486002, "재검토", 39455483, 53380947, "블랙라벨", "사용"],
  ["20250530424", "금촌역점", 95241009.09, 67121993, "없음", 0, 67121993, 0.2952406359330888, -0.2952406359330888, "재검토", 57053694, 77190292, "블랙라벨", "사용"],
  ["20240705417", "김포구래점", 53418500, 58727035, "없음", 0, 58727035, 0.09937633965760925, 0.09937633965760928, "양호", 49917980, 67536090, "블랙라벨", "사용"],
  ["20250314423", "남악점", 62887845.45, 77618036, "보통", -0.03, 75289495, 0.1972026463272351, 0.19720264632723516, "주의", 63996071, 86582919, "블랙라벨", "사용"],
  ["20240530413", "문경시청점", 64759318.18, 62219200, "없음", 0, 62219200, 0.03922397970106089, -0.03922397970106084, "양호", 52886320, 71552080, "블랙라벨", "사용"],
  ["20240621415", "부경대점", 52133454.55, 54965119, "없음", 0, 54965119, 0.054315688059316275, 0.0543156880593163, "양호", 46720351, 63209887, "블랙라벨", "사용"],
  ["20240628416", "부천상동역점", 60719381.82, 60676491, "없음", 0, 60676491, 0.0007063777149486226, -0.0007063777149486361, "양호", 51575017, 69777965, "블랙라벨", "사용"],
  ["20240517412", "수원망포점", 66201327.27, 69118896, "보통", -0.03, 67045329, 0.01274901519414743, 0.012749015194147395, "양호", 56988530, 77102128, "블랙라벨", "사용"],
  ["20241017418", "수원인계점", 66332128.18, 60189460, "없음", 0, 60189460, 0.0926047203699082, -0.09260472036990819, "양호", 51161041, 69217879, "블랙라벨", "사용"],
  ["20230324392", "시흥능곡점", 51096136.36, 59185550, "보통", -0.03, 57409984, 0.12356800505286374, 0.1235680050528638, "주의", 48798486, 66021482, "블랙라벨", "사용"],
  ["20240507410", "시흥배곧점", 83130654.55, 69419989, "없음", 0, 69419989, 0.16492911815048644, -0.1649291181504865, "주의", 59006991, 79832987, "블랙라벨", "사용"],
  ["20231023405", "시흥은계점", 61105281.82, 68057788, "보통", -0.03, 66016054, 0.08036575621122467, 0.08036575621122477, "양호", 56113646, 75918462, "블랙라벨", "사용"],
  ["20240517411", "시흥정왕점", 90161709.09, 75935463, "없음", 0, 75935463, 0.1577858964115789, -0.15778589641157892, "주의", 64545144, 87325782, "블랙라벨", "사용"],
  ["20230707397", "안산선부점", 76917436.36, 71465593, "없음", 0, 71465593, 0.07087916110284954, -0.07087916110284953, "양호", 60745754, 82185432, "블랙라벨", "사용"],
  ["20231019404", "양주덕정점", 69060381.82, 72084604, "보통", -0.03, 69922066, 0.01247725771465874, 0.012477257714658796, "양호", 59433756, 80410376, "블랙라벨", "사용"],
  ["20250110420", "울산대점", 87054736.36, 63017230, "없음", 0, 63017230, 0.27611945504296614, -0.2761194550429661, "재검토", 53564646, 72469815, "블랙라벨", "사용"],
  ["20240126408", "전대상대점", 42550354.55, 57932468, "강함", -0.2, 46345974, 0.08920300418391981, 0.0892030041839198, "양호", 39394078, 53297870, "블랙라벨", "사용"],
  ["20231215406", "전대후문점", 82495754.73, 59533689, "없음", 0, 59533689, 0.27834239232290553, -0.2783423923229055, "재검토", 50603636, 68463742, "블랙라벨", "사용"],
  ["20230908401", "창원남양점", 38308120, 38441208, "보통", -0.03, 37287972, 0.02663007216224654, -0.026630072162246554, "양호", 31694776, 42881168, "블랙라벨", "사용"],
  ["20240412409", "청주대점", 54129836.36, 62179090, "보통", -0.03, 60313717, 0.11424162812577564, 0.11424162812577565, "주의", 51266659, 69360775, "블랙라벨", "사용"],
  ["20230915402", "청주지웰시티점", 55359818.18, 45157403, "보통", -0.03, 43802681, 0.2087640017866585, -0.20876400178665844, "재검토", 37232279, 50373083, "블랙라벨", "사용"],
  ["20230829399", "청주터미널점", 55016772.73, 56629562, "없음", 0, 56629562, 0.02931450161066585, 0.029314501610665955, "양호", 48135128, 65123996, "블랙라벨", "사용"],
  ["20240607414", "탕정역점", 75866890.91, 61677889, "보통", -0.03, 59827552, 0.21141421134959096, -0.21141421134959093, "재검토", 50853419, 68801685, "블랙라벨", "사용"],
  ["20230818398", "하남덕풍점", 50434909.09, 54371461, "보통", -0.03, 52740317, 0.045710559424929284, 0.04571055942492919, "양호", 44829269, 60651365, "블랙라벨", "사용"],
  ["20230928403", "화명대로점", 50356827.27, 51143852, "보통", -0.03, 49609536, 0.014839919693113757, -0.014839919693113712, "양호", 42168106, 57050966, "블랙라벨", "사용"],
];

describe("V62 보정 (12_운영판정!G열: ROUND(V61×(1+보정률)))", () => {
  it.each(VALIDATION_ROWS)("%s %s", (code, name, actual, v61, inflow, _rate, expectedV62, expectedAbsErr, expectedBias, expectedJudgement, expected85, expected115) => {
    const rate = getV62Rate(inflow, settings);
    const v62 = computeV62Final(v61, rate);
    expect(v62).toBe(expectedV62);

    const { conservativeSales, upperSales } = computeBoundedSales(v62, settings);
    expect(conservativeSales).toBe(expected85);
    expect(upperSales).toBe(expected115);

    const row: ValidationInputRow = { storeCode: code, storeName: name, actualSales: actual, v61Predicted: v61, inflowRestriction: inflow, brandType: "블랙라벨" };
    const computed = computeValidationRow(row, settings);
    expect(computed.v62Predicted).toBe(expectedV62);
    expect(computed.absoluteError).toBeCloseTo(expectedAbsErr, 6);
    expect(computed.bias).toBeCloseTo(expectedBias, 6);
    expect(computed.storeJudgement).toBe(expectedJudgement);
    expect(computed.usedInSample).toBe("사용");
  });
});

describe("검증 요약 지표 (12_운영판정!B8:H9, D15~D23)", () => {
  const computedRows = VALIDATION_ROWS.map(([code, name, actual, v61, inflow]) =>
    computeValidationRow({ storeCode: code, storeName: name, actualSales: actual, v61Predicted: v61, inflowRestriction: inflow, brandType: "블랙라벨" }, settings),
  );
  const summary = summarizeValidation(computedRows, settings);

  it("표본수 26 (30 미달)", () => {
    expect(summary.sampleCount).toBe(26);
    expect(summary.passed.sampleCount).toBe(false);
  });
  it("외부유입 강함 표본 2 (5 미달)", () => {
    expect(summary.strongInflowSampleCount).toBe(2);
    expect(summary.passed.strongInflowSampleCount).toBe(false);
  });
  it("평균절대오차 ≈ 0.1175 (통과, ≤0.15)", () => {
    expect(summary.meanAbsoluteError).toBeCloseTo(0.1175, 3);
    expect(summary.passed.meanAbsoluteError).toBe(true);
  });
  it("중앙절대오차 ≈ 0.0909 (통과, ≤0.10)", () => {
    expect(summary.medianAbsoluteError).toBeCloseTo(0.0909, 3);
    expect(summary.passed.medianAbsoluteError).toBe(true);
  });
  it("±20% 이내 비율 ≈ 0.7692 (통과, ≥0.75)", () => {
    expect(summary.within20PctRatio).toBeCloseTo(0.7692, 3);
    expect(summary.passed.within20PctRatio).toBe(true);
  });
  it("평균편향 ≈ -0.0277 (통과, |x|≤0.05)", () => {
    expect(summary.meanBias).toBeCloseTo(-0.0277, 3);
    expect(summary.passed.meanBias).toBe(true);
  });
  it("전체 상태 = 조건부 사용 (표본수 미달, 성능지표는 통과)", () => {
    expect(summary.overallStatus).toBe("조건부 사용");
  });
});

// 요청사항 9 — 06_검증대시보드 참고치와의 parity test. 숫자를 코드에 새로 하드코딩하지 않고,
// 위 VALIDATION_ROWS(원본 시트에서 그대로 옮긴 실측 26곳)와 사용자가 전달한 조기검증 5곳의
// 실제 절대오차율을 fixture로 그대로 넣어, 새 코호트 요약함수(summarizeValidationRows)가
// 시트에 이미 확정된 집계치를 재현하는지만 검증한다 — 예측 모형 자체의 정확도를 주장하는
// 테스트가 아니라, 집계 함수(평균/중앙값/±10%/±20% 비율)의 산술이 맞는지 확인하는 것이다.
describe("summarizeValidationRows — 06_검증대시보드 참고치와 parity (요청사항 9)", () => {
  const targets = { mape: 0.15, medianAe: 0.1, within10: 0.8, within20: 0.75, maxBias: 0.05 };

  it("정식검증 26곳: 평균 11.7%·중앙값 9.1%·±10% 57.7%·±20% 76.9%", () => {
    const rows = VALIDATION_ROWS.map(([, name, actual, , , , expectedV62, expectedAbsErr]) => ({
      storeName: name,
      absoluteErrorPct: expectedAbsErr,
      errorAmount: expectedV62 - actual,
      actualRevenueAvg: actual,
    }));
    const summary = summarizeValidationRows(rows, targets);
    expect(summary.sampleCount).toBe(26);
    expect(summary.meanAbsoluteErrorPct).toBeCloseTo(0.117, 2);
    expect(summary.medianAbsoluteErrorPct).toBeCloseTo(0.091, 2);
    expect(summary.within10PctRatio).toBeCloseTo(0.577, 2);
    expect(summary.within20PctRatio).toBeCloseTo(0.769, 2);
  });

  it("조기검증 5곳(장산점8.1%·발산역점11.8%·일산탄현점13.4%·야당점15.2%·강릉교동점(신)20.8%): 평균 13.8%·중앙값 13.4%·±10% 20.0%·±20% 80.0%", () => {
    const rows = [
      { storeName: "장산점", absoluteErrorPct: 0.081, errorAmount: -1, actualRevenueAvg: 100 },
      { storeName: "발산역점", absoluteErrorPct: 0.118, errorAmount: -1, actualRevenueAvg: 100 },
      { storeName: "일산탄현점", absoluteErrorPct: 0.134, errorAmount: -1, actualRevenueAvg: 100 },
      { storeName: "야당점", absoluteErrorPct: 0.152, errorAmount: -1, actualRevenueAvg: 100 },
      { storeName: "강릉교동점(신)", absoluteErrorPct: 0.208, errorAmount: -1, actualRevenueAvg: 100 },
    ];
    const summary = summarizeValidationRows(rows, targets);
    expect(summary.sampleCount).toBe(5);
    expect(summary.meanAbsoluteErrorPct).toBeCloseTo(0.1386, 2);
    expect(summary.medianAbsoluteErrorPct).toBeCloseTo(0.134, 2);
    expect(summary.within10PctRatio).toBeCloseTo(0.2, 2);
    expect(summary.within20PctRatio).toBeCloseTo(0.8, 2);
  });
});

describe("13_신규후보지판정!G열 폴백 회귀식 (N002 춘천퇴계점)", () => {
  it("실사례: PC 100대, 시간당 1400원 → V61 기본예측 58204549", () => {
    // 원본 N002행은 07 계산열이 채워지지 않아 G열 폴백식으로 산출된 값(58204549)이 그대로 박혀있다.
    // 상권수요(N)·경쟁력격차(S)·경쟁IP(Q)·자사경쟁력점수(BM)의 실제 조합은 원본에서 역산 불가하므로,
    // 여기서는 폴백 함수 자체가 원본 계수로 정확히 같은 산식을 재현하는지(회귀계수 4개 대입)만 검증한다.
    // 대신 계수값이 model-spec.md §4와 정확히 일치하는지를 고정한다.
    expect(settings.v61Fallback.intercept).toBeCloseTo(-79920.46038242977, 6);
    expect(settings.v61Fallback.hourlyRateCoef).toBeCloseTo(30.35495074620959, 6);
    expect(settings.v61Fallback.demandPerPcCoef).toBeCloseTo(390.05461852333895, 6);
    expect(settings.v61Fallback.competitivenessCoef).toBeCloseTo(158536.9275523547, 6);
  });

  it("입력값 중 하나라도 없으면 계산하지 않는다 (공백 유지, 절대 임의값을 만들지 않음)", () => {
    const result = computeV61Fallback(
      { expectedPcCount: 100, hourlyRate: 1400, marketDemand: null, competitivenessGap: 1.2, competitorIp: 500, ownCompetitivenessScore: 4.0 },
      settings,
    );
    expect(result).toBeNull();
  });
});

describe("상권성격 판정 (08_계산기준: 8배 이상 번화가/4~8배 혼합/4배 미만 주거중심)", () => {
  it("수원인계점 실사례: 유동500=166062, 거주500=10338 → 16.06배 → 번화가", () => {
    expect(computeMarketCharacter(166062, 10338, settings)).toBe("번화가");
  });
  it("정확히 8배 → 번화가 (경계값 포함)", () => {
    expect(computeMarketCharacter(800, 100, settings)).toBe("번화가");
  });
  it("정확히 4배 → 혼합", () => {
    expect(computeMarketCharacter(400, 100, settings)).toBe("혼합");
  });
  it("4배 미만 → 주거중심", () => {
    expect(computeMarketCharacter(399, 100, settings)).toBe("주거중심");
  });
});

// 2026-08-27 (2차) — 상대평가(상위10/30/60% 백분위)에서 절대평가로 바꿨다(사용자 확정) — 매장이
// 새로 추가돼도 등급 기준선이 안 흔들리게 하기 위함. 기본 설정값(SS 12,000/S 7,500/A 4,800)은
// 원래 상대평가가 실제로 쓰던 경계값을 반올림해 고정한 것이다.
describe("computeMarketGrade (절대평가로 변경, 2026-08-27 2차)", () => {
  it("SS 기준 이상이면 SS", () => {
    expect(computeMarketGrade(12000, settings)).toBe("SS");
    expect(computeMarketGrade(20000, settings)).toBe("SS");
  });
  it("S 기준 이상 SS 미만이면 S", () => {
    expect(computeMarketGrade(7500, settings)).toBe("S");
    expect(computeMarketGrade(11999, settings)).toBe("S");
  });
  it("A 기준 이상 S 미만이면 A", () => {
    expect(computeMarketGrade(4800, settings)).toBe("A");
    expect(computeMarketGrade(7499, settings)).toBe("A");
  });
  it("A 기준 미만이면 B", () => {
    expect(computeMarketGrade(4799, settings)).toBe("B");
    expect(computeMarketGrade(0, settings)).toBe("B");
  });
  it("상권수요가 없으면 null(비교 표본과 무관하게 결정되므로 표본 없어도 동작)", () => {
    expect(computeMarketGrade(null, settings)).toBeNull();
  });
});

describe("입지동선종합점수 (09_입지동선평가!H열: 0.3/0.3/0.25/0.15)", () => {
  it("상권내위치4, 주요동선4, 선점경쟁3, 접근가시성4 → 3.75 (실사례 코멘트 기준)", () => {
    const score = computeLocationCompositeScore({ withinMarket: 4, flow: 4, preemption: 3, visibility: 4 }, settings);
    expect(score).toBeCloseTo(3.75, 2);
  });
});

describe("누적평균매출 (12_운영판정 '실제매출' == 04_점포평가요약 누적평균매출)", () => {
  it("월별 (PC매출+상품매출) 합계의 단순평균", () => {
    const avg = computeCumulativeAverageSales([
      { pcSales: 10_000_000, productSales: 5_000_000 },
      { pcSales: 12_000_000, productSales: 4_000_000 },
    ]);
    expect(avg).toBe(15_500_000);
  });
  it("데이터가 없으면 null", () => {
    expect(computeCumulativeAverageSales([])).toBeNull();
  });
});

describe("입력완성도/최종운영판정 (13_신규후보지판정 T/U열 원문)", () => {
  it("V61 없음 → 07 분석 필요", () => {
    const status = computeCompletionStatus({ v61: null, locationScore: 3, inflowRestriction: "없음", brandType: "블랙라벨", brandFilter: "블랙라벨" });
    expect(status).toBe("07 분석 필요");
  });
  it("입지동선점수 없음 → 09 입지평가 필요", () => {
    const status = computeCompletionStatus({ v61: 100, locationScore: null, inflowRestriction: "없음", brandType: "블랙라벨", brandFilter: "블랙라벨" });
    expect(status).toBe("09 입지평가 필요");
  });
  it("외부유입제한 없음(미입력) → 외부유입 확인 필요", () => {
    const status = computeCompletionStatus({ v61: 100, locationScore: 3, inflowRestriction: null, brandType: "블랙라벨", brandFilter: "블랙라벨" });
    expect(status).toBe("외부유입 확인 필요");
  });
  it("블랙라벨이 아니면 → 브랜드 확인 필요", () => {
    const status = computeCompletionStatus({ v61: 100, locationScore: 3, inflowRestriction: "없음", brandType: "리그PC방", brandFilter: "블랙라벨" });
    expect(status).toBe("브랜드 확인 필요");
  });
  it("완료 + IP당수요<7 → 포화 주의", () => {
    const judgement = computeFinalJudgement({ completionStatus: "완료", v62Final: 1000, ipPerDemand: 5, inflowRestriction: "없음", saturationThreshold: 7 });
    expect(judgement).toBe("포화 주의");
  });
  it("완료 + 외부유입 강함 → 입지 재검토", () => {
    const judgement = computeFinalJudgement({ completionStatus: "완료", v62Final: 1000, ipPerDemand: 20, inflowRestriction: "강함", saturationThreshold: 7 });
    expect(judgement).toBe("입지 재검토");
  });
  it("완료 + 문제없음 → 평가 완료", () => {
    const judgement = computeFinalJudgement({ completionStatus: "완료", v62Final: 1000, ipPerDemand: 20, inflowRestriction: "없음", saturationThreshold: 7 });
    expect(judgement).toBe("평가 완료");
  });
  it("완료가 아니면 T값을 그대로 승계", () => {
    const judgement = computeFinalJudgement({ completionStatus: "09 입지평가 필요", v62Final: null, ipPerDemand: null, inflowRestriction: null, saturationThreshold: 7 });
    expect(judgement).toBe("09 입지평가 필요");
  });
});

// 아래 3개 describe는 원본 Apps Script(점포평가.gs) scoreFromVga_/scoreFromSpecWithMonitor_/
// scoreFromZoneComposition_/scoreFromAccess_를 그대로 포팅한 함수들의 골든 테스트다.
// 예시 값은 .gs 코드 주석(V37/V13 변경이력)에 실사례로 적힌 값을 그대로 옮겼다.

describe("scoreFromVga (모델명이 없으면 null)", () => {
  it("모델명이 없으면 null", () => {
    expect(scoreFromVga(null)).toBeNull();
  });
});

describe("scoreFromCpu (2026-08-27 추가 — 세대 기반 CPU 점수, 14세대=4점 기준 1세대당 1점)", () => {
  it("'N세대' 텍스트에서 뽑는다", () => {
    expect(scoreFromCpu("i5 14세대")).toBe(4);
  });
  it("인텔 5자리 모델번호(앞 2자리=세대)에서 뽑는다", () => {
    expect(scoreFromCpu("14400")).toBe(4);
    expect(scoreFromCpu("14400F")).toBe(4); // 사용자 확정 앵커
    expect(scoreFromCpu("13400")).toBe(3);
    expect(scoreFromCpu("12400")).toBe(2);
  });
  it("세대가 낮으면 clamp 하한(1), 높으면 상한(5)", () => {
    expect(scoreFromCpu("11400")).toBe(1); // 11세대 -> 1
    expect(scoreFromCpu("16400")).toBe(5); // 16세대 -> 6 -> 5로 clamp
  });
  it("4자리 구형 모델번호(9세대 이하, 예: i5-9400)는 5자리 패턴에 안 걸려 null - 지어내지 않는다", () => {
    expect(scoreFromCpu("i5-9400")).toBeNull();
  });
  it("세대/모델 패턴을 못 뽑으면 null - 지어내지 않는다", () => {
    expect(scoreFromCpu("울트라5 시리즈2 225F")).toBeNull();
    expect(scoreFromCpu("알수없음")).toBeNull();
  });
  it("텍스트가 없으면 null", () => {
    expect(scoreFromCpu(null)).toBeNull();
  });
});

describe("scoreFromRam (텍스트가 없거나 단위를 못 뽑으면 null)", () => {
  it("텍스트가 없거나 단위를 못 뽑으면 null", () => {
    expect(scoreFromRam(null)).toBeNull();
    expect(scoreFromRam("많음")).toBeNull();
  });
});

describe("scoreFromCpu/scoreFromVga AMD 환산 (경쟁력 평가 기준 최종본 §14, 2026-08-30)", () => {
  it("라이젠 5000번대(Zen3)는 11세대 인텔 동급 → 1점", () => {
    expect(scoreFromCpu("Ryzen 5 5600")).toBe(1);
  });
  it("라이젠 7000번대(Zen4)는 13세대 인텔 동급 → 3점", () => {
    expect(scoreFromCpu("라이젠7 7700X")).toBe(3);
  });
  it("라이젠 9000번대(Zen5)는 14세대 인텔 동급(현재 앵커) → 4점", () => {
    expect(scoreFromCpu("ryzen 9600")).toBe(4);
  });
  it("라데온 RX6600은 RTX3060 동급 → 2점", () => {
    expect(scoreFromVga("RX 6600")).toBe(2);
  });
  it("라데온 RX7600은 RTX4060 동급(RTX5060 앵커보다 한 세대 아래) → 3점", () => {
    expect(scoreFromVga("RX 7600")).toBe(3);
  });
});

describe("scoreFromVga (GPU, 2026-08-28 재보정 — RTX5060=4점 앵커)", () => {
  it("RTX5060은 앵커값 4점 그대로", () => {
    expect(scoreFromVga("RTX 5060")).toBe(4);
  });
  it("RTX5070은 세대는 같고 티어만 높아 4.5점", () => {
    expect(scoreFromVga("RTX 5070")).toBe(4.5);
  });
  it("RTX5080은 티어가 더 높아 5점", () => {
    expect(scoreFromVga("RTX 5080")).toBe(5);
  });
  it("RTX4060은 한 세대 아래라 3점", () => {
    expect(scoreFromVga("RTX 4060")).toBe(3);
  });
  it("RTX3060은 두 세대 아래라 2점", () => {
    expect(scoreFromVga("RTX 3060")).toBe(2);
  });
  it("RTX2060은 세 세대 아래라 1점(하한 clamp)", () => {
    expect(scoreFromVga("RTX 2060")).toBe(1);
  });
});

describe("scoreFromCpu (2026-08-28 확장 — 울트라 신형 네이밍 + 기존 세대 파싱)", () => {
  it("울트라5 225F(블랙라벨 현재 표준)는 앵커값 4점", () => {
    expect(scoreFromCpu("울트라5 225F")).toBe(4);
  });
  it("울트라7은 같은 200번대에서 티어가 높아 5점(clamp)", () => {
    expect(scoreFromCpu("Ultra 7 265K")).toBe(5);
  });
  it("울트라5 100번대(구형)는 한 단계 아래라 3점", () => {
    expect(scoreFromCpu("울트라5 125H")).toBe(3);
  });
  it("기존 i5-14400(14세대)은 그대로 4점", () => {
    expect(scoreFromCpu("14400")).toBe(4);
  });
  it("세대/모델을 못 뽑으면 null", () => {
    expect(scoreFromCpu("잘모름")).toBeNull();
    expect(scoreFromCpu(null)).toBeNull();
  });
});

describe("scoreFromRam (2026-08-30 재보정 — 경쟁력 평가 기준 최종본 §9)", () => {
  it("64GB 이상은 5점", () => {
    expect(scoreFromRam("64G")).toBe(5);
  });
  it("32GB는 4.5점", () => {
    expect(scoreFromRam("32G")).toBe(4.5);
  });
  it("16GB는 3.5점", () => {
    expect(scoreFromRam("16G")).toBe(3.5);
  });
  it("8GB 이하는 1.5점", () => {
    expect(scoreFromRam("8G")).toBe(1.5);
    expect(scoreFromRam("4G")).toBe(1.5);
  });
});

describe("combineHardwareTiers (기본80%+특화들 균등분배20%, 2026-08-28 신설 — 일부 좌석만 업그레이드된 경우)", () => {
  it("1종류(특화 없음)면 기본 그대로", () => {
    expect(combineHardwareTiers(3.5, [])).toBe(3.5);
  });
  it("2종류(기본+특화1개) — 사용자 예시(GPU 기본3.5·특화4.0→3.6점)", () => {
    expect(combineHardwareTiers(3.5, [4.0])).toBeCloseTo(3.6, 4);
  });
  it("3종류(기본+특화2개) — 사용자 예시(CPU 기본3.5·특화4.0·특화4.5→3.65점)", () => {
    expect(combineHardwareTiers(3.5, [4.0, 4.5])).toBeCloseTo(3.65, 4);
  });
  it("기본이 없고 특화만 있으면(드문 데이터 이슈) 특화들만 단순평균", () => {
    expect(combineHardwareTiers(null, [4.0, 5.0])).toBe(4.5);
  });
  it("전부 없으면 null", () => {
    expect(combineHardwareTiers(null, [])).toBeNull();
  });
});

describe("scoreFromMonitor (모니터, 2026-08-30 재보정 — 경쟁력 평가 기준 최종본 §10)", () => {
  it("400Hz 이상은 5점", () => {
    expect(scoreFromMonitor("400Hz")).toBe(5);
  });
  it("360~399Hz는 4.75점", () => {
    expect(scoreFromMonitor("360Hz")).toBe(4.75);
  });
  it("300~359Hz는 4.5점", () => {
    expect(scoreFromMonitor("300Hz")).toBe(4.5);
  });
  it("241~299Hz는 4점", () => {
    expect(scoreFromMonitor("280Hz")).toBe(4);
  });
  it("201~240Hz(32인치FHD240Hz 기준점 포함)는 3.5점", () => {
    expect(scoreFromMonitor("240Hz")).toBe(3.5);
    expect(scoreFromMonitor("200Hz")).not.toBe(3.5); // 200은 아래 구간
  });
  it("166~200Hz는 3.25점", () => {
    expect(scoreFromMonitor("200Hz")).toBe(3.25);
  });
  it("144~165Hz(32인치FHD144-165Hz 기준점)는 3점", () => {
    expect(scoreFromMonitor("165Hz")).toBe(3);
    expect(scoreFromMonitor("144Hz")).toBe(3);
  });
  it("120~143Hz는 2점", () => {
    expect(scoreFromMonitor("120Hz")).toBe(2);
  });
  it("120Hz 미만은 1.5점", () => {
    expect(scoreFromMonitor("100Hz")).toBe(1.5);
  });
  it("Hz를 못 뽑거나 텍스트가 없으면(모델 사전에도 없으면) null", () => {
    expect(scoreFromMonitor("BenQ XL2540X")).toBeNull();
    expect(scoreFromMonitor(null)).toBeNull();
  });
  it("OLED·4K·UHD는 Hz와 무관하게 고정 5점", () => {
    expect(scoreFromMonitor("144Hz OLED")).toBe(5);
    expect(scoreFromMonitor("4K 60Hz")).toBe(5);
  });
  it("같은 Hz라도 QHD/WQHD면 +1.0(최대 5) — 27인치QHD165Hz=4.0 기준점", () => {
    expect(scoreFromMonitor("165Hz QHD")).toBe(4); // 32인치FHD165Hz(3.0)+1.0
    expect(scoreFromMonitor("165Hz FHD")).toBe(3); // FHD 명시는 가산 없음
  });
  it("34인치는 LG가 아니면 WQHD로 간주해 가산한다", () => {
    expect(scoreFromMonitor("34인치 165Hz")).toBe(4); // 3.0+1.0
    expect(scoreFromMonitor("LG 34인치 165Hz")).toBe(3); // LG는 가산 없음(§10 자사 34인치 예외)
  });
  it("BenQ ZOWIE는 계산값과 4.5 중 큰 값(특화 사양 하한)", () => {
    expect(scoreFromMonitor("BenQ ZOWIE 165Hz")).toBe(4.5); // 3.0보다 4.5가 큼
    expect(scoreFromMonitor("BenQ ZOWIE 400Hz")).toBe(5); // 5.0이 4.5보다 큼
  });
  it("한 줄에 Hz가 여러 개면 평균 낸다", () => {
    // (240+300)/2 = 270Hz → 241~299 구간=4점
    expect(scoreFromMonitor("240Hz, 300Hz")).toBe(4);
  });
  it("Hz가 없으면 모델명 사전(MONITOR_MODEL_HZ_TABLE)에서 찾는다(대소문자·공백 무시, 부분일치)", () => {
    const table = { "2546K": 240, "27GP850": 165 };
    expect(scoreFromMonitor("벤큐 2546K", table)).toBe(3.5); // 240Hz로 매칭
  });
  it("콤마로 여러 모델이 나열돼 있으면 매칭된 모델들의 Hz를 평균한다", () => {
    const table = { "2546K": 240, "27GP850": 165 };
    // 매칭: 2546K(240)+27GP850(165) → 평균 202.5Hz → 201~240 구간=3.5점 (GP750은 표에 없어 무시)
    expect(scoreFromMonitor("벤큐 2546K, LG울트라기어 GP750, LG 27GP850", table)).toBe(3.5);
  });
  it("사전에도 없는 모델명이면 null(지어내지 않음)", () => {
    expect(scoreFromMonitor("벤큐 2546K, LG울트라기어 GP750", {})).toBeNull();
  });
  it("기본 MONITOR_MODEL_HZ_TABLE(사용자 확인, 2026-08-28)로 실제 매장 문구를 채점한다", () => {
    // 전대후문점 실사례: 벤큐2546K(240)+벤큐2746K(240)+GP750(240)+GP850(165) 평균=221.25Hz → 3.5점
    expect(scoreFromMonitor("벤큐 2546K, 벤큐 2746K, LG울트라기어 GP750, LG울트라기어 GP850")).toBe(3.5);
    expect(scoreFromMonitor("DELL")).toBe(4.75); // 360Hz
  });
});

describe("scoreFromVgaSpec/scoreFromCpuSpec/scoreFromRamSpec/scoreFromMonitorSpec (기본/특화 결합, 2026-08-28 재설계)", () => {
  it("GPU — 기본만 있으면 기본 그대로", () => {
    expect(scoreFromVgaSpec("RTX 5060", null, null)).toBeCloseTo(4, 2);
  });
  it("GPU — 기본+특화1(2종류) combineHardwareTiers로 결합", () => {
    // RTX4060=3, RTX5060=4 → 3*.8+4*.2=3.2
    expect(scoreFromVgaSpec("RTX 4060", "RTX 5060", null)).toBeCloseTo(3.2, 2);
  });
  it("GPU — 기본+특화1+특화2(3종류)", () => {
    // RTX4060=3, RTX5060=4, RTX5070=4.5 → 3*.8+(4+4.5)/2*.2=2.4+0.85=3.25
    expect(scoreFromVgaSpec("RTX 4060", "RTX 5060", "RTX 5070")).toBeCloseTo(3.25, 2);
  });
  it("CPU — 기본+특화1(14400=4, 13400=3) → 4*.8+3*.2=3.8", () => {
    expect(scoreFromCpuSpec("14400", "13400", null)).toBeCloseTo(3.8, 2);
  });
  it("RAM — 기본+특화(16G=3.5, 32G=4.5) → 3.5*.8+4.5*.2=3.7", () => {
    expect(scoreFromRamSpec("16G", "32G")).toBeCloseTo(3.7, 2);
  });
  it("모니터 — 기본+특화(240Hz=3.5, 300Hz=4.5) → 3.5*.8+4.5*.2=3.7", () => {
    expect(scoreFromMonitorSpec("240Hz", "300Hz")).toBeCloseTo(3.7, 2);
  });
  it("전부 없으면 null", () => {
    expect(scoreFromVgaSpec(null, null, null)).toBeNull();
    expect(scoreFromCpuSpec(null, null, null)).toBeNull();
    expect(scoreFromRamSpec(null, null)).toBeNull();
    expect(scoreFromMonitorSpec(null, null)).toBeNull();
  });
});

describe("computeSpecScore (하드웨어점수 = GPU40%+모니터25%+CPU20%+RAM15%, 2026-08-28 전면개편)", () => {
  const blankItems = { vgaBase: null, vgaTop: null, vgaTop2: null, cpu: null, cpuTop1: null, cpuTop2: null, ram: null, ramTop: null, monitorBase: null, monitorTop: null };
  it("GPU만 있으면 GPU 점수 그대로", () => {
    expect(computeSpecScore({ ...blankItems, vgaBase: "RTX 4060" }, settings)).toBeCloseTo(3, 10);
  });
  it("모니터만 있으면 모니터 점수 그대로", () => {
    expect(computeSpecScore({ ...blankItems, monitorBase: "300Hz" }, settings)).toBe(4.5);
  });
  it("GPU+CPU+RAM+모니터가 다 있으면 40/20/15/25 가중평균", () => {
    // GPU: RTX4060(3점) / CPU: 14400(4점) / RAM: 32G(2026-08-30 재보정 4.5점) / 모니터: 240Hz(3.5점)
    // 3*.4 + 3.5*.25 + 4.5*.15 + 4*.2 = 1.2+0.875+0.675+0.8 = 3.55
    expect(
      computeSpecScore(
        { vgaBase: "RTX 4060", vgaTop: null, vgaTop2: null, cpu: "14400", cpuTop1: null, cpuTop2: null, ram: "32G", ramTop: null, monitorBase: "240Hz", monitorTop: null },
        settings,
      ),
    ).toBeCloseTo(3.55, 2);
  });
  it("전부 없으면 null(지어내지 않음)", () => {
    expect(computeSpecScore(blankItems, settings)).toBeNull();
  });
});

describe("computeFoodScore (먹거리 브랜드 기준, 2026-08-30 우선순위 반전 — 경쟁력 평가 기준 최종본 §11)", () => {
  it("직접입력값이 있으면 브랜드 프리셋보다 우선한다(사용자 확인: 확인된 경우에만 가감)", () => {
    expect(computeFoodScore({ brand: "쉐프앤클릭", legacyScore: 2 }, settings)).toBe(2);
    expect(computeFoodScore({ brand: "비바쿡", legacyScore: 4.5 }, settings)).toBe(4.5);
  });
  it("직접입력값이 없으면 브랜드 프리셋을 쓴다", () => {
    expect(computeFoodScore({ brand: "쉐프앤클릭", legacyScore: null }, settings)).toBe(settings.foodBrandScores.쉐프앤클릭);
    expect(computeFoodScore({ brand: "비바쿡", legacyScore: null }, settings)).toBe(settings.foodBrandScores.비바쿡);
  });
  it("브랜드없음이면 직접입력값(legacyScore)을 쓴다", () => {
    expect(computeFoodScore({ brand: "브랜드없음", legacyScore: 2 }, settings)).toBe(2);
  });
  it("브랜드를 안 정했으면(null) 직접입력값(legacyScore)을 쓴다", () => {
    expect(computeFoodScore({ brand: null, legacyScore: 3 }, settings)).toBe(3);
  });
  it("브랜드도 직접입력값도 없으면 null", () => {
    expect(computeFoodScore({ brand: null, legacyScore: null }, settings)).toBeNull();
  });
});

describe("computeFreshnessFromYear/resolveFreshnessScore (경쟁력 평가 기준 최종본 §7, 2026-08-30)", () => {
  const thisYear = new Date().getFullYear();
  it("리뉴얼연도 기준 연차별 점수", () => {
    expect(computeFreshnessFromYear(thisYear, null)).toBe(5.0); // 0년(1년 이하)
    expect(computeFreshnessFromYear(thisYear - 2, null)).toBe(4.5); // 2년
    expect(computeFreshnessFromYear(thisYear - 3, null)).toBe(4.0); // 3년
    expect(computeFreshnessFromYear(thisYear - 4, null)).toBe(3.5); // 4년
    expect(computeFreshnessFromYear(thisYear - 6, null)).toBe(3.0); // 6년
    expect(computeFreshnessFromYear(thisYear - 7, null)).toBe(2.5); // 6년 초과
  });
  it("리뉴얼연도가 없으면 오픈일에서 연도를 뽑는다", () => {
    expect(computeFreshnessFromYear(null, `${thisYear - 1}-05-01`)).toBe(5.0);
  });
  it("리뉴얼연도가 있으면 오픈일보다 우선한다", () => {
    expect(computeFreshnessFromYear(thisYear, `${thisYear - 10}-01-01`)).toBe(5.0);
  });
  it("둘 다 없으면 null", () => {
    expect(computeFreshnessFromYear(null, null)).toBeNull();
  });
  it("직접입력(조사자 확인값)이 있으면 연도 계산보다 우선한다", () => {
    expect(resolveFreshnessScore(2, thisYear, null)).toBe(2); // 새 건물이어도 직접 확인한 노후도가 우선
  });
  it("직접입력이 없으면 연도 기반 자동계산으로 폴백", () => {
    expect(resolveFreshnessScore(null, thisYear - 6, null)).toBe(3.0);
  });
});

describe("computeZoneScore/computeZoneAchievement/computeSingleSeatBonus (경쟁력 평가 기준 최종본 §3~6, 2026-08-30)", () => {
  const blankCounts = { teamRoom: null, room2: null, coupleZone: null, vipZone: null, friendsZone: null, singleSeatCount: null, room1: null, firstClassZone: null };
  it("주요 존 가산점 환산 예시값과 일치한다(팀룸2개+0.50, 커플존4개+0.40, VIP존5개+0.30, 프렌즈존10개+0.40)", () => {
    expect(computeZoneScore({ ...blankCounts, teamRoom: 2 })).toBeCloseTo(2.0 + 0.5, 6);
    expect(computeZoneScore({ ...blankCounts, coupleZone: 4 })).toBeCloseTo(2.0 + 0.4, 6);
    expect(computeZoneScore({ ...blankCounts, vipZone: 5 })).toBeCloseTo(2.0 + 0.3, 6);
    expect(computeZoneScore({ ...blankCounts, friendsZone: 10 })).toBeCloseTo(2.0 + 0.4, 6);
    expect(computeZoneScore({ ...blankCounts, room2: 2 })).toBeCloseTo(2.0 + 0.4, 6); // 2인룸 2개 기준 +0.40
  });
  it("팀룸 1개는 +0.25, 3개 이상은 150%까지만 반영돼 최대 +0.75", () => {
    expect(computeZoneScore({ ...blankCounts, teamRoom: 1 })).toBeCloseTo(2.0 + 0.25, 6);
    expect(computeZoneScore({ ...blankCounts, teamRoom: 3 })).toBeCloseTo(2.0 + 0.75, 6);
    expect(computeZoneScore({ ...blankCounts, teamRoom: 10 })).toBeCloseTo(2.0 + 0.75, 6); // 상한 클램프
  });
  it("1인 특화 가산점 — 1인석 10개 +0.1, 1인룸 5개 +0.2, 합산 최대 +0.2", () => {
    expect(computeSingleSeatBonus(10, 0)).toBeCloseTo(0.1, 6);
    expect(computeSingleSeatBonus(0, 5)).toBeCloseTo(0.2, 6);
    expect(computeSingleSeatBonus(10, 5)).toBeCloseTo(0.2, 6); // 0.1+0.2=0.3이지만 상한 0.2로 클램프
  });
  it("퍼스트클래스존 보유 시 +0.5, 여러 개라도 최대 +0.5", () => {
    expect(computeZoneScore({ ...blankCounts, firstClassZone: 1 })).toBeCloseTo(2.5, 6);
    expect(computeZoneScore({ ...blankCounts, firstClassZone: 3 })).toBeCloseTo(2.5, 6);
  });
  it("모든 존이 만점이면 상한 5점으로 클램프", () => {
    expect(computeZoneScore({ teamRoom: 3, room2: 3, coupleZone: 6, vipZone: 8, friendsZone: 15, singleSeatCount: 10, room1: 5, firstClassZone: 1 })).toBe(5);
  });
  it("존 개수가 전부 없으면 null(레거시 직접입력 폴백 대상)", () => {
    expect(computeZoneScore(blankCounts)).toBeNull();
  });
  it("resolveSeatZoneScore — 하나라도 채워지면 자동계산, 전부 없으면 legacy 직접입력으로 폴백", () => {
    expect(resolveSeatZoneScore({ ...blankCounts, teamRoom: 2 }, 3)).toBeCloseTo(2.5, 6); // 자동계산이 legacy(3)보다 우선
    expect(resolveSeatZoneScore(blankCounts, 3)).toBe(3);
    expect(resolveSeatZoneScore(blankCounts, null)).toBeNull();
  });
});

describe("computeOwnLocationScore (경쟁력 평가 기준 최종본 §12 — 자사/후보지 입지점수, 2026-08-30)", () => {
  const facts = { floor: 1, groundLevel: "지하" as const, hasElevator: false }; // computeLocationScoreFromFacts → 4
  it("09_입지동선평가가 있으면 4요소 조합을 쓴다", () => {
    const loc = { locationScore: 4, flowScore: 4, preemptionScore: 3, visibilityScore: 4 };
    expect(computeOwnLocationScore(loc, facts, settings)).toBeCloseTo(3.75, 2); // 기존 computeLocationCompositeScore 테스트와 동일 사례
  });
  it("09_입지동선평가가 없으면 층수+엘리베이터 자동계산으로 폴백한다", () => {
    expect(computeOwnLocationScore(null, facts, settings)).toBe(4);
  });
  it("09_입지동선평가가 일부만 채워져 있으면(미완성) 폴백한다", () => {
    const loc = { locationScore: 4, flowScore: null, preemptionScore: 3, visibilityScore: 4 };
    expect(computeOwnLocationScore(loc, facts, settings)).toBe(4);
  });
});

describe("computeInteriorSeatManagementScore (좌석존구성50%+최신성25%+청결관리15%+편의성10%, 2026-08-28 전면개편)", () => {
  const interiorWeights = { seatZone: 0.5, freshness: 0.25, cleanliness: 0.15, comfort: 0.1 };
  it("넷 다 있으면 가중평균(2026-08-30부터 반올림 금지 — §15)", () => {
    // 4*.5 + 3*.25 + 3*.15 + 2*.1 = 2+0.75+0.45+0.2 = 3.4 (반올림 없음)
    expect(
      computeInteriorSeatManagementScore(
        { seatZoneScore: 4, freshnessScore: 3, cleanlinessScore: 3, comfortScore: 2, legacyScore: null },
        { interiorWeights },
      ),
    ).toBeCloseTo(3.4, 2);
  });
  it("일부만 있으면 채워진 항목의 가중치로 재정규화", () => {
    expect(
      computeInteriorSeatManagementScore(
        { seatZoneScore: 4, freshnessScore: null, cleanlinessScore: null, comfortScore: null, legacyScore: null },
        { interiorWeights },
      ),
    ).toBe(4);
  });
  it("넷 다 없으면 직접입력값(legacyScore)으로 폴백 — 기존 40개 매장은 항상 이 경로", () => {
    expect(
      computeInteriorSeatManagementScore(
        { seatZoneScore: null, freshnessScore: null, cleanlinessScore: null, comfortScore: null, legacyScore: 4 },
        { interiorWeights },
      ),
    ).toBe(4);
  });
});

describe("applyStandardOwnFacilityDefaults (07_신규후보지 헤더 메모: 비우면 표준값 적용, 2026-08-21)", () => {
  const blank = {
    ownTeamRoom: null,
    ownCoupleZone: null,
    ownVipZone: null,
    ownFriendsZone: null,
    ownFoodScore: null,
    ownInteriorScore: null,
  };
  it("전부 비어있으면 표준값(팀룸2·커플존3·VIP존5·프렌즈존15·먹거리/인테리어5점)을 적용한다", () => {
    // 2026-08-27: 오픈 초기 기준 먹거리/인테리어는 "상"(5점)이 더 현실적이라는 사용자 확인으로
    // 4→5로 올렸다(원본 시트 "빈칸이면 4" 규칙과 달라진 값 — 의도된 재조정). 2026-08-28(2차):
    // 모니터가 텍스트 자동채점으로 바뀌며 "표준값 4" 폴백 자체가 없어져 반환값에서 빠졌다.
    // 2026-08-30: 게임존 가산점 폐지로 ownGameZoneCount/gameZoneCount 필드 자체를 없앴다.
    expect(applyStandardOwnFacilityDefaults(blank)).toEqual({
      ownTeamRoom: 2,
      ownCoupleZone: 3,
      ownVipZone: 5,
      ownFriendsZone: 15,
      ownFoodScore: 5,
      ownInteriorScore: 5,
    });
  });
  it("실제 값이 입력돼 있으면 표준값으로 덮어쓰지 않는다", () => {
    const real = { ...blank, ownTeamRoom: 0, ownFoodScore: 2 };
    const result = applyStandardOwnFacilityDefaults(real);
    expect(result.ownTeamRoom).toBe(0); // 0은 "값 있음"이므로 표준값(2)으로 안 바뀐다
    expect(result.ownFoodScore).toBe(2);
    expect(result.ownVipZone).toBe(5); // 나머지 비어있는 항목은 여전히 표준값
  });
  it("신중동점(N001) 실사례 — 2026-08-28 (2차) 모니터가 텍스트 자동채점으로 바뀌며 표준값(4점) 폴백이 없어짐(GPU만 있으면 GPU 가중치로만 재정규화)", () => {
    const facility = applyStandardOwnFacilityDefaults(blank);
    const spec = computeSpecScore(
      {
        vgaBase: "RTX 5060",
        vgaTop: null,
        vgaTop2: null,
        cpu: null,
        cpuTop1: null,
        cpuTop2: null,
        ram: null,
        ramTop: null,
        monitorBase: null,
        monitorTop: null,
      },
      settings,
    );
    // GPU: RTX5060(4점, 앵커, 2026-08-30 게임존 가산 폐지) — CPU/RAM/모니터 전부 비어서 GPU 가중치만으로 재정규화
    expect(spec).toBeCloseTo(4, 2);
    const interior = computeInteriorSeatManagementScore(
      { seatZoneScore: null, freshnessScore: null, cleanlinessScore: null, comfortScore: null, legacyScore: facility.ownInteriorScore },
      settings,
    );
    expect(interior).toBe(5); // 세부항목 전부 비어서 표준값(5) 폴백
    const competitivenessSettings = { competitivenessWeights: defaultModelSettings().competitivenessWeights };
    const total = computeCompetitivenessScore(
      { spec, food: facility.ownFoodScore, interior, location: computeLocationScoreFromFacts(1, "지하", false) },
      competitivenessSettings,
    );
    // 4*.3 + 5*.2 + 5*.4 + 4*.1 = 1.2+1+2+0.4 = 4.6
    expect(total).toBeCloseTo(4.6, 2);
  });
});

describe("computeLocationScoreFromFacts (입지점수 = 층수+엘리베이터+지상/지하)", () => {
  it("지하1층 + 엘리베이터 없음 → 4점 (전대후문점 실적 1위 근거, 지하1~2층은 1~2층과 동급)", () => {
    expect(computeLocationScoreFromFacts(1, "지하", false)).toBe(4);
  });
  it("3층 + 엘리베이터 있음 → 4점", () => {
    expect(computeLocationScoreFromFacts(3, "지상", true)).toBe(4);
  });
  it("6층 이상 + 엘리베이터 없음 → 0점", () => {
    expect(computeLocationScoreFromFacts(6, "지상", false)).toBe(0);
  });
  it("층수 미입력 → null", () => {
    expect(computeLocationScoreFromFacts(null, "지상", true)).toBeNull();
  });
});

describe("computeFloatingRawDemand (40개 상권 평균 연령구성 대체값 — data-issues.md #5 해결)", () => {
  it("연령구성 입력이 없어도 유동인구 평균만 있으면 40개 상권 평균 구성으로 계산한다", () => {
    const candidate = { floating500Avg: 8000 } as unknown as CandidateInput;
    expect(computeFloatingRawDemand(candidate)).toBeCloseTo(654.44, 1);
  });
  it("유동인구 평균 자체가 없으면 null", () => {
    const candidate = {} as unknown as CandidateInput;
    expect(computeFloatingRawDemand(candidate)).toBeNull();
  });
});

describe("computeMarketDemand — 주거중심인데 반경1km 연령실측 미달 시 유동원수요로 대체(analyzeMarket_ 원본, 2026-08-22 발견/수정)", () => {
  const demandSettings = { marketCharacterThreshold: settings.marketCharacterThreshold, marketDemandEffectiveRate: settings.marketDemandEffectiveRate };
  it("주거중심이고 거주인구 실측이 있으면 주거원수요×주거유효율을 쓴다", () => {
    const candidate = {
      floating500Avg: 1000,
      pop500m: 1000, // 유동/거주 비율 1 → 주거중심
      pop1km: 1000,
      male1kmRatio: 0.5,
      age1km_0_9: 100,
      age1km_10_19: 100,
      age1km_20_29: 100,
      age1km_30_39: 100,
      age1km_40_49: 100,
      age1km_50_59: 100,
      age1km_60_69: 0,
      age1km_70_79: 0,
      age1km_80plus: 0,
    } as unknown as CandidateInput;
    const result = computeMarketDemand(candidate, demandSettings);
    expect(result.marketCharacter).toBe("주거중심");
    expect(result.demandSource).toBe("주거");
    expect(result.marketDemand).not.toBeNull();
  });
  it("주거중심인데 반경1km 연령실측이 총인구의 50% 미달(거주원수요 null)이어도, 유동원수요×혼합유효율로 상권수요를 낸다(추측 아님 — 원본이 설계한 대체 계산)", () => {
    const candidate = {
      floating500Avg: 1000,
      pop500m: 1000, // 주거중심
      pop1km: 1000,
      age1km_0_9: 10, // 총 10명, 총인구 1000명의 1% → 50% 미달 → residentDemand null
    } as unknown as CandidateInput;
    const result = computeMarketDemand(candidate, demandSettings);
    expect(result.marketCharacter).toBe("주거중심");
    expect(result.demandSource).toBe("유동");
    expect(result.marketDemand).not.toBeNull();
    expect(result.marketDemand).toBe(Math.round((computeFloatingRawDemand(candidate) ?? 0) * settings.marketDemandEffectiveRate.mixed));
  });
  it("유동인구 평균이 없으면 상권성격 자체를 못 정하므로(대체할 원수요도 없음) null", () => {
    // floating500Avg가 없으면 computeMarketCharacter/computeFloatingRawDemand 둘 다 null이라
    // "주거중심인데 대체할 유동원수요조차 없는" 상황은 이 경로로만 재현된다.
    const candidate = { pop500m: 1000, pop1km: 1000, male1kmRatio: 0.5, age1km_0_9: 10 } as unknown as CandidateInput;
    const result = computeMarketDemand(candidate, demandSettings);
    expect(result.marketCharacter).toBeNull();
    expect(result.marketDemand).toBeNull();
  });
});

describe("fitNonnegativeRidgeRegression (V61 비음수 릿지회귀 좌표하강법)", () => {
  it("완전한 선형관계(y=2x)를 잡아낸다", () => {
    const z = [[-1], [0], [1], [2]];
    const y = z.map(([x]) => 2 * x);
    const beta = fitNonnegativeRidgeRegression(z, y, 0.01);
    expect(beta).not.toBeNull();
    expect(beta![0]).toBeCloseTo(2, 1);
  });
  it("음의 상관관계는 0으로 제한된다(비음수 제약)", () => {
    const z = [[-1], [0], [1], [2]];
    const y = z.map(([x]) => -2 * x);
    const beta = fitNonnegativeRidgeRegression(z, y, 0.01);
    expect(beta![0]).toBe(0);
  });
});

describe("fitEmpiricalRevenueModel/predictEmpiricalRevenue (V61 정상운영모형)", () => {
  it("최소 학습표본 미달이면 null", () => {
    const samples: EmpiricalRevenueSample[] = Array.from({ length: 3 }, (_, i) => ({
      featuresRaw: [Math.log(1000 + i), Math.log(10 + i), 4],
      revenuePerPc: 600000 + i * 1000,
    }));
    expect(fitEmpiricalRevenueModel(samples, 1, 12)).toBeNull();
  });
  it("표본이 충분하면 학습해서 예측한다", () => {
    const samples: EmpiricalRevenueSample[] = Array.from({ length: 12 }, (_, i) => ({
      featuresRaw: [Math.log(1000 + i * 20), Math.log(10 + i), 3 + (i % 3) * 0.5],
      revenuePerPc: 500000 + i * 15000,
    }));
    const model = fitEmpiricalRevenueModel(samples, 1, 12);
    expect(model).not.toBeNull();
    expect(model!.sampleCount).toBe(12);
    const prediction = predictEmpiricalRevenue(model!, [Math.log(1100), Math.log(12), 4], 100, 0.6, 0.4);
    expect(prediction).not.toBeNull();
    expect(prediction!.monthlyRevenue).toBeGreaterThan(0);
    expect(prediction!.dailyRevenuePerPc).toBeGreaterThan(0);
  });

  // 2026-08-25 추가 — "적용된 산식과 계수 보기"에서 예측이 실제로 어떻게 나왔는지 화면에
  // 보여주기 위해 predictEmpiricalRevenue가 중간값(explain)을 노출하게 됐다. 그 중간값들이
  // 서로 정합적인 관계를 실제로 만족하는지 확인한다(계산 로직 자체 회귀 방지).
  it("explain의 중간값들이 최종 monthlyRevenue와 수학적으로 정합한다", () => {
    const samples: EmpiricalRevenueSample[] = Array.from({ length: 12 }, (_, i) => ({
      featuresRaw: [Math.log(1000 + i * 20), Math.log(10 + i), 3 + (i % 3) * 0.5],
      revenuePerPc: 500000 + i * 15000,
    }));
    const model = fitEmpiricalRevenueModel(samples, 1, 12)!;
    const featuresRaw = [Math.log(1100), Math.log(12), 4];
    const pcCount = 100;
    const ridgeWeight = 0.6;
    const baselineWeight = 0.4;
    const prediction = predictEmpiricalRevenue(model, featuresRaw, pcCount, ridgeWeight, baselineWeight)!;

    // z = (원값 - 학습평균) / 학습표준편차
    featuresRaw.forEach((v, j) => {
      expect(prediction.explain.z[j]).toBeCloseTo((v - model.featureMeans[j]) / model.featureSds[j], 10);
    });
    // logPerPc = yMean + Σ(z × 학습된 가중치)
    const expectedLogPerPc = model.yMean + prediction.explain.z.reduce((s, v, j) => s + v * model.coefficients[j], 0);
    expect(prediction.explain.logPerPc).toBeCloseTo(expectedLogPerPc, 10);
    // 회귀예측매출 = exp(logPerPc) × PC대수
    expect(prediction.explain.ridgeRevenue).toBeCloseTo(Math.exp(prediction.explain.logPerPc) * pcCount, 6);
    // 기준모형매출 = 대당월매출 중앙값 × PC대수
    expect(prediction.explain.baselineRevenue).toBeCloseTo(model.perPcMedian * pcCount, 6);
    // 최종 = 회귀예측매출×비중 + 기준모형매출×비중 (반올림 전)
    const blended = prediction.explain.ridgeRevenue * ridgeWeight + prediction.explain.baselineRevenue * baselineWeight;
    expect(prediction.monthlyRevenue).toBe(Math.round(blended));
  });
});

describe("computeExpectedOwnDemand (예측_자사수요 = 상권수요 × 점유율)", () => {
  it("경쟁점이 없으면 점유율 100%", () => {
    expect(computeExpectedOwnDemand(1000, 100, 1.2, 0)).toBe(1000);
  });
  it("자사IP×격차 대 경쟁IP 비례로 나눈다", () => {
    // 점유율 = (100*1.5)/(100*1.5+150) = 150/300 = 0.5
    expect(computeExpectedOwnDemand(2000, 100, 1.5, 150)).toBe(1000);
  });
});

describe("lookupDemandCapture (경쟁력격차 → 수요확보율/신규수요증가율 룩업표)", () => {
  const table = defaultModelSettings().demandCaptureTable;
  it.each([
    [-1, 0.4, 0],
    [0.79, 0.4, 0],
    [0.8, 0.5, 0],
    [1.0, 0.55, 0.03],
    [1.29, 0.55, 0.03],
    [1.3, 0.6, 0.05],
    [1.7, 0.65, 0.1],
    [2.2, 0.7, 0.12],
    [10, 0.7, 0.12],
  ])("격차 %s → 확보율 %s, 증가율 %s", (gap, capture, growth) => {
    const result = lookupDemandCapture(gap, table);
    expect(result?.captureRate).toBeCloseTo(capture, 5);
    expect(result?.growthRate).toBeCloseTo(growth, 5);
  });
  it("격차가 null이면 null", () => {
    expect(lookupDemandCapture(null, table)).toBeNull();
  });
});

describe("computeCompetitorAppliedPcCount — 오픈예정 경쟁점 처리(2026-08-27)", () => {
  it("PC대수가 알려져 있으면(네이버지도 등) 그 값을 그대로 쓴다", () => {
    expect(computeCompetitorAppliedPcCount({ totalPcCount: 100, appliedPcCount: null, surveyLevel: null, investigationStatus: "오픈예정" })).toBe(100);
  });
  it("PC대수를 모르면 노후저경쟁력미조사와 동일하게 간략_기본대수(70)로 채운다", () => {
    expect(computeCompetitorAppliedPcCount({ totalPcCount: null, appliedPcCount: null, surveyLevel: null, investigationStatus: "오픈예정" })).toBe(70);
  });
});

describe("computeCompetitorOccupiedSeats (경쟁점 실가동좌석 — 요청사항 5: 미조사/값누락 구분)", () => {
  function comp(overrides: Partial<Parameters<typeof computeCompetitorOccupiedSeats>[0][number]>) {
    return {
      id: "x",
      candidateCode: "N001",
      name: "c",
      surveyLevel: null,
      investigationStatus: "조사완료" as const,
      address: null,
      distanceM: null,
      floor: null,
      groundLevel: null,
      totalPcCount: null,
      appliedPcCount: null,
      hasElevator: null,
      cpu: null,
      cpuTop1: null,
      cpuTop2: null,
      vgaBase: null,
      vgaTop: null,
      vgaTop2: null,
      ram: null,
      ramTop: null,
      monitorBase: null,
      monitorTop: null,
      ratePer1000Won: null,
      hourlyRateConverted: null,
      paidDeduction: null,
      visitedAt: null,
      visitedDow: null,
      visitorCount: null,
      measuredSeatRate: null,
      pingbotUtilization: null,
      pingbotPeriod: null,
      renovationYear: null,
      foodScore: null,
      foodBasis: null,
      foodBrand: null,
      interiorScore: null,
      interiorBasis: null,
      interiorLevelScore: null,
      interiorConditionScore: null,
      monitorBasis: null,
      seatZoneScore: null,
      comfortScore: null,
      singleSeatCount: null,
      room1: null,
      room2: null,
      teamRoom: null,
      coupleZone: null,
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  it("핑봇_가동률 실측값을 적용대수와 곱해 합산한다(0~1/%표기 모두 지원)", () => {
    const result = computeCompetitorOccupiedSeats([
      comp({ appliedPcCount: 100, pingbotUtilization: 0.3 }),
      comp({ appliedPcCount: 50, pingbotUtilization: 40 }), // 40 → 0.4로 정규화
    ]);
    expect(result.seats).toBeCloseTo(100 * 0.3 + 50 * 0.4, 2);
    expect(result.coverage.measured).toBe(2);
  });

  it("노후저경쟁력미조사는 0을 더하되 '미조사로 제외'로 구분한다(값 누락과 다르게 표시)", () => {
    const result = computeCompetitorOccupiedSeats([
      comp({ appliedPcCount: 100, pingbotUtilization: 0.3 }),
      comp({ investigationStatus: "노후저경쟁력미조사" }),
    ]);
    expect(result.seats).toBeCloseTo(30, 2);
    expect(result.coverage.assumedLowThreat).toBe(1);
    expect(result.coverage.missingData).toBe(0);
  });

  it("오픈예정은 0을 더하되 '아직 측정 불가'로 구분한다(값 누락·노후저경쟁력미조사와 다르게 표시, 2026-08-27)", () => {
    const result = computeCompetitorOccupiedSeats([
      comp({ appliedPcCount: 100, pingbotUtilization: 0.3 }),
      comp({ investigationStatus: "오픈예정", totalPcCount: 100 }),
    ]);
    expect(result.seats).toBeCloseTo(30, 2);
    expect(result.coverage.notYetOpen).toBe(1);
    expect(result.coverage.missingData).toBe(0);
    expect(result.coverage.assumedLowThreat).toBe(0);
  });

  it("조사완료인데 값이 없으면 '값 누락'으로 구분한다", () => {
    const result = computeCompetitorOccupiedSeats([
      comp({ appliedPcCount: 100, pingbotUtilization: 0.3 }),
      comp({ investigationStatus: "조사완료", appliedPcCount: 80 }), // 가동률 데이터 없음
    ]);
    expect(result.coverage.missingData).toBe(1);
    expect(result.coverage.assumedLowThreat).toBe(0);
  });

  it("핑봇 없이 실측착석률(현장 방문 시점 실시간값)만 있으면 좌석수에 안 더하고 참고로만 구분한다(2026-08-21, 신중동점 사례)", () => {
    const result = computeCompetitorOccupiedSeats([
      comp({ appliedPcCount: 100, pingbotUtilization: 0.3 }),
      comp({ appliedPcCount: 194, measuredSeatRate: 28.9 }), // 방문 시점 1회 실측, 기간평균 아님
    ]);
    expect(result.seats).toBeCloseTo(30, 2); // 실시간값 194*0.289는 합산에서 빠진다
    expect(result.coverage.measured).toBe(1);
    expect(result.coverage.realtimeSnapshotOnly).toBe(1);
    expect(result.coverage.missingData).toBe(0);
  });

  it("경쟁점없음은 완전히 제외한다", () => {
    const result = computeCompetitorOccupiedSeats([comp({ investigationStatus: "경쟁점없음" })]);
    expect(result.coverage.excludedNoCompetitor).toBe(1);
    expect(result.seats).toBeNull(); // 실측이 하나도 없으므로 산출 불가
  });

  it("실측이 하나도 없으면 null(원본 SUMPRODUCT처럼 빈 값)", () => {
    const result = computeCompetitorOccupiedSeats([comp({ appliedPcCount: 100 })]);
    expect(result.seats).toBeNull();
  });
});

describe("실측기반 예상월매출 파이프라인 (경쟁점 실가동좌석 → 예상평균가동좌석 → 가동률 → 매출)", () => {
  it("예상 평균가동좌석 = 실가동좌석×확보율×(1+증가율)", () => {
    expect(computeExpectedOccupiedSeats(37, 0.6, 0.05)).toBeCloseTo(37 * 0.6 * 1.05, 2);
  });
  it("예상 가동률은 100%를 초과할 수 있다(수요 초과 신호)", () => {
    expect(computeExpectedUtilization(150, 100)).toBeCloseTo(1.5, 4);
  });
  it("실측기반 예상월매출 = 평균가동좌석×24×30×요금÷(1-상품비율)", () => {
    const result = computeMeasuredForecast(23.31, 1200, 0.5, 100);
    expect(result?.monthlyRevenue).toBe(Math.round((23.31 * 24 * 30 * 1200) / 0.5));
    expect(result?.dailyRevenuePerPc).toBe(Math.round((result!.monthlyRevenue) / 100 / 30));
  });
});

describe("computeImpliedUtilizationFromRevenue (2026-08-27, computeMeasuredForecast 역산)", () => {
  it("computeMeasuredForecast로 만든 매출을 거꾸로 풀면 원래 가동률로 되돌아온다", () => {
    const seats = 23.31;
    const pcCount = 100;
    const forecast = computeMeasuredForecast(seats, 1200, 0.5, pcCount);
    const implied = computeImpliedUtilizationFromRevenue(forecast!.monthlyRevenue, 1200, 0.5, pcCount);
    expect(implied).toBeCloseTo(seats / pcCount, 3);
  });
  it("V62 매출이 높으면(회귀모형이 뽑아준 값) 100%를 넘는 값도 그대로 반환한다(잘라내지 않음)", () => {
    const implied = computeImpliedUtilizationFromRevenue(300_000_000, 1500, 0.5, 100);
    expect(implied).toBeGreaterThan(1);
  });
  it("입력값이 없으면 null", () => {
    expect(computeImpliedUtilizationFromRevenue(null, 1500, 0.5, 100)).toBeNull();
    expect(computeImpliedUtilizationFromRevenue(100_000_000, null, 0.5, 100)).toBeNull();
    expect(computeImpliedUtilizationFromRevenue(100_000_000, 1500, 0.5, null)).toBeNull();
  });
});

describe("computeExistingStoreMeasuredForecast (기존 가맹점 실측기반 예상월매출 백테스트, 2026-08-21)", () => {
  const settings = defaultModelSettings();
  function baseStore(overrides: Partial<Parameters<typeof computeExistingStoreMeasuredForecast>[0]> = {}) {
    return {
      storeCode: "S1",
      pcCount: 100,
      evaluationPcCount: null,
      floor: 1,
      groundLevel: "지하" as const,
      hasElevator: false,
      hourlyRate: 1300,
      ownCpu: null,
      ownCpuTop1: null,
      ownCpuTop2: null,
      ownRam: null,
      ownRamTop: null,
      ownVgaBase: "RTX 5060",
      ownVgaTop: null,
      ownVgaTop2: null,
      ownRoom1: 0,
      ownRoom2: 0,
      ownTeamRoom: 2,
      ownCoupleZone: 3,
      ownVipZone: 5,
      ownFriendsZone: 15,
      ownFirstClassZone: null,
      ownSingleSeatCount: null,
      ownFoodScore: 4,
      ownInteriorScore: 4,
      ownMonitorBase: "240Hz", // scoreFromMonitor 2026-08-28(2차) 재보정 = 3.5점
      ownMonitorTop: null,
      ownFoodBrand: null,
      ownInteriorLevelScore: null,
      ownInteriorConditionScore: null,
      ownSeatZoneScore: null,
      ownComfortScore: null,
      ...overrides,
    };
  }
  function competitor(overrides: Partial<Parameters<typeof computeExistingStoreMeasuredForecast>[1][number]> = {}) {
    return {
      id: "c1",
      candidateCode: "S1",
      name: "경쟁점",
      surveyLevel: "상세" as const,
      investigationStatus: "조사완료" as const,
      address: null,
      distanceM: null,
      floor: null,
      groundLevel: null,
      totalPcCount: 100,
      appliedPcCount: 100,
      hasElevator: null,
      cpu: null,
      cpuTop1: null,
      cpuTop2: null,
      vgaBase: null,
      vgaTop: null,
      vgaTop2: null,
      ram: null,
      ramTop: null,
      monitorBase: "200Hz", // scoreFromMonitor("200Hz")=3점(기존 monitorScore:3과 동일 결과)
      monitorTop: null,
      ratePer1000Won: null,
      hourlyRateConverted: null,
      paidDeduction: null,
      visitedAt: null,
      visitedDow: null,
      visitorCount: null,
      measuredSeatRate: null,
      pingbotUtilization: 30,
      pingbotPeriod: "최근 30일",
      renovationYear: null,
      foodScore: 3,
      foodBasis: null,
      foodBrand: null,
      interiorScore: 3,
      interiorBasis: null,
      interiorLevelScore: null,
      interiorConditionScore: null,
      monitorBasis: null,
      seatZoneScore: null,
      comfortScore: null,
      singleSeatCount: null,
      room1: null,
      room2: null,
      teamRoom: null,
      coupleZone: null,
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  it("존구성/VGA가 하나라도 없으면(물리적 시설 사실) 표준값으로 채우지 않고 데이터 부족으로 제외한다", () => {
    const result = computeExistingStoreMeasuredForecast(baseStore({ ownVgaBase: null }), [competitor()], null, settings);
    expect(result.excludedReason).toBe("데이터 부족(자사 존구성/VGA 미완비)");
    expect(result.measuredForecastMonthlyRevenue).toBeNull();
  });

  it("먹거리/인테리어평가(평가자 직접입력)가 없으면 원본 시트 규칙(빈칸이면 4점)으로 채우고 표본에서 빼지 않는다 — 실데이터 26곳 전부 이 항목들이 비어 있었음(2026-08-21 확인). 2026-08-27에 신규후보지 기본값은 4→5로 올렸지만, 기존 가맹점 백테스트는 과거 실적에 새 기준을 소급 적용하면 안 되므로 EXISTING_STORE_FACILITY_DEFAULTS(원본 그대로 4/4)를 따로 쓴다. 모니터는 2026-08-28(2차)부터 텍스트 자동채점이라 비어있으면 표준값 대신 그냥 하드웨어점수 가중치에서 제외된다.", () => {
    const result = computeExistingStoreMeasuredForecast(
      baseStore({ ownFoodScore: null, ownInteriorScore: null, ownMonitorBase: null }),
      [competitor()],
      null,
      settings,
    );
    expect(result.excludedReason).toBeNull();
    // hardware(spec): GPU(RTX5060=4) — CPU/RAM/모니터 없어서 GPU 가중치만 재정규화. food=4
    // (원본 규칙대로 4). interior는 2026-08-30부터 존 개수(팀룸2·커플존3·VIP존5·프렌즈존15)로
    // 자동계산됨(§3~6) — achievement=.25+0+.15+.15+.30=.85 → 2.0+.85*2=3.7. location=4.0
    // → 4*.3+4*.2+3.7*.4+4*.1 = 3.88
    expect(result.ownCompetitivenessScore).toBeCloseTo(3.88, 3);
  });

  it("경쟁점 정보가 없으면 제외한다", () => {
    const result = computeExistingStoreMeasuredForecast(baseStore(), [], null, settings);
    expect(result.excludedReason).toBe("경쟁점 정보 없음");
  });

  it("경쟁점은 있지만 핑봇 실측이 하나도 없으면(방문시점 실시간값만) 제외한다", () => {
    const result = computeExistingStoreMeasuredForecast(
      baseStore(),
      [competitor({ pingbotUtilization: null, measuredSeatRate: 28.9 })],
      null,
      settings,
    );
    expect(result.excludedReason).toBe("경쟁점 실측 데이터 부족(핑봇 실측 없음)");
  });

  it("입력이 완비되면 evaluate.ts와 동일한 조합으로 계산하고, 각 단계 출력이 재조합값과 일치한다", () => {
    const competitors = [competitor()];
    const result = computeExistingStoreMeasuredForecast(baseStore(), competitors, null, settings);
    expect(result.excludedReason).toBeNull();
    // 표준 존구성(팀룸2·커플존3·VIP존5·프렌즈존15)+지하1층·엘리베이터없음 조합. 하드웨어점수는
    // GPU(RTX5060=4), 모니터(240Hz=3.5) — (4*.4+3.5*.25)/(0.4+0.25)=3.808. food=4.
    // interior는 존 개수 자동계산(§3~6)으로 3.7(위 테스트와 동일 계산). location=4
    // → 3.808*.3+4*.2+3.7*.4+4*.1 = 3.822
    expect(result.ownCompetitivenessScore).toBeCloseTo(3.822, 2);

    const capture = lookupDemandCapture(result.competitivenessGap, settings.demandCaptureTable);
    expect(result.demandCaptureRate).toBe(capture?.captureRate ?? null);
    expect(result.newDemandGrowthRate).toBe(capture?.growthRate ?? null);

    const expectedSeats = computeExpectedOccupiedSeats(result.competitorOccupiedSeats, capture?.captureRate ?? null, capture?.growthRate ?? null);
    expect(result.expectedOccupiedSeats).toBeCloseTo(expectedSeats ?? -1, 4);

    const expectedUtil = computeExpectedUtilization(result.expectedOccupiedSeats, 100);
    expect(result.expectedUtilization).toBeCloseTo(expectedUtil ?? -1, 6);

    const forecast = computeMeasuredForecast(result.expectedOccupiedSeats, 1300, settings.measuredForecastProductRatio, 100);
    expect(result.measuredForecastMonthlyRevenue).toBe(forecast?.monthlyRevenue ?? null);
  });

  describe("경쟁점 핑봇 커버율(원본 CONFIG.MODEL.최소커버율=0.70과 같은 개념, 2026-08-22 추가 — 표본 제외 기준이 아니라 참고 신뢰도)", () => {
    it("경쟁점 전부 핑봇 실측이면 커버율 100%, 낮은신뢰도 아님", () => {
      const result = computeExistingStoreMeasuredForecast(baseStore(), [competitor(), competitor({ id: "c2" })], null, settings);
      expect(result.competitorCoverageRatio).toBe(1);
      expect(result.isLowCoverageReliability).toBe(false);
    });
    it("조사된 경쟁점 5곳 중 1곳만 핑봇 실측이면 커버율 20%로 낮은신뢰도 표시하되, 표본에서 빼지는 않는다", () => {
      const competitors = [
        competitor(),
        competitor({ id: "c2", pingbotUtilization: null, measuredSeatRate: 30 }),
        competitor({ id: "c3", pingbotUtilization: null, measuredSeatRate: null }),
        competitor({ id: "c4", pingbotUtilization: null, measuredSeatRate: null }),
        competitor({ id: "c5", pingbotUtilization: null, measuredSeatRate: null }),
      ];
      const result = computeExistingStoreMeasuredForecast(baseStore(), competitors, null, settings);
      expect(result.excludedReason).toBeNull();
      expect(result.competitorCoverageRatio).toBeCloseTo(0.2, 4);
      expect(result.isLowCoverageReliability).toBe(true);
    });
  });

  it("evaluationPcCount(평가기준 대수)를 우선 쓴다 — 오픈 후 증설한 매장을 현재 pcCount로 계산하면 안 됨(2026-08-30 발견)", () => {
    const competitors = [competitor()];
    const expanded = computeExistingStoreMeasuredForecast(baseStore({ pcCount: 200, evaluationPcCount: 100 }), competitors, null, settings);
    const notExpanded = computeExistingStoreMeasuredForecast(baseStore({ pcCount: 100, evaluationPcCount: null }), competitors, null, settings);
    expect(expanded.expectedUtilization).toBeCloseTo(notExpanded.expectedUtilization!, 6);
    expect(expanded.measuredForecastMonthlyRevenue).toBe(notExpanded.measuredForecastMonthlyRevenue);
  });
});

describe("computeExistingStoreDemandEvaluation (2026-08-30 신설 — 핑봇 실측 불필요한 기본 매출예상 경로)", () => {
  const settings = defaultModelSettings();
  function baseStore(overrides: Partial<Parameters<typeof computeExistingStoreDemandEvaluation>[0]> = {}) {
    return {
      storeCode: "S1",
      pcCount: 100,
      evaluationPcCount: null,
      operatingPcStores500m: null,
      floor: 1,
      groundLevel: "지하" as const,
      hasElevator: false,
      ownCpu: null,
      ownCpuTop1: null,
      ownCpuTop2: null,
      ownRam: null,
      ownRamTop: null,
      ownVgaBase: "RTX 5060",
      ownVgaTop: null,
      ownVgaTop2: null,
      ownRoom1: 0,
      ownRoom2: 0,
      ownTeamRoom: 2,
      ownCoupleZone: 3,
      ownVipZone: 5,
      ownFriendsZone: 15,
      ownFirstClassZone: null,
      ownSingleSeatCount: null,
      ownFoodScore: 4,
      ownInteriorScore: 4,
      ownMonitorBase: "240Hz",
      ownMonitorTop: null,
      ownFoodBrand: null,
      ownInteriorLevelScore: null,
      ownInteriorConditionScore: null,
      ownSeatZoneScore: null,
      ownComfortScore: null,
      // 인구/유동인구 — 번화가 기준(유동500 ÷ 인구500 >= downtown 임계값)이 되도록 유동을 크게 잡는다.
      floating500Avg: 50000,
      pop500m: 3000,
      floating500Male: 27500,
      floating500_10s: null,
      floating500_20s: null,
      floating500_30s: null,
      floating500_40s: null,
      floating500_50s: null,
      floating500_60plus: null,
      pop1km: null,
      male1kmRatio: null,
      age1km_0_9: null,
      age1km_10_19: null,
      age1km_20_29: null,
      age1km_30_39: null,
      age1km_40_49: null,
      age1km_50_59: null,
      age1km_60_69: null,
      age1km_70_79: null,
      age1km_80plus: null,
      ...overrides,
    };
  }
  function competitor(overrides: Partial<Parameters<typeof computeExistingStoreDemandEvaluation>[1][number]> = {}) {
    return {
      id: "c1",
      candidateCode: "S1",
      name: "경쟁점",
      surveyLevel: "상세" as const,
      investigationStatus: "조사완료" as const,
      address: null,
      distanceM: null,
      floor: null,
      groundLevel: null,
      totalPcCount: 100,
      appliedPcCount: 100,
      hasElevator: null,
      cpu: null,
      cpuTop1: null,
      cpuTop2: null,
      vgaBase: null,
      vgaTop: null,
      vgaTop2: null,
      ram: null,
      ramTop: null,
      monitorBase: "200Hz",
      monitorTop: null,
      ratePer1000Won: null,
      hourlyRateConverted: null,
      paidDeduction: null,
      visitedAt: null,
      visitedDow: null,
      visitorCount: null,
      // 핑봇 실측이 아예 없어도(가동률 미측정) 이 함수는 값을 내야 한다 — 그게 이 함수의 존재 이유.
      measuredSeatRate: null,
      pingbotUtilization: null,
      pingbotPeriod: null,
      renovationYear: null,
      foodScore: 3,
      foodBasis: null,
      foodBrand: null,
      interiorScore: 3,
      interiorBasis: null,
      interiorLevelScore: null,
      interiorConditionScore: null,
      monitorBasis: null,
      seatZoneScore: null,
      comfortScore: null,
      singleSeatCount: null,
      room1: null,
      room2: null,
      teamRoom: null,
      coupleZone: null,
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  it("경쟁점 핑봇 실측이 하나도 없어도 ownDemand/경쟁력점수를 계산한다(산식에서 핑봇은 필수가 아님, 사용자 확정)", () => {
    const result = computeExistingStoreDemandEvaluation(baseStore(), [competitor()], null, settings);
    expect(result.excludedReason).toBeNull();
    expect(result.ownCompetitivenessScore).not.toBeNull();
    expect(result.marketDemand).not.toBeNull();
    expect(result.ownDemand).not.toBeNull();
  });

  it("자사 존구성/VGA가 미완비면(물리적 시설 사실) 표준값으로 채우지 않고 데이터 부족으로 제외한다", () => {
    const result = computeExistingStoreDemandEvaluation(baseStore({ ownVgaBase: null }), [competitor()], null, settings);
    expect(result.excludedReason).toBe("데이터 부족(자사 존구성/VGA 미완비)");
    expect(result.ownDemand).toBeNull();
  });

  it("경쟁점이 하나도 없어도 제외하지 않는다(computeExistingStoreMeasuredForecast와 달리 경쟁점 실측 자체가 필수 아님) — 경쟁력격차는 1.0(동급) 기본값으로 계산된다", () => {
    const result = computeExistingStoreDemandEvaluation(baseStore(), [], null, settings);
    expect(result.excludedReason).toBeNull();
    expect(result.competitivenessGap).toBe(1.0);
    expect(result.ownDemand).not.toBeNull();
  });

  it("evaluate.ts(evaluateCandidate)와 동일한 조합(원수요×경쟁력격차 확보율)으로 재계산값과 일치한다", () => {
    const competitors = [competitor()];
    const result = computeExistingStoreDemandEvaluation(baseStore(), competitors, null, settings);
    expect(result.excludedReason).toBeNull();

    const { marketDemand } = computeMarketDemand(baseStore(), settings);
    expect(result.marketDemand).toBe(marketDemand);

    const competitorIp = computeCompetitorAppliedPcCount(competitor()) ?? 0;
    expect(result.competitorIp).toBe(competitorIp);

    const expectedOwnDemand = computeExpectedOwnDemand(marketDemand, 100, result.competitivenessGap, result.competitorIp);
    expect(result.ownDemand).toBe(expectedOwnDemand);
  });
});

describe("AA 기준매출 (오픈월부터 10개월 순수익 2,000만원 대당 일매출목표 평균)", () => {
  const targets = defaultModelSettings().aaMonthlyTargets;
  it("1월 오픈·100대 초과분은 100대로 캡", () => {
    // 1~10월 평균을 손으로 검산
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const expectedAvg =
      months.reduce((sum, m) => {
        const t = targets.find((x) => x.month === m)!;
        return sum + t.dailyRevenuePerPcTarget * t.daysInMonth;
      }, 0) / 10;
    expect(computeAaBaselineRevenue(150, 1, targets, 100)).toBe(Math.round(100 * expectedAvg));
  });
  it("11월 오픈이면 다음해 1~8월까지 순환한다", () => {
    const months = [11, 12, 1, 2, 3, 4, 5, 6, 7, 8];
    const expectedAvg =
      months.reduce((sum, m) => {
        const t = targets.find((x) => x.month === m)!;
        return sum + t.dailyRevenuePerPcTarget * t.daysInMonth;
      }, 0) / 10;
    expect(computeAaBaselineRevenue(80, 11, targets, 100)).toBe(Math.round(80 * expectedAvg));
  });
  it("오픈월 미입력이면 null", () => {
    expect(computeAaBaselineRevenue(100, null, targets, 100)).toBeNull();
  });
});

// 2026-08-27 (2차) — 실사례(하안금당사거리점)에서 이 판정이 AA경로(핑봇 실측, 평균오차 52%로
// 확인됨) 기준이라 V62(정식 계산, 7,300만원으로 아주 양호)와 무관하게 "1,000만원 미달"이라는
// 잘못된 경고가 떴다(경쟁점 3곳 중 2곳 핑봇 데이터 누락). V62 최종예상월매출 기준으로 바꿨다
// (사용자 확정) — "데이터 재검토"(AA경로 가동률 초과 감지용) 상태도 같이 없앴다.
describe("judgeAaGrade (13_신규후보지판정!자동평가를 2,000/1,500/1,000만원 3단계로 확장 + V62 기준으로 변경, 2026-08-27)", () => {
  const base = { aaBaselineRevenue2000: 200, aaBaselineRevenue1500: 150, aaBaselineRevenue1000: 100 };
  it("오픈월 없으면 오픈월 입력 필요", () => {
    expect(judgeAaGrade({ plannedOpenMonth: null, forecastRevenue: 300, ...base })).toBe("오픈월 입력 필요");
  });
  it("예측매출이 없으면 실측자료 부족", () => {
    expect(judgeAaGrade({ plannedOpenMonth: 3, forecastRevenue: null, ...base })).toBe("실측자료 부족");
  });
  it("기준값(1,500만원) 하나라도 없으면 실측자료 부족", () => {
    expect(judgeAaGrade({ plannedOpenMonth: 3, forecastRevenue: 300, ...base, aaBaselineRevenue1500: null })).toBe("실측자료 부족");
  });
  it("2,000만원 기준 이상이면 2,000만원 이상", () => {
    expect(judgeAaGrade({ plannedOpenMonth: 3, forecastRevenue: 200, ...base })).toBe("2,000만원 이상");
  });
  it("1,500만원 이상 2,000만원 미만이면 1,500만원 이상", () => {
    expect(judgeAaGrade({ plannedOpenMonth: 3, forecastRevenue: 199, ...base })).toBe("1,500만원 이상");
  });
  it("1,000만원 이상 1,500만원 미만이면 1,000만원 이상", () => {
    expect(judgeAaGrade({ plannedOpenMonth: 3, forecastRevenue: 149, ...base })).toBe("1,000만원 이상");
  });
  it("1,000만원 미만이면 1,000만원 미달", () => {
    expect(judgeAaGrade({ plannedOpenMonth: 3, forecastRevenue: 99, ...base })).toBe("1,000만원 미달");
  });
});

describe("computeSpecialDemandScore (10_오차원인분석 근거 — 대학가·군부대·산업단지만 점수화)", () => {
  it.each([
    ["대학가", "높음", 3],
    ["군부대", "높음", 3],
    ["산업단지", "보통", 2],
    ["산업단지", "낮음", 1],
  ])("%s/%s → %d점", (type, intensity, expected) => {
    expect(computeSpecialDemandScore(type, intensity)).toBe(expected);
  });
  it("특수수요 없음이면 0점", () => {
    expect(computeSpecialDemandScore("없음", "높음")).toBe(0);
    expect(computeSpecialDemandScore(null, null)).toBe(0);
  });
  it("근거가 확인되지 않은 유형(관광유흥/기타)은 강도와 무관하게 0점 — 지어내지 않는다", () => {
    expect(computeSpecialDemandScore("관광유흥", "높음")).toBe(0);
    expect(computeSpecialDemandScore("기타", "높음")).toBe(0);
  });
});

describe("empiricalFeaturesFor / toEmpiricalSample (2026-08-30 개편 — 점유율 적용 자사수요 대신 marketDemand·competitorIp 분리)", () => {
  it("4개 특징치를 순서대로 반환한다: log(요금), log(marketDemand/PC), log(1+competitorIp/PC), 경쟁력점수", () => {
    const features = empiricalFeaturesFor({
      hourlyRate: 1300,
      marketDemand: 200000,
      competitorIp: 300,
      pcCount: 100,
      competitivenessScore: 4,
    });
    expect(features).toHaveLength(4);
    expect(features[0]).toBeCloseTo(Math.log(1300), 6);
    expect(features[1]).toBeCloseTo(Math.log(200000 / 100), 6);
    expect(features[2]).toBeCloseTo(Math.log(1 + 300 / 100), 6);
    expect(features[3]).toBe(4);
  });
  it("competitorIp가 0이어도(독점매장) log(1+0)=0이 나온다 — 나눗셈으로 인한 예외 없음", () => {
    const features = empiricalFeaturesFor({ hourlyRate: 1300, marketDemand: 200000, competitorIp: 0, pcCount: 100, competitivenessScore: 4 });
    expect(features[2]).toBe(0);
  });
  it("toEmpiricalSample도 empiricalFeaturesFor와 동일한 특징치를 만든다(중복 로직 없음)", () => {
    const store: V61TrainingStore = {
      storeCode: "S",
      storeName: "점포",
      pcCount: 100,
      hourlyRate: 1300,
      marketDemand: 200000,
      competitorIp: 300,
      competitivenessScore: 4,
      actualMonthlyRevenueAvg: 60000000,
      specialDemandScore: 0,
    };
    const sample = toEmpiricalSample(store);
    expect(sample.featuresRaw).toEqual(empiricalFeaturesFor(store));
    expect(sample.revenuePerPc).toBe(600000);
  });
});

describe("isEligibleForV61Training (학습 대상 판정 — 블랙라벨·정상영업·산식학습제외 아님)", () => {
  const base = {
    brandType: "블랙라벨",
    franchiseStatus: "정상",
    excludedFromModel: false,
    pcCount: 100,
    hourlyRate: 1200,
    marketDemand: 2000,
    competitorIp: 500,
    competitivenessScore: 4,
    actualMonthlyRevenueAvg: 60000000,
  };
  it("모든 조건 충족 시 true", () => {
    expect(isEligibleForV61Training(base)).toBe(true);
  });
  it("리그PC방이면 false", () => {
    expect(isEligibleForV61Training({ ...base, brandType: "리그PC방" })).toBe(false);
  });
  it("산식학습제외면 false", () => {
    expect(isEligibleForV61Training({ ...base, excludedFromModel: true })).toBe(false);
  });
  it("정상영업이 아니면 false", () => {
    expect(isEligibleForV61Training({ ...base, franchiseStatus: "가맹해지" })).toBe(false);
  });
  it("evaluationPcCount가 0이면 false — pcCount는 양수여도 실제 학습에 쓰이는 값(evaluationPcCount)이 0이면 대당매출이 Infinity가 되므로 제외해야 한다(2026-08-24)", () => {
    expect(isEligibleForV61Training({ ...base, evaluationPcCount: 0 })).toBe(false);
  });
  it("evaluationPcCount가 null이면 pcCount로 판정한다(폴백)", () => {
    expect(isEligibleForV61Training({ ...base, evaluationPcCount: null })).toBe(true);
  });
});

describe("buildV61TrainingStores/toV61TrainingStore — evaluationPcCount 우선 사용 (오픈 후 좌석 증설 매장 왜곡 방지, 2026-08-22)", () => {
  const baseExistingStore = {
    storeCode: "BG",
    storeName: "시흥배곧점",
    pcCount: 168,
    evaluationPcCount: null as number | null,
    floor: 1,
    groundLevel: "지상" as const,
    openedAt: "2024-05-07",
    franchiseStatus: "정상",
    excludedFromModel: false,
    excludedReason: null,
    v61Predicted: null,
    referenceMarketDemand: null,
    brandType: "블랙라벨" as const,
    validationUse: "사용" as const,
    hourlyRate: 1200,
    marketDemand: 300000,
    competitorIp: 500,
    competitivenessScore: 4,
    actualMonthlyRevenueAvg: 83129382,
    completedMonths: 12,
    specialDemandType: null,
    specialDemandIntensity: null,
    hasElevator: true,
  };

  it("evaluationPcCount가 있으면 pcCount 대신 그걸 쓴다 — 현재 168대이지만 오픈 초기 108대로 학습", () => {
    const [trained] = buildV61TrainingStores([{ ...baseExistingStore, evaluationPcCount: 108 } as any]);
    expect(trained.pcCount).toBe(108);
  });

  it("evaluationPcCount가 없으면 현재 pcCount로 폴백한다(대부분의 매장)", () => {
    const [trained] = buildV61TrainingStores([{ ...baseExistingStore, evaluationPcCount: null } as any]);
    expect(trained.pcCount).toBe(168);
  });

  it("toV61TrainingStore(ValidationStoreInput)도 동일하게 evaluationPcCount를 우선한다", () => {
    const input: ValidationStoreInput = {
      storeCode: "BG",
      storeName: "시흥배곧점",
      brand: "블랙라벨",
      openedAt: "2024-05-07",
      completedMonths: 12,
      franchiseStatus: "정상",
      isPostOpenIssue: false,
      postOpenIssueReason: null,
      pcCount: 168,
      evaluationPcCount: 108,
      hourlyRate: 1200,
      ownDemand: 300000,
      marketDemand: 300000,
      competitorIp: 500,
      competitivenessScore: 4,
      actualRevenueAvg: 83129382,
    };
    expect(toV61TrainingStore(input).pcCount).toBe(108);
  });

  it("isCoreEligibleForV61Training도 evaluationPcCount가 0이면 false — pcCount != null만 보던 예전 판정은 이 경우를 놓쳐 대당매출 Infinity를 학습에 흘려보냈다(2026-08-24)", () => {
    const input: ValidationStoreInput = {
      storeCode: "BG",
      storeName: "시흥배곧점",
      brand: "블랙라벨",
      openedAt: "2024-05-07",
      completedMonths: 12,
      franchiseStatus: "정상",
      isPostOpenIssue: false,
      postOpenIssueReason: null,
      pcCount: 168,
      evaluationPcCount: 0,
      hourlyRate: 1200,
      ownDemand: 300000,
      marketDemand: 300000,
      competitorIp: 500,
      competitivenessScore: 4,
      actualRevenueAvg: 83129382,
    };
    expect(isCoreEligibleForV61Training(input)).toBe(false);
  });
});

describe("classifyTenureCohort (재직기간 코호트 분류)", () => {
  it.each([
    [12, "정식 검증군"],
    [15, "정식 검증군"],
    [9, "조기 검증 A"],
    [11, "조기 검증 A"],
    [6, "조기 검증 B"],
    [8, "조기 검증 B"],
    [3, "조기 검증 C"],
    [5, "조기 검증 C"],
    [1, "참고용"],
    [2, "참고용"],
    [0, "제외"],
    [null, "제외"],
  ])("%s개월 → %s", (months, expected) => {
    expect(classifyTenureCohort(months)).toBe(expected);
  });
});

describe("bucketizeErrors (오차 구간별 적중률)", () => {
  it("각 구간에 정확히 분류하고 경계값은 하한 구간에 포함하지 않는다", () => {
    const rows = [
      { absoluteErrorPct: 0.05, storeName: "A" }, // ±5% 이내 (경계 포함)
      { absoluteErrorPct: 0.051, storeName: "B" }, // 5~10%
      { absoluteErrorPct: 0.25, storeName: "C" }, // 20~30%
      { absoluteErrorPct: 0.35, storeName: "D" }, // 30% 초과
    ];
    const buckets = bucketizeErrors(rows);
    expect(buckets.find((b) => b.label === "±5% 이내")?.storeNames).toEqual(["A"]);
    expect(buckets.find((b) => b.label === "5% 초과~10% 이내")?.storeNames).toEqual(["B"]);
    expect(buckets.find((b) => b.label === "20% 초과~30% 이내")?.storeNames).toEqual(["C"]);
    expect(buckets.find((b) => b.label === "30% 초과")?.storeNames).toEqual(["D"]);
  });
});

describe("summarizeValidationRows (목표 달성 여부 판정)", () => {
  it("모든 목표를 충족하면 targetsMetAll=true", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      storeName: `S${i}`,
      absoluteErrorPct: 0.05,
      errorAmount: 1000,
      actualRevenueAvg: 100000,
    }));
    const summary = summarizeValidationRows(rows, { mape: 0.1, medianAe: 0.08, within10: 0.8, within20: 0.9, maxBias: 0.05 });
    expect(summary.targetsMetAll).toBe(true);
    expect(summary.passed.mape).toBe(true);
    expect(summary.passed.within10).toBe(true);
  });
  it("목표 미달이면 targetsMetAll=false", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      storeName: `S${i}`,
      absoluteErrorPct: 0.25,
      errorAmount: -1000,
      actualRevenueAvg: 100000,
    }));
    const summary = summarizeValidationRows(rows, { mape: 0.1, medianAe: 0.08, within10: 0.8, within20: 0.9, maxBias: 0.05 });
    expect(summary.targetsMetAll).toBe(false);
    expect(summary.underPredictedCount).toBe(10);
    expect(summary.overPredictedCount).toBe(0);
  });
  it('"재보정 필요" 문구는 ±10%·±20%가 둘 다 미달이면 두 수치를 모두 보여준다(이름만 나열하지 않음)', () => {
    // mape/medianAe/bias는 통과, within10=0.6<0.8·within20=0.6<0.75만 실패하도록 구성 —
    // 이전엔 이 분기(재보정 필요)에서 within10이 아예 검사되지 않아 ±10% 수치가 문구에서 빠졌었다.
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => ({ storeName: `A${i}`, absoluteErrorPct: 0.02, errorAmount: 2, actualRevenueAvg: 100 })),
      ...Array.from({ length: 3 }, (_, i) => ({ storeName: `B${i}`, absoluteErrorPct: 0.02, errorAmount: -2, actualRevenueAvg: 100 })),
      ...Array.from({ length: 2 }, (_, i) => ({ storeName: `C${i}`, absoluteErrorPct: 0.3, errorAmount: 30, actualRevenueAvg: 100 })),
      ...Array.from({ length: 2 }, (_, i) => ({ storeName: `D${i}`, absoluteErrorPct: 0.3, errorAmount: -30, actualRevenueAvg: 100 })),
    ];
    const summary = summarizeValidationRows(rows, { mape: 0.15, medianAe: 0.1, within10: 0.8, within20: 0.75, maxBias: 0.05 });
    expect(summary.passed.mape).toBe(true);
    expect(summary.passed.medianAe).toBe(true);
    expect(summary.passed.bias).toBe(true);
    expect(summary.within10PctRatio).toBeCloseTo(0.6, 5);
    expect(summary.within20PctRatio).toBeCloseTo(0.6, 5);
    expect(summary.overallStatus).toBe("재보정 필요");
    expect(summary.statusReason).toContain("±10% 적중률 60.0%로 목표 80% 미달");
    expect(summary.statusReason).toContain("±20% 적중률 60.0%로 목표 75% 미달");
  });
});

describe("runLeaveOneOutValidation (자기 자신을 뺀 학습으로 예측 — 데이터 누출 방지)", () => {
  it("표본이 충분하면 각 매장을 서로 다른 모형으로 예측한다", () => {
    const stores: V61TrainingStore[] = Array.from({ length: 13 }, (_, i) => ({
      storeCode: `S${i}`,
      storeName: `점포${i}`,
      pcCount: 100,
      hourlyRate: 1200 + i * 20,
      marketDemand: (2000 + i * 100) * 100,
      competitorIp: 500,
      competitivenessScore: 3.5 + (i % 5) * 0.2,
      actualMonthlyRevenueAvg: 55000000 + i * 1000000,
      specialDemandScore: 0,
    }));
    const result = runLeaveOneOutValidation(stores, 1, 0.6, 0.4, 12);
    expect(result.sampleCount).toBe(13);
    expect(result.rows.every((r) => r.predictedRevenue != null)).toBe(true);
    expect(result.meanAbsoluteErrorPct).not.toBeNull();
  });
  it("표본이 부족하면 예측 불가", () => {
    const stores: V61TrainingStore[] = Array.from({ length: 5 }, (_, i) => ({
      storeCode: `S${i}`,
      storeName: `점포${i}`,
      pcCount: 100,
      hourlyRate: 1200,
      marketDemand: 200000,
      competitorIp: 500,
      competitivenessScore: 4,
      actualMonthlyRevenueAvg: 55000000,
      specialDemandScore: 0,
    }));
    const result = runLeaveOneOutValidation(stores, 1, 0.6, 0.4, 12);
    expect(result.sampleCount).toBe(0);
    expect(result.rows.every((r) => r.predictedRevenue == null)).toBe(true);
  });
});

describe("runCohortValidation (12개월 미완료 매장까지 포함한 전체 검증 — 데이터 누출 방지)", () => {
  function makeStore(overrides: Partial<ValidationStoreInput>): ValidationStoreInput {
    return {
      storeCode: "S",
      storeName: "점포",
      brand: "블랙라벨",
      openedAt: "2025-01-01",
      completedMonths: 12,
      franchiseStatus: "정상",
      isPostOpenIssue: false,
      postOpenIssueReason: null,
      pcCount: 100,
      hourlyRate: 1300,
      ownDemand: null,
      marketDemand: 200000,
      competitorIp: 500,
      competitivenessScore: 4,
      actualRevenueAvg: 60000000,
      ...overrides,
    };
  }

  const coreStores: ValidationStoreInput[] = Array.from({ length: 13 }, (_, i) =>
    makeStore({
      storeCode: `C${i}`,
      storeName: `핵심${i}`,
      hourlyRate: 1200 + i * 20,
      marketDemand: (2000 + i * 100) * 100,
      competitivenessScore: 3.5 + (i % 5) * 0.2,
      actualRevenueAvg: 55000000 + i * 1000000,
    }),
  );

  it("핵심표본은 리브-원-아웃으로 예측하고 includedInCoreAccuracy=true다", () => {
    const { rows } = runCohortValidation(coreStores, { v61Training: defaultModelSettings().v61Training, inflowAdjustment: defaultModelSettings().inflowAdjustment });
    expect(rows.every((r) => r.includedInCoreAccuracy)).toBe(true);
    expect(rows.every((r) => r.predictedRevenueAvg != null)).toBe(true);
    expect(rows.every((r) => r.cohort === "정식 검증군")).toBe(true);
  });

  it("12개월 미완료 매장은 학습에 전혀 안 쓰이고(완전 외부검증) 코호트로 분류된다", () => {
    const earlyStore = makeStore({ storeCode: "E1", storeName: "조기점포", completedMonths: 7 });
    const { rows } = runCohortValidation([...coreStores, earlyStore], { v61Training: defaultModelSettings().v61Training, inflowAdjustment: defaultModelSettings().inflowAdjustment });
    const early = rows.find((r) => r.storeCode === "E1")!;
    expect(early.cohort).toBe("조기 검증 B");
    expect(early.includedInCoreAccuracy).toBe(false);
    expect(early.predictedRevenueAvg).not.toBeNull(); // 전체 학습모형으로 예측은 된다
    expect(early.includedInEarlyValidation).toBe(true);
  });

  it("조기검증(완전 외부검증) 매장도 evaluationPcCount를 우선 써서 예측한다 — 오픈 후 증설한 매장의 현재 pcCount로 왜곡되면 안 됨(2026-08-30 발견)", () => {
    const expanded = makeStore({ storeCode: "E3", storeName: "증설점포", completedMonths: 7, pcCount: 200, evaluationPcCount: 100 });
    const notExpanded = makeStore({ storeCode: "E4", storeName: "비교점포", completedMonths: 7, pcCount: 100, evaluationPcCount: null });
    const { rows } = runCohortValidation([...coreStores, expanded, notExpanded], {
      v61Training: defaultModelSettings().v61Training,
      inflowAdjustment: defaultModelSettings().inflowAdjustment,
    });
    const e = rows.find((r) => r.storeCode === "E3")!;
    const n = rows.find((r) => r.storeCode === "E4")!;
    // evaluationPcCount(100)가 실제로 쓰였다면, pcCount만 다른(200 vs 100) 두 매장의 예측이 같아야 한다.
    expect(e.predictedRevenueAvg).toBeCloseTo(n.predictedRevenueAvg!, 0);
  });

  it("정상 조기검증 매장은 includedInEarlyValidation=true, 핵심표본은 false다(배타적)", () => {
    const { rows } = runCohortValidation(coreStores, {
      v61Training: defaultModelSettings().v61Training,
      inflowAdjustment: defaultModelSettings().inflowAdjustment,
    });
    expect(rows.every((r) => r.includedInEarlyValidation === false)).toBe(true);
  });

  it("사후 운영이슈 조기검증 매장은 조기검증 집계에서도 빠진다", () => {
    const earlyIssue = makeStore({
      storeCode: "E2",
      storeName: "조기이슈점포",
      completedMonths: 7,
      isPostOpenIssue: true,
      postOpenIssueReason: "오픈 후 경쟁점 가격전쟁",
    });
    const { rows } = runCohortValidation([...coreStores, earlyIssue], {
      v61Training: defaultModelSettings().v61Training,
      inflowAdjustment: defaultModelSettings().inflowAdjustment,
    });
    const e = rows.find((r) => r.storeCode === "E2")!;
    expect(e.cohort).toBe("조기 검증 B");
    expect(e.includedInEarlyValidation).toBe(false);
  });

  it("사후 운영이슈 점포는 핵심 정확도에서 제외되고 사유가 남는다", () => {
    const anomalyStore = makeStore({ storeCode: "A1", storeName: "이슈점포", isPostOpenIssue: true, postOpenIssueReason: "오픈 후 운영관리 문제" });
    const { rows } = runCohortValidation([...coreStores, anomalyStore], { v61Training: defaultModelSettings().v61Training, inflowAdjustment: defaultModelSettings().inflowAdjustment });
    const anomaly = rows.find((r) => r.storeCode === "A1")!;
    expect(anomaly.includedInCoreAccuracy).toBe(false);
    expect(anomaly.exclusionReason).toContain("운영관리 문제");
  });

  it("영업 1~2개월 매장은 참고용으로 분류되고 핵심 정확도에서 빠진다", () => {
    const refStore = makeStore({ storeCode: "R1", storeName: "참고점포", completedMonths: 1 });
    const { rows } = runCohortValidation([...coreStores, refStore], { v61Training: defaultModelSettings().v61Training, inflowAdjustment: defaultModelSettings().inflowAdjustment });
    const ref = rows.find((r) => r.storeCode === "R1")!;
    expect(ref.cohort).toBe("참고용");
    expect(ref.includedInCoreAccuracy).toBe(false);
    expect(ref.exclusionReason).toContain("참고자료");
  });

  it("오픈 당월(완료월 0개) 매장은 예측값도 아예 내지 않는다 — 오픈달 매출로 평가하지 않는다", () => {
    const justOpened = makeStore({ storeCode: "J1", storeName: "오픈당월점포", completedMonths: 0, actualRevenueAvg: null });
    const { rows } = runCohortValidation([...coreStores, justOpened], { v61Training: defaultModelSettings().v61Training, inflowAdjustment: defaultModelSettings().inflowAdjustment });
    const j = rows.find((r) => r.storeCode === "J1")!;
    expect(j.cohort).toBe("제외");
    expect(j.predictedRevenueAvg).toBeNull();
    expect(j.absoluteErrorPct).toBeNull();
  });

  it("브랜드 미확인 매장은 핵심 정확도에서 제외되고 사유가 남는다", () => {
    const unknownBrand = makeStore({ storeCode: "U1", storeName: "미확인점포", brand: null });
    const { rows } = runCohortValidation([...coreStores, unknownBrand], { v61Training: defaultModelSettings().v61Training, inflowAdjustment: defaultModelSettings().inflowAdjustment });
    const u = rows.find((r) => r.storeCode === "U1")!;
    expect(u.includedInCoreAccuracy).toBe(false);
    expect(u.exclusionReason).toContain("브랜드 미확인");
  });

  it("요청사항 2 — 외부유입제한이 있으면 V62예측이 V61예측×(1+보정률)로 줄어들고 오차도 그 값 기준으로 계산된다", () => {
    const strongInflow = makeStore({ storeCode: "F1", storeName: "외부유입강함점", inflowRestriction: "강함" });
    const settings = { v61Training: defaultModelSettings().v61Training, inflowAdjustment: defaultModelSettings().inflowAdjustment };
    const { rows } = runCohortValidation([...coreStores, strongInflow], settings);
    const f = rows.find((r) => r.storeCode === "F1")!;
    expect(f.predictedRevenueAvg).not.toBeNull();
    expect(f.v62PredictedRevenueAvg).not.toBeNull();
    expect(f.v62PredictedRevenueAvg!).toBeCloseTo(Math.round(f.predictedRevenueAvg! * 0.8), -1);
    expect(f.absoluteErrorPct).toBeCloseTo(Math.abs(f.v62PredictedRevenueAvg! - f.actualRevenueAvg!) / f.actualRevenueAvg!, 6);
  });

  it("외부유입제한이 없으면(null) V62=V61 그대로다", () => {
    const noInflow = makeStore({ storeCode: "F2", storeName: "외부유입없음점", inflowRestriction: null });
    const settings = { v61Training: defaultModelSettings().v61Training, inflowAdjustment: defaultModelSettings().inflowAdjustment };
    const { rows } = runCohortValidation([...coreStores, noInflow], settings);
    const f = rows.find((r) => r.storeCode === "F2")!;
    expect(f.v62PredictedRevenueAvg).toBe(f.predictedRevenueAvg);
  });
});

describe('describeNotVerifiableReason ("검증 불가(실적 없음)" 세분화 — 새 산식 없이 기존 필드만 조합)', () => {
  const complete = { score: 100, grade: "complete" as const, hasCoreInputs: true, hasLocationEvaluation: true, hasCompetitorInfo: true, hasActualPerformance: true };
  const base = {
    actualRevenueAvg: 60000000,
    cohort: "정식 검증군" as const,
    brand: "블랙라벨" as const,
    franchiseStatus: "정상",
    v62PredictedRevenueAvg: 58000000,
    dataCompleteness: complete,
  };
  it("완료된 실제매출 월이 없으면(코호트=제외) 그 사유를 먼저 보여준다", () => {
    expect(describeNotVerifiableReason({ ...base, actualRevenueAvg: null, cohort: "제외" })).toBe("완료된 실제매출 월 없음");
    expect(describeNotVerifiableReason({ ...base, cohort: "제외" })).toBe("완료된 실제매출 월 없음");
  });
  it("브랜드가 null이면(09_입지동선평가 행 없음) 입지동선평가 미작성", () => {
    expect(describeNotVerifiableReason({ ...base, brand: null })).toBe("입지동선평가 미작성");
  });
  it("브랜드가 블랙라벨이 아니면 타 브랜드", () => {
    expect(describeNotVerifiableReason({ ...base, brand: "리그PC방" })).toBe("타 브랜드");
  });
  it("정상영업이 아니면 정상영업 아님", () => {
    expect(describeNotVerifiableReason({ ...base, franchiseStatus: "가맹해지" })).toBe("정상영업 아님");
  });
  it("데이터완성도가 excluded면 데이터 완성도 미달", () => {
    expect(describeNotVerifiableReason({ ...base, dataCompleteness: { ...complete, grade: "excluded", score: 50 } })).toBe("데이터 완성도 미달");
  });
  it("데이터완성도는 partial(핵심입력값은 있음)인데 핵심입력값이 없으면 예측 입력값 부족", () => {
    expect(
      describeNotVerifiableReason({ ...base, dataCompleteness: { ...complete, grade: "partial", score: 75, hasCoreInputs: false } }),
    ).toBe("예측 입력값 부족");
  });
  it("모든 입력이 있는데 V62 예측값만 없으면 V62 예측값 없음 — 검단사거리점처럼 '실적 없음'으로 오인되지 않아야 한다", () => {
    expect(describeNotVerifiableReason({ ...base, v62PredictedRevenueAvg: null })).toBe("V62 예측값 없음");
  });
  it("위 사유가 전부 아니면 원인 미분류로 표시한다(실제로는 도달하지 않아야 하는 폴백)", () => {
    expect(describeNotVerifiableReason(base)).toBe("검증 불가(원인 미분류)");
  });
});

describe("diagnoseLoocvSensitivity / LOOCV 고변동 점포 진단 (1회성 스크립트 대체)", () => {
  const settings = { v61Training: defaultModelSettings().v61Training };
  function makeStore(overrides: Partial<ValidationStoreInput>): ValidationStoreInput {
    return {
      storeCode: "S",
      storeName: "점포",
      brand: "블랙라벨",
      openedAt: "2025-01-01",
      completedMonths: 12,
      franchiseStatus: "정상",
      isPostOpenIssue: false,
      postOpenIssueReason: null,
      pcCount: 100,
      hourlyRate: 1300,
      ownDemand: null,
      marketDemand: 200000,
      competitorIp: 500,
      competitivenessScore: 4,
      actualRevenueAvg: 60000000,
      ...overrides,
    };
  }
  const normalStores: ValidationStoreInput[] = Array.from({ length: 12 }, (_, i) =>
    makeStore({
      storeCode: `N${i}`,
      storeName: `정상${i}`,
      hourlyRate: 1200 + i * 20,
      marketDemand: (2000 + i * 100) * 100,
      competitivenessScore: 3.5 + (i % 5) * 0.2,
      actualRevenueAvg: 55000000 + i * 1000000,
    }),
  );
  const outlier = makeStore({
    storeCode: "OUT1",
    storeName: "이상치점",
    hourlyRate: 3200,
    marketDemand: 60000,
    competitivenessScore: 1,
    actualRevenueAvg: 95000000,
  });

  it("존재하지 않는 매장코드는 null을 반환한다", () => {
    expect(diagnoseLoocvSensitivity("NOPE", normalStores, settings)).toBeNull();
  });

  it("with/without 학습표본 수가 정확히 1개 차이나고, 혼합예측은 ridge단독·baseline단독 사이 값이다(볼록결합)", () => {
    const diag = diagnoseLoocvSensitivity("N0", [...normalStores, outlier], settings)!;
    expect(diag).not.toBeNull();
    expect(diag.sampleCountWithout).toBe(diag.sampleCountWith - 1);
    expect(diag.coefficientsWith).toHaveLength(4);
    expect(diag.coefficientsWithout).toHaveLength(4);
    const lo = Math.min(diag.ridgeOnlyPrediction!, diag.baselineOnlyPrediction!);
    const hi = Math.max(diag.ridgeOnlyPrediction!, diag.baselineOnlyPrediction!);
    expect(diag.blendedPrediction!).toBeGreaterThanOrEqual(lo);
    expect(diag.blendedPrediction!).toBeLessThanOrEqual(hi);
  });

  it("나머지 학습표본 범위 안쪽(양끝이 아닌) 매장은 학습범위 이탈이 아니다", () => {
    const diag = diagnoseLoocvSensitivity("N6", normalStores, settings)!;
    expect(diag.isOutOfTrainingRange).toBe(false);
  });

  it("나머지와 특징값이 크게 다른 이상치 매장은 학습범위 이탈로 잡힌다", () => {
    const diag = diagnoseLoocvSensitivity("OUT1", [...normalStores, outlier], settings)!;
    expect(diag.isOutOfTrainingRange).toBe(true);
  });

  it("계수·입력값은 그대로 노출만 한다 — with/without 표본수 외에는 아무 값도 임의로 바꾸지 않는다", () => {
    const diag = diagnoseLoocvSensitivity("N0", [...normalStores, outlier], settings)!;
    expect(diag.sampleCountWith).toBe(normalStores.length + 1);
  });
});

describe('매장별 비교표의 "LOOCV 고변동 점포" 표시 (buildParityComparisonRows)', () => {
  const inflowSettings = { inflowAdjustment: defaultModelSettings().inflowAdjustment };
  function makeInput(overrides: Partial<ValidationStoreInput>): ValidationStoreInput {
    return {
      storeCode: "S1",
      storeName: "테스트점",
      brand: "블랙라벨",
      openedAt: "2024-01-01",
      completedMonths: 12,
      franchiseStatus: "정상",
      isPostOpenIssue: false,
      postOpenIssueReason: null,
      pcCount: 100,
      hourlyRate: 1300,
      ownDemand: 200000,
      marketDemand: 200000,
      competitorIp: 500,
      competitivenessScore: 4,
      actualRevenueAvg: 60000000,
      sheetV61Predicted: 58000000,
      inflowRestriction: "없음",
      ...overrides,
    };
  }
  function makeLoocvRow(storeCode: string, predictedRevenueAvg: number, v62Rate: number): ValidationStoreRow {
    const v62PredictedRevenueAvg = computeV62Final(predictedRevenueAvg, v62Rate);
    const actual = 60000000;
    return {
      ...makeInput({ storeCode }),
      cohort: "정식 검증군",
      predictedRevenueAvg,
      v62Rate,
      v62PredictedRevenueAvg,
      errorAmount: v62PredictedRevenueAvg! - actual,
      absoluteErrorPct: Math.abs(v62PredictedRevenueAvg! - actual) / actual,
      direction: "과대예측",
      includedInCoreAccuracy: true,
      includedInEarlyValidation: false,
      exclusionReason: null,
      operationalStatus: "normal",
      dataCompleteness: { score: 100, grade: "complete", hasCoreInputs: true, hasLocationEvaluation: true, hasCompetitorInfo: true, hasActualPerformance: true },
      errorCause: "within_range",
    };
  }

  it("시흥배곧점 사례처럼 웹 V61이 시트 V61보다 30% 넘게 높으면 LOOCV 고변동 점포로 표시된다", () => {
    // 시트(sheetParity) 69,419,989원 vs 웹 LOOCV 107,888,052원(약 55% 차이) 실제 사례를 단순화해 재현.
    const stores = [makeInput({ storeCode: "BG", storeName: "시흥배곧점", sheetV61Predicted: 69419989 })];
    const loocvRows = [makeLoocvRow("BG", 107888052, 0)];
    const rows = buildParityComparisonRows(stores, loocvRows, inflowSettings);
    expect(rows[0].diffStage).toBe("V61예측차이");
    expect(rows[0].predictionDiffPct).toBeGreaterThan(0.3);
    expect(rows[0].isLoocvHighVariance).toBe(true);
  });

  it("웹/시트 V61 차이가 30% 이내면 LOOCV 고변동 점포로 표시되지 않는다", () => {
    const stores = [makeInput({ storeCode: "S1", sheetV61Predicted: 58000000 })];
    const loocvRows = [makeLoocvRow("S1", 62000000, 0)]; // 약 7% 차이
    const rows = buildParityComparisonRows(stores, loocvRows, inflowSettings);
    expect(rows[0].isLoocvHighVariance).toBe(false);
  });
});

describe("computeCompetitorInvestigationSummary (요청사항 4 — 경쟁점 조사상태·데이터 신뢰도)", () => {
  it("경쟁점이 없으면 uninvestigated/low", () => {
    const summary = computeCompetitorInvestigationSummary([]);
    expect(summary.status).toBe("uninvestigated");
    expect(summary.dataReliability).toBe("low");
  });
  it("전부 상세조사면 detailed_complete, 상세비율 100%면 high", () => {
    const summary = computeCompetitorInvestigationSummary([
      { investigationStatus: "조사완료", surveyLevel: "상세" },
      { investigationStatus: "조사완료", surveyLevel: "상세" },
    ]);
    expect(summary.status).toBe("detailed_complete");
    expect(summary.dataReliability).toBe("high");
  });
  it("상세+간이 혼재면 mixed", () => {
    const summary = computeCompetitorInvestigationSummary([
      { investigationStatus: "조사완료", surveyLevel: "상세" },
      { investigationStatus: "조사완료", surveyLevel: "간략" },
    ]);
    expect(summary.status).toBe("mixed");
  });
  it("간이/외관만이면 light, 상세조사 없으면 신뢰도는 medium 이하", () => {
    const summary = computeCompetitorInvestigationSummary([
      { investigationStatus: "조사완료", surveyLevel: "외관만" },
      { investigationStatus: "경쟁점없음", surveyLevel: null },
    ]);
    expect(summary.status).toBe("light");
    expect(summary.dataReliability).toBe("low"); // 상세조사 0건
  });
  it("경쟁점은 있으나 조사정보가 없으면(노후저경쟁력미조사) uninvestigated — 경쟁력이 약하다는 뜻은 아니다", () => {
    const summary = computeCompetitorInvestigationSummary([{ investigationStatus: "노후저경쟁력미조사", surveyLevel: null }]);
    expect(summary.status).toBe("uninvestigated");
    expect(summary.uninvestigatedCount).toBe(1);
  });
  it("경쟁점 문서가 있고 전부 경쟁점없음이면 confirmed_no_competitor/high — '조사 안 됨'과 구분 (탕정역점 등 독점상권 실사례, 2026-08-22)", () => {
    const summary = computeCompetitorInvestigationSummary([{ investigationStatus: "경쟁점없음", surveyLevel: null }]);
    expect(summary.status).toBe("confirmed_no_competitor");
    expect(summary.dataReliability).toBe("high");
  });
  it("경쟁점 문서가 아예 없으면(빈 배열) 여전히 uninvestigated/low — confirmed_no_competitor와 다름(둘 다 0건이지만 하나는 확인됨, 하나는 모름)", () => {
    const summary = computeCompetitorInvestigationSummary([]);
    expect(summary.status).toBe("uninvestigated");
    expect(summary.dataReliability).toBe("low");
  });
});

describe("computeDataCompleteness (요청사항 5 — 25점×4항목)", () => {
  const base = {
    hourlyRate: 1300,
    ownDemand: 200000,
    pcCount: 100,
    competitivenessScore: 4,
    hasLocationEvaluation: true,
    competitorCount: 3,
    actualMonthlyRevenueAvg: 60000000,
    completedMonths: 12,
  };
  it("4항목 모두 있으면 100점 complete", () => {
    expect(computeDataCompleteness(base)).toMatchObject({ score: 100, grade: "complete" });
  });
  it("1항목 빠지면 75점 partial", () => {
    expect(computeDataCompleteness({ ...base, competitorCount: 0 })).toMatchObject({ score: 75, grade: "partial" });
  });
  it("2항목 빠지면 50점 excluded", () => {
    expect(computeDataCompleteness({ ...base, competitorCount: 0, hasLocationEvaluation: false })).toMatchObject({ score: 50, grade: "excluded" });
  });
});

describe("computeOperationalStatus (요청사항 6 — 운영상태)", () => {
  it("가맹해지 등 정상 아님 → abnormal (post_open_issue보다 우선)", () => {
    expect(computeOperationalStatus({ franchiseStatus: "가맹해지", isPostOpenIssue: true, cohort: "정식 검증군" })).toBe("abnormal");
  });
  it("송도점형(경쟁점 가격전쟁)·동탄북광장형(운영관리 문제) — 계약은 정상이라 post_open_issue", () => {
    expect(computeOperationalStatus({ franchiseStatus: "정상", isPostOpenIssue: true, cohort: "정식 검증군" })).toBe("post_open_issue");
  });
  it("12개월 미완료 정상 매장 → early", () => {
    expect(computeOperationalStatus({ franchiseStatus: "정상", isPostOpenIssue: false, cohort: "조기 검증 B" })).toBe("early");
  });
  it("12개월 완료 정상 매장 → normal", () => {
    expect(computeOperationalStatus({ franchiseStatus: "정상", isPostOpenIssue: false, cohort: "정식 검증군" })).toBe("normal");
  });
});

describe("classifyErrorCause (요청사항 7 — 오차원인 우선 추정, 단일 확정 아님)", () => {
  const baseInput = {
    absoluteErrorPct: 0.25,
    direction: "과대예측" as const,
    specialDemandScore: 0,
    inflowRestriction: null,
    competitorDataReliability: "high" as const,
    floor: 1,
    groundLevel: "지상" as const,
    hasElevator: true,
  };
  it("비교 불가(실적 없음) → not_verifiable", () => {
    expect(classifyErrorCause({ ...baseInput, absoluteErrorPct: null })).toBe("not_verifiable");
  });
  it("오차가 이미 10% 이내 → within_range", () => {
    expect(classifyErrorCause({ ...baseInput, absoluteErrorPct: 0.05 })).toBe("within_range");
  });
  it("경쟁 데이터 신뢰도 low → competitor_data_missing (다른 신호보다 우선)", () => {
    expect(classifyErrorCause({ ...baseInput, competitorDataReliability: "low" })).toBe("competitor_data_missing");
  });
  it("확인된 독점상권(competitorConfirmedNoCompetitor) → monopoly_market_unmodeled, competitor_data_missing보다 우선 (탕정역점 등 실사례, 2026-08-22)", () => {
    expect(classifyErrorCause({ ...baseInput, competitorDataReliability: "high", competitorConfirmedNoCompetitor: true })).toBe(
      "monopoly_market_unmodeled",
    );
  });
  it("과소예측+특수수요점수>0 → special_demand_underreflected", () => {
    expect(classifyErrorCause({ ...baseInput, direction: "과소예측", specialDemandScore: 3 })).toBe("special_demand_underreflected");
  });
  it("과대예측+외부유입제한 있음 → external_inflow_underreflected", () => {
    expect(classifyErrorCause({ ...baseInput, inflowRestriction: "강함" })).toBe("external_inflow_underreflected");
  });
  it("과대예측+접근성 좋음(1층+엘리베이터) → access_overestimated", () => {
    expect(classifyErrorCause({ ...baseInput, floor: 1, hasElevator: true })).toBe("access_overestimated");
  });
  it("남은 과대예측(접근성도 안 좋음) → demand_share_overestimated", () => {
    expect(classifyErrorCause({ ...baseInput, floor: 6, hasElevator: false, groundLevel: "지상" })).toBe("demand_share_overestimated");
  });
  it("남은 과소예측 → demand_conversion_underestimated", () => {
    expect(classifyErrorCause({ ...baseInput, direction: "과소예측" })).toBe("demand_conversion_underestimated");
  });
});

describe("computeStabilizedPerformance (매출DB 라이브 동기화 — 평가창 12개월 + 누적평균 2개월차부터)", () => {
  it("오픈 후 12개월 넘게 쌓인 매장도 1~12개월 구간만 평가창으로 쓴다", () => {
    // 21개월치 데이터가 있어도 completedMonths는 12를 넘지 않는다
    const monthlySales = Array.from({ length: 21 }, (_, i) => ({
      elapsedMonths: i + 1,
      pcSales: 40000000 + i * 100000,
      productSales: 5000000,
    }));
    const result = computeStabilizedPerformance(monthlySales);
    expect(result.completedMonths).toBe(12);
  });

  it("2개월차부터 평균하고 1개월차는 뺀다", () => {
    const monthlySales = [
      { elapsedMonths: 1, pcSales: 10000000, productSales: 0 }, // 오픈효과로 낮음 - 제외돼야 함
      { elapsedMonths: 2, pcSales: 50000000, productSales: 0 },
      { elapsedMonths: 3, pcSales: 50000000, productSales: 0 },
    ];
    const result = computeStabilizedPerformance(monthlySales);
    expect(result.actualMonthlyRevenueAvg).toBe(50000000);
  });

  it("2개월차 데이터가 아직 없으면 1개월차라도 쓴다", () => {
    const monthlySales = [{ elapsedMonths: 1, pcSales: 30000000, productSales: 0 }];
    const result = computeStabilizedPerformance(monthlySales);
    expect(result.actualMonthlyRevenueAvg).toBe(30000000);
    expect(result.completedMonths).toBe(1);
  });

  it("13개월차 이후 데이터는 평가창 밖이라 완전히 무시한다", () => {
    const monthlySales = [
      { elapsedMonths: 2, pcSales: 40000000, productSales: 0 },
      { elapsedMonths: 13, pcSales: 999999999, productSales: 0 }, // 창 밖 - 평균에 영향 없어야 함
    ];
    const result = computeStabilizedPerformance(monthlySales);
    expect(result.completedMonths).toBe(1);
    expect(result.actualMonthlyRevenueAvg).toBe(40000000);
  });
});

describe("computeCompletedMonthsCount", () => {
  it("매출이 0보다 큰 달만 센다", () => {
    const rows = [
      { pcSales: 100, productSales: 0 },
      { pcSales: 0, productSales: 0 },
      { pcSales: null, productSales: 50 },
    ];
    expect(computeCompletedMonthsCount(rows)).toBe(2);
  });
});

describe("buildParityComparisonRows (요청사항 — sheetParity vs loocvValidation 매장별 비교, 요청사항 1/2)", () => {
  const inflowSettings = { inflowAdjustment: defaultModelSettings().inflowAdjustment };
  function makeInput(overrides: Partial<ValidationStoreInput>): ValidationStoreInput {
    return {
      storeCode: "S1",
      storeName: "테스트점",
      brand: "블랙라벨",
      openedAt: "2024-01-01",
      completedMonths: 12,
      franchiseStatus: "정상",
      isPostOpenIssue: false,
      postOpenIssueReason: null,
      pcCount: 100,
      hourlyRate: 1300,
      ownDemand: 200000,
      marketDemand: 200000,
      competitorIp: 500,
      competitivenessScore: 4,
      actualRevenueAvg: 60000000,
      sheetV61Predicted: 58000000,
      inflowRestriction: "보통",
      ...overrides,
    };
  }
  function makeLoocvRow(storeCode: string, predictedRevenueAvg: number, v62Rate: number): ValidationStoreRow {
    const v62PredictedRevenueAvg = computeV62Final(predictedRevenueAvg, v62Rate);
    const actual = 60000000;
    return {
      ...makeInput({ storeCode }),
      cohort: "정식 검증군",
      predictedRevenueAvg,
      v62Rate,
      v62PredictedRevenueAvg,
      errorAmount: v62PredictedRevenueAvg! - actual,
      absoluteErrorPct: Math.abs(v62PredictedRevenueAvg! - actual) / actual,
      direction: "과대예측",
      includedInCoreAccuracy: true,
      includedInEarlyValidation: false,
      exclusionReason: null,
      operationalStatus: "normal",
      dataCompleteness: { score: 100, grade: "complete", hasCoreInputs: true, hasLocationEvaluation: true, hasCompetitorInfo: true, hasActualPerformance: true },
      errorCause: "within_range",
    };
  }

  it("웹 V61과 시트 V61이 유의미하게 다르면 diffStage=V61예측차이", () => {
    const stores = [makeInput({ storeCode: "S1", sheetV61Predicted: 58000000, inflowRestriction: "보통" })];
    const loocvRows = [makeLoocvRow("S1", 65000000, -0.03)]; // 웹 예측이 시트보다 12% 높음
    const rows = buildParityComparisonRows(stores, loocvRows, inflowSettings);
    expect(rows[0].diffStage).toBe("V61예측차이");
  });

  it("V61은 같은데(오차<0.1%) 외부유입 보정률이 다르면 diffStage=외부유입보정률차이", () => {
    const stores = [makeInput({ storeCode: "S1", sheetV61Predicted: 58000000, inflowRestriction: "보통" })];
    const loocvRows = [makeLoocvRow("S1", 58000000, -0.2)]; // 보정률만 다르게(강함 취급) 강제
    const rows = buildParityComparisonRows(stores, loocvRows, inflowSettings);
    expect(rows[0].diffStage).toBe("외부유입보정률차이");
  });

  it("V61·보정률·V62예측까지 전부 같으면 diffStage=일치", () => {
    const stores = [makeInput({ storeCode: "S1", sheetV61Predicted: 58000000, inflowRestriction: "보통" })];
    const loocvRows = [makeLoocvRow("S1", 58000000, -0.03)];
    const rows = buildParityComparisonRows(stores, loocvRows, inflowSettings);
    expect(rows[0].diffStage).toBe("일치");
    expect(rows[0].predictionDiff).toBe(0);
  });

  it("웹 쪽 리브-원-아웃 결과가 아예 없으면(짝이 안 맞으면) diffStage=비교불가", () => {
    const stores = [makeInput({ storeCode: "S1" })];
    const rows = buildParityComparisonRows(stores, [], inflowSettings);
    expect(rows[0].diffStage).toBe("비교불가");
    expect(rows[0].webV61Predicted).toBeNull();
  });

  it("브랜드가 블랙라벨이 아니거나 시트 V61이 없으면 비교 대상에서 아예 빠진다", () => {
    const stores = [makeInput({ storeCode: "S1", brand: "리그PC방" }), makeInput({ storeCode: "S2", sheetV61Predicted: null })];
    const rows = buildParityComparisonRows(stores, [makeLoocvRow("S1", 58000000, -0.03), makeLoocvRow("S2", 58000000, -0.03)], inflowSettings);
    expect(rows.length).toBe(0);
  });
});

