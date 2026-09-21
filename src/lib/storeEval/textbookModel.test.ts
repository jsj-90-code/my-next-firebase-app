// 교과서식 점유율 — 품질 모드(2026-09-17 신설)의 동작을 고정한다.
//
// 통계적 근거(홀드아웃·대조군)는 `_competitionDesign.test.ts`에 있다. 여기서 지키는 건
// **배관**이다 — 산식이 뜻대로 도는지, 결측을 중립으로 읽는지, 유효거리가 실제로 자르는지.
//
// 이게 왜 필요한가: 2026-09-16에 점유율 분자에서 격차^gamma를 빠뜨려 "경쟁력이 좋을수록
// 가동률이 내려가는" 반대 결과가 나온 적이 있다. 부호 하나가 뒤집히면 검정 결과가 전부
// 무의미해지므로, 방향과 경계를 테스트로 박아 둔다.
import { describe, expect, it } from "vitest";
import { computeTextbook, computeQualityScore, DEFAULT_TEXTBOOK_PARAMS, type QualityParts, type TextbookInput, type TextbookParams } from "./textbookModel";

// ⚠️ `rivalDistanceDecay: null` — 아래 "품질 모드 점유율" 묶음은 **계단 동작**을 검증한다.
// 2026-09-21에 본체 기본값이 감쇠로 바뀌었는데(plateauM 300 · scaleM 150 · weightFactor 0.90),
// 그 묶음은 "유효거리 밖은 아예 안 센다" 같은 계단 성질을 확인하는 자리라 계단으로 고정한다.
// 감쇠 동작은 이 파일 맨 아래 "거리 감쇠" 묶음이 따로 본다.
const P: TextbookParams = {
  ...DEFAULT_TEXTBOOK_PARAMS, shareMode: "quality", outsideOptionIp: 0, rivalDistanceDecay: null,
};

/** 수요층은 이 테스트의 관심사가 아니다 — 인구를 고정해 점유율만 본다. */
function input(over: Partial<TextbookInput>): TextbookInput {
  return {
    storeCode: "T", storeName: "테스트", pcCount: 100, hourlyRate: 1343,
    actualUtilization: null, specialDemandType: "없음",
    competitivenessGap: 1, competitorIp: 0, competitorCount: 0,
    ownQualityParts: null, rivals: null, location: null,
    pop500m: 5000, pop1km: 20000,
    residentAges: { age0s: 2000, age10s: 2000, age20s: 4000, age30s: 4000, age40s: 3000, age50s: 3000, age60plus: 2000 },
    residentMaleRatio: 0.5, floatingMaleRatioByRadius: {}, floatingByRadius: {}, floatingAgesByRadius: {},
    ...over,
  };
}
const parts = (v: number): QualityParts => ({ spec: v, food: v, zone: v, interior: v, management: v });
const shareOf = (over: Partial<TextbookInput>, p: TextbookParams = P) => computeTextbook(input(over), p).share;

describe("computeQualityScore — 있는 항목만 그 합으로 나눈다", () => {
  it("전 항목이 같으면 그 값이 그대로 나온다 (비중과 무관)", () => {
    expect(computeQualityScore(parts(3.2), P.qualityWeights)).toBeCloseTo(3.2, 10);
  });

  it("결측 항목은 비중에서 자동으로 빠진다 — 0점으로 세지 않는다", () => {
    const some: QualityParts = { spec: 4, food: null, zone: 4, interior: null, management: null };
    expect(computeQualityScore(some, P.qualityWeights)).toBeCloseTo(4, 10);
  });

  it("전부 결측이면 null이다", () => {
    expect(computeQualityScore({ spec: null, food: null, zone: null, interior: null, management: null }, P.qualityWeights)).toBeNull();
  });

  it("비중을 바꾸면 점수가 바뀐다 — 조절판이 실제로 먹혀야 한다", () => {
    const mixed: QualityParts = { spec: 5, food: 1, zone: 1, interior: 1, management: 1 };
    const specHeavy = computeQualityScore(mixed, { spec: 0.9, food: 0.025, zone: 0.025, interior: 0.025, management: 0.025 });
    const specLight = computeQualityScore(mixed, { spec: 0.1, food: 0.225, zone: 0.225, interior: 0.225, management: 0.225 });
    expect(specHeavy!).toBeGreaterThan(specLight!);
  });
});

