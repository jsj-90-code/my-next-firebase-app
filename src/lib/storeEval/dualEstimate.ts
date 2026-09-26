// 신규 후보지 — 두 산식(운영 V62 · 실험실 구조식)을 같이 내고, 어느 쪽을 믿을지 규칙으로 고른다 (2026-09-25 밤, 사용자 결정).
//
// 사용자: *"신규후보지 조회할 때 두 개 산식값이 같이 떠서 내가 참고할 수 있는 방향으로 가는 게 좋겠네."*
//
// ── 왜 규칙이 필요한가 (근거: docs/releases/2026-09-25-timesplit-and-v62-rate.md, _candidateRangeCheck.test.ts) ──
// - V62가 평균적으로 더 맞는다: 기존점 40곳 9.5% vs 실험실 13.4%, 개점 시기 되짚기(신규 매장)에서도 8.7 vs 15.5.
// - 그러나 둘은 **서로 다른 자리에서** 틀린다(오차 상관 0.22):
//   · V62는 회귀라 **학습 범위 밖**(기존점에 없던 입력)에서 직선을 그대로 늘린다 — 영월: 상권수요 383 = 기존점 최저 1,128의 1/3인데 7,081만(실험실 3,802만).
//   · 실험실은 **경쟁 밀집**(경쟁 PC 800대 이상)에서 수요를 ~1.7배 적게 본다 — 창원상남 2,937만 vs 실무 감각 4,500~4,800만(V62 5,439만).
// - 두 값 평균은 되짚기에서 V62 단독보다 낫지 않았다 → 평균 내지 않고 **고른다.**
//
// ── 규칙 (2026-09-26 밤 개정, 사용자 확정 — 근거 docs/releases/2026-09-26-v62-lab-feed.md "범위 규칙 되짚기") ──────────
// 1. 입력(상권수요·정가·PC수·경쟁IP·수요/공급)이 V62 학습 범위(모델 포함 기존점 최소~최대)를 **크게** 벗어남
//    (끝값의 절반 아래 또는 두 배 위, farFactor) → **두 값 중 낮은 쪽을 주 값**으로 + 폭 + 현장 확인.
//    이 구간은 기존점에 예가 없어 **어느 산식도 검증할 수 없다** — 산식을 편들지 않고 "모른다"를 드러낸다.
//    낮은 쪽인 이유: 들어갈지 말지 정하는 평가라 과대평가가 더 비싸다(사용자 2026-09-26 확정).
//    ⚠️ 특정 매장 예외를 두지 않는다 — 사람이 지적하지 않은 매장에도 같은 규칙이 돌아야 한다(사용자 우려).
//    검증 계획: 개점한 후보지는 3~6개월 뒤 같은 경쟁점 핑봇을 다시 재 "우리가 들어간 뒤 동네 이용량이 몇 배가 됐나"를 잰다.
//    (09-26 밤에 영월을 두고 시장 크기·경쟁점 대비 가동률로 판정하려다 둘 다 "경쟁점 손님 이동 vs 신규 수요" 비율을 몰라 무너졌다.)
// 1'. **조금** 벗어남 → V62 주 값 그대로 + "범위 밖" 경고. 기존점 되짚기: 자기 빼고 잡은 범위 밖 7곳에서 V62가 더 가까웠다
//    (|오차| 평균 V62 10.3% vs 실험실 27.7%). 옛 규칙("범위 밖이면 무조건 실험실")은 이 시험으로 기각.
// 2. 두 값이 20% 넘게 갈림 →
//    · 경쟁 PC ≥ 800대(밀집, **거리와 무관한 원래 대수** competitorIpRaw) → V62 주 값, "실험실 약점 구간(경쟁 밀집 수요 과소)".
//    · 그 밖 → V62 주 값, V62가 크면 "V62 과대 가능 — 현장 확인", 작으면 "V62 과소 가능 — 현장 확인".
// 3. 그 밖(20% 안) → V62 주 값, "두 산식 일치".
// 폭(low~high)은 두 값의 작은 쪽~큰 쪽. 보고서에는 주 값과 폭을 같이 적는다.

import type { CandidateInput, Competitor, EvaluationResult, ExistingStore, ExistingStoreMonthlySales, LocationEvaluation, ModelSettings } from "./types";
import type { ResidentAges, ResidentRingRadius } from "./textbookModel";
import { DEFAULT_TEXTBOOK_PARAMS, computeTextbook, fittedParams, scoreTextbook } from "./textbookModel";
import { computeCompetitorAppliedPcCount } from "./calc";
import { buildLabCandidateRows, buildLabRows, franchiseManagementFromRows, productUnitPriceEraByStore, utilizationByStore } from "./labInput";

