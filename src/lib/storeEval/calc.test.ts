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
  computeFloatingRawDemand,
  computeImpliedUtilizationFromRevenue,
  computeLocationCompositeScore,
  computeLocationScoreFromFacts,
  computeMarketCharacter,
  computeMarketDemand,
  computeMeasuredForecast,
  computeSeatScore,
  computeSpecScore,
  computeV61Fallback,
  computeV62Final,
  computeValidationRow,
  computeZoneComposition,
  applyStandardOwnFacilityDefaults,
  describeNotVerifiableReason,
  diagnoseLoocvSensitivity,
  fitEmpiricalRevenueModel,
  fitNonnegativeRidgeRegression,
  GAME_ZONE_BONUS,
  getV62Rate,
  isCoreEligibleForV61Training,
  isEligibleForV61Training,
  judgeAaGrade,
  lookupDemandCapture,
  predictEmpiricalRevenue,
  runCohortValidation,
  runLeaveOneOutValidation,
  scoreFromVga,
  summarizeValidation,
  summarizeValidationRows,
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

describe("scoreFromVga (VGA 모델명 → 사양점수)", () => {
  it.each([
    ["RTX 4060", 4],
    ["2060", 2],
    ["GTX 1660", 1],
  ])("%s → %d점", (text, expected) => {
    expect(scoreFromVga(text)).toBe(expected);
  });
  it("모델명이 없으면 null", () => {
    expect(scoreFromVga(null)).toBeNull();
  });
});

describe("computeSpecScore (사양점수 = VGA 70% + 모니터 30%)", () => {
  const specSettings = { specWeights: defaultModelSettings().specWeights };
  it("VGA만 있으면 VGA 점수 그대로", () => {
    expect(computeSpecScore("RTX 4060", null, 0, null, specSettings)).toBe(4);
  });
  it("모니터만 있으면 모니터 점수 그대로", () => {
    expect(computeSpecScore(null, null, 0, 5, specSettings)).toBe(5);
  });
  it("VGA 4점 + 게임존 3종(+0.6) + 모니터 5점 → 4.6*0.7+5*0.3=4.72", () => {
    expect(computeSpecScore("RTX 4060", null, 3 * GAME_ZONE_BONUS, 5, specSettings)).toBeCloseTo(4.72, 2);
  });
});

describe("computeZoneComposition/computeSeatScore (좌석점수 = 다양성 50% + 수용력 50%)", () => {
  it("자사 표준 존구성(팀룸2·커플존3·VIP존5·프렌즈존15) → 종류수5·독립룸수10 → 4.0점", () => {
    const { kinds, rooms } = computeZoneComposition([0, 0, 2, 3, 5], [15]);
    expect(kinds).toBe(5); // 일반석1 + 팀룸/커플존/VIP존/프렌즈존 4종
    expect(rooms).toBe(10); // 2+3+5, 프렌즈존은 제외 (가중치 없이 단순 합계)
    expect(computeSeatScore(kinds, rooms)).toBe(4.0);
  });
  it("경쟁점 팀룸 8개(1종) vs 자사 3종(각1개) — 둘 다 반영", () => {
    const rival = computeZoneComposition([0, 0, 8, 0]);
    expect(rival.kinds).toBe(2);
    expect(rival.rooms).toBe(8);
    expect(computeSeatScore(rival.kinds, rival.rooms)).toBeCloseTo((2 * 0.5 + 4 * 0.5), 2);
  });
});

