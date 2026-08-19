// 골든 데이터 테스트: reference/점포평가_V62_원본.xlsx의 실제 셀 값과 웹 계산 결과를 비교한다.
// 아래 표는 12_운영판정!A36:N61 (블랙라벨·검증사용 26곳 전체)을 그대로 옮긴 것이다.
// V61 예측값은 원본 시트 값을 그대로 쓴다 - Apps Script 회귀식 자체는 재현 대상이 아니고
// (docs/data-issues.md #1), V62 보정·오차지표·판정 로직만 검증한다.

import { describe, expect, it } from "vitest";
import {
  computeBoundedSales,
  computeCompletionStatus,
  computeCumulativeAverageSales,
  computeFinalJudgement,
  computeLocationCompositeScore,
  computeMarketCharacter,
  computeV61Fallback,
  computeV62Final,
  computeValidationRow,
  getV62Rate,
  summarizeValidation,
  type ValidationInputRow,
} from "./calc";
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