export const DUAL_ESTIMATE_RULE = { gapRatio: 1.2, denseCompetitorIp: 800, farFactor: 2 } as const;

export type V62TrainingRange = { demand: [number, number]; rate: [number, number]; pc: [number, number]; competitorIp: [number, number]; demandPerSupply: [number, number]; sampleCount: number };

/** V62 학습 범위 — 모델 포함(블랙라벨·제외 아님) 기존점의 입력 최소~최대. prepareExistingStoresForEvaluation을 지난 매장을 넣을 것(요금에 유료게임 과금이 합산된 값). */
export function v62TrainingRange(stores: ExistingStore[]): V62TrainingRange | null {
  const inc = stores.filter((s) => !s.excludedFromModel && s.brandType === "블랙라벨" && s.marketDemand != null && s.actualMonthlyRevenueAvg != null);
  if (!inc.length) return null;
  const rng = (f: (s: ExistingStore) => number | null | undefined): [number, number] => {
    const v = inc.map(f).filter((x): x is number => x != null && Number.isFinite(x));
    return [Math.min(...v), Math.max(...v)];
  };
  const pcOf = (s: ExistingStore) => s.evaluationPcCount ?? s.pcCount ?? null;
  return {
    demand: rng((s) => s.marketDemand), rate: rng((s) => s.hourlyRate), pc: rng(pcOf), competitorIp: rng((s) => s.competitorIp),
    demandPerSupply: rng((s) => { const pc = pcOf(s) ?? 0; const d = (pc + (s.competitorIp ?? 0)); return d > 0 ? (s.marketDemand as number) / d : null; }),
    sampleCount: inc.length,
  };
}

/** far = 끝값의 절반 아래 또는 두 배 위(DUAL_ESTIMATE_RULE.farFactor) — 기존점에 예가 없을 만큼 크게 벗어남. */
export type RangeFlag = { field: "상권수요" | "정가" | "PC수" | "경쟁IP" | "수요/공급"; value: number; min: number; max: number; side: "아래" | "위"; far?: boolean };

export function rangeFlagsFor(result: Pick<EvaluationResult, "marketDemand" | "competitorIp" | "hourlyRate" | "expectedPcCount">, range: V62TrainingRange): RangeFlag[] {
  const out: RangeFlag[] = [];
  const chk = (field: RangeFlag["field"], v: number | null | undefined, [min, max]: [number, number]) => {
    if (v == null || !Number.isFinite(v)) return;
    const k = DUAL_ESTIMATE_RULE.farFactor;
    if (v < min) out.push({ field, value: v, min, max, side: "아래", far: min > 0 && v < min / k });
    else if (v > max) out.push({ field, value: v, min, max, side: "위", far: max > 0 && v > max * k });
  };
  const pc = result.expectedPcCount ?? null, comp = result.competitorIp ?? 0;
  chk("상권수요", result.marketDemand, range.demand);
  chk("정가", result.hourlyRate, range.rate);
  chk("PC수", pc, range.pc);
  chk("경쟁IP", comp, range.competitorIp);
  chk("수요/공급", result.marketDemand != null && pc != null && pc + comp > 0 ? result.marketDemand / (pc + comp) : null, range.demandPerSupply);
  return out;
}

export type DualEstimate = {
  v62: number | null;
  lab: number | null;
  /** 규칙이 고른 주 값 */
  primary: "V62" | "실험실";
  primaryValue: number | null;
  low: number | null;
  high: number | null;
  /** V62 ÷ 실험실 */
  ratio: number | null;
  reason: string;
  rangeFlags: RangeFlag[];
  rangeSampleCount: number | null;
  /** 입력 호환성 — 두 산식 중 하나라도 기본값·가정으로 채운 입력(inputGapsFor). 비어 있으면 둘 다 제 입력으로 계산. */
  inputGaps?: string[];
  computedAt: number;
};

