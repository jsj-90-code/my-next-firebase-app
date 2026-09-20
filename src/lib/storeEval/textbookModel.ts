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
//   4) 매출     = 자사PC x 720 x 가동률 x 총단가,  총단가 = PC몫(정가) + 상품몫(상수)
//
// ── 축척은 두 개다 (2026-09-16 구조 변경) ────────────────────────────────
//   층마다 실측값이 따로 있으니 축척도 따로 맞춘다. 자세한 근거는 fitHoursPerUser 위 주석.
//     hoursPerUserPerMonth <- 독점매장 **실측 가동률**
//     productUnitPrice     <- **전 매장** 실매출÷실측가동률 (직접 측정되므로 독점 제약 없음)
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
   * **상품몫** — PC 1대가 1시간 채워졌을 때 들어오는 **상품매출**(먹거리·음료, 원).
   *
   * 2026-09-16 저녁(3) 신설. 그전에는 총단가 하나에 정가를 통째로 곱했는데, 그러면
   * **요금을 올리면 라면 값도 같이 오르는** 꼴이 된다. PC방 매출의 절반이 상품이라
   * (실측 32곳 상품몫 중앙 1,456원 vs PC몫 1,366원) 그냥 두면 안 되는 크기다.
   *
   *   총단가 = PC몫(정가가 여기에만 들어감) + 상품몫(정가와 무관)
   *
   * 독점 3곳에서 총단가가 16.8% 벌어지는데, 그 차이의 **75%가 상품몫**이다
   * (탕정역 1,591원 vs 남악 1,247원). PC몫 차이는 25%뿐이다. 그래서 정가로 총단가를
   * 맞히려던 옛 구조는 애초에 4분의 1짜리를 겨냥하고 있었다.
   *
   * ⚠️ 상품몫을 후보지에서 예측할 방법은 아직 없다. PC대수 r=0.251 · 정가 r=−0.015 ·
   *    가동률 r=0.118로 전부 유의선 0.354 미만이고, 좌석 구성 19개 항목도 다중비교 수준이다.
   *    경쟁력점수가 r=0.713으로 강해 보이지만 **착시다** — 평가창 시점을 통제하면 0.170으로
   *    무너진다(경쟁력점수 ~ 시점 r=0.913). 쓰지 않는다. 사용자 결정(2026-09-16)과도 맞는다:
   *    "독점매장은 경쟁력점수로 맞추는건 안할거고. 애초에 점유100이라 경쟁력점수가 의미가없음".
   *    그래서 지금은 **상수**이고, `fitProductUnitPrice`가 실측 가동률이 있는 전 매장에서 구한다.
   */
  productUnitPrice: number;
  /**
   * **정가 탄력도 β** — 실제로 받는 시간당 요금이 정가를 얼마나 따라가는지.
   *
   * 2026-09-16 저녁(3)부터 이 지수는 **PC몫에만** 걸린다(상품몫은 정가와 무관하다). 그래서
   * PC몫 = 기준정가 x (정가/기준정가)^β가 되고, 이건 운영 산식 `effectiveHourlyRate`와 **완전히
   * 같은 식**이다. 실측으로도 축척이 필요 없었다 — 32곳에서 실측 PC몫 ÷ eff(정가)의 기하평균이
   * 1.005라 eff()가 수준까지 그대로 맞는다.
   *
   * **운영 산식의 `effectiveHourlyRate`(usageRevenue.ts)와 같은 형태다.** 거기 기본값은
   * `tariffEffectiveExponent = 0.546` · `tariffReferenceRate = 1343`(38곳으로 2026-09-14에
   * 구함)이고, 이 β에 0.546을 넣으면 그 식과 완전히 같아진다. 2026-09-16에 32곳으로 독립
   * 측정한 값도 0.49~0.535라 그 지수 자체는 잘 선 값이다 — 32곳 실효단가를 MAPE 9.16%로
   * 맞힌다(정가를 그대로 쓰면 10.43%).
   *
   * **왜 이 지수가 필요한가 — 정액권 할인이 실체다.**
   *
   * 건별 원장(바탕화면 `좌석가동률_7월`, 8곳)으로 2026-09-16에 처음 직접 측정했다. 정액권
   * 손님은 시간당 296~663원으로 **정가의 1/3**만 내고, 그 시간 비중이 매장마다 2.1~9.1%로
   * 4배 차이 난다. 그래서 정가 1,700원 매장이 실제로는 1,397원(82%)만 받고, 1,000원 매장은
   * 1,255원(126%)을 받는다. 이 지수는 그 **평균**을 한 숫자로 담은 것이다.
   *
   * 사용자(2026-09-16): "매장별 정액할인 금액이 틀리고 신규후보지도 마찬가지로 정액할인에
   * 대한 정보가 없으니까 평균값이 가장 정답일것같다" — 맞는 판단이다. 정액할인의 *크기*는
   * 매장 운영 정책이라 후보지에서 알 수 없지만, **정가가 비쌀수록 할인이 크다는 경향**은
   * 38곳에서 측정된 정보라 버리지 않는다. 여기서 쓰는 "평균"이 바로 그 조건부 평균이다.
   *
   * ⚠️ **요금제 자체는 아직 반영되지 않는다.** 들어가는 건 `시간당 정가` 한 숫자뿐이고,
   *    정액권 가격·구성, 좌석별 추가과금, 상품 가격은 안 들어간다. 매장별 정액권 비중을
   *    받을 수 있게 되면 그때 이 지수를 매장별로 풀 수 있다.
   *
   * ── 구조 비교 (환산층만 떼어 잰 성적, 실측 가동률을 넣고 매출만 계산, 32곳) ──────
   *
   *   덧셈(채택) PC몫 + 상품몫 1,508원        MAPE 10.48%  · 독점 최대 10.1%
   *   곱셈(옛것) 2,681 x (정가/1300)^0.546   MAPE  9.23%  · 독점 최대 12.9%
   *   요금 무시  총단가 2,928원 상수           MAPE 12.18%  · 독점 최대  8.7%
   *
   * 덧셈이 전체 MAPE는 1.1%p 나쁘다. 곱셈이 반칙 이득을 보기 때문이다 — 정가가 상품몫과도
   * 약하게 붙어 있어서(r=0.405, 비싼 매장이 먹거리도 잘 판다) 정가가 "매장 전반의 급"을
   * 대신 나타내는 역할을 한다. 논리적으로는 그러면 안 된다. 덧셈은 독점 오차가 낮고
   * 요금 인상 반응도 맞다(정가 +80%일 때 총단가 덧셈 +16% vs 곱셈 +38%).
   * 2026-09-16 사용자 결정: "덧셈으로하자".
   */
  rateElasticity: number;
  /** 정가 탄력도의 기준점(원). 이 정가인 매장에서 총단가 = T0가 된다. 32곳 중앙정가. */
  referenceHourlyRate: number;
  /**
   * **특수수요 배수** — 인구 통계에 안 잡히는 수요원이 있는 상권의 **수요를** 키운다.
   *
   * 사용자(2026-09-16): "기존처럼 입지평가로 특수수요를 플러스하는게아니라 수요산식을 정할떄
   * 적용해보자고" — 그래서 입지 보정이 아니라 **수요 산식 안**에서 곱한다.
   *
   *   수요 = (주거 + 유동 x α) x 특수수요배수
   *
   * ⚠️ **운영 산식(V62)의 특수수요와 이름만 같고 형태가 다르다**(사용자 지적: "기존 특수수요는
   *    말은같지만 형태가 많이 틀릴텐데"). V62는 `computeSpecialDemandScore`를 **회귀의 이진
   *    더미 피처**로 써서 예측값을 통계적으로 밀어준다 — "이런 매장은 평균보다 잘 나오더라"다.
   *    교과서식은 회귀로 덮지 않는 게 목적이라 수요 배수로 다시 정의한다 — "군부대·대학가·
   *    산업단지가 인구 통계에 안 잡히는 이용자를 데려온다"는 물리적 뜻이다.
   *
   * ── 2026-09-16 1차 측정 (지금은 일부만 살아 있다) ────────────────────────
   * 필요 점유율(= 실측가동률 ÷ 경쟁없을때 예측)을 유형별로 보고 "없음" 대비 배수를 잡았다:
   *
   *   군부대   2곳 118.3% -> 2.25배      대학가   5곳 76.0% -> 1.45배
   *   산업단지 3곳  72.8% -> 1.39배      기타     4곳 65.6% -> 1.25배
   *   없음    22곳  52.5% -> 1.00        관광·유흥 2곳 44.1% -> 0.84배
   *
   * ── ✅ 2026-09-20 2차 가공 — **산업단지·기타를 1.00으로 껐다** ────────────
   * 1차 값은 **순환에 오염돼 있었다.** 수요 축척 A는 독점 3곳에서 정하는데 그 3곳이
   * 탕정역(산업단지)·남악(기타)·광주각화(없음)이다. 즉 **산업단지와 기타의 배수가 자기 자신을
   * 재는 자를 부풀리고 있었다.** 배수를 켜면 A가 6.796 -> 5.653으로 내려가, 배수가 없는
   * 22곳은 가만히 있는데 수요가 16.8% 줄었다. 그리고 필요 점유율 100% 초과 6곳이 **전부
   * "없음"**이었다 — 제일 굶는 쪽에서 걷어다 특수수요 쪽에 얹어 주고 있었다.
   *
   * 자를 바로잡고 다시 뽑으니(독점은 유도에서 제외, `_anchorExemption.test.ts` (5)절):
   *
   *   군부대   2.22 (1차 2.25)  그대로    ← 자를 고쳐도 안 변한다 = 진짜 신호
   *   대학가   1.45 (1차 1.45)  그대로    ← 이때는 남겼다. **2026-09-20 밤에 껐다(아래 3차)**
   *   산업단지 1.08 (1차 1.39)  **사실상 1**
   *   기타    0.94 (1차 1.25)  **사실상 1**
   *
   * LOO 흔들림도 작다(산업단지 1.07~1.08 · 기타 0.87~1.10). 그래서 둘을 1.00으로 둔다.
   *
   * ── ✅ 2026-09-20 밤 3차 — **대학가도 1.00으로 껐다** ────────────────────
   * 2차 재도출(경쟁을 무시한 필요 점유율 기준)에서는 1.45가 살아남았는데, **경쟁 항까지
   * 넣고 보면 달라진다.** 근거 셋이 같은 곳을 가리켰다.
   *
   * **(1) 대학가는 방학에 안 뛴다** — 여기가 결정적이다.
   *   사용자(2026-09-20): *"대학가는 방학 때는 비성수기, 개학 때가 성수기지."*
   *   월별 가동률로 재니 그대로다(`_accuracyCeiling.test.ts` (1)절):
   *
   *       방학(1·2·7·8월) ÷ 학기월     없음 1.178 · 군부대 1.260 · **대학가 1.019**
   *
   *   일반 상권은 방학에 18% 뛰는데(중고생이 동네에 있다) 대학가는 안 뛴다 — 대학생이
   *   고향으로 가기 때문이다. 우리가 맞히는 건 **연평균**이므로, 대학가는 연평균 수요가
   *   남들보다 **낮아야** 맞는다. 그런데 배수를 **올려서** 주고 있었다. 방향이 반대였다.
   *
   * **(2) 경쟁까지 넣은 함축배수가 1.03이다**(`_universityTowns.test.ts` (3)절).
   *   매장별로 역산하면 부경대 0.854 · 전대상대 1.024 · 전대후문 1.034 · 울산대 1.227 ·
   *   청주대 1.276 — **중앙 1.034이고 1.45는 다섯 곳 중 아무에게도 안 맞는다.**
   *   대학가 5곳은 전부 '경쟁 과소'(예측 점유율 > 필요 점유율)다. 즉 1.45는 수요 배수인
   *   척하면서 실은 **경쟁 항의 오차를 대신 받던 값**이었다.
   *
   * **(3) 교차검증이 1.45를 한 번도 안 골랐다**(`_labFrontier.test.ts` (2)절).
   *   38겹 중 30겹이 1.1, 7겹이 1.0, 1겹이 1.2를 골랐다.
   *
   * 성적(정직한 LOO): MAPE 22.16% → **19.02%** · 중앙 15.9% → 15.5% ·
   * ±20% 58% → **63%** · ±30% 71% → **79%** · **최악 70.2% → 54.7%**
   * 📌 사용자가 짚은 "오차 범위가 너무 크다"에 직접 듣는 **유일한** 손잡이였다 —
   *    나머지 열한 개는 한 칸씩 훑어도 −0.8%p 이하이고, 다 같이 맞추면 중첩 교차검증에서
   *    오히려 나빠진다(24.16%). 38곳으로 손잡이 12개는 과적합이다.
   *
   * ⚠️ **이것도 성적으로 고른 게 아니다.** 근거는 (1)의 계절 패턴과 (2)의 함축배수이고,
   *    MAPE는 확인일 뿐이다. 표본이 늘면 (2)를 다시 재야 한다.
   * ⚠️ 이제 1이 아닌 배수는 **군부대 2.25 하나뿐**이다. 그건 자를 두 번 고쳐도 안 변했다.
   *
   * 📌 **끄니까 순환이 저절로 끊긴다** — 기준점 3곳이 전부 배수 1.00이 되어, 예외 규칙 없이
   *    A가 배수와 무관해진다. 기준점 3곳의 필요 점유율 벌어짐이 **1.416배 -> 1.019배**,
   *    100% 초과가 **6곳 -> 4곳**, 광주각화점이 121% -> 101%가 된다.
   *
   * ⚠️ **성적으로 고른 게 아니다.** 표본 안 MAPE는 21.59% -> 22.08%로 오히려 나빠진다.
   *    다만 **LOO는 22.17% -> 22.16%로 같다** — 1차 값의 표본 안 이득은 홀드아웃에서
   *    사라지는 과적합이었다. 근거는 위 재도출값이고, MAPE는 확인일 뿐이다.
   *
   * ⚠️ 사용자 지적(2026-09-20): *"걸거면 같이 걸어야 되는 거 아님? 산업, 기타는 안 걸고
   *    나머지는 걸고."* 한때 "독점 3곳에만 배수를 안 건다"는 안을 냈는데, 같은 산업단지인데
   *    독점이면 안 걸고 경쟁상권이면 거는 규칙이라 뜻이 안 선다. **유형으로 가른다.**
   *
   * 📌 **"기타"는 유형 이름도 아니었다** — 남악·발산역·송도·진주혁신도시본점·야탑을 묶어
   *    놓은 것인데 공통점을 설명할 수 없다. 물리적 뜻 없이 1.25배를 받고 있었다.
   *
   * ⚠️ **표본이 2곳이라 계수를 확정할 수준이 아니다.** 군부대도 방향만 믿는다.
   * ⚠️ 관광·유흥은 측정값이 0.84로 오히려 낮지만 n=2라 신뢰할 수 없어 **1.00으로 둔다.**
   *    V62도 근거 부족으로 제외한 유형이다(SPECIAL_DEMAND_TYPES_WITH_EVIDENCE).
   * ⚠️ 강도(없음/낮음/보통/높음)는 아직 안 쓴다. 표본 대부분이 "높음"이라 유형과 분리가 안 된다.
   *    사용자가 "같은 군부대라도 규모가 다르다"고 지적한 자리다(2026-09-20) — 규모 자료
   *    (병력·재학생·종사자 수)가 생기면 곱셈이 아니라 **덧셈**으로 넣는 게 맞다.
   * ⚠️ **특수수요가 100% 초과를 다 설명하지도 않는다.** 4곳 중 2곳(금촌역·문산)만 군부대이고,
   *    문경시청(197.7%)·양주덕정(124.6%)은 유형이 "없음"이다. 문경시청은 주거1km 18,786명으로
   *    표본 최소인데 가동률 30.6%가 나온다 — 인구 적은 동네를 과소평가하는 별개의 문제다.
   *
   * 사용자(2026-09-16): "지금 이 특수수요를 정하는게 정확하지않으니까, 경쟁력점수작업끝나면
   * 2차가공하는것도 좋을거같다. 1차는 우선 최대한 예측해서넣고" — 그래서 이건 **1차**다.
   */
  specialDemandMultipliers: Record<string, number>;
  /**
   * **점유율 환산을 켤지 끌지** (2026-09-16 밤 신설).
   *
   * 사용자 설계: "일단 전체가맹점을 점유율환산하는 값을 전부제거해서 0부터 시작한다음에,
   * 점유율이 얼마가 되어야 예상매출로갈수있는지 확인해볼수있도록하면 지금 수요의 문제점이
   * 있는지 2차검증을 해볼수있을것같다."
   *
   *   "formula" — 지금까지 동작. 점유율 = (자사PC x 격차^γ) / (자사PC x 격차^γ + 경쟁IP + 안가는몫)
   *   "off"     — 점유율을 1로 둔다. 경쟁 항을 통째로 들어낸 상태다.
   *
   * `off`로 두면 예측 가동률이 "경쟁이 없다면 이만큼"이 되고, 화면의 **필요 점유율**
   * (= 실측가동률 ÷ 그 예측)이 **이 매장이 실제로 먹은 몫**이 된다. 수요식이 맞다면 그 값이
   * 0~1 안에 들고 경쟁이 셀수록 낮아야 한다. 1을 넘으면 그 동네 수요를 과소평가한 것이다.
   *
   * 왜 이게 필요한가: 2026-09-16 점검에서 지금 점유율 환산이 **아무것도 설명하지 못한다**는
   * 게 드러났다(경쟁력격차 r=0.025, 사양 -0.062, 입지 0.075~0.220 — 전부 유의선 0.371 미달).
   * 게다가 수준도 안 맞는다(자사PC/(자사PC+경쟁IP) 중앙 0.186 vs 실측 0.519). 근거는
   * `_shareAudit.test.ts`에 있다. 그래서 경쟁 항을 고치기 전에 수요식부터 다시 봤다.
   *
   *   "quality" — **2026-09-17 신설, 새 기본값.** 유효거리 안의 경쟁점만 품질로 겨룬다.
   *               위 점검이 남긴 빈칸(상권 겹침)을 메운 것이다. 홀드아웃·대조군 결과는
   *               `_competitionDesign.test.ts` 머리말에 있다.
   */
  shareMode: "formula" | "off" | "quality";
  /**
   * **유효거리 R(m)** — 이 안의 경쟁점만 진짜 경쟁자로 센다 (shareMode="quality"에서만).
   *
   * 2026-09-16 사용자 실무 의견: "거리는 유효거리안에있으면 거리가 크게작용안한다는게
   * 실무의견이고, 매장의 품질이 (점수)가 작용되어야함". 자료도 이쪽을 지지한다 —
   * 지수 감쇠(최선 r=0.510)보다 **계단**(r=0.560)이 낫다.
   *
   * ⚠️ **300m은 잠정값이다.** 300·400·500m가 MAPE로 30.1~30.5%라 구별이 안 된다.
   *    300을 고른 근거는 상관(0.560 vs 400m 0.434)과 실무 의견뿐이다. 표본이 늘면 여기부터
   *    다시 본다. 근거: `_competitionDesign.test.ts` 검정 2·5.
   */
  effectiveRadiusM: number;
  /**
   * **품질 지수 θ** — 품질 차이를 얼마나 세게 볼지 (shareMode="quality"에서만).
   *
   * θ=3은 두 경로가 독립으로 만난 값이다. 자료로 고른 최선이 3이고, 사용자가 매출 변화폭에서
   * 역산한 값이 2.74~4.92·중앙 3.25다. **감각은 매출액, 측정은 가동률 — 경로가 완전히 다르다.**
   *
   * ⚠️ θ가 하는 일의 상당 부분은 **수준 보정**이다. 자사/경쟁 품질비가 1.75인데 1.75³=5.36이고,
   *    이는 최적 상수배율 λ=5와 같은 값이다. "θ가 오차를 줄였다"고 읽으면 안 된다 —
   *    θ가 줄인 건 수준이고, 남긴 건 **순서**다(r 0.223 → 0.560).
   */
  qualityExponent: number;
  /**
   * **경쟁력점수 비중** — 사양·먹거리·존구성·인테리어·관리 (shareMode="quality"에서만).
   *
   * 합이 1이 아니어도 된다. 있는 항목만 모아 그 합으로 나눠 쓴다(결측 항목은 자동 제외).
   *
   * 기본값은 **실무 감각 비중**이다. 2026-09-16 사용자 지적대로 기존 비중은 적중률 튜닝
   * 산물이고("지금 적용한값을 적중률 맞출려고 조정하다보니 저래된고고"), 교과서식은 회귀로
   * 덮지 않는 게 목적이다. 정확도 비용도 없다 — 세 벌을 돌려도 r이 0.553~0.561로 차이 0.008이다.
   *
   * ⚠️ **입지는 여기 없다.** 사용자 방향대로 항목·평가값·개념을 전부 다시 만든 뒤 넣는다.
   *    실무 감각 비중에서 입지 몫은 17.0%였고, 나머지 넷이 그 몫을 나눠 갖고 있는 상태다.
   *
   * ⚠️ **관리(management)는 실험실에서 QSC로 채운다**(2026-09-17). 운영 V62는 전 매장 4.00
   *    고정이지만, 실험실은 본사 점검 점수를 1~5로 환산해 넣는다(3.22~5.00 · 평균 4.25).
   *    환산자와 근거는 `labInput.ts`의 `qscToManagementScore`에 있다. 이 파일은 안 바뀌었다 —
   *    관리는 원래 여기 있던 칸이고, 그 칸에 들어오는 **값**이 상수에서 실측으로 바뀐 것이다.
   */
  qualityWeights: { spec: number; food: number; zone: number; interior: number; management: number };
  /**
   * **입지 — 점유율에 곱하는 독립 항들** (2026-09-17 전면 재설계).
   *
   * ── 왜 경쟁력점수 안이 아니라 밖인가 ────────────────────────────────
   * 입지를 품질에 섞으면 **자사÷경쟁의 나눗셈**이 된다. 그런데 접근성은 "경쟁점보다 낮은
   * 층인가"가 아니라 **"올라오기 얼마나 번거로운가"**다 — 6층 매장은 경쟁점이 없어도 덜 온다.
   * 손님이 경쟁점으로 가는 게 아니라 **아예 안 온다.** 그래서 비율이 아니라 곱셈이다.
   * 실측도 같은 말을 한다: 품질에 섞으면 r이 0.554 -> 0.565로 0.011밖에 안 오르는데,
   * 독립 곱셈 항으로 두면 0.554 -> 0.725로 오른다. 근거는 `_locationRebuild.test.ts` ③④.
   *
   * ── 기존 주관 3항목은 폐기했다 ─────────────────────────────────────
   * 상권위치·동선 / 선점경쟁 / 접근가시성은 1~5점인데 **실제로 3~4개 값만 쓰였고**
   * (상권위치·동선은 29곳 중 19곳이 5점) 셋 다 유의선 0.371 미달이었다(0.075 / 0.220 / 0.181).
   * 층수에서 기계적으로 나온 값이 0.389로 유일하게 유의했다. 41곳에 매겨둔 평가값도 안 쓴다.
   *
   * ── 계수 출처 라벨 ────────────────────────────────────────────────
   * 사용자 방침(2026-09-17): **항목은 뜻으로 정하고, 계수만 자료로 정한다.**
   * 검정은 "이 항목이 중요한가"가 아니라 "자료에서 주워온 숫자를 믿어도 되나"를 묻는 것이라,
   * 감각으로 정한 값에는 필요 없다. 표본이 늘면 `[보류]`를 `[감각]`이나 `[자료]`로 올린다.
   */
  locationExponents: {
    /**
     * `[자료]` **상권 중심도** ν — 관문을 전부 통과했다. 지금까지 중 제일 강하다.
     *   중심도 = (유동 300m ÷ 유동 1km) x (1000/300)²  — 1보다 크면 문 앞이 상권 평균보다 빽빽
     *   LOO 24.52% -> 25.50%(벌어짐 0.98%p) · 5겹 78% · 대조군 MAPE p=0.002 · r p=0.012
     * ⚠️ 300m/500m 짝은 쓰지 않는다 — 순서는 더 잘 맞히지만(r 0.801) MAPE 홀드아웃에서
     *    6.65%p 벌어져 gamma(7%p)와 비슷한 징후를 보인다.
     */
    centrality: number;
    /**
     * `[자료]` **접근성(층수)** κ — 켠다. 한때 기준에 따라 갈렸는데 **원인이 기준값이었다.**
     *
     * 중앙값을 기준으로 쓸 때는 MAPE 기준이 κ=0을, r 기준이 κ=0.25를 골라 갈렸다.
     * 층수 항이 편향을 키웠고(-5.5% -> -10.0%) MAPE가 편향을 포함하기 때문이다.
     * **기준값을 기하평균으로 바꾸니 두 기준이 같은 답을 낸다**(아래 locationReferences 참고):
     *   κ=0     편향 -8.3%  MAPE 24.39%  r 0.693
     *   **κ=0.25 편향 -9.2%  MAPE 24.08%  r 0.736**  <- 두 기준 모두 최선
     *   κ=0.5   편향 -9.4%  MAPE 26.13%  r 0.727
     * LOO도 κ=0.25를 93%(MAPE)·86%(r) 고르고 벌어짐은 1.79%p다.
     */
    access: number;
    /**
     * `[보류]` **유동 방향(편심도)** ω — 기본 0. 자료는 모았고 **부호도 맞다**(음수).
     * 다만 중심도가 이미 먹고 있다 — 잔차 상관이 -0.280 -> (중심도·층수 반영 후) -0.069로
     * 사라지고, 편심도 ↔ 중심도가 r=-0.335로 겹친다. 대조군도 p=1.000 / 0.216으로 미달.
     * **항목을 버린 게 아니라 자료가 계수를 못 정한 것이다.** 사용자가 정하면 그날 켜진다.
     */
    direction: number;
    /**
     * `[보류]` **동선 방해** — 기본 0. *"유동이 몰리는 쪽에 경쟁점이 있으면 그게 우리 동선을
     * 막는다"*(사용자 착상 2026-09-20). 항목의 뜻은 멀쩡하다.
     *
     * ⚠️ 옛 보류 사유는 **"경쟁점 좌표가 22%뿐이라 방위를 못 잰다"**였는데 **그 사유는
     *    2026-09-20에 해소됐다 — 좌표가 229/232곳(98.7%)이다.** 그래서 처음으로 실제로 재봤다.
     *
     * **재봤더니 신호가 없다** (`_rivalDirection.test.ts`, 경쟁상권 33곳):
     *   공식 넷(최근접·거리가중·붐비는방위 0/1·붐비는쪽 경쟁PC비율) 전부 상관이 0 근처였고,
     *   **쏠림이 뚜렷한 상권만 추리면 부호가 오히려 뒤집혔다**(전체 -0.24 -> 상위절반 +0.15~+0.33).
     *   신호라면 방향이 뜻을 갖는 상권에서 더 강해져야 하는데 반대다 = 잡음의 모양이다.
     *
     * ⚠️ 다만 **"착상이 틀렸다"가 아니라 "이 자료로는 안 잡힌다"**로 읽어야 한다. 한계가 셋:
     *   1. 방향 자료가 거칠다 — `kakao-directional.json`이 반경 300m·격자 300m라 방위당 한 칸이다.
     *   2. 300m 바깥에서 오는 통행을 아예 안 본다.
     *   3. 실험실 자체 MAPE가 22.5%라 n=33에서 어지간한 효과는 묻힌다.
     *   더 고운 방향 자료(격자 50~100m)나 실제 보행 동선(도로망)이 생기면 다시 열 자리다.
     */
    flowBlock: number;
    /** `[보류]` **간판·출입구 가시성** — 기본 0. 로드뷰 평가가 필요하고, 그때는 1~5점이 아니라
     * 예/아니오 사실 질문으로 물어야 한다(지금 3항목이 그래서 망가졌다). 경쟁점 좌표부터. */
    visibility: number;
  };
  /**
   * **입지 지표의 기준값** — 이 값에서 1배가 된다. **기하평균으로 잡는다(중앙값이 아니다).**
   *
   * 곱셈 보정 (x/기준)^지수는 표본 전체에서 **평균적으로 1배**여야 중립이다. 그러려면 기준이
   * x의 **기하평균**(로그 공간의 중심)이어야 한다. 중앙값을 쓰면 분포가 한쪽으로 꼬리를 끌 때
   * 중립이 깨진다 — 중심도는 0.37~6.95로 오른쪽 꼬리가 길다.
   *
   * ⚠️ **이건 자유계수가 아니라 정규화다.** 자료에 맞춰 고르는 값이 아니라 "보정이 평균적으로
   *    아무 일도 안 하게" 만드는 유일한 값이다. 그래서 검정 대상이 아니다.
   *
   * 2026-09-17에 중앙값(3.95 / 4)을 쓰다가 기하평균(3.22 / 3.42)으로 고쳤다. 그 전에는
   * 편향이 -12.8%였고 MAPE 기준과 r 기준이 서로 다른 κ를 골랐다. 고친 뒤엔 편향 -9.2%,
   * 두 기준이 같은 답(κ=0.25·ν=0.25)을 낸다. **수준을 자유계수 λ로 푸는 것보다 낫다** —
   * λ를 풀면 표본 안 MAPE는 비슷한데(24.04%) LOO 벌어짐이 1.79%p -> 6.45%p로 커진다.
   */
  locationReferences: { centrality: number; access: number };
  /**
   * **중심도 잔차화** — 중심도에서 *동네 규모* 몫을 걷어낸다 (2026-09-20 채택).
   *
   * ── 왜 필요한가 (이중계산) ────────────────────────────────────────────────
   * 중심도의 뜻은 *"동네 규모를 감안했을 때 우리가 상권 중심이냐 끝이냐"*다. 그런데 날값에는
   * **동네 규모 자체가 섞여 있다** — 수요식이 쓰는 유동400m와 r=0.599다. 그래서 수요에서
   * 이미 센 것을 점유율에서 한 번 더 곱했다. log(중심도)를 log(유동400m)에 회귀시켜
   * **잔차만** 쓰면 남는 게 원래 재려던 그것이다. 겹침이 0.599 -> **−0.154**로 사라진다.
   *
   *     잔차화 중심도 = 기준 x (중심도 / G_c) x (G_f / 유동400m)^기울기
   *
   * ── 근거 (`_residualCentralityPort.test.ts`) ──────────────────────────────
   *   정직한 홀드아웃(축척·기울기를 **훈련겹에서만** 맞춤, n=38)
   *     손 안 댄 중심도 ν=0.25 (옛 본체)   24.40%
   *     잔차화 ν=0.5                      **22.12%**   <- 2.28%p 좋아짐
   *   겹마다 기울기를 다시 적합해도 유지된다(기울기 고정 22.16% vs 재적합 22.12%) —
   *   즉 예전 하네스가 적어 둔 '벌어짐 −0.05%p'는 누수가 아니었다.
   *   무작위 대조군 200회 p=0.005 · 훈련겹 38회 중 37회가 ν=0.5를 골랐다(`_textbookFull`).
   *
   *   ⚠️ 채택 당시(2026-09-20 오전)에는 23.15% -> 22.02%로 쟀다. 같은 날 오후에 특수수요
   *      배수를 고치면서 **기준선이 통째로 옮겨져** 위 숫자가 됐다. 폭이 커졌을 뿐 결론은
   *      같다. 숫자를 인용할 때는 어느 시점 기준인지 같이 볼 것.
   *
   * ⚠️ **이 셋은 표본에서 적합한 상수다 — 자유계수가 아니라 정규화다.** MAPE로 고르지
   *    않았다(OLS 기울기와 기하평균이라 고를 여지 자체가 없다). locationReferences와 같은
   *    부류다. 다만 **표본이 늘면 다시 적합해야 한다** — `_residualCentralityPort.test.ts`의
   *    (1)번 시험이 지금 표본의 값을 찍어 준다.
   *
   * ⚠️ 인계 문서(2026-09-21)에 *"새로 고를 계수가 없다"*고 적혀 있었는데 **정확하지 않다.**
   *    굳혀야 하는 상수가 셋이고 ν도 0.25 -> 0.5로 바뀐다. 옮겨도 되는 이유는 "고를 게
   *    없어서"가 아니라 **고른 값이 정직한 홀드아웃에서 버텨서**다.
   *
   * ⚠️ **유동400m가 없으면 중심도 항을 통째로 뺀다**(1배). 날값으로 되돌리지 않는다 —
   *    ν=0.5는 잔차 눈금에 맞춘 값이라 날값에 그대로 먹이면 딴 걸 재게 된다.
   *
   * null로 두면 잔차화를 끄고 날 중심도를 쓴다(옛 동작).
   */
  centralityResidual: {
    /** log(중심도) ~ log(유동400m) OLS 기울기. */
    slope: number;
    /** 중심도의 기하평균 G_c. */
    geoMeanCentrality: number;
    /** 유동400m의 기하평균 G_f. */
    geoMeanFloating400: number;
  } | null;
  /**
   * **경쟁점 거리 감쇠** — `effectiveRadiusM`의 계단 함수를 대신한다 (2026-09-20 신설).
   *
   * ── 왜 필요한가 ───────────────────────────────────────────────────────────
   * 지금은 **300m 안이면 100%, 밖이면 0%**로 자른다. 임의의 자이고, 지방에서 깨진다:
   *   문경시청점 — 373m 콤마PC가 **0으로** 세진다(23m 차이). 1.5km의 4곳도 0이다.
   *              그래서 산식상 완전 독점인데 실제로는 시내 PC방들과 나눠 먹는다.
   * Huff 모형의 원형은 계단이 아니라 **거리에 따라 완만히 줄어드는 곡선**이다.
   *
   *     무게 = 1                                   (거리 ≤ plateauM)
   *          = exp(−(거리 − plateauM) ÷ scaleM)      (그 밖)
   *
   * **평지 + 감쇠**다. plateauM 안쪽은 지금과 **똑같이** 100%로 세고, 그 밖만 완만히 줄인다.
   *
   * ⚠️ 첫 설계(평지 없이 exp(−d/scaleM))는 **근거리 경쟁점 무게까지 바꿔서** 300m 밖에
   *    경쟁점이 하나도 없는 도시 매장 23곳도 평균 7.68%p나 움직였다(2026-09-20 측정).
   *    그건 "거리를 반영했다"가 아니라 "경쟁을 통째로 줄였다"이고, 실제로 무작위 대조군을
   *    못 넘었다. 평지를 두면 **300m 안이 전부인 매장은 정확히 0 움직인다** — 가설을
   *    제대로 겨냥하게 된다.
   *
   * ⚠️ **지금 동작을 포함한다(중첩 모형).** plateauM = effectiveRadiusM이고 scaleM → 0이면
   *    계단 함수와 정확히 같다. 그래서 "계단 vs 감쇠"를 공정하게 견줄 수 있다.
   *    자유도는 scaleM 하나만 늘고, plateauM은 기존 값을 그대로 쓴다.
   *
   * ⚠️ 거리를 모르는 경쟁점은 **1배(가장 가까운 것처럼)** 센다. 지금 계단 규칙이 "모르면
   *    유효거리 안으로 본다"인 것과 같은 방향이다 — 빼는 쪽이 아니라 세는 쪽이 보수적이다.
   *
   * ── ⛔ 2026-09-20 측정 결과 — **기각. 계단이 낫다** (`_rivalDecay.test.ts`) ───────
   * 평지를 둔 뒤 확인 기준 1은 통과했다(300m 밖 경쟁점이 없는 23곳은 **정확히 0.00%p**
   * 움직인다). 그런데 **모든 scaleM에서 성적이 단조롭게 나빠진다**:
   *
   *     계단300     MAPE 21.59%   LOO 22.17%   경쟁상권 잔차 −16.9%
   *     감쇠 100m   MAPE 23.36%   LOO 24.33%   경쟁상권 잔차 −19.5%
   *     감쇠 300m   MAPE 24.27%   LOO 24.85%   경쟁상권 잔차 −21.1%
   *     감쇠 500m   MAPE 24.52%   LOO 25.09%   경쟁상권 잔차 −21.6%
   *
   * 기전이 분명하다 — 먼 경쟁점을 **새로 세면** 경쟁무게가 늘어 점유율이 내려가는데,
   * 경쟁상권은 **이미 과소예측**이라 더 나빠진다. 대조군도 미달(p=0.408).
   *
   * 📌 이 결과는 `_worstErrors.test.ts` (4)절과 **같은 방향을 가리킨다** — 과소예측 8곳은
   *    경쟁무게를 지금의 **0.38배로 줄여야** 맞는다. 즉 **경쟁을 더 세는 방향은 전부 틀린다.**
   *    "문경의 373m 경쟁점이 안 세진다"는 관찰은 맞았지만, 그걸 세면 더 나빠진다 —
   *    문경의 병목은 경쟁이 아니라 수요다(필요 점유율 229%).
   *
   * 다시 열 자리: 경쟁무게를 **전반적으로 줄이는** 손잡이를 먼저 찾은 뒤, 그 위에서 거리를
   * 다시 본다. 순서가 반대였다.
   *
   * null이면 옛 계단 동작(`effectiveRadiusM`)을 쓴다. **기본값은 null이고, 기각된 상태다.**
   */
  rivalDistanceDecay: { plateauM: number; scaleM: number } | null;
  /** 가동률 물리적 상한. 이 위로는 좌석이 모자라 못 받는다. */
  maxUtilization: number;
};

