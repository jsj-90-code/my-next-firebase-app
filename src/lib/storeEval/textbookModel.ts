// 교과서식 산식 (실험판) — 2026-09-15 신설.
//
// 사용자 방향: "지금 가맹점 데이터 기준값으로 하는 건 일단 현재 시점에서 두고, 산식을 또
// 만드는 구조로 하는 건데. 이걸 내가 보고 판단하려면 웹에 반영이 되어야 한다. 예를 들어
// 점포평가 test 버전 같은 페이지를 또 하나 만드는 거지. 여기에 유동 100, 200 등을 추가해서
// 궁극의 목표로 가보자는 거지. 지금 가맹점 기준 데이터로 맞추는 건 모수가 늘어도 신빙성이
// 없을 것 같다."
//
// ⚠️ **이 파일은 기존 산식(calc.ts / usageRevenue.ts)을 대체하지 않는다.** 운영 화면은 계속
//    기존 산식을 쓰고, 이 모듈은 /store-eval/lab 실험 화면에서만 호출한다. 기존 파일은 한 줄도
//    건드리지 않는다 — 두 산식을 나란히 두고 비교하는 게 이 작업의 목적이다.
//
// ── 구조 ─────────────────────────────────────────────────────────────────
//   1) 총수요   = (주거인구 x 이용률 + 유동인구 x 이용률 x α) x 1인당 월이용시간
//   2) 점유율   = (자사PC x 격차^γ) / (자사PC x 격차^γ + 경쟁IP)
//   3) 자사수요 = 총수요 x 점유율   -> 가동률 = 자사수요 / (자사PC x 720)
//   4) 매출     = 자사PC x 720 x 가동률 x 총단가
//
// ── 축척은 두 개다 (2026-09-16 구조 변경) ────────────────────────────────
//   층마다 실측값이 따로 있으니 축척도 따로 맞춘다. 자세한 근거는 fitHoursPerUser 위 주석.
//     hoursPerUserPerMonth <- 독점매장 **실측 가동률**
//     totalUnitPrice       <- 독점매장 **실매출**
//   그전에는 축척 하나가 둘을 겸해서, 환산층이 틀린 만큼이 가동률로 되밀려 들어갔다.
//
// 기존 산식과 다른 점은 **회귀로 덮지 않는다**는 것이다. 기존 V61/V62는 위 값을 특징 하나로
// 넣고 기존 38곳 평균에 맞춰 회귀하는데, 그래서 "기존 가맹점 평균에서 ±"라는 설명밖에 못 한다.
//
// ── 알려진 한계 (2026-09-15 실측) ────────────────────────────────────────
//   관측 총수요를 인구로 맞춘 최선이 MAPE 42%다(주거1km + 유동x0.2). 목표 10%, 마지노선
//   20%에 한참 못 미친다. 반경·가중을 바꿔도 이 벽이 있다:
//     주거 500m 총수    r=0.299   주거 1km 총수  r=0.511   주거 1km 연령가중 r=0.516
//     유동 500m 총수    r=0.692   유동 500m 연령가중 r=0.635
//   그래서 이 모듈의 기본값은 "정답"이 아니라 **출발점**이다. 화면에서 손으로 돌려보며
//   어디까지 가는지 재라고 파라미터를 전부 밖으로 뺐다.

/** PC방 이용률 가중 — 연령대별로 "이 연령 100명 중 몇 명이 PC방을 쓰나". */
export type AgeUsageWeights = {
  age0s: number; age10s: number; age20s: number; age30s: number;
  age40s: number; age50s: number; age60plus: number;
};

/**
 * 연령·성별 PC방 이용률 — **1,000명 중 몇 명이 PC방을 쓰나** (2026-09-16 사용자 제공 실측 조사).
 *
 *   연령   남성   여성
 *   10대   390    130
 *   20대   420    150
 *   30대   170     45
 *   40대   100     20
 *   50대    35      8
 *
 * 이 값은 **우리 데이터로 맞춘 게 아니다.** 외부 조사값을 그대로 넣었는데 독점매장 3곳이
 * 최대오차 0.8% 안에 들어왔다(직접 만든 추정 가중치는 3.2~4.7%였다). 과적합일 수 없는
 * 종류의 일치라 이 값을 신뢰한다.
 *
 * ⚠️ 2020~2021 조사라 절대 수준은 낡았을 수 있다. 다만 산식에서 의미를 갖는 건 **연령·성별 간
 *    비율**뿐이고, 전체 수준은 hoursPerUserPerMonth(축척 계수)가 흡수한다.
 */