/**
 * 입력 호환성(2026-09-25, 사용자 "실험실 입력이 V62엔 없을 수도 있으니 입력 단계에서 체크") — 비어 있으면 그 산식이 기본값·가정으로 계산하는 항목.
 * 전수 점검 하네스: _inputCompatibility.test.ts (13곳은 전부 채워져 있음, 경쟁점 PC 빈칸은 두 산식이 같은 90대 규칙으로 채움).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function inputGapsFor(candidate: CandidateInput, loc: LocationEvaluation | null, competitors: Competitor[]): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = candidate as any; const gaps: string[] = [];
  const miss = (k: string) => c[k] == null || c[k] === "";
  if (miss("expectedPcCount") || miss("hourlyRate")) gaps.push("PC수·정가(둘 다)");
  if (miss("pop1km") || miss("pop500m")) gaps.push("주거 인구(둘 다)");
  if (["0_9", "10_19", "20_29", "30_39", "40_49", "50_59", "60_69", "70_79", "80plus"].some((a) => miss(`age1km_${a}`))) gaps.push("주거 1km 연령(실험실)");
  if ([100, 200, 300, 400, 500].some((r) => miss(`floating${r}Avg`))) gaps.push("유동 반경별 평균(실험실)");
  if ([100, 200, 300, 400, 500].some((r) => ["10s", "20s", "30s", "40s", "50s", "60plus"].some((a) => miss(`floating${r}_${a}`)) || miss(`floating${r}Male`))) gaps.push("유동 연령·남성(실험실)");
  if (miss("operatingPcStores500m")) gaps.push("500m 영업 PC방 수(실험실)");
  if (miss("floor") || miss("groundLevel") || c.hasElevator == null) gaps.push("층·지하·엘리베이터(둘 다)");
  if (!loc || loc.visibilityScore == null || loc.preemptionScore == null) gaps.push("입지평가 가시성·선점(V62)");
  if (!loc || !loc.inflowRestriction) gaps.push("외부유입제한(V62)");
  if (!loc || !loc.specialDemandType || !loc.specialDemandIntensity) gaps.push("특수수요 유형·강도(둘 다)");
  const cs = competitors.filter((x) => x.candidateCode === candidate.code && x.investigationStatus !== "경쟁점없음");
  if (cs.some((x) => x.lat == null || x.lng == null)) gaps.push("경쟁점 좌표(실험실 거리 감쇠)");
  const unsurveyed = cs.filter((x) => x.investigationStatus !== "조사완료").length;
  if (unsurveyed) gaps.push(`경쟁점 미조사 ${unsurveyed}곳(둘 다 — PC 없으면 90대로 간주)`);
  // 2026-09-26 — "상권자료 수집"이 막 가져온 경쟁점은 조사완료 + 조사수준·PC대수 빈칸이다. V62는 이런 경쟁점을
  // **0대**로 센다(computeCompetitorAppliedPcCount → null → "값 누락", 경쟁IP에서 빠짐) — PC대수를 채우거나
  // 조사수준 "간략"(90대)을 고르기 전에 결과를 보면 예상매출이 부풀어 있는데 여기 안 떠서 알 길이 없었다.
  const noPc = cs.filter((x) => x.investigationStatus === "조사완료" && computeCompetitorAppliedPcCount(x) == null).length;
  if (noPc) gaps.push(`경쟁점 PC대수 빈칸 ${noPc}곳(V62는 0대로 셈 — 대수를 넣거나 조사수준 "간략"(90대)을 고를 것)`);
  return gaps;
}

/** 목록·결과 탭 "현장 확인" 표시 — 검증 불가 구간(크게 벗어남)이거나 두 값이 20% 넘게 갈릴 때. 사람이 결과 탭을 안 열어도 목록에서 보이게 한다. */
export function needsFieldCheck(d: Pick<DualEstimate, "rangeFlags" | "ratio"> | null | undefined): boolean {
  if (!d) return false;
  if (d.rangeFlags?.some((f) => f.far)) return true;
  return d.ratio != null && (d.ratio > DUAL_ESTIMATE_RULE.gapRatio || d.ratio < 1 / DUAL_ESTIMATE_RULE.gapRatio);
}