/** 경쟁력점수를 이루는 다섯 항목. 없는 항목은 null로 두면 비중에서 자동으로 빠진다. */
export type QualityParts = {
  spec: number | null;
  food: number | null;
  zone: number | null;
  interior: number | null;
  management: number | null;
};

/**
 * 경쟁력점수 — 있는 항목만 비중대로 섞는다. 자사·경쟁점에 **같은 함수**를 쓴다.
 *
 * ⚠️ 구성 점수(사양·존구성)는 저장 필드가 아니라 **파생값**이다. 원자료에서
 *    `computeSpecScore` / `computeOwnZoneComposition` / `computeCompetitorZoneComposition`으로
 *    계산해서 넣어야 한다. 2026-09-16에 이걸 "결측"으로 읽어 한 번 틀렸다.
 */
export function computeQualityScore(parts: QualityParts, w: TextbookParams["qualityWeights"]): number | null {
  const items: [number | null, number][] = [
    [parts.spec, w.spec], [parts.food, w.food], [parts.zone, w.zone],
    [parts.interior, w.interior], [parts.management, w.management],
  ];
  let num = 0, den = 0;
  for (const [v, weight] of items) {
    if (v == null || !Number.isFinite(v) || !(weight > 0)) continue;
    num += v * weight; den += weight;
  }
  return den > 0 ? num / den : null;
}

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
  // fitProductUnitPrice가 실측 가동률이 있는 전 매장에서 다시 구한다. 여기 값은 그 전에
  // 쓰이는 출발점이다(2026-09-16 실측 32곳 기준).
  productUnitPrice: 1508,
  // 운영 산식 usageRevenue.ts effectiveHourlyRate와 같은 값 — 두 산식이 한 식을 쓴다.
  // 2026-09-16 저녁(3)부터 이 지수는 PC몫에만 걸린다(상품몫은 정가와 무관).
  rateElasticity: 0.546,
  referenceHourlyRate: 1343,
  // 2026-09-17 — 새 경쟁 항이 홀드아웃·대조군을 통과해 **품질 모드가 기본값**이 됐다.
  // 끄기(off)는 여전히 쓸모가 있다 — 화면의 "필요 점유율"이 그 모드로 계산된다.
  shareMode: "quality",
  effectiveRadiusM: 300,
  qualityExponent: 3,
  // 실무 감각 비중(입지 17.0% 제외, 시설 34.0%를 존구성 23.8 + 인테리어 10.2로 나눈 값).
  // 합이 0.83인 건 입지 몫이 빠져서다 — computeQualityScore가 있는 항목의 합으로 나눈다.
  qualityWeights: { spec: 0.264, food: 0.075, zone: 0.238, interior: 0.102, management: 0.151 },
  // 입지 — [자료] 둘만 켜져 있고 [보류] 셋은 0이다. 자세한 근거는 타입 쪽 주석.
  // ⚠️ 중심도 ν는 2026-09-20에 0.25 -> 0.5로 바뀌었다. **잔차화와 한 묶음이다** —
  //    잔차화를 끄면(centralityResidual: null) ν도 0.25로 돌려야 한다. 0.5는 잔차 눈금 값이다.
  locationExponents: { centrality: 0.5, access: 0.25, direction: 0, flowBlock: 0, visibility: 0 },
  // 기준값 — 경쟁상권 29곳의 **기하평균**. 중앙값이 아니다(위 주석의 이유).
  locationReferences: { centrality: 3.22, access: 3.42 },
  // 중심도 잔차화 상수 — 기존점 38곳에서 적합(2026-09-20). 표본이 늘면 다시 적합할 것.
  // `_residualCentralityPort.test.ts`의 (1)번 시험이 지금 표본의 값을 찍어 준다.
  centralityResidual: { slope: 0.4801, geoMeanCentrality: 3.2719, geoMeanFloating400: 75093 },
  // 거리 감쇠는 **기본 꺼짐**이다. 켜면 effectiveRadiusM(계단)을 안 쓴다. 측정 중이다
  // (`_rivalDecay.test.ts`). 채택 전까지 운영·화면 동작을 바꾸지 않는다.
  rivalDistanceDecay: null,
  // 2026-09-16 측정값에서 **산업단지·기타를 2026-09-20에 1.00으로 껐다**(자세한 근거는
  // 타입 쪽 주석). 그 둘이 축척 기준점(탕정역·남악)을 부풀려 자를 휘게 하고 있었고,
  // 자를 바로잡고 다시 뽑으니 1.08 · 0.94로 사실상 1이었다. 표본 2~5곳이라 확정값이
  // 아니다 — 조절판에서 돌려볼 것.
  specialDemandMultipliers: { "군부대": 2.25, "대학가": 1.0, "산업단지": 1.0, "기타": 1.0, "관광·유흥": 1.0, "관광유흥": 1.0, "없음": 1.0 },
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
  /**
   * **자사 경쟁력 항목별 점수** — 합친 점수가 아니라 **항목별 원점수**를 넣는다
   * (shareMode="quality"용). 비중이 조절판에서 바뀌면 점수도 같이 바뀌어야 하기 때문이다.
   * null이면 품질 항을 통째로 빼고 비례 배분한다("모른다 = 중립").
   */
  ownQualityParts: QualityParts | null;
  /**
   * **경쟁점 한 곳씩** — 거리·PC수·항목별 점수 (shareMode="quality"용).
   *
   * ⚠️ 합계인 `competitorIp`와 달리 **거리로 걸러야 하므로 낱개가 필요하다.** 그리고
   *    `competitorIp`는 미조사 500m 점포를 100대로 추정해 채우는데(`computeCompetitorIp`),
   *    그런 점포는 거리도 품질도 없어서 여기 못 들어온다. 두 값은 일부러 다르다.
   */
  /**
   * `name`은 **화면에 그리려고만** 들고 다닌다 — 계산에는 안 쓴다. 이름을 따로 뽑아
   * 화면에서 다시 짝지으면 순서가 어긋나 "엉뚱한 경쟁점이 잡혔다"고 오해하게 된다
   * (2026-09-18 사용자 요청: *"어느매장을 인식하고있는지 내가봐야겠어"*).
   */
  rivals: { ip: number; distanceM: number | null; parts: QualityParts | null; name?: string | null }[] | null;
  /**
   * **입지 5항목** (2026-09-17). 전부 null이면 그 항은 1배(중립)로 빠진다 —
   * 자료가 없다고 틀린 값을 만들지 않는다. 화면에는 "자료없음"으로 표시한다.
   */
  location: {
    /** 상권 중심도 = (유동 300m ÷ 유동 1km) x (1000/300)². 1보다 크면 문 앞이 빽빽하다. */
    centrality: number | null;
    /** 접근성 — `computeLocationScoreFromFacts(층수, 지상지하, 엘베)`. 자사·경쟁점이 같은 자다. */
    access: number | null;
    /** 유동 방향 편심도(0~1). 0이면 사방이 고르고, 1에 가까울수록 한쪽으로 쏠렸다(상권 끝). */
    direction: number | null;
    /** 동선 방해 — 아직 자료 없음(경쟁점 좌표 22%). 자리만 둔다. */
    flowBlock: number | null;
    /** 간판·출입구 가시성 — 아직 자료 없음(로드뷰 평가 필요). 자리만 둔다. */
    visibility: number | null;
  } | null;
  /** 특수수요 유형 — "군부대"/"대학가"/"산업단지"/"관광·유흥"/"기타"/"없음". 수요 배수에 쓴다. */
  specialDemandType: string | null;
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
  /** 입지가 점유율에 곱한 배율. 1이면 입지가 아무 일도 안 한 것(자료없음 또는 계수 0). */
  locationMultiplier: number | null;
  /** 어느 입지 항목이 얼마를 곱했는지 — 화면에 그대로 보여준다. */
  locationFactors: { key: string; value: number }[];
  ownDemandHours: number | null;
  utilization: number | null;
  capped: boolean;
  /** 이 매장에 적용된 총단가(원/PC·시간) = PC몫 + 상품몫. 화면에 그대로 보여준다. */
  unitPrice: number | null;
  /** PC몫(원/PC·시간). 정가가 여기에만 들어간다. */
  pcUnitPrice: number | null;
  pcRevenue: number | null;
  productRevenue: number | null;
  monthlyRevenue: number | null;
  /**
   * 상품매출 비율 — **결과값이다.** 2026-09-16 저녁(3)부터 파라미터가 아니다.
   * PC몫과 상품몫을 따로 계산하니 비율은 나눠 보면 나온다.
   */
  productRatio: number | null;
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
    totalDemandHours: null, share: null, locationMultiplier: null, locationFactors: [], ownDemandHours: null, utilization: null,
    capped: false, unitPrice: null, pcUnitPrice: null, pcRevenue: null, productRevenue: null,
    monthlyRevenue: null, productRatio: null, missing,
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
  // 특수수요 배수 — 인구 통계에 안 잡히는 수요원(군부대·대학가·산업단지)을 수요에서 키운다.
  const sdMul = p.specialDemandMultipliers?.[input.specialDemandType ?? "없음"] ?? 1;
  const totalUsers = baseUsers * agg * dens * sdMul;
  const totalHours = totalUsers * p.hoursPerUserPerMonth;

  // ── 3) 점유율 ───────────────────────────────────────────────────────────
  const pc = input.pcCount;
  if (!pc) { missing.push("PC대수"); return { ...empty, residentDemandUsers: residentUsers, floatingDemandUsers: floatingUsers, totalDemandUsers: totalUsers, totalDemandHours: totalHours }; }
  const gap = input.competitivenessGap ?? 1;
  const rivalIp = input.competitorIp ?? 0;
  let ownWeight: number;
  let denom: number;
  if (p.shareMode === "quality") {
    // 품질 모드 — 유효거리 안의 경쟁점만 세고, 각자의 품질을 지수만큼 올려 겨룬다.
    //
    //   점유율 = 자사PC x 자사품질^θ ÷ (자사PC x 자사품질^θ + Σ[d≤R] 경쟁PC x 경쟁품질ᵢ^θ)
    //
    // 품질의 **기준값은 약분된다** — 분자·분모를 같은 수로 나눠도 비가 안 변하기 때문이다.
    // 그래서 "몇 점 만점"인지는 상관없고 자사/경쟁의 **비**만 작용한다.
    //
    // 자료가 없을 때는 "모른다 = 중립"으로 둔다. 자사 품질을 모르면 품질 항을 통째로 빼고
    // (비례 배분), 경쟁점 품질을 모르면 그 경쟁점을 자사와 같은 품질로 본다. 어느 쪽도
    // 결측을 유리/불리로 해석하지 않는다.
    // 비중은 조절판에서 바뀌므로 점수를 여기서 매번 만든다.
    const oq = input.ownQualityParts ? computeQualityScore(input.ownQualityParts, p.qualityWeights) : null;
    // 자사 품질로 정규화한다 — 그러면 자사 항이 정확히 pc가 되고 경쟁점만 배율을 갖는다.
    const ratio = (parts: QualityParts | null) => {
      if (oq == null || !(oq > 0) || !parts) return 1;
      const v = computeQualityScore(parts, p.qualityWeights);
      return v == null || !(v > 0) ? 1 : v / oq;
    };
    ownWeight = pc;
    let rivalWeight = 0;
    const decay = p.rivalDistanceDecay;
    for (const r of input.rivals ?? []) {
      if (!(r.ip > 0)) continue;
      // 거리를 모르면 유효거리 안으로 본다 — 경쟁점을 빼는 쪽이 아니라 세는 쪽이 보수적이다.
      // 감쇠를 켜면 계단 대신 exp(−d/scaleM)으로 센다(타입 쪽 주석 참고). 모르면 1배.
      let w = 1;
      if (decay) {
        // 평지 안쪽은 1배(지금과 같다). 밖만 완만히 줄인다. scaleM<=0이면 계단과 동일.
        const d = r.distanceM;
        if (d != null && d > decay.plateauM) {
          w = decay.scaleM > 0 ? Math.exp(-(d - decay.plateauM) / decay.scaleM) : 0;
        }
      } else if (r.distanceM != null && r.distanceM > p.effectiveRadiusM) {
        continue;
      }
      rivalWeight += r.ip * Math.pow(ratio(r.parts), p.qualityExponent) * w;
    }
    denom = ownWeight + rivalWeight + p.outsideOptionIp;
  } else {
    ownWeight = pc * Math.pow(gap, p.gapExponent);
    // 분모의 outsideOptionIp가 "PC방을 안 가는 몫"이다. 이게 없으면 경쟁점 0곳일 때
    // 점유율이 100%가 되어 동네 수요를 통째로 먹는다.
    denom = ownWeight + rivalIp + p.outsideOptionIp;
  }
  // shareMode="off"면 점유율을 아예 1로 둔다 — 경쟁 항을 통째로 들어낸 상태다.
  // 그러면 화면의 "필요 점유율"(실측가동률 ÷ 이 예측)이 **이 매장이 실제로 먹은 몫**이 되고,
  // 그 값으로 수요식을 2차 검증할 수 있다(2026-09-16 사용자 설계).
  const rawShare = p.shareMode === "off" ? 1 : (denom > 0 ? ownWeight / denom : 1);

  // ── 입지 — 점유율에 곱한다 (2026-09-17) ────────────────────────────────
  // 경쟁력점수 안이 아니라 **밖**이다. 접근성은 "경쟁점보다 낮은 층인가"가 아니라
  // "올라오기 얼마나 번거로운가"라서, 비율이 아니라 곱셈이 맞다. 타입 쪽 주석 참고.
  //
  // 자료가 없으면 그 항은 1배로 빠진다 — **없는 값을 지어내지 않는다.**
  // shareMode="off"일 때도 빠진다. "off"는 경쟁·입지를 통째로 들어내 필요 점유율을 보는 모드다.
  const locFactors: { key: string; value: number }[] = [];
  if (p.shareMode !== "off" && input.location) {
    const L = input.location, E = p.locationExponents, R = p.locationReferences;
    const mul = (key: string, v: number | null, exp: number, ref: number) => {
      if (v == null || !Number.isFinite(v) || !(v > 0) || !(ref > 0) || exp === 0) return;
      locFactors.push({ key, value: Math.pow(v / ref, exp) });
    };
    // 중심도는 **잔차화해서** 넣는다 — 날값에는 동네 규모(유동400m)가 섞여 있어 수요식과
    // 이중계산이 된다. 자세한 근거와 상수의 성격은 `centralityResidual` 타입 주석에 있다.
    // ⚠️ 유동400m가 없으면 **항을 통째로 뺀다**(null). 날값으로 되돌리지 않는다 —
    //    ν=0.5는 잔차 눈금에 맞춘 값이라 날값에 먹이면 딴 걸 재게 된다.
    const CR = p.centralityResidual;
    const f400 = input.floatingByRadius[400] ?? null;
    const centrality = (() => {
      if (!CR) return L.centrality; // 잔차화를 끈 상태 — 옛 동작(ν도 0.25로 돌릴 것)
      if (L.centrality == null || !(L.centrality > 0)) return null;
      if (f400 == null || !(f400 > 0)) return null;
      return R.centrality * (L.centrality / CR.geoMeanCentrality)
        * Math.pow(CR.geoMeanFloating400 / f400, CR.slope);
    })();
    mul("centrality", centrality, E.centrality, R.centrality);
    mul("access", L.access, E.access, R.access);
    // 편심도는 클수록 불리하므로 (1 - 편심도)를 쓴다. 기준 0.75는 실측 중앙 편심도 0.25의 여집합.
    if (L.direction != null && Number.isFinite(L.direction) && E.direction !== 0) {
      const room = Math.max(0.01, 1 - L.direction);
      locFactors.push({ key: "direction", value: Math.pow(room / 0.75, E.direction) });
    }
    mul("flowBlock", L.flowBlock, E.flowBlock, 3);
    mul("visibility", L.visibility, E.visibility, 3);
  }
  const locationMultiplier = locFactors.reduce((a, f) => a * f.value, 1);
  // 점유율은 1을 넘을 수 없다 — 입지가 좋아도 그 동네 수요보다 많이 먹지는 못한다.
  const share = Math.min(1, rawShare * locationMultiplier);

  // ── 4) 매출 ─────────────────────────────────────────────────────────────
  const rawOwnHours = totalHours * share;
  const capHours = pc * MONTH_HOURS * p.maxUtilization;
  const capped = rawOwnHours > capHours;
  const ownHours = Math.min(rawOwnHours, capHours);
  const utilization = ownHours / (pc * MONTH_HOURS);

  // ── 총단가 = PC몫 + 상품몫 ─────────────────────────────────────────────
  //
  //   PC몫   = 기준정가 x (정가 / 기준정가)^β   <- 정가가 여기에만 들어간다
  //   상품몫 = 상수                             <- 정가와 무관하다 (라면 값은 PC요금을 안 따라간다)
  //
  // 2026-09-16 저녁(3) 이전에는 총단가 전체에 정가를 곱했다. 그러면 정가를 80% 올릴 때
  // 총단가가 38% 오르는데, 상품매출은 안 오르므로 과하다(덧셈 구조에서는 17%).
  const rate = input.hourlyRate;
  const ref = p.referenceHourlyRate;
  if (rate == null) missing.push("시간당 요금");
  // 요금을 모르면 기준정가(표본 중앙)인 매장으로 가정한다. 화면에 "자료없음"으로 표시된다.
  const effRate = rate == null || !(ref > 0)
    ? ref
    : ref * Math.pow(rate / ref, p.rateElasticity);
  const pcUnitPrice = effRate;
  const unitPrice = pcUnitPrice + p.productUnitPrice;
  const pcRevenue = ownHours * pcUnitPrice;
  const productRevenue = ownHours * p.productUnitPrice;
  const monthlyRevenue = unitPrice > 0 ? pcRevenue + productRevenue : null;

  return {
    residentDemandUsers: residentUsers,
    floatingDemandUsers: floatingUsers,
    totalDemandUsers: totalUsers,
    totalDemandHours: totalHours,
    share,
    locationMultiplier,
    locationFactors: locFactors,
    ownDemandHours: ownHours,
    utilization,
    capped,
    unitPrice,
    pcUnitPrice,
    pcRevenue,
    productRevenue,
    monthlyRevenue,
    productRatio: monthlyRevenue != null && monthlyRevenue > 0 ? productRevenue / monthlyRevenue : null,
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
 *   2) productUnitPrice     ← **전 매장** 실매출·실측가동률 (fitProductUnitPrice)
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
 * 상품몫(productUnitPrice)을 **실측 가동률이 있는 전 매장**에서 구한다.
 *
 * 덧셈 구조라 배수가 아니라 **빼서** 구한다 — PC몫은 정가에서 이미 정해졌으니, 실매출에서
 * PC몫을 빼고 남는 게 상품몫이다.
 *
 *   상품몫 = 평균( 실매출 ÷ (PC x 720 x 실측가동률) − PC몫 )
 *
 * 남는 오차가 곧 "세 독점매장이 PC·시간당 실제로 얼마나 다르게 버는가"다. 2026-09-16 실측으로
 * 총단가가 탕정역 3,206원 · 광주각화 2,853원 · 남악 2,745원이라 16.8% 벌어져 있고, **그 차이의
 * 75%가 상품몫**이다(탕정역 1,591원 vs 남악 1,247원). 후보지에서 알 수 있는 값으로는 설명되지
 * 않았다 — 그래서 독점 최대오차 10.6%가 지금 자료의 바닥이다.
 */