describe("품질 모드 점유율", () => {
  it("경쟁점이 없으면 점유율은 1이다 (독점상권)", () => {
    expect(shareOf({ ownQualityParts: parts(3.5), rivals: [] })).toBe(1);
  });

  it("품질이 같고 PC대수가 같으면 반씩 나눠 갖는다", () => {
    const s = shareOf({ ownQualityParts: parts(3), rivals: [{ ip: 100, distanceM: 100, parts: parts(3) }] });
    expect(s).toBeCloseTo(0.5, 10);
  });

  it("자사 품질이 높을수록 점유율이 올라간다 — 부호가 뒤집히면 안 된다", () => {
    const rivals = [{ ip: 100, distanceM: 100, parts: parts(2) }];
    const weak = shareOf({ ownQualityParts: parts(2), rivals })!;
    const strong = shareOf({ ownQualityParts: parts(4), rivals })!;
    expect(strong).toBeGreaterThan(weak);
    // theta=3이면 품질 2배가 경쟁점을 8분의 1로 만든다 -> 100/(100+100/8)
    expect(strong).toBeCloseTo(100 / (100 + 100 / 8), 10);
  });

  it("유효거리 밖의 경쟁점은 아예 안 센다 (계단)", () => {
    const far = { ip: 500, distanceM: P.effectiveRadiusM + 1, parts: parts(3) };
    expect(shareOf({ ownQualityParts: parts(3), rivals: [far] })).toBe(1);
    const near = { ...far, distanceM: P.effectiveRadiusM };
    expect(shareOf({ ownQualityParts: parts(3), rivals: [near] })!).toBeLessThan(1);
  });

  it("유효거리를 넓히면 경쟁점이 들어와 점유율이 내려간다", () => {
    const rivals = [{ ip: 200, distanceM: 450, parts: parts(3) }];
    const tight = shareOf({ ownQualityParts: parts(3), rivals }, { ...P, effectiveRadiusM: 300 })!;
    const wide = shareOf({ ownQualityParts: parts(3), rivals }, { ...P, effectiveRadiusM: 500 })!;
    expect(tight).toBe(1);
    expect(wide).toBeLessThan(1);
  });

  it("theta=0이면 품질을 안 본다 — PC대수 비례 배분", () => {
    const rivals = [{ ip: 300, distanceM: 100, parts: parts(1) }];
    const s = shareOf({ ownQualityParts: parts(5), rivals }, { ...P, qualityExponent: 0 })!;
    expect(s).toBeCloseTo(100 / 400, 10);
  });

  // ── 결측은 중립으로 읽는다 ────────────────────────────────────────────
  it("자사 품질을 모르면 품질 항을 통째로 빼고 비례 배분한다", () => {
    const rivals = [{ ip: 300, distanceM: 100, parts: parts(1) }];
    expect(shareOf({ ownQualityParts: null, rivals })).toBeCloseTo(100 / 400, 10);
  });

  it("경쟁점 품질을 모르면 자사와 같은 품질로 본다 — 결측이 유리해지면 안 된다", () => {
    const unknown = shareOf({ ownQualityParts: parts(4), rivals: [{ ip: 100, distanceM: 100, parts: null }] })!;
    expect(unknown).toBeCloseTo(0.5, 10);
  });

  it("거리를 모르면 유효거리 안으로 본다 — 빼는 쪽이 아니라 세는 쪽", () => {
    const s = shareOf({ ownQualityParts: parts(3), rivals: [{ ip: 100, distanceM: null, parts: parts(3) }] })!;
    expect(s).toBeCloseTo(0.5, 10);
  });

  it("PC대수가 0인 경쟁점은 무시한다 (경쟁점 pcCount가 전 문서 0이라 생기는 함정)", () => {
    expect(shareOf({ ownQualityParts: parts(3), rivals: [{ ip: 0, distanceM: 50, parts: parts(5) }] })).toBe(1);
  });
});