export function chooseEstimate(v62: number | null, lab: number | null, flags: RangeFlag[], competitorIp: number | null, rangeSampleCount: number | null, inputGaps: string[] = []): DualEstimate {
  const ratio = v62 != null && lab != null && lab > 0 ? v62 / lab : null;
  const low = v62 != null && lab != null ? Math.min(v62, lab) : v62 ?? lab;
  const high = v62 != null && lab != null ? Math.max(v62, lab) : v62 ?? lab;
  let primary: DualEstimate["primary"] = "V62";
  let reason: string;
  const fmt = (list: RangeFlag[]) => list.map((f) => `${f.field} ${Math.round(f.value * 100) / 100}이(가) 기존점 범위(${Math.round(f.min * 100) / 100}~${Math.round(f.max * 100) / 100}) ${f.side}`).join(", ");
  const far = flags.filter((f) => f.far);
  // 조금 벗어남 — 주 값은 V62 그대로, 경고만 앞에 붙인다(2026-09-26 되짚기: 범위 밖 7곳에서 V62 10.3% vs 실험실 27.7%).
  const nearNote = flags.length && !far.length ? `범위 밖 경고 — ${fmt(flags)}. 기존점 되짚기에서 이 정도 벗어난 매장은 V62가 더 가까웠습니다. ` : "";
  if (far.length && lab != null && v62 != null) {
    primary = lab < v62 ? "실험실" : "V62";
    reason = `검증 불가 구간(크게 벗어남) — ${fmt(far)}. 기존점에 이런 예가 없어 어느 산식이 맞는지 판정할 수 없습니다. 들어갈지 정하는 평가라 두 값 중 낮은 쪽(${primary})을 주 값으로 두고 폭을 같이 봅니다. 현장 확인이 필요합니다.`;
  } else if (lab == null) {
    reason = "실험실 값을 낼 수 없어 V62만 봅니다.";
  } else if (ratio != null && (ratio > DUAL_ESTIMATE_RULE.gapRatio || ratio < 1 / DUAL_ESTIMATE_RULE.gapRatio)) {
    if ((competitorIp ?? 0) >= DUAL_ESTIMATE_RULE.denseCompetitorIp) reason = `두 산식이 ${ratio.toFixed(2)}배 갈림 — 경쟁 밀집(경쟁 PC ${Math.round(competitorIp ?? 0)}대)은 실험실이 수요를 적게 보는 구간이라 V62를 주 값으로 봅니다.`;
    else reason = `두 산식이 ${ratio.toFixed(2)}배 갈림 — ${ratio > 1 ? "V62 과대 가능" : "V62 과소 가능"}. 현장 확인을 권합니다.`;
  } else reason = "두 산식이 20% 안에서 일치합니다.";
  if (primary === "V62" && nearNote) reason = nearNote + reason;
  return { v62, lab, primary, primaryValue: primary === "V62" ? v62 : lab, low, high, ratio, reason, rangeFlags: flags, rangeSampleCount, inputGaps, computedAt: Date.now() };
}

export type LabExtras = {
  residentRingsByCode?: Map<string, Partial<Record<ResidentRingRadius, ResidentAges | null>>>;
  ringBlockedByCode?: Map<string, number>;
  residentRadiusByCode?: Map<string, number>;
  roadviewByKey?: Map<string, { flowBlock: number | null; visibility: number | null }>;
};

/**
 * 후보지 한 곳의 실험실(구조식) 월매출 — 실험실 화면과 같은 조립(buildLabRows로 가맹점 관리 평균·축척을 잡고 buildLabCandidateRows로 후보지).
 * 기존점·경쟁점·입지평가는 **운영 자료**(결과 탭이 읽은 것), 고리·막힌 방향·반경 같은 실험실 전용 사실은 실험실 컬렉션에서 받는다.
 */
export function labCandidateRevenue(args: LabCandidateArgs): number | null {
  return labCandidateBreakdown(args)?.monthlyRevenue ?? null;
}

type LabCandidateArgs = {
  candidate: CandidateInput; preparedStores: ExistingStore[]; rawStores: ExistingStore[]; competitors: Competitor[]; locations: LocationEvaluation[];
  sales: ExistingStoreMonthlySales[]; settings: ModelSettings; qscByStoreCode?: Map<string, number>; extras?: LabExtras;
};

/** labCandidateRevenue와 같은 조립으로 매출·가동률을 같이 낸다(2026-09-26 — 범위 밖 검토 근거가 가동률을 쓴다). */
export function labCandidateBreakdown(args: LabCandidateArgs): { monthlyRevenue: number | null; utilization: number | null } | null {
  const { candidate, preparedStores, rawStores, competitors, locations, sales, settings, qscByStoreCode, extras } = args;
  const compsByCode = new Map<string, Competitor[]>();
  for (const c of competitors) compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  const rows = buildLabRows({
    stores: preparedStores, compsByCode, utilByStore: utilizationByStore(sales, rawStores), settings, qscByStoreCode,
    productUnitPriceByStore: productUnitPriceEraByStore(sales, rawStores),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    roadviewByKey: extras?.roadviewByKey as any, residentRingsByCode: extras?.residentRingsByCode, ringBlockedByCode: extras?.ringBlockedByCode, residentRadiusByCode: extras?.residentRadiusByCode,
  });
  if (!rows.length) return null;
  const P = fittedParams(DEFAULT_TEXTBOOK_PARAMS, scoreTextbook(rows, DEFAULT_TEXTBOOK_PARAMS));
  const [cand] = buildLabCandidateRows({
    candidates: [candidate], compsByCode, locByCode: new Map(locations.map((l) => [l.candidateCode, l])), settings,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    roadviewByKey: extras?.roadviewByKey as any, residentRingsByCode: extras?.residentRingsByCode, ringBlockedByCode: extras?.ringBlockedByCode, residentRadiusByCode: extras?.residentRadiusByCode,
    franchiseManagement: franchiseManagementFromRows(rows),
  });
  if (!cand) return null;
  const b = computeTextbook(cand.input, P);
  return { monthlyRevenue: b.monthlyRevenue ?? null, utilization: b.utilization ?? null };
}