export function fitProductUnitPrice(
  rows: { input: TextbookInput; actualRevenue: number }[],
  p: TextbookParams,
): number {
  // ── 실측 가동률이 있으면 **전 매장**을 쓴다 (2026-09-16 저녁(3) 수정) ──────────────
  //
  // 상품몫은 수요와 달리 **직접 측정된다** — 실매출 ÷ (PC x 720 x 실측가동률) − PC몫.
  // 산식을 한 번도 거치지 않으니 독점이라는 지렛대가 필요 없다.
  //
  // 사용자(2026-09-16): "정액권비중은 독점매장비율로쓰면안될거같은데, 전체매장으로해야하지
  // 않음? 평균값이라" — 맞다. 평균으로 쓸 값이면 표본이 많을수록 낫다.
  //
  // ⚠️ 그전에는 **모형이 예측한** 이용시간(ownDemandHours)으로 나눴다. 경쟁상권 매장은 그
  //    값이 29% 틀려서 독점으로 제한할 수밖에 없었다. 실측 가동률로 나누면 그 제약이 사라진다.
  //    독점 3곳 1,492원 vs 전체 32곳 1,508원으로 값 자체는 1%밖에 안 달랐지만, 표본이 3곳에서
  //    32곳으로 늘고 독점 매출 최대오차도 10.6% → 10.1%로 조금 나아진다.
  const measured: number[] = [];
  for (const r of rows) {
    const au = r.input.actualUtilization;
    const pc = r.input.pcCount;
    if (au == null || !(au > 0) || !pc || !(r.actualRevenue > 0)) continue;
    const b = computeTextbook(r.input, { ...p, productUnitPrice: 0 });
    if (b.pcUnitPrice == null) continue;
    measured.push(r.actualRevenue / (pc * MONTH_HOURS * au) - b.pcUnitPrice);
  }
  if (measured.length) return Math.max(0, measured.reduce((a, b) => a + b, 0) / measured.length);

  // ── 되돌림: 실측 가동률이 하나도 없으면 독점매장에서 모형 이용시간으로 맞춘다 ──────
  const target = calibrationTarget(rows);
  const shares: number[] = [];
  for (const r of target) {
    // 상품몫을 0으로 두고 계산하면 PC몫과 자사이용시간만 남는다.
    const b = computeTextbook(r.input, { ...p, productUnitPrice: 0 });
    if (b.ownDemandHours == null || b.ownDemandHours <= 0 || !(r.actualRevenue > 0)) continue;
    if (b.capped) continue;
    shares.push(r.actualRevenue / b.ownDemandHours - (b.pcUnitPrice ?? 0));
  }
  if (!shares.length) return p.productUnitPrice;
  // 상품몫이 음수면 PC몫이 실매출보다 크다는 뜻이다 — 0으로 막는다.
  return Math.max(0, shares.reduce((a, b) => a + b, 0) / shares.length);
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
  /** 전 매장 실측으로 구한 productUnitPrice(상품몫, 원/PC·시간). 화면에 그대로 보여준다. */
  fittedProductUnitPrice: number;
  /** 수요 축척을 실측 가동률로 맞췄는지. false면 매출로 떨어진 것이라 두 층이 다시 엉킨다. */
  scaledOnUtilization: boolean;
  /** 가동률 성적 — 실측 가동률이 있는 매장만. 매출과 따로 봐야 층별 판정이 된다. */
  utilizationMape: number | null;
  utilizationSampleCount: number;
  /**
   * **필요 점유율** 요약 — 이 매장이 실제로 먹은 몫. 수요식 2차 검증용이다.
   * 필요 점유율 = 실측가동률 ÷ (경쟁 없다고 볼 때의 예측 가동률)
   * 수요식이 맞다면 0~1 안에 들어야 한다. 1을 넘으면 그 동네 수요를 과소평가한 것이다.
   */
  requiredShare: { count: number; median: number; min: number; max: number; overOne: number } | null;
  rows: {
    storeCode: string; storeName: string | null;
    predicted: number | null; actual: number; absErrPct: number | null;
    utilization: number | null; actualUtilization: number | null; utilErrPct: number | null;
    share: number | null; capped: boolean;
    unitPrice: number | null; pcUnitPrice: number | null; productRatio: number | null;
    /** 경쟁이 없다고 볼 때의 예측 가동률 — 필요 점유율의 분모다. */
    utilizationNoShare: number | null;
    /** 필요 점유율 = 실측가동률 ÷ utilizationNoShare. 실측 가동률이 없으면 null. */
    requiredShare: number | null;
    missing: string[];
  }[];
};