export const PC_USE_RATE_MALE: AgeUsageWeights = {
  age0s: 0, age10s: 0.390, age20s: 0.420, age30s: 0.170,
  age40s: 0.100, age50s: 0.035, age60plus: 0,
};
export const PC_USE_RATE_FEMALE: AgeUsageWeights = {
  age0s: 0, age10s: 0.130, age20s: 0.150, age30s: 0.045,
  age40s: 0.020, age50s: 0.008, age60plus: 0,
};

/**
 * 지역 남성비율 m으로 남녀 이용률을 섞는다. m=0.5면 남녀평균이다.
 *
 * ⚠️ **성별 x 연령 교차 자료는 존재하지 않는다.** SGIS도 소상공인365도 성별 총수와 연령 총수를
 *    따로 줄 뿐이다(2026-09-16 확인, classDeg 1·2·3 전부 같은 74필드). 그래서 "각 연령대 안의
 *    성비 = 그 지역 전체 성비"로 근사한다. 이건 임시방편이 아니라 자료의 한계다.
 */
export function blendUsageByGender(maleRatio: number | null): AgeUsageWeights {
  const m = maleRatio == null || !Number.isFinite(maleRatio) ? 0.5 : Math.min(1, Math.max(0, maleRatio));
  const mix = (key: keyof AgeUsageWeights) => m * PC_USE_RATE_MALE[key] + (1 - m) * PC_USE_RATE_FEMALE[key];
  return {
    age0s: mix("age0s"), age10s: mix("age10s"), age20s: mix("age20s"), age30s: mix("age30s"),
    age40s: mix("age40s"), age50s: mix("age50s"), age60plus: mix("age60plus"),
  };
}

/**
 * 유동인구를 어느 반경으로 쓸지.
 * 2026-09-15에 100/200/300/400m 수집 경로를 열었다(scripts/collectSbizFloatingPopulation.mjs).
 * 500m는 원래 갖고 있던 값이라 출처가 다르다 — 반경끼리 비교할 땐 100~400m 안에서 본다.
 */
export type FloatingRadius = 100 | 200 | 300 | 400 | 500;
/** 주거인구를 어느 반경으로 쓸지. 500m는 연령 분해가 없어 총수만 쓸 수 있다. */
export type ResidentRadius = 500 | 1000;

