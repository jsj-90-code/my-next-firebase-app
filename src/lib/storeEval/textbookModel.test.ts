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

const P: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS, shareMode: "quality", outsideOptionIp: 0 };

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

  it("기준값이면 1배다 — 아무 일도 안 한다", () => {
    const ref = P.locationReferences;
    const b = computeTextbook(input({ ...base, location: L({ centrality: ref.centrality, access: ref.access }) }), P);
    expect(b.locationMultiplier).toBeCloseTo(1, 10);
    expect(b.share).toBeCloseTo(0.5, 10);
  });

  it("상권 중심이면 점유율이 올라가고, 상권 끝이면 내려간다", () => {
    const ref = P.locationReferences.centrality;
    const mid = computeTextbook(input({ ...base, location: L({ centrality: ref }) }), P).share!;
    const core = computeTextbook(input({ ...base, location: L({ centrality: ref * 2 }) }), P).share!;
    const edge = computeTextbook(input({ ...base, location: L({ centrality: ref / 2 }) }), P).share!;
    expect(core).toBeGreaterThan(mid);
    expect(edge).toBeLessThan(mid);
    // nu=0.25이면 중심도 2배가 2^0.25 = 1.189배다
    expect(core / mid).toBeCloseTo(Math.pow(2, P.locationExponents.centrality), 10);
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
    const b = computeTextbook(input({ ...base, location: L({ centrality: 8, access: 5 }) }), P);
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