/** 38곳에 대고 점수를 낸다. 배율(hoursPerUserPerMonth)은 여기서 자동으로 맞춘다. */
export function scoreTextbook(
  rows: { input: TextbookInput; actualRevenue: number }[],
  p: TextbookParams,
): TextbookScore {
  // 축척 둘을 맞춘다. 1) 수요 축척은 **독점** 실측 가동률에(수요는 직접 관측이 안 되므로),
  // 2) 상품몫은 **전 매장** 실측 가동률로 직접 측정한다(산식을 안 거치므로 독점 제약이 없다).
  const fitted = fitHoursPerUser(rows, p);
  const scaledOnUtilization = rows.some((r) => (r.input.actualUtilization ?? 0) > 0);
  const withFit: TextbookParams = { ...p, hoursPerUserPerMonth: fitted };
  const fittedProductUnitPrice = fitProductUnitPrice(rows, withFit);
  const full: TextbookParams = { ...withFit, productUnitPrice: fittedProductUnitPrice };

  const out: TextbookScore["rows"] = [];
  const errs: number[] = [];
  const utilErrs: number[] = [];
  const reqShares: number[] = [];
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
    // **필요 점유율** — 경쟁을 아예 없다고 본 예측 가동률로 실측을 나눈 값이다.
    // 이게 "이 매장이 실제로 먹은 몫"이고, 수요식 2차 검증의 자다(2026-09-16 사용자 설계).
    // 상한을 무한대로 두는 이유: 상한에 걸리면 분모가 잘려 필요 점유율이 부풀려진다.
    const bNo = computeTextbook(r.input, { ...full, shareMode: "off", maxUtilization: Number.POSITIVE_INFINITY });
    const req = bNo.utilization != null && bNo.utilization > 0 && au != null && au > 0
      ? au / bNo.utilization
      : null;
    if (req != null) reqShares.push(req);
    out.push({
      storeCode: r.input.storeCode, storeName: r.input.storeName,
      predicted: b.monthlyRevenue, actual: r.actualRevenue, absErrPct: err,
      utilization: b.utilization, actualUtilization: au ?? null, utilErrPct: utilErr,
      share: b.share, capped: b.capped, unitPrice: b.unitPrice, pcUnitPrice: b.pcUnitPrice,
      productRatio: b.productRatio, utilizationNoShare: bNo.utilization, requiredShare: req,
      missing: b.missing,
    });
  }
  const sorted = [...errs].sort((a, b) => a - b);
  const reqSorted = [...reqShares].sort((a, b) => a - b);
  return {
    sampleCount: errs.length,
    mape: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
    medianAbsErr: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    within10: errs.length ? errs.filter((v) => v <= 0.1).length / errs.length : null,
    within20: errs.length ? errs.filter((v) => v <= 0.2).length / errs.length : null,
    maxAbsErr: sorted.length ? sorted[sorted.length - 1] : null,
    fittedHoursPerUser: fitted,
    fittedProductUnitPrice,
    scaledOnUtilization,
    utilizationMape: utilErrs.length ? utilErrs.reduce((a, b) => a + b, 0) / utilErrs.length : null,
    utilizationSampleCount: utilErrs.length,
    requiredShare: reqSorted.length ? {
      count: reqSorted.length,
      median: reqSorted[Math.floor(reqSorted.length / 2)],
      min: reqSorted[0],
      max: reqSorted[reqSorted.length - 1],
      overOne: reqSorted.filter((v) => v > 1).length,
    } : null,
    rows: out.sort((a, b) => (b.absErrPct ?? 0) - (a.absErrPct ?? 0)),
  };
}