export type TextbookParams = {
  residentRadius: ResidentRadius;
  floatingRadius: FloatingRadius;
  /** 주거인구에 연령가중을 적용할지. 500m는 연령 자료가 없어 무시된다. */
  useResidentAgeWeights: boolean;
  /** 유동인구에 연령가중을 적용할지. */
  useFloatingAgeWeights: boolean;
  /** 유동인구를 수요로 볼 때 깎는 비율. 스쳐 가는 사람이 대부분이라 1.0일 수 없다. */
  floatingFactor: number;
  ageWeights: AgeUsageWeights;
  /** 이용자 1인당 월 PC방 이용시간. 총수요를 시간 단위로 바꾸는 계수. */
  hoursPerUserPerMonth: number;
  /** 점유율에서 경쟁력격차를 얼마나 세게 볼지. 1이면 기존 구조와 같다. */
  gapExponent: number;
  /**
   * **PC방을 안 가는 몫** (Huff 모형의 no-purchase option). 경쟁IP와 같은 단위로 분모에 더한다.
   *
   * 2026-09-15에 이게 없어서 교과서식이 무너졌다 — 경쟁점이 0곳이면 점유율이 100%가 되어
   * 그 동네 수요를 통째로 먹는다. 광주각화점 2억2천(실제 7,616만), 남악점 1억7천(실제 6,286만),
   * 탕정역점 1억6천(실제 7,586만)이 전부 점유율 100% 케이스였다.
   * 경쟁 PC방이 없다고 동네 사람이 다 우리 매장에 오지는 않는다. 그 "안 오는 몫"이 이 값이다.
   */
  outsideOptionIp: number;
  /**
   * **상권 흡인력** — 경쟁점이 많다는 건 그 자리가 좋다는 뜻이기도 하다.
   * 수요에 (1 + factor x ln(1 + 경쟁점수))를 곱한다. 0이면 끈 것이다.
   *
   * 지금 구조는 경쟁을 벌점으로만 본다. 그래서 금촌역·양주덕정·수원인계처럼 경쟁이 많은데
   * 실제로 잘 되는 매장을 절반 아래로 깎아버렸다(오차 56~64%).
   */
  agglomerationFactor: number;
  /**
   * **주거 밀집도 보정** — 2026-09-15 야간 발견.
   *
   * 치우침(예측/실제-1)이 500m 주거인구와 r=0.660으로 강하게 붙어 있었다(유의선 0.32).
   * 수요를 1km 주거인구로 재는데, 같은 1km 인구라도 500m 안에 얼마나 몰려 있는지가
   * 매장마다 다르다. 가까이 몰려 있는 곳을 그만큼 더 크게 세고 있었던 것이다.
   *
   * 수요에 (500m주거 / 1km주거)^(-계수)를 곱해 상쇄한다. 0이면 끈 것이다.
   */
  densityCorrection: number;
  /**
   * 총매출 대비 상품매출 비율. **매출 크기에는 더 이상 영향을 주지 않는다**(2026-09-16 구조 변경).
   * 총매출은 이제 총단가(totalUnitPrice)가 직접 정하고, 이 값은 그 총매출을 PC매출과 상품매출로
   * **쪼개 보여주는 데만** 쓴다. 실측 32곳 중앙 52.7%다(회사 기준값은 50%였다).
   */
  productRatio: number;
  /**
   * **총단가** — PC 1대를 1시간 채웠을 때 들어오는 총매출(PC+상품, 원).
   *
   * 2026-09-16 신설. 그전에는 `매출 = 이용시간 x 정가 ÷ (1-상품비율)`이었는데, 정가는
   * 실제로 받는 돈과 다르다(좌석 추가과금 +, 정액권 할인 −). 32곳에서 역산한 실측 총단가는
   * 중앙 2,778원 · 범위 2,246~3,606원이고, 정가x2(=지금 산식)와는 독점 3곳에서 −12.7%~+19.2%
   * 어긋났다. 그래서 정가를 거쳐 가지 않고 총단가를 직접 축척으로 잡는다.
   *
   * 이 값은 눈으로 정하지 않는다 — `fitTotalUnitPrice`가 **독점매장 실매출**에서 구한다.
   */
  totalUnitPrice: number;
  /**
   * **정가 탄력도 β** — 총단가가 정가를 얼마나 따라가는지. 총단가 = T0 x (정가/기준정가)^β.
   *
   * **운영 산식의 `effectiveHourlyRate`(usageRevenue.ts)와 같은 형태다.** 거기 기본값은
   * `tariffEffectiveExponent = 0.546` · `tariffReferenceRate = 1343`(38곳으로 2026-09-14에
   * 구함)이고, 이 β에 0.546을 넣으면 그 식과 완전히 같아진다. 2026-09-16에 32곳으로 독립
   * 측정한 값도 0.49~0.535라 그 지수 자체는 잘 선 값이다 — 32곳 실효단가를 MAPE 9.16%로
   * 맞힌다(정가를 그대로 쓰면 10.43%).
   *
   * **왜 0이 아니라 0.546인가 — 독점 기준을 이 층에 쓰면 안 된다.**
   *
   * 독점매장(경쟁IP=0)이 필요한 이유는 점유율이 1이라 격차^gamma가 약분돼 **수요식을 경쟁
   * 항에서 떼어낼 수 있기** 때문이다. 환산층에는 그 문제가 없다 — 실측 가동률이 있어서
   * 32곳 **전부에서** 총단가를 직접 잴 수 있다(총단가 = 실매출 ÷ (PC x 720 x 실측가동률)).
   * 그래서 이 층은 독점으로 고르지 않고 전체 표본으로 고른다.
   *
   * 환산층만 떼어 잰 성적(실측 가동률을 넣고 매출만 계산, 32곳):
   *   β=0      MAPE 12.18%      β=0.4  MAPE 9.71%      β=0.6  MAPE 9.29%
   *
   * 독점 3곳은 이 추세를 거스른다 — 정가 순서(1400 < 1500 < 1700)가 실효단가 순서
   * (1397 < 1498 < 1615)와 정확히 반대다. 그래서 β를 올리면 독점만 나빠진다:
   *
   *   β=0     독점 최대오차  8.5%  · 전체 MAPE 30.96%
   *   β=0.3   독점 최대오차 10.9%  · 전체 MAPE 30.14%
   *   β=0.546 독점 최대오차 12.8%  · 전체 MAPE 30.14%   ← 기본값. 운영 산식과 동일
   *   β=1     독점 최대오차 16.2%  · 전체 MAPE 31.14%   (2026-09-16 이전 동작)
   *
   * 세 매장 순서가 정확히 뒤집힐 확률은 1/6이라 우연으로 설명된다. 32곳 증거가 3곳보다
   * 강하다고 보고 0.546을 쓴다. 독점을 우선하려면 조절판에서 0으로 내리면 된다.
   *
   * 사용자(2026-09-16): "매장별 정액할인 금액이 틀리고 신규후보지도 마찬가지로 정액할인에
   * 대한 정보가 없으니까 평균값이 가장 정답일것같다" — 맞는 판단이고, 여기서 쓰는 "평균"이
   * 바로 그것이다. 정액할인의 *크기*는 모르지만 **정가가 비쌀수록 할인이 크다는 경향**은
   * 38곳에서 측정된 정보라 버리지 않는다.
   */
  rateElasticity: number;
  /** 정가 탄력도의 기준점(원). 이 정가인 매장에서 총단가 = T0가 된다. 32곳 중앙정가. */
  referenceHourlyRate: number;
  /** 가동률 물리적 상한. 이 위로는 좌석이 모자라 못 받는다. */
  maxUtilization: number;
};