describe("입지 — 점유율에 곱하는 독립 항", () => {
  const L = (over: Partial<NonNullable<TextbookInput["location"]>>) => ({
    centrality: null, access: null, direction: null, flowBlock: null, visibility: null, ...over,
  });
  // 경쟁점을 하나 둬야 점유율이 1 미만이라 배율이 보인다 (1은 상한에 걸린다).
  const base = { ownQualityParts: parts(3), rivals: [{ ip: 100, distanceM: 100, parts: parts(3) }] };

  // ⚠️ **중심도는 2026-09-20부터 잔차화해서 들어간다**(`centralityResidual`). 유동400m를
  //    같이 주지 않으면 항이 통째로 빠지므로, 중심도를 보는 시험은 반드시 유동400m를 준다.
  //    기하평균 G_f를 주면 잔차화가 (중심도/G_c)만 남겨 눈금이 단순해진다.
  const CR = P.centralityResidual!;
  const atGeoMean = (centrality: number) => ({
    ...base,
    location: L({ centrality }),
    floatingByRadius: { 400: CR.geoMeanFloating400 },
  });

  it("기준값이면 1배다 — 아무 일도 안 한다", () => {
    // 잔차화 뒤 기준값이 되는 자리는 **기하평균**이다(유동400m도 G_f일 때).
    const b = computeTextbook(input({
      ...atGeoMean(CR.geoMeanCentrality),
      location: L({ centrality: CR.geoMeanCentrality, access: P.locationReferences.access }),
    }), P);
    expect(b.locationMultiplier).toBeCloseTo(1, 10);
    expect(b.share).toBeCloseTo(0.5, 10);
  });

  it("상권 중심이면 점유율이 올라가고, 상권 끝이면 내려간다", () => {
    const g = CR.geoMeanCentrality;
    const mid = computeTextbook(input(atGeoMean(g)), P).share!;
    const core = computeTextbook(input(atGeoMean(g * 2)), P).share!;
    const edge = computeTextbook(input(atGeoMean(g / 2)), P).share!;
    expect(core).toBeGreaterThan(mid);
    expect(edge).toBeLessThan(mid);
    // ν=0.5이면 중심도 2배가 2^0.5 = 1.414배다
    expect(core / mid).toBeCloseTo(Math.pow(2, P.locationExponents.centrality), 10);
  });

  it("같은 중심도라도 동네가 크면 덜 쳐준다 — 잔차화가 하는 일", () => {
    // 이게 잔차화의 뜻이다. 날값이 같아도 유동400m가 크면 "그 동네가 원래 빽빽한 것"이라
    // 우리 공은 덜 된다. 기울기 0.48이면 유동이 2배일 때 2^-0.48배로 깎인다.
    const small = computeTextbook(input({
      ...base, location: L({ centrality: 4 }), floatingByRadius: { 400: CR.geoMeanFloating400 },
    }), P).share!;
    const big = computeTextbook(input({
      ...base, location: L({ centrality: 4 }), floatingByRadius: { 400: CR.geoMeanFloating400 * 2 },
    }), P).share!;
    expect(big).toBeLessThan(small);
    expect(big / small).toBeCloseTo(Math.pow(Math.pow(2, -CR.slope), P.locationExponents.centrality), 10);
  });

  it("유동400m가 없으면 중심도 항을 통째로 뺀다 — 날값으로 되돌리지 않는다", () => {
    // ν=0.5는 **잔차 눈금**에 맞춘 값이다. 날 중심도에 그대로 먹이면 딴 걸 재게 되므로,
    // 잔차화를 못 하면 1배로 빼는 게 맞다(없는 값을 지어내지 않는다와 같은 규칙).
    const b = computeTextbook(input({ ...base, location: L({ centrality: 8 }) }), P);
    expect(b.locationFactors.map((f) => f.key)).toEqual([]);
    expect(b.locationMultiplier).toBe(1);
  });

  it("층이 높으면(접근성 점수가 낮으면) 점유율이 내려간다", () => {
    const hi = computeTextbook(input({ ...base, location: L({ access: 5 }) }), P).share!;  // 1층
    const lo = computeTextbook(input({ ...base, location: L({ access: 1 }) }), P).share!;  // 5층+엘베
    expect(hi).toBeGreaterThan(lo);
  });

  it("자료가 없으면 그 항은 1배로 빠진다 — 없는 값을 지어내지 않는다", () => {
    const none = computeTextbook(input({ ...base, location: null }), P);
    expect(none.locationMultiplier).toBe(1);
    expect(none.locationFactors).toEqual([]);
    // location 객체는 있는데 값이 전부 null이어도 같다
    const empty = computeTextbook(input({ ...base, location: L({}) }), P);
    expect(empty.locationMultiplier).toBe(1);
  });

  it("[보류] 항목은 계수가 0이라 값이 있어도 안 쓰인다", () => {
    const withHeld = computeTextbook(input({ ...base, location: L({ direction: 0.5, flowBlock: 5, visibility: 5 }) }), P);
    expect(withHeld.locationMultiplier).toBe(1);
    expect(withHeld.locationFactors).toEqual([]);
  });

  it("[보류] 유동 방향은 계수를 켜면 바로 동작한다 — 편심도가 크면 불리하다", () => {
    const p: TextbookParams = { ...P, locationExponents: { ...P.locationExponents, direction: 1 } };
    const center = computeTextbook(input({ ...base, location: L({ direction: 0.1 }) }), p).share!;
    const edge = computeTextbook(input({ ...base, location: L({ direction: 0.6 }) }), p).share!;
    expect(center).toBeGreaterThan(edge);
  });

  it("어느 항목이 얼마를 곱했는지 내놓는다 (화면 표시용)", () => {
    const b = computeTextbook(input({
      ...base, location: L({ centrality: 8, access: 5 }),
      floatingByRadius: { 400: CR.geoMeanFloating400 },
    }), P);
    expect(b.locationFactors.map((f) => f.key).sort()).toEqual(["access", "centrality"]);
    expect(b.locationFactors.reduce((a, f) => a * f.value, 1)).toBeCloseTo(b.locationMultiplier!, 10);
  });

  it("점유율은 1을 못 넘는다 — 입지가 좋아도 동네 수요보다 많이 먹지는 못한다", () => {
    const b = computeTextbook(input({ ownQualityParts: parts(3), rivals: [], location: L({ centrality: 100 }) }), P);
    expect(b.share).toBe(1);
  });

  it("off 모드에서는 입지도 통째로 빠진다 — 필요 점유율을 보는 모드다", () => {
    const b = computeTextbook(input({ ...base, location: L({ centrality: 100, access: 5 }) }), { ...P, shareMode: "off" });
    expect(b.share).toBe(1);
    expect(b.locationMultiplier).toBe(1);
  });
});