/**
 * 채점에서 **맞춰진 축척까지 먹인 파라미터 한 벌**. 실매출이 없는 곳(신규후보지)에
 * `computeTextbook`을 직접 돌릴 때 쓴다 (2026-09-18).
 *
 * ── 왜 함수로 두나 ─────────────────────────────────────────────────────────
 * 부르는 쪽에서 `{ ...p, hoursPerUserPerMonth: score.fittedHoursPerUser, ... }`를 손으로
 * 조립하면, 나중에 축척이 하나 더 늘 때 **부르는 자리를 전부 찾아 고쳐야 한다.** 한 군데라도
 * 빠지면 그 화면만 옛 축척으로 돌아가는데, 값이 그럴듯해서 티가 안 난다. 조립을 한 곳에 둔다.
 *
 * ⚠️ 축척은 **실매출·실측가동률이 있는 기존점에서만** 맞춘다. 후보지 행으로 `scoreTextbook`을
 *    부르지 말 것 — 맞출 실측값이 없어서 되돌림 경로로 새어 들어가고, 결국 예측값으로
 *    예측값을 맞추는 순환이 된다.
 */
export function fittedParams(p: TextbookParams, score: TextbookScore): TextbookParams {
  return {
    ...p,
    hoursPerUserPerMonth: score.fittedHoursPerUser,
    productUnitPrice: score.fittedProductUnitPrice,
  };
}