/**
 * 2026-09-16 확정본. 근거는 `docs/handoff-20260916-evening.md` 2절.
 *
 *   유동 400m  — 500m는 수원망포점처럼 지하철 상권을 먹는다(300→400m에서 4.19배 점프).
 *                100~300m는 너무 좁아 오차가 커진다. 독점 5% 체를 통과한 조합이 전부 400m 계열이었다.
 *   주거 1km   — 100~500m도 전부 시험했으나 1km가 이겼다. PC방은 평균 3시간·월 3.7회 오는
 *                목적지형이라 도보 10분권이 상권이라는 뜻이다.
 *   유동 x0.15 — **측정값이 아니라 보정상수다.** 한 숫자가 셋을 떠맡는다: 단위 변환(주거는 "명",
 *                유동은 "하루 통행량"), 중복 제거(거주자 통행이 양쪽에 두 번), 방문객의 낮은 이용
 *                성향. 그래서 "유동인구의 15%가 수요"라고 읽으면 안 된다.
 *   격차^4     — 경쟁력 쏠림. 우위가 있으면 한쪽으로 쏠린다는 현장 관찰을 지수로 옮긴 것이고,
 *                무작위 대조군 500회에서 p=0.004로 통과했다(가동률 MAPE 46.25% → 30.59%).
 *   상한 0.55  — 실측 월평균 가동률 최대가 46.5%(전대후문점), 월 최대의 최대가 52.0%다.
 */
export const DEFAULT_TEXTBOOK_PARAMS: TextbookParams = {
  residentRadius: 1000,
  floatingRadius: 400,
  useResidentAgeWeights: true,
  useFloatingAgeWeights: true,
  floatingFactor: 0.15,
  // 연령가중 자체는 남녀 이용률을 지역 성비로 섞어 그때그때 만든다(blendUsageByGender).
  // 여기 값은 성비를 모를 때(남녀 1:1)의 기본값이다.
  ageWeights: blendUsageByGender(0.5),
  hoursPerUserPerMonth: 1.0,
  gapExponent: 4.0,
  outsideOptionIp: 0,
  agglomerationFactor: 0,
  densityCorrection: 0,
  // 실측 32곳 평균. 매출 크기가 아니라 PC/상품 분해 표시에만 쓴다(2026-09-16).
  productRatio: 0.523,
  // fitTotalUnitPrice가 독점 실매출에서 다시 구한다. 여기 값은 그 전에 쓰이는 출발점이다.
  // (기본 β에서 총단가 = 실효단가 ÷ (1-0.523)이므로 정가 1343원 매장 기준 약 2,816원)
  totalUnitPrice: 2816,
  // 운영 산식 usageRevenue.ts effectiveHourlyRate와 같은 값 — 두 산식이 한 식을 쓴다.
  rateElasticity: 0.546,
  referenceHourlyRate: 1343,
  maxUtilization: 0.55,
};