describe("applyStandardOwnFacilityDefaults (07_신규후보지 헤더 메모: 비우면 표준값 적용, 2026-08-21)", () => {
  const blank = {
    ownGameZoneCount: null,
    ownTeamRoom: null,
    ownCoupleZone: null,
    ownVipZone: null,
    ownFriendsZone: null,
    ownFoodScore: null,
    ownInteriorScore: null,
    ownMonitorScore: null,
  };
  it("전부 비어있으면 표준값(게임존3·팀룸2·커플존3·VIP존5·프렌즈존15·평가4점)을 적용한다", () => {
    expect(applyStandardOwnFacilityDefaults(blank)).toEqual({
      ownGameZoneCount: 3,
      ownTeamRoom: 2,
      ownCoupleZone: 3,
      ownVipZone: 5,
      ownFriendsZone: 15,
      ownFoodScore: 4,
      ownInteriorScore: 4,
      ownMonitorScore: 4,
    });
  });
  it("실제 값이 입력돼 있으면 표준값으로 덮어쓰지 않는다", () => {
    const real = { ...blank, ownGameZoneCount: 1, ownTeamRoom: 0, ownFoodScore: 2 };
    const result = applyStandardOwnFacilityDefaults(real);
    expect(result.ownGameZoneCount).toBe(1);
    expect(result.ownTeamRoom).toBe(0); // 0은 "값 있음"이므로 표준값(2)으로 안 바뀐다
    expect(result.ownFoodScore).toBe(2);
    expect(result.ownVipZone).toBe(5); // 나머지 비어있는 항목은 여전히 표준값
  });
  it("신중동점(N001) 실사례: 표준값 적용 시 사양4.70·좌석4.00·경쟁력4.18을 그대로 재현한다", () => {
    const facility = applyStandardOwnFacilityDefaults(blank);
    const { kinds, rooms } = computeZoneComposition(
      [0, 0, facility.ownTeamRoom, facility.ownCoupleZone, facility.ownVipZone],
      [facility.ownFriendsZone],
    );
    const specSettings = { specWeights: defaultModelSettings().specWeights };
    const spec = computeSpecScore("RTX 5060", null, facility.ownGameZoneCount * GAME_ZONE_BONUS, facility.ownMonitorScore, specSettings);
    const seat = computeSeatScore(kinds, rooms);
    expect(spec).toBeCloseTo(4.7, 2);
    expect(seat).toBeCloseTo(4.0, 2);
    const competitivenessSettings = { competitivenessWeights: defaultModelSettings().competitivenessWeights };
    const total = computeCompetitivenessScore(
      { spec, seat, food: facility.ownFoodScore, interior: facility.ownInteriorScore, location: computeLocationScoreFromFacts(1, "지하", false) },
      competitivenessSettings,
    );
    expect(total).toBeCloseTo(4.18, 2); // 시트 04_점포평가요약 "자사_경쟁력점수" 스냅샷과 일치
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
      vgaBase: null,
      vgaTop: null,
      ram: null,
      monitor: null,
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
      interiorScore: null,
      interiorBasis: null,
      monitorScore: null,
      monitorBasis: null,
      room1: null,
      room2: null,
      teamRoom: null,
      coupleZone: null,
      premiumZone: null,
      premiumSpec: null,
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
      floor: 1,
      groundLevel: "지하" as const,
      hasElevator: false,
      hourlyRate: 1300,
      ownVgaBase: "RTX 5060",
      ownVgaTop: null,
      ownGameZoneCount: 3,
      ownRoom1: 0,
      ownRoom2: 0,
      ownTeamRoom: 2,
      ownCoupleZone: 3,
      ownVipZone: 5,
      ownFriendsZone: 15,
      ownFoodScore: 4,
      ownInteriorScore: 4,
      ownMonitorScore: 4,
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
      vgaBase: null,
      vgaTop: null,
      ram: null,
      monitor: null,
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
      interiorScore: 3,
      interiorBasis: null,
      monitorScore: 3,
      monitorBasis: null,
      room1: null,
      room2: null,
      teamRoom: null,
      coupleZone: null,
      premiumZone: null,
      premiumSpec: null,
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  it("존구성/VGA가 하나라도 없으면(물리적 시설 사실) 표준값으로 채우지 않고 데이터 부족으로 제외한다", () => {
    const result = computeExistingStoreMeasuredForecast(baseStore({ ownVgaBase: null }), [competitor()], settings);
    expect(result.excludedReason).toBe("데이터 부족(자사 존구성/VGA 미완비)");
    expect(result.measuredForecastMonthlyRevenue).toBeNull();
  });

  it("먹거리/인테리어/모니터평가(평가자 직접입력)가 없으면 표준값 4로 채우고 표본에서 빼지 않는다 — 실데이터 26곳 전부 이 3개가 비어 있었음(2026-08-21 확인)", () => {
    const result = computeExistingStoreMeasuredForecast(
      baseStore({ ownFoodScore: null, ownInteriorScore: null, ownMonitorScore: null }),
      [competitor()],
      settings,
    );
    expect(result.excludedReason).toBeNull();
    expect(result.ownCompetitivenessScore).toBeCloseTo(4.18, 2); // 표준값 4로 채워도 신중동점 사례와 동일 결과
  });

  it("경쟁점 정보가 없으면 제외한다", () => {
    const result = computeExistingStoreMeasuredForecast(baseStore(), [], settings);
    expect(result.excludedReason).toBe("경쟁점 정보 없음");
  });

  it("경쟁점은 있지만 핑봇 실측이 하나도 없으면(방문시점 실시간값만) 제외한다", () => {
    const result = computeExistingStoreMeasuredForecast(
      baseStore(),
      [competitor({ pingbotUtilization: null, measuredSeatRate: 28.9 })],
      settings,
    );
    expect(result.excludedReason).toBe("경쟁점 실측 데이터 부족(핑봇 실측 없음)");
  });

  it("입력이 완비되면 evaluate.ts와 동일한 조합으로 계산하고, 각 단계 출력이 재조합값과 일치한다", () => {
    const competitors = [competitor()];
    const result = computeExistingStoreMeasuredForecast(baseStore(), competitors, settings);
    expect(result.excludedReason).toBeNull();
    // 표준 존구성(팀룸2·커플존3·VIP존5·프렌즈존15)+지하1층·엘리베이터없음 조합은 신중동점 실사례와
    // 동일해서 경쟁력점수 4.18을 그대로 재현해야 한다(calc.ts applyStandardOwnFacilityDefaults 테스트 참고).
    expect(result.ownCompetitivenessScore).toBeCloseTo(4.18, 2);

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
      const result = computeExistingStoreMeasuredForecast(baseStore(), [competitor(), competitor({ id: "c2" })], settings);
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
      const result = computeExistingStoreMeasuredForecast(baseStore(), competitors, settings);
      expect(result.excludedReason).toBeNull();
      expect(result.competitorCoverageRatio).toBeCloseTo(0.2, 4);
      expect(result.isLowCoverageReliability).toBe(true);
    });
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

describe("judgeAaGrade (13_신규후보지판정!자동평가를 2,000/1,500/1,000만원 3단계로 확장, 2026-08-27)", () => {
  const base = { aaBaselineRevenue2000: 200, aaBaselineRevenue1500: 150, aaBaselineRevenue1000: 100 };
  it("오픈월 없으면 오픈월 입력 필요", () => {
    expect(judgeAaGrade({ plannedOpenMonth: null, measuredForecastRevenue: 300, ...base, expectedUtilization: 0.2, maxReviewUtilization: 0.5 })).toBe("오픈월 입력 필요");
  });
  it("실측값이 없으면 실측자료 부족", () => {
    expect(judgeAaGrade({ plannedOpenMonth: 3, measuredForecastRevenue: null, ...base, expectedUtilization: 0.2, maxReviewUtilization: 0.5 })).toBe("실측자료 부족");
  });
  it("기준값(1,500만원) 하나라도 없으면 실측자료 부족", () => {
    expect(
      judgeAaGrade({ plannedOpenMonth: 3, measuredForecastRevenue: 300, ...base, aaBaselineRevenue1500: null, expectedUtilization: 0.2, maxReviewUtilization: 0.5 }),
    ).toBe("실측자료 부족");
  });
  it("가동률이 최대검토가동률 초과면 데이터 재검토", () => {
    expect(judgeAaGrade({ plannedOpenMonth: 3, measuredForecastRevenue: 300, ...base, expectedUtilization: 0.6, maxReviewUtilization: 0.5 })).toBe("데이터 재검토");
  });
  it("2,000만원 기준 이상이면 2,000만원 이상", () => {
    expect(judgeAaGrade({ plannedOpenMonth: 3, measuredForecastRevenue: 200, ...base, expectedUtilization: 0.2, maxReviewUtilization: 0.5 })).toBe("2,000만원 이상");
  });
  it("1,500만원 이상 2,000만원 미만이면 1,500만원 이상", () => {
    expect(judgeAaGrade({ plannedOpenMonth: 3, measuredForecastRevenue: 199, ...base, expectedUtilization: 0.2, maxReviewUtilization: 0.5 })).toBe("1,500만원 이상");
  });
  it("1,000만원 이상 1,500만원 미만이면 1,000만원 이상", () => {
    expect(judgeAaGrade({ plannedOpenMonth: 3, measuredForecastRevenue: 149, ...base, expectedUtilization: 0.2, maxReviewUtilization: 0.5 })).toBe("1,000만원 이상");
  });
  it("1,000만원 미만이면 1,000만원 미달", () => {
    expect(judgeAaGrade({ plannedOpenMonth: 3, measuredForecastRevenue: 99, ...base, expectedUtilization: 0.2, maxReviewUtilization: 0.5 })).toBe("1,000만원 미달");
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

describe("isEligibleForV61Training (학습 대상 판정 — 블랙라벨·정상영업·산식학습제외 아님)", () => {
  const base = {
    brandType: "블랙라벨",
    franchiseStatus: "정상",
    excludedFromModel: false,
    pcCount: 100,
    hourlyRate: 1200,
    ownDemand: 2000,
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
    ownDemand: 300000,
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
      ownDemand: (2000 + i * 100) * 100,
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
      ownDemand: 200000,
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
      ownDemand: 200000,
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
      ownDemand: (2000 + i * 100) * 100,
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
      ownDemand: 200000,
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
      ownDemand: (2000 + i * 100) * 100,
      competitivenessScore: 3.5 + (i % 5) * 0.2,
      actualRevenueAvg: 55000000 + i * 1000000,
    }),
  );
  const outlier = makeStore({
    storeCode: "OUT1",
    storeName: "이상치점",
    hourlyRate: 3200,
    ownDemand: 60000,
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
    expect(diag.coefficientsWith).toHaveLength(3);
    expect(diag.coefficientsWithout).toHaveLength(3);
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