describe("모드끼리 섞이지 않는다", () => {
  const rivals = [{ ip: 400, distanceM: 100, parts: parts(2) }];
  const over = { ownQualityParts: parts(3.5), rivals, competitorIp: 400, competitivenessGap: 1.5 };

  it("off는 경쟁을 통째로 들어낸다 — 필요 점유율을 만드는 모드", () => {
    expect(shareOf(over, { ...P, shareMode: "off" })).toBe(1);
  });

  it("formula는 격차^지수만 쓴다 — 품질·거리를 안 본다 (기각된 구조, 비교용)", () => {
    const p: TextbookParams = { ...P, shareMode: "formula", gapExponent: 4 };
    const g = Math.pow(1.5, 4);
    expect(shareOf(over, p)).toBeCloseTo((100 * g) / (100 * g + 400), 10);
  });

  it("quality는 competitorIp 합계가 아니라 rivals 낱개를 쓴다", () => {
    // competitorIp=400이지만 유효거리 밖이면 0으로 겨룬다 — 두 값은 일부러 다르다.
    const far = { ...over, rivals: [{ ip: 400, distanceM: 900, parts: parts(2) }] };
    expect(shareOf(far)).toBe(1);
  });
});

// 2026-09-21 채택 — 거리 감쇠가 기본값이 됐다. 그 동작을 여기서 고정한다.
//   무게 = 1 (거리 <= plateauM) · exp(−(거리 − plateauM) ÷ scaleM) (밖) · x weightFactor
describe("거리 감쇠 (2026-09-21 채택 기본값)", () => {
  const D = DEFAULT_TEXTBOOK_PARAMS.rivalDistanceDecay!;

  it("기본값이 켜져 있다 — 평지 300m · 감쇠 150m · 총량 정규화 0.90", () => {
    expect(D.plateauM).toBe(300);
    expect(D.scaleM).toBe(150);
    expect(D.weightFactor).toBeCloseTo(0.9, 10);
  });

  it("유효거리 밖 경쟁점도 **센다** — 계단이 아니다 (오송점 342m 문제)", () => {
    const rivals = [{ ip: 100, distanceM: 342, parts: parts(3) }];
    const step = computeTextbook(input({ ownQualityParts: parts(3), rivals }), { ...P, rivalDistanceDecay: null }).share;
    const decay = computeTextbook(input({ ownQualityParts: parts(3), rivals }), DEFAULT_TEXTBOOK_PARAMS).share;
    expect(step).toBe(1); // 계단: 300m 밖이라 통째로 빠져 독점이 된다
    expect(decay).toBeLessThan(1); // 감쇠: 세진다
  });

  it("평지 안쪽은 거리가 달라도 같다 — 실무 의견(유효거리 안이면 거리가 크게 작용 안 한다)", () => {
    const at = (d: number) =>
      computeTextbook(input({ ownQualityParts: parts(3), rivals: [{ ip: 100, distanceM: d, parts: parts(3) }] }),
        DEFAULT_TEXTBOOK_PARAMS).share;
    expect(at(50)).toBeCloseTo(at(299)!, 10);
  });

  it("멀수록 단조롭게 줄어든다 — 401m 문제가 구조적으로 없다", () => {
    const at = (d: number) =>
      computeTextbook(input({ ownQualityParts: parts(3), rivals: [{ ip: 100, distanceM: d, parts: parts(3) }] }),
        DEFAULT_TEXTBOOK_PARAMS).share!;
    // 경쟁이 약해질수록 자사 점유율은 올라간다. 400m와 401m 사이에 절벽이 없다.
    expect(at(401)).toBeGreaterThan(at(400));
    expect(at(400) - at(399)).toBeLessThan(0.005);
    expect(at(1500)).toBeGreaterThan(at(500));
  });

  it("scaleM=0이면 계단과 같다 — 중첩 모형이다", () => {
    const rivals = [{ ip: 100, distanceM: 342, parts: parts(3) }];
    const zero = computeTextbook(input({ ownQualityParts: parts(3), rivals }),
      { ...P, rivalDistanceDecay: { plateauM: 300, scaleM: 0, weightFactor: 1 } }).share;
    expect(zero).toBe(1);
  });
});