/** 한 점포(기존점이든 후보지든)의 교과서식 입력. */
export type TextbookInput = {
  storeCode: string;
  storeName: string | null;
  pcCount: number | null;
  hourlyRate: number | null;
  /**
   * **실측 월평균 가동률**(0~1). 평가창 월매출의 `utilizationRate` 평균이다.
   *
   * 2026-09-16 신설. 수요층 축척을 여기에 맞춘다 — 그전에는 축척 하나가 "수요를 가동률로
   * 바꾸는 일"과 "가동률을 매출로 바꾸는 일"을 겸해서, 환산층이 틀린 만큼이 가동률로
   * 되밀려 들어갔다(독점 3곳 가동률이 화면에서 −3.2~−5.3% 어긋나 보이던 원인).
   * 층마다 실측값이 따로 있으니(가동률은 매출DB·게토, 매출은 매출DB) 축척도 따로 맞춘다.
   */
  actualUtilization: number | null;
  competitivenessGap: number | null;
  competitorIp: number | null;
  /** 상권 흡인력 계산용. 조사된 경쟁점 수(IP가 아니라 점포 수). */
  competitorCount: number | null;
  /** 주거 — 500m는 총수만, 1km는 연령 분해까지 있다. */
  pop500m: number | null;
  pop1km: number | null;
  residentAges: { age0s: number; age10s: number; age20s: number; age30s: number; age40s: number; age50s: number; age60plus: number } | null;
  /**
   * 주거인구의 남성비율(0~1). 연령별 이용률을 성비로 섞는 데 쓴다(blendUsageByGender).
   * 없으면 남녀 1:1로 본다.
   */
  residentMaleRatio: number | null;
  /** 유동인구의 반경별 남성비율(0~1). */
  floatingMaleRatioByRadius: Partial<Record<FloatingRadius, number | null>>;
  /** 유동 — 반경별. 아직 500만 채워진다. */
  floatingByRadius: Partial<Record<FloatingRadius, number | null>>;
  floatingAgesByRadius: Partial<Record<FloatingRadius, { age10s: number; age20s: number; age30s: number; age40s: number; age50s: number; age60plus: number } | null>>;
};

export type TextbookBreakdown = {
  residentDemandUsers: number | null;
  floatingDemandUsers: number | null;
  totalDemandUsers: number | null;
  totalDemandHours: number | null;
  share: number | null;
  ownDemandHours: number | null;
  utilization: number | null;
  capped: boolean;
  /** 이 매장에 적용된 총단가(원/PC·시간). 화면에 그대로 보여준다. */
  unitPrice: number | null;
  pcRevenue: number | null;
  productRevenue: number | null;
  monthlyRevenue: number | null;
  /** 왜 값이 안 나왔는지. 화면에서 그대로 보여준다. */
  missing: string[];
};

const MONTH_HOURS = 24 * 30;

function weightedAges(
  ages: { age0s?: number; age10s: number; age20s: number; age30s: number; age40s: number; age50s: number; age60plus: number },
  w: AgeUsageWeights,
): number {
  return (ages.age0s ?? 0) * w.age0s + ages.age10s * w.age10s + ages.age20s * w.age20s
    + ages.age30s * w.age30s + ages.age40s * w.age40s + ages.age50s * w.age50s
    + ages.age60plus * w.age60plus;
}

/**
 * 연령 자료가 없을 때 총인구에 쓸 평균 이용률. 연령가중을 켠 매장과 끈 매장이 서로 다른
 * 자로 재지는 걸 막으려고, 가중치의 인구 가중평균이 아니라 **그냥 평균 이용률**을 쓴다
 * (전국 연령 분포를 모르는 상태에서 지어내지 않는다는 뜻이다).
 */
