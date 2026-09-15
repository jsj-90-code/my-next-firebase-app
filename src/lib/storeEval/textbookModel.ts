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
//   3) 자사수요 = 총수요 x 점유율
//   4) 매출     = 자사수요 x 실효단가 + 상품매출
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

/** 유동인구를 어느 반경으로 쓸지. 100·200은 아직 수집된 적이 없다(2026-09-15). */
export type FloatingRadius = 100 | 200 | 500;
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
  /** 총매출 대비 상품매출 비율(회사 기준 50%). */
  productRatio: number;
  /** 가동률 물리적 상한. 이 위로는 좌석이 모자라 못 받는다. */
  maxUtilization: number;
};

export const DEFAULT_TEXTBOOK_PARAMS: TextbookParams = {
  residentRadius: 1000,
  floatingRadius: 500,
  useResidentAgeWeights: true,
  useFloatingAgeWeights: true,
  // 2026-09-15 실측에서 주거1km + 유동x0.2이 가장 나았다(MAPE 42.0%). 출발점으로만 쓴다.
  floatingFactor: 0.2,
  ageWeights: {
    age0s: 0.01, age10s: 0.35, age20s: 0.30, age30s: 0.14,
    age40s: 0.05, age50s: 0.02, age60plus: 0.01,
  },
  hoursPerUserPerMonth: 1.0,
  gapExponent: 1.0,
  outsideOptionIp: 0,
  agglomerationFactor: 0,
  productRatio: 0.5,
  maxUtilization: 0.85,
};

/** 한 점포(기존점이든 후보지든)의 교과서식 입력. */
export type TextbookInput = {
  storeCode: string;
  storeName: string | null;
  pcCount: number | null;
  hourlyRate: number | null;
  competitivenessGap: number | null;
  competitorIp: number | null;
  /** 상권 흡인력 계산용. 조사된 경쟁점 수(IP가 아니라 점포 수). */
  competitorCount: number | null;
  /** 주거 — 500m는 총수만, 1km는 연령 분해까지 있다. */
  pop500m: number | null;
  pop1km: number | null;
  residentAges: { age0s: number; age10s: number; age20s: number; age30s: number; age40s: number; age50s: number; age60plus: number } | null;
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
    capped: false, pcRevenue: null, productRevenue: null, monthlyRevenue: null, missing,
  };

  // ── 1) 주거 수요 ────────────────────────────────────────────────────────
  let residentUsers: number | null = null;
  if (p.residentRadius === 1000) {
    if (p.useResidentAgeWeights && input.residentAges) {
      residentUsers = weightedAges(input.residentAges, p.ageWeights);
    } else if (input.pop1km != null) {
      residentUsers = input.pop1km * flatUsageRate(p.ageWeights);
    } else missing.push("1km 주거인구");
  } else {
    // 500m는 연령 분해가 없다 — 총수 x 평균 이용률만 가능하다.
    if (input.pop500m != null) residentUsers = input.pop500m * flatUsageRate(p.ageWeights);
    else missing.push("500m 주거인구");
  }

  // ── 2) 유동 수요 ────────────────────────────────────────────────────────
  let floatingUsers: number | null = null;
  const flow = input.floatingByRadius[p.floatingRadius];
  const flowAges = input.floatingAgesByRadius[p.floatingRadius];
  if (flow == null) {
    missing.push(`${p.floatingRadius}m 유동인구`);
  } else if (p.useFloatingAgeWeights && flowAges) {
    floatingUsers = weightedAges(flowAges, p.ageWeights) * p.floatingFactor;
  } else {
    floatingUsers = flow * flatUsageRate(p.ageWeights) * p.floatingFactor;
  }

  if (residentUsers == null && floatingUsers == null) return empty;

  const baseUsers = (residentUsers ?? 0) + (floatingUsers ?? 0);
  // 상권 흡인력 — 경쟁점이 많다는 건 그 자리가 좋다는 뜻이기도 하다. 0이면 끈 것이다.
  const agg = p.agglomerationFactor > 0
    ? 1 + p.agglomerationFactor * Math.log(1 + (input.competitorCount ?? 0))
    : 1;
  const totalUsers = baseUsers * agg;
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

  const rate = input.hourlyRate;
  if (rate == null) missing.push("시간당 요금");
  const pcRevenue = rate != null ? ownHours * rate : null;
  // 상품매출은 총매출 대비 비율로 잡는다(회사 기준). PC매출 = 총매출 x (1 - productRatio).
  const monthlyRevenue = pcRevenue != null && p.productRatio < 1 ? pcRevenue / (1 - p.productRatio) : null;
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
    pcRevenue,
    productRevenue,
    monthlyRevenue,
    missing,
  };
}

/**
 * hoursPerUserPerMonth는 스케일 계수라 눈으로 정할 값이 아니다. 나머지 파라미터를 고정한
 * 상태에서 실제 매출에 **가장 잘 맞는 배율**을 닫힌 형태로 구한다(로그 공간 평균).
 * 이렇게 해야 반경·가중을 바꿀 때 스케일 차이 때문에 비교가 엉키지 않는다.
 */
export function fitHoursPerUser(
  rows: { input: TextbookInput; actualRevenue: number }[],
  p: TextbookParams,
): number {
  const ratios: number[] = [];
  for (const r of rows) {
    const b = computeTextbook(r.input, { ...p, hoursPerUserPerMonth: 1 });
    if (b.monthlyRevenue == null || b.monthlyRevenue <= 0 || !(r.actualRevenue > 0)) continue;
    // 상한에 걸린 매장은 배율을 키워도 매출이 안 늘어 배율 추정을 왜곡한다 — 제외한다.
    if (b.capped) continue;
    ratios.push(Math.log(r.actualRevenue / b.monthlyRevenue));
  }
  if (!ratios.length) return p.hoursPerUserPerMonth;
  return Math.exp(ratios.reduce((a, b) => a + b, 0) / ratios.length);
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
  rows: {
    storeCode: string; storeName: string | null;
    predicted: number | null; actual: number; absErrPct: number | null;
    utilization: number | null; share: number | null; capped: boolean;
    missing: string[];
  }[];
};

/** 38곳에 대고 점수를 낸다. 배율(hoursPerUserPerMonth)은 여기서 자동으로 맞춘다. */
export function scoreTextbook(
  rows: { input: TextbookInput; actualRevenue: number }[],
  p: TextbookParams,
): TextbookScore {
  const fitted = fitHoursPerUser(rows, p);
  const withFit: TextbookParams = { ...p, hoursPerUserPerMonth: fitted };
  const out: TextbookScore["rows"] = [];
  const errs: number[] = [];
  for (const r of rows) {
    const b = computeTextbook(r.input, withFit);
    const err = b.monthlyRevenue != null && r.actualRevenue > 0
      ? Math.abs(b.monthlyRevenue - r.actualRevenue) / r.actualRevenue
      : null;
    if (err != null) errs.push(err);
    out.push({
      storeCode: r.input.storeCode, storeName: r.input.storeName,
      predicted: b.monthlyRevenue, actual: r.actualRevenue, absErrPct: err,
      utilization: b.utilization, share: b.share, capped: b.capped, missing: b.missing,
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
    rows: out.sort((a, b) => (b.absErrPct ?? 0) - (a.absErrPct ?? 0)),
  };
}