export function flatUsageRate(w: AgeUsageWeights): number {
  const vals = [w.age0s, w.age10s, w.age20s, w.age30s, w.age40s, w.age50s, w.age60plus];
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function computeTextbook(input: TextbookInput, p: TextbookParams): TextbookBreakdown {
  const missing: string[] = [];
  const empty: TextbookBreakdown = {
    residentDemandUsers: null, floatingDemandUsers: null, totalDemandUsers: null,
    totalDemandHours: null, share: null, ownDemandHours: null, utilization: null,
    capped: false, unitPrice: null, pcRevenue: null, productRevenue: null, monthlyRevenue: null, missing,
  };

  // 연령별 이용률은 **그 자료의 지역 성비로 섞어서** 쓴다(2026-09-16). 주거와 유동은 성비가
  // 다르므로(주거 중앙 49.9%, 유동 중앙 57.9%) 각각 따로 섞는다.
  // 성비 자료가 없으면 남녀 1:1로 떨어진다(blendUsageByGender가 null을 0.5로 본다).
  // `?.`를 쓰는 이유: 이 필드는 2026-09-16에 추가돼서, 그 전에 만들어진 호출부는 아예 안 넘긴다.
  const residentWeights = blendUsageByGender(input.residentMaleRatio ?? null);
  const floatingWeights = blendUsageByGender(input.floatingMaleRatioByRadius?.[p.floatingRadius] ?? null);

  // ── 1) 주거 수요 ────────────────────────────────────────────────────────
  let residentUsers: number | null = null;
  if (p.residentRadius === 1000) {
    if (p.useResidentAgeWeights && input.residentAges) {
      residentUsers = weightedAges(input.residentAges, residentWeights);
    } else if (input.pop1km != null) {
      residentUsers = input.pop1km * flatUsageRate(residentWeights);
    } else missing.push("1km 주거인구");
  } else {
    // 500m는 연령 분해가 없다 — 총수 x 평균 이용률만 가능하다.
    if (input.pop500m != null) residentUsers = input.pop500m * flatUsageRate(residentWeights);
    else missing.push("500m 주거인구");
  }

  // ── 2) 유동 수요 ────────────────────────────────────────────────────────
  let floatingUsers: number | null = null;
  const flow = input.floatingByRadius[p.floatingRadius];
  const flowAges = input.floatingAgesByRadius[p.floatingRadius];
  if (flow == null) {
    missing.push(`${p.floatingRadius}m 유동인구`);
  } else if (p.useFloatingAgeWeights && flowAges) {
    floatingUsers = weightedAges(flowAges, floatingWeights) * p.floatingFactor;
  } else {
    floatingUsers = flow * flatUsageRate(floatingWeights) * p.floatingFactor;
  }

  if (residentUsers == null && floatingUsers == null) return empty;

  const baseUsers = (residentUsers ?? 0) + (floatingUsers ?? 0);
  // 상권 흡인력 — 경쟁점이 많다는 건 그 자리가 좋다는 뜻이기도 하다. 0이면 끈 것이다.
  const agg = p.agglomerationFactor > 0
    ? 1 + p.agglomerationFactor * Math.log(1 + (input.competitorCount ?? 0))
    : 1;
  // 주거 밀집도 보정 — 500m에 몰려 있는 상권을 과대평가하던 걸 상쇄한다.
  const dens = p.densityCorrection > 0 && input.pop500m && input.pop1km
    ? Math.pow(input.pop500m / input.pop1km, -p.densityCorrection)
    : 1;
  const totalUsers = baseUsers * agg * dens;
  const totalHours = totalUsers * p.hoursPerUserPerMonth;

  // ── 3) 점유율 ───────────────────────────────────────────────────────────
  const pc = input.pcCount;
  if (!pc) { missing.push("PC대수"); return { ...empty, residentDemandUsers: residentUsers, floatingDemandUsers: floatingUsers, totalDemandUsers: totalUsers, totalDemandHours: totalHours }; }
  const gap = input.competitivenessGap ?? 1;
  const rivalIp = input.competitorIp ?? 0;
  const ownWeight = pc * Math.pow(gap, p.gapExponent);
  // 분모의 outsideOptionIp가 "PC방을 안 가는 몫"이다. 이게 없으면 경쟁점 0곳일 때
  // 점유율이 100%가 되어 동네 수요를 통째로 먹는다.
  const denom = ownWeight + rivalIp + p.outsideOptionIp;
  const share = denom > 0 ? ownWeight / denom : 1;

  // ── 4) 매출 ─────────────────────────────────────────────────────────────
  const rawOwnHours = totalHours * share;
  const capHours = pc * MONTH_HOURS * p.maxUtilization;
  const capped = rawOwnHours > capHours;
  const ownHours = Math.min(rawOwnHours, capHours);
  const utilization = ownHours / (pc * MONTH_HOURS);

  // 총단가 = T0 x (정가/기준정가)^β. β=0(기본)이면 정가와 무관하게 T0다.
  // 정가를 거쳐 가지 않는 이유는 totalUnitPrice/rateElasticity 주석에 적혀 있다.
  const rate = input.hourlyRate;
  const rateFactor = p.rateElasticity === 0 || rate == null || !(p.referenceHourlyRate > 0)
    ? 1
    : Math.pow(rate / p.referenceHourlyRate, p.rateElasticity);
  if (rate == null && p.rateElasticity !== 0) missing.push("시간당 요금");
  const unitPrice = p.totalUnitPrice * rateFactor;
  const monthlyRevenue = unitPrice > 0 ? ownHours * unitPrice : null;
  // 상품비율은 총매출을 쪼개 보여주는 데만 쓴다 — 총매출 크기는 위에서 이미 정해졌다.
  const pcRevenue = monthlyRevenue != null ? monthlyRevenue * (1 - p.productRatio) : null;
  const productRevenue = monthlyRevenue != null && pcRevenue != null ? monthlyRevenue - pcRevenue : null;

  return {
    residentDemandUsers: residentUsers,
    floatingDemandUsers: floatingUsers,
    totalDemandUsers: totalUsers,
    totalDemandHours: totalHours,
    share,
    ownDemandHours: ownHours,
    utilization,
    capped,
    unitPrice,
    pcRevenue,
    productRevenue,
    monthlyRevenue,
    missing,
  };
}

/**
 * ── 축척은 **두 개**다. 층마다 실측값이 따로 있으니 따로 맞춘다 (2026-09-16 구조 변경) ──
 *
 * 그전에는 축척 하나(hoursPerUserPerMonth)를 실매출에 맞춰서 두 일을 겸하게 했다. 그랬더니
 * 환산층(정가 ÷ (1-상품비율))이 매장마다 −12.7%~+19.2% 틀린 만큼이 **가동률로 되밀려
 * 들어갔다** — 독점 3곳 가동률이 화면에서 −3.2~−5.3% 어긋나 보이던 원인이 이것이다.
 * 수요식은 멀쩡했는데 환산층 오차를 대신 뒤집어쓰고 있었다.
 *
 *   1) hoursPerUserPerMonth ← 독점매장 **실측 가동률**   (fitHoursPerUser)
 *   2) totalUnitPrice       ← 독점매장 **실매출**        (fitTotalUnitPrice)
 *
 * 순서가 중요하다. 1)을 먼저 정해 가동률을 고정한 뒤, 2)가 남은 몫만 맡는다.
 */

/** 독점매장이 있으면 거기서만 고른다. 없으면 전체를 쓴다. */
function calibrationTarget<T extends { input: TextbookInput }>(rows: T[]): T[] {
  // 독점상권(경쟁IP=0)은 점유율이 1이라 격차^gamma가 약분되고 **수요식만 남는다.** 그래서
  // 축척을 여기서 정하면 경쟁 항의 오차가 축척으로 스며들지 않는다. 전체로 맞추면 반대가
  // 된다 — 경쟁 항이 틀린 몫까지 축척이 흡수해서 "수요가 맞는지"를 영영 못 가른다.
  //
  // 사용자(2026-09-16): "일단 독점매장이 무조건 맞아야 돼 산식이. 그 개념이 맞잖아."
  // 실제로 2026-09-16에 이걸 안 하고 전체로 맞췄더니 광주각화점(독점)이 90.9% 과대예측됐다.
  const monopoly = rows.filter((r) => !(r.input.competitorIp ?? 0));
  return monopoly.length > 0 ? monopoly : rows;
}

const logMean = (xs: number[]) => Math.exp(xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * 수요 축척(hoursPerUserPerMonth)을 **독점매장 실측 가동률**에 맞춘다.
 *
 * 실측 가동률이 하나도 없으면 매출로 떨어진다(예전 방식). 그 경우 가동률과 매출을 한 축척이
 * 겸하게 되므로 위에 적은 되밀림이 다시 생긴다 — 반환값만 보고 넘어가지 말 것.
 */
export function fitHoursPerUser(
  rows: { input: TextbookInput; actualRevenue: number }[],
  p: TextbookParams,
): number {
  const target = calibrationTarget(rows);

  const byUtil: number[] = [];
  for (const r of target) {
    const actual = r.input.actualUtilization;
    if (actual == null || !(actual > 0)) continue;
    const b = computeTextbook(r.input, { ...p, hoursPerUserPerMonth: 1, maxUtilization: Number.POSITIVE_INFINITY });
    if (b.utilization == null || b.utilization <= 0) continue;
    byUtil.push(Math.log(actual / b.utilization));
  }
  if (byUtil.length) return logMean(byUtil);

  // ── 되돌림: 실측 가동률이 없으면 매출로 맞춘다 (예전 방식) ──────────────────────
  const byRevenue: number[] = [];
  for (const r of target) {
    const b = computeTextbook(r.input, { ...p, hoursPerUserPerMonth: 1 });
    if (b.monthlyRevenue == null || b.monthlyRevenue <= 0 || !(r.actualRevenue > 0)) continue;
    // 상한에 걸린 매장은 배율을 키워도 매출이 안 늘어 배율 추정을 왜곡한다 — 제외한다.
    if (b.capped) continue;
    byRevenue.push(Math.log(r.actualRevenue / b.monthlyRevenue));
  }
  if (!byRevenue.length) return p.hoursPerUserPerMonth;
  return logMean(byRevenue);
}

/**
 * 총단가(totalUnitPrice)를 **독점매장 실매출**에 맞춘다. 수요 축척이 이미 정해진 뒤에 부른다.
 *
 * 남는 오차가 곧 "세 독점매장이 PC·시간당 실제로 얼마나 다르게 버는가"다. 2026-09-16 실측으로
 * 탕정역 3,206원 · 광주각화 2,853원 · 남악 2,745원이라 17% 벌어져 있고, 후보지에서 알 수 있는
 * 어떤 값으로도 설명되지 않았다(경쟁력점수·좌석구성·PC대수 전부 확인). 그래서 독점 최대오차
 * 8.5%가 지금 자료의 바닥이다.
 */
export function fitTotalUnitPrice(
  rows: { input: TextbookInput; actualRevenue: number }[],
  p: TextbookParams,
): number {
  const target = calibrationTarget(rows);
  const ratios: number[] = [];
  for (const r of target) {
    const b = computeTextbook(r.input, { ...p, totalUnitPrice: 1 });
    if (b.monthlyRevenue == null || b.monthlyRevenue <= 0 || !(r.actualRevenue > 0)) continue;
    if (b.capped) continue;
    ratios.push(Math.log(r.actualRevenue / b.monthlyRevenue));
  }
  if (!ratios.length) return p.totalUnitPrice;
  return logMean(ratios);
}

export type TextbookScore = {
  sampleCount: number;
  mape: number | null;
  medianAbsErr: number | null;
  within10: number | null;
  within20: number | null;
  maxAbsErr: number | null;
  /** 배율까지 맞춘 뒤의 hoursPerUserPerMonth. 화면에 그대로 보여준다. */
  fittedHoursPerUser: number;
  /** 독점 실매출로 맞춘 뒤의 totalUnitPrice(원/PC·시간). 화면에 그대로 보여준다. */
  fittedTotalUnitPrice: number;
  /** 수요 축척을 실측 가동률로 맞췄는지. false면 매출로 떨어진 것이라 두 층이 다시 엉킨다. */
  scaledOnUtilization: boolean;
  /** 가동률 성적 — 실측 가동률이 있는 매장만. 매출과 따로 봐야 층별 판정이 된다. */
  utilizationMape: number | null;
  utilizationSampleCount: number;
  rows: {
    storeCode: string; storeName: string | null;
    predicted: number | null; actual: number; absErrPct: number | null;
    utilization: number | null; actualUtilization: number | null; utilErrPct: number | null;
    share: number | null; capped: boolean; unitPrice: number | null;
    missing: string[];
  }[];
};

/** 38곳에 대고 점수를 낸다. 배율(hoursPerUserPerMonth)은 여기서 자동으로 맞춘다. */
export function scoreTextbook(
  rows: { input: TextbookInput; actualRevenue: number }[],
  p: TextbookParams,
): TextbookScore {
  // 축척 둘을 **순서대로** 맞춘다. 1) 수요 축척을 실측 가동률에, 2) 총단가를 독점 실매출에.
  // 순서가 바뀌면 안 된다 — 가동률이 먼저 고정돼야 총단가가 남은 몫만 맡는다.
  const fitted = fitHoursPerUser(rows, p);
  const scaledOnUtilization = rows.some((r) => (r.input.actualUtilization ?? 0) > 0);
  const withFit: TextbookParams = { ...p, hoursPerUserPerMonth: fitted };
  const fittedUnitPrice = fitTotalUnitPrice(rows, withFit);
  const full: TextbookParams = { ...withFit, totalUnitPrice: fittedUnitPrice };

  const out: TextbookScore["rows"] = [];
  const errs: number[] = [];
  const utilErrs: number[] = [];
  for (const r of rows) {
    const b = computeTextbook(r.input, full);
    const err = b.monthlyRevenue != null && r.actualRevenue > 0
      ? Math.abs(b.monthlyRevenue - r.actualRevenue) / r.actualRevenue
      : null;
    if (err != null) errs.push(err);
    const au = r.input.actualUtilization;
    const utilErr = b.utilization != null && au != null && au > 0
      ? Math.abs(b.utilization - au) / au
      : null;
    if (utilErr != null) utilErrs.push(utilErr);
    out.push({
      storeCode: r.input.storeCode, storeName: r.input.storeName,
      predicted: b.monthlyRevenue, actual: r.actualRevenue, absErrPct: err,
      utilization: b.utilization, actualUtilization: au ?? null, utilErrPct: utilErr,
      share: b.share, capped: b.capped, unitPrice: b.unitPrice, missing: b.missing,
    });
  }
  const sorted = [...errs].sort((a, b) => a - b);
  return {
    sampleCount: errs.length,
    mape: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
    medianAbsErr: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    within10: errs.length ? errs.filter((v) => v <= 0.1).length / errs.length : null,
    within20: errs.length ? errs.filter((v) => v <= 0.2).length / errs.length : null,
    maxAbsErr: sorted.length ? sorted[sorted.length - 1] : null,
    fittedHoursPerUser: fitted,
    fittedTotalUnitPrice: fittedUnitPrice,
    scaledOnUtilization,
    utilizationMape: utilErrs.length ? utilErrs.reduce((a, b) => a + b, 0) / utilErrs.length : null,
    utilizationSampleCount: utilErrs.length,
    rows: out.sort((a, b) => (b.absErrPct ?? 0) - (a.absErrPct ?? 0)),
  };
}
