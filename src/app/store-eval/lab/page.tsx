"use client";

// 점포평가 실험실 — 교과서식 산식을 손으로 돌려보는 화면 (2026-09-15 신설)
//
// 사용자 방향: "지금 가맹점 데이터 기준값으로 하는 건 일단 현재 시점에서 두고, 산식을 또
// 만드는 구조로 하는 건데. 이걸 내가 보고 판단하려면 웹에 반영이 되어야 한다. 예를 들어
// 점포평가 test 버전 같은 페이지를 또 하나 만드는 거지."
// "이거 기존 웹에 탭 추가하는 거 아니고 페이지 따로 만드는 거지?" -> 그렇다. 별도 페이지다.
//
// ⚠️ **이 화면은 운영 산식을 건드리지 않는다.** 계산은 전부 textbookModel.ts(신규)로만 하고,
//    기존 calc.ts/usageRevenue.ts는 "지금 산식" 비교값을 얻는 데만 읽기로 쓴다.
//
// 왜 이 화면이 필요한가: 지금 산식은 MAPE 9.3%로 숫자는 좋지만 "기존 38곳 평균에서 ±"라는
// 설명밖에 못 한다. 교과서식(수요 -> 점유율 -> 매출)은 설명이 되지만 실측 MAPE가 30~46%다.
// 어느 쪽으로 갈지 사람이 보고 정하라고 만든 화면이다.
//
// ── 2026-09-16 두 가지가 바뀌었다 (사용자 방향) ────────────────────────────
//
// 1) **자료를 갈랐다.** 전까지 실험실은 운영 V62와 **같은 Firestore 문서**를 읽었다. 그래서
//    실험용으로 기초자료를 고치면 운영 예측이 조용히 따라 움직였다(2026-09-15 유동·주거인구
//    교체로 V62 MAPE가 9.37% -> 9.26%로 같이 변한 게 그 예다). 시설·사양까지 실험실에서
//    고칠 참이라 `storeEvalLab*` 전용 복제본으로 갈라놨다. 복사는 한 방향(운영->실험실)뿐이고
//    `scripts/syncLabCollections.mjs`를 **명시적으로 돌릴 때만** 일어난다.
//
// 2) **조절판을 없앴다.** 사용자: "슬라이드바 직접 조절하는 건 없애고 최신 데이터 기준으로
//    반영한 예상매출·가동률들 보고 싶다." 계수는 DEFAULT_TEXTBOOK_PARAMS에 고정돼 있고
//    화면은 읽기 전용으로 보여만 준다(ParamSummary). 계수를 바꾸는 건 코드 작업이다.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  summarizeValidationRows,
  computeCompetitorInvestigationSummary,
  type ValidationStoreInput,
} from "@/lib/storeEval/calc";
import { existingStoreSourceCode, prepareExistingStoresForEvaluation } from "@/lib/storeEval/existingStoreEvaluation";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import {
  getLabModelSettings, listLabCandidates, listLabCompetitors, listLabLocationEvaluations,
  listLabExistingStores, listLabRoadviewJudgments, listLabQscScores, listLabResidentRings, listLabTradeAreaJudgments, listEvaluationSales,
} from "@/lib/storeEval/store";
import { computeOverflowPcHours, runUsageCohortValidation } from "@/lib/storeEval/usageRevenue";
import {
  DEFAULT_TEXTBOOK_PARAMS, PC_USE_RATE_MALE, PC_USE_RATE_FEMALE, computeQualityScore,
  computeTextbook, fittedParams, scoreTextbook, rivalDistanceWeight,
  type FloatingRadius, type ResidentRadius,
  type TextbookInput, type TextbookParams, type TextbookScore,
} from "@/lib/storeEval/textbookModel";
// 2km 경쟁점 자료의 기준일·반경을 화면이 그대로 보여 준다 — 숫자를 글자로 박지 않는다.
import {
  RIVAL_2KM_BUILT_AT, RIVAL_2KM_OFFICIAL_RADIUS_M, RIVAL_2KM_OUTER_RADIUS_M,
} from "@/lib/storeEval/rival2km";
import type { Competitor, ModelSettings } from "@/lib/storeEval/types";

// 모델 입력 조립은 labInput.ts에 있다 — 측정 하네스와 **같은 코드**를 써야 한다.
// 화면에만 항목을 붙이다 하네스가 입지를 통째로 빠뜨린 적이 있다(2026-09-16).
import {
  buildLabRows, buildLabCandidateRows, franchiseManagementFromRows,
  utilizationByStore, type LabRow, type LabCandidateRow,
} from "@/lib/storeEval/labInput";
import { evaluationMonths } from "@/lib/storeEval/evaluationSalesPeriod";
import { FIRST_CLASS_ZONE_SEATS, LAB_ZONE_WEIGHTS } from "@/lib/storeEval/labZoneComposition";
import {
  LAB_PERF_ANCHOR_SCORE, LAB_PERF_LOG_STEP, LAB_PERF_LOG_STEP_UP,
  LAB_GEN_PENALTY, LAB_ANCHOR_GENERATION, LAB_CPU_GEN_PENALTY,
  LAB_MONITOR_HZ_STEP, LAB_MONITOR_HZ_STEP_UP, LAB_MONITOR_BONUS, LAB_SPEC_WEIGHTS,
} from "@/lib/storeEval/labSpecScore";

type Loaded = {
  rows: LabRow[];
  /**
   * 모델에서 빠진 매장(2026-09-18). **성적에 안 들어간다** — 같은 축척으로 예측만 내서
   * 참고로 보여준다. 빠진 이유가 산식 밖의 사정이라 섞으면 계수가 그 사정을 배운다.
   */
  excludedRows: LabRow[];
  /** 지금 운영 산식의 성적. 비교 기준선으로만 쓴다. */
  current: { mape: number | null; within10: number | null; within20: number | null; sampleCount: number } | null;
  /**
   * QSC(본사 점검) 적용 현황. **숫자를 글자로 박지 않고 여기서 읽어 그린다** — 자료가 늘면
   * 화면이 저절로 따라간다. 몇 곳이 실측이고 몇 곳이 평균인지 화면에 꼭 적어야 한다:
   * 안 적으면 "관리 3.51점"이 실측인지 기본값인지 사람이 구분 못 한다.
   */
  qsc: { measured: number; total: number; avg: number | null; min: number | null; max: number | null } | null;
  /**
   * 매장코드 -> {QSC 평균(개점 이후 전 기간), 그걸 환산한 관리 점수}. 매장 표에 그대로 그린다.
   * 없으면 그 매장은 QSC가 없어 가맹점 평균을 받은 것이다 — 화면에서 구분해 보여줘야
   * "실측 2.39점"과 "몰라서 평균 4.21점"을 사람이 헷갈리지 않는다.
   */
  qscByStore: Map<string, { qsc: number | null; management: number | null }>;
  /**
   * 매장코드 -> 평가창이 **얼마나 찼나** (2026-09-21).
   *
   * 실측 가동률은 평가창(개점 다음 달부터 12개월) 평균인데, 갓 연 매장은 몇 달치뿐이다.
   * 그 값은 12개월 완주 평균과 **같은 자가 아니고**, 달이 갈수록 움직인다. 송도점이 그 경우다
   * (2026-07 22% · 08 25%로 아직 오르는 중인데 2달 평균 23.5%를 실측으로 쓴다).
   * 사용자가 사정을 알고 넣으라고 했으므로, 숨기지 말고 **표에 티를 낸다.**
   */
  windowFillByStore: Map<string, { filled: number; total: number }>;
  /** 하드웨어 내부비중 — 화면 설명이 이 값을 읽어 그린다(숫자를 글자로 박지 않는다). */
  specWeights: ModelSettings["specWeights"];
  /**
   * 신규후보지 — 실험실 산식으로 돌릴 입력 한 벌 (2026-09-18).
   *
   * ⚠️ 여기엔 실매출이 없다. **채점이 아니라 예측**이고, 축척은 기존점에서 맞춘 것을
   *    그대로 받아 쓴다. 후보지로 축척을 다시 맞추면 예측으로 예측을 맞추는 순환이 된다.
   */
  candRows: LabCandidateRow[];
  /** 후보지에 들어간 관리 점수(= 가맹점 평균). 화면에 적어야 "실측인가 평균인가"가 구분된다. */
  franchiseManagement: number | null;
};

const pct = (v: number | null | undefined, digits = 1) =>
  v == null ? "-" : `${(v * 100).toFixed(digits)}%`;
const manwon = (v: number | null | undefined) =>
  v == null ? "-" : `${Math.round(v / 10000).toLocaleString()}만`;

async function loadLabData(): Promise<Loaded | null> {
  // ⚠️ **실험실 전용 복제본만 읽는다**(2026-09-16 사용자 방향). 운영 컬렉션을 읽으면
  //    실험실에서 시설·사양을 고칠 때 운영 V62가 같이 움직인다 — 갈라놓은 뜻이 없어진다.
  //    복제본은 scripts/syncLabCollections.mjs로 **명시적으로** 채운다(자동 동기화 없음).
  //    월매출만 운영 것을 그대로 읽는다 — 실측 사실이라 두 벌로 둘 이유가 없다.
  const [storedStores, settingsDoc, allCompetitors, allLocationEvaluations, roadviewByKey, qscByStoreCode, candidates, residentRingsByCode, ringBlockedByCode] = await Promise.all([
    listLabExistingStores(),
    getLabModelSettings(),
    listLabCompetitors(),
    listLabLocationEvaluations(),
    listLabRoadviewJudgments(),
    // QSC 점검 기록 -> 관리 점수(labInput.ts qscInWindowAverage + qscToManagementScore). 전용 컬렉션이라
    // 동기화가 안 건드리고, 운영 V62는 아예 읽지 않는다.
    listLabQscScores(),
    // 신규후보지 (2026-09-18). 경쟁점·입지평가는 위에서 이미 통째로 읽으므로 따로 안 읽는다 —
    // 후보지코드와 기존점코드는 안 겹쳐서 같은 맵에 담아도 된다.
    listLabCandidates(),
    // 1km 밖 고리 인구(2026-09-23). residentRingDecayM이 0이면 산식이 안 읽는다 — 값만 실어 둔다.
    listLabResidentRings(),
    // 막힌 상권 AI 판정(2026-09-23). useRingEnclosure가 꺼져 있으면 산식이 안 읽는다 — 값만 실어 둔다.
    listLabTradeAreaJudgments(),
  ]);
  if (storedStores.length === 0) return null;
  const sales = await listEvaluationSales(storedStores);
  const settings: ModelSettings = settingsDoc ?? { ...defaultModelSettings(), updatedAt: 0, updatedBy: null };
  const stores = prepareExistingStoresForEvaluation(storedStores, allCompetitors, allLocationEvaluations, settings);

  // 매장별 실측 월평균 가동률 — 하네스와 **같은 함수**를 쓴다(labInput.ts). 평가창을 무엇으로
  // 자르는지가 거기 한 곳에만 있다.
  const utilByStore = utilizationByStore(sales, storedStores);

  const compsByCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    compsByCode.set(c.candidateCode, [...(compsByCode.get(c.candidateCode) ?? []), c]);
  }
  const locByCode = new Map(allLocationEvaluations.map((l) => [l.candidateCode, l]));

  const validationInputs: ValidationStoreInput[] = [];
  for (const s of stores) {
    const code = existingStoreSourceCode(s);
    const cs = compsByCode.get(code) ?? [];
    const loc = locByCode.get(code) ?? null;

    // 지금 산식 비교용 입력 (validation 화면과 같은 형태)
    validationInputs.push({
      storeCode: s.storeCode, storeName: s.storeName, brand: s.brandType ?? loc?.brandType ?? null,
      openedAt: s.openedAt, completedMonths: s.completedMonths ?? 0, franchiseStatus: s.franchiseStatus,
      isPostOpenIssue: s.excludedFromModel, postOpenIssueReason: s.excludedReason,
      pcCount: s.pcCount, evaluationPcCount: s.evaluationPcCount, hourlyRate: s.hourlyRate,
      ownDemand: s.ownDemand, marketDemand: s.marketDemand, competitorIp: s.competitorIp,
      extraPcHours: computeOverflowPcHours(s.marketDemand, { pcCount: s.evaluationPcCount ?? s.pcCount, competitivenessScore: s.competitivenessScore }, cs, settings),
      competitivenessScore: s.competitivenessScore, competitivenessGap: s.competitivenessGap,
      actualRevenueAvg: s.actualMonthlyRevenueAvg, specialDemandType: s.specialDemandType,
      specialDemandIntensity: s.specialDemandIntensity, inflowRestriction: loc?.inflowRestriction ?? null,
      visibilityScore: loc?.visibilityScore ?? null, hasLocationEvaluation: loc != null,
      floor: s.floor, groundLevel: s.groundLevel, hasElevator: s.hasElevator,
      competitorSummary: computeCompetitorInvestigationSummary(cs), sheetV61Predicted: s.v61Predicted,
    });

  }

  // 모델 입력 조립은 labInput.ts 한 곳에만 있다 — 측정 하네스가 같은 함수를 부른다.
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, roadviewByKey, residentRingsByCode, ringBlockedByCode, qscByStoreCode });
  // 모델에서 빠진 매장(송도점·동탄북광장점 등) — 2026-09-18 사용자 요청으로 화면에만 띄운다.
  // ⚠️ `rows`와 절대 합치지 말 것. 합치면 축척과 계수가 가격전쟁·운영문제까지 배운다.
  // 2026-09-21 사용자 지시: *"검단사거리점은 아예 빼줘 표에서."*
  // **폐점 매장은 이 표의 대상이 아니다.** 이 표는 "그 사정이 없었다면 얼마"를 보는 자리인데,
  // 폐점은 사정이 아니라 매장이 없어진 것이다. 검단사거리점은 개점일조차 없어서 평가창이
  // 0달이고(가동률 5% · 0%로 두 달치뿐) 산식에는 애초에 못 들어간다 — 표에만 보이고 있었다.
  // ⚠️ 자료는 **안 지운다.** 기존점 목록·매출DB에는 그대로 남는다. 화면에서만 뺀다.
  const closedStoreCodes = new Set(
    stores.filter((s) => (s.franchiseStatus ?? "").includes("폐점")).map((s) => s.storeCode),
  );
  const excludedRows = buildLabRows({
    stores, compsByCode, utilByStore, settings, roadviewByKey, residentRingsByCode, ringBlockedByCode, qscByStoreCode, which: "excluded",
  }).filter((r) => !closedStoreCodes.has(r.input.storeCode));

  let current: Loaded["current"] = null;
  try {
    const { rows: vRows } = runUsageCohortValidation(validationInputs, sales, settings);
    const core = vRows.filter((r) => r.brand === "블랙라벨" && r.includedInCoreAccuracy);
    const sum = summarizeValidationRows(core, {
      mape: settings.targetMAE, medianAe: settings.targetMedianAE,
      within10: settings.target10pctRatio, within20: settings.target20pctRatio, maxBias: settings.maxAvgBias,
    });
    current = {
      mape: sum.meanAbsoluteErrorPct, within10: sum.within10PctRatio,
      within20: sum.within20PctRatio, sampleCount: sum.sampleCount,
    };
  } catch {
    current = null; // 비교값이 없어도 실험은 돌아가야 한다
  }

  // QSC 적용 현황 — 행에 실제로 들어간 관리 점수에서 읽는다. 별도로 다시 계산하면
  // 화면과 모델이 갈라진다(2026-09-17에 하네스가 그렇게 갈라졌다).
  const mgmts = rows.map((r) => r.input.ownQualityParts?.management ?? null).filter((v): v is number => v != null);
  const qsc = qscByStoreCode.size
    ? {
      measured: rows.filter((r) => qscByStoreCode.has(r.input.storeCode)).length,
      total: rows.length,
      avg: mgmts.length ? mgmts.reduce((a, b) => a + b, 0) / mgmts.length : null,
      min: mgmts.length ? Math.min(...mgmts) : null,
      max: mgmts.length ? Math.max(...mgmts) : null,
    }
    : null;
  // 매장별 QSC·관리 점수. 관리 점수는 **행에 실제로 들어간 값**을 읽는다 — 여기서 다시
  // 환산하면 화면과 모델이 갈라진다.
  const qscByStore = new Map(rows.map((r) => [r.input.storeCode, {
    qsc: qscByStoreCode.get(r.input.storeCode) ?? null,
    management: r.input.ownQualityParts?.management ?? null,
  }]));
  // ── 신규후보지 (2026-09-18) ────────────────────────────────────────────────
  // 조립은 labInput.ts 한 곳에 있다 — 하네스(_labCandidate.test.ts)가 **같은 함수**를 부른다.
  // 관리 점수는 기존점 행에 실제로 들어간 값의 평균을 그대로 넘긴다(여기서 다시 환산하지 않는다).
  // 평가창이 얼마나 찼나 — 실측 가동률을 만든 달 수를 그대로 센다(위 타입 주석).
  const windowFillByStore = new Map(stores.map((s) => {
    const w = evaluationMonths(s.openedAt);
    const filled = sales.filter((x) => x.storeCode === s.storeCode && w.includes(x.yearMonth)
      && (x.pcSales ?? 0) + (x.productSales ?? 0) > 0).length;
    return [s.storeCode, { filled, total: w.length }] as const;
  }));
  const franchiseManagement = franchiseManagementFromRows(rows);
  const candRows = buildLabCandidateRows({
    candidates, compsByCode, locByCode, settings, roadviewByKey, residentRingsByCode, ringBlockedByCode, franchiseManagement,
  });

  return { rows, excludedRows, current, qsc, qscByStore, windowFillByStore,
    specWeights: settings.specWeights, candRows, franchiseManagement };
}

export default function LabPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 조절판을 없앴다(2026-09-16 사용자 방향: "슬라이드바 직접 조절하는 건 없애고 최신 데이터
  // 기준으로 반영한 예상매출·가동률을 보고 싶다"). 계수는 코드에 고정하고, 바꿔야 하면
  // textbookModel.ts의 DEFAULT_TEXTBOOK_PARAMS에서 바꾼다 — 화면에 떠넘기지 않는다.
  const p: TextbookParams = { ...DEFAULT_TEXTBOOK_PARAMS };

  useEffect(() => {
    let alive = true;
    loadLabData()
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e: unknown) => { if (alive) { setError(e instanceof Error ? e.message : "불러오지 못했습니다."); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  // 반경별로 자료가 몇 곳이나 모였는지 — 반경 버튼 아래에 그대로 보여준다.
  const counts = useMemo(() => {
    const rs = data?.rows ?? [];
    const n = (r: FloatingRadius) => rs.filter((x) => x.input.floatingByRadius[r] != null).length;
    return { f100: n(100), f200: n(200), f300: n(300), f400: n(400), f500: n(500), total: rs.length };
  }, [data]);

  const score: TextbookScore | null = useMemo(
    () => (data?.rows.length ? scoreTextbook(data.rows, p) : null),
    [data, p],
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#171310] dark:text-[#f2ede2]">점포평가 실험실</h1>
          <p className="mt-1 text-sm text-[var(--sl-ink-soft)]">
            교과서식 산식(수요 → 점유율 → 매출)을 최신 자료로 돌린 결과입니다.
            <b className="text-[#171310] dark:text-[#f2ede2]"> 운영 산식과 저장값은 전혀 건드리지 않습니다.</b>
          </p>
        </div>
        <Link href="/store-eval" className="app-btn-outline shrink-0 rounded-lg px-4 py-2 text-sm">← 점포평가</Link>
      </div>

      <div className="app-notice mt-4 rounded-xl px-4 py-3 text-xs leading-relaxed">
        지금 운영 산식은 기존 가맹점 실적에 회귀로 맞춥니다. 숫자는 좋지만 &ldquo;왜 이 금액인가&rdquo;를
        설명할 때 <b>&ldquo;기존 가맹점 평균에서 조정했다&rdquo;</b>밖에 말할 수 없습니다.
        여기 교과서식은 <b>&ldquo;이 동네 수요가 얼마고 그중 우리가 몇 %를 가져간다&rdquo;</b>로 설명됩니다.
        대신 정확도가 떨어집니다 — 그 맞바꿈이 할 만한지 보시라고 만든 화면입니다.
        <span className="mt-1 block">
          이 화면이 읽는 자료는 <b>운영과 따로 관리되는 실험실 전용 복제본</b>입니다. 여기서 무엇을 고쳐도
          운영 점포평가 숫자는 바뀌지 않습니다. 운영 쪽 최신 자료를 당겨오는 건 별도 작업입니다.
        </span>
      </div>

      {loading && <p className="mt-8 text-sm text-[var(--sl-ink-soft)]">불러오는 중...</p>}
      {error && <p className="mt-8 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {score && data && (
        <>
          <ScoreBoard score={score} current={data.current} p={p} />
          <HowItWorks p={p} fitted={score.fittedHoursPerUser} productUnitPrice={score.fittedProductUnitPrice}
            scaledOnUtilization={score.scaledOnUtilization} qsc={data.qsc} specWeights={data.specWeights} />
          <ParamSummary p={p} counts={counts} />
          <StoreTable score={score} qscByStore={data.qscByStore} p={p} windowFill={data.windowFillByStore} />
          <ExcludedTable rows={data.excludedRows} p={fittedParams(p, score)} />
          <CandidateTable rows={data.candRows} p={fittedParams(p, score)}
            franchiseManagement={data.franchiseManagement} existingCount={score.sampleCount}
            actualUtilRange={(() => {
              // 기존점 **실측** 가동률의 범위. 후보지 예측이 이 밖이면 외삽 경고를 띄운다.
              // ⚠️ 예측이 아니라 실측이어야 한다 — 예측 범위로 재면 "산식이 벌린 만큼"이
              //    기준이 돼서 경고가 영영 안 뜬다(자기 자신을 기준 삼는 순환).
              const v = data.rows
                .map((r) => r.input.actualUtilization)
                .filter((x): x is number => x != null && x > 0);
              return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null;
            })()} />
          <RivalRecognition
            groups={[
              ...data.rows.map((r) => ({ kind: "기존점" as const, input: r.input })),
              ...data.candRows.map((r) => ({ kind: "후보지" as const, input: r.input })),
            ]}
            p={fittedParams(p, score)}
          />
        </>
      )}
    </div>
  );
}

function ScoreBoard({ score, current, p }: { score: TextbookScore; current: Loaded["current"]; p: TextbookParams }) {
  const cells: { label: string; lab: string; now: string; better?: boolean }[] = [
    { label: "MAPE (평균오차)", lab: pct(score.mape), now: pct(current?.mape), better: score.mape != null && current?.mape != null && score.mape < current.mape },
    { label: "±10% 적중", lab: pct(score.within10), now: pct(current?.within10), better: score.within10 != null && current?.within10 != null && score.within10 > current.within10 },
    { label: "±20% 적중", lab: pct(score.within20), now: pct(current?.within20), better: score.within20 != null && current?.within20 != null && score.within20 > current.within20 },
    { label: "최악 오차", lab: pct(score.maxAbsErr), now: "-" },
  ];
  return (
    <div className="mt-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="app-card rounded-xl p-4">
            <p className="text-xs text-[var(--sl-ink-soft)]">{c.label}</p>
            <p className={`mt-1 text-2xl font-bold ${c.better ? "text-emerald-600 dark:text-emerald-400" : "text-[#171310] dark:text-[#f2ede2]"}`}>{c.lab}</p>
            <p className="mt-0.5 text-[11px] text-[var(--sl-ink-soft)]">지금 산식 {c.now}</p>
          </div>
        ))}
      </div>
      {score.requiredShare && (
        <div className="mt-3 rounded-xl border border-amber-400/40 bg-amber-50/60 p-4 dark:border-amber-300/20 dark:bg-amber-400/10">
          <p className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
            필요 점유율 — 이 매장들이 실제로 먹은 몫
          </p>
          <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
            실측가동률 ÷ (점유율 항을 끈 예측 가동률). 수요식이 맞다면 0~100% 안에 들고
            경쟁이 셀수록 낮아야 합니다. <b>100%를 넘으면 그 동네 수요를 과소평가한 것</b>입니다.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
            {([
              ["중앙", pct(score.requiredShare.median)],
              ["최소", pct(score.requiredShare.min)],
              ["최대", pct(score.requiredShare.max)],
              ["100% 초과", `${score.requiredShare.overOne}곳 / ${score.requiredShare.count}곳`],
            ] as const).map(([k, v]) => (
              <div key={k}>
                <p className="text-xs text-[var(--sl-ink-soft)]">{k}</p>
                <p className={`text-lg font-bold ${k === "100% 초과" && score.requiredShare!.overOne > 0 ? "text-red-600 dark:text-red-400" : "text-[#171310] dark:text-[#f2ede2]"}`}>{v}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-[var(--sl-ink-soft)]">
        표본 {score.sampleCount}곳 · 목표 MAPE 10%(마지노선 20%) ·
        1인당 월이용시간 {score.fittedHoursPerUser.toFixed(2)}시간
        {p.hoursPerUserFixed ? <> ← <b>가맹점 원장 실측</b>(안 맞춥니다)</> : <> ← 독점 실측가동률에서 역산</>} ·
        상품몫 {Math.round(score.fittedProductUnitPrice).toLocaleString()}원/PC·시간
        {p.productUnitPriceFixed ? <> ← <b>직접 측정으로 못 박은 값</b>(안 맞춥니다)</> : <> ← 실측으로 매번 맞춥니다</>}.
        {score.utilizationMape != null && (
          <> 가동률 자체의 오차는 {pct(score.utilizationMape)}입니다(실측 있는 {score.utilizationSampleCount}곳)
          — 매출 오차와 따로 봐야 어느 층이 틀렸는지 갈립니다.</>
        )}
      </p>
    </div>
  );
}

/**
 * 계산기준 — 지금 수요를 어떻게 재는지 화면에 적어 둔다 (2026-09-16 사용자 요청:
 * "혹시 내가 까먹을 수도 있음 이후 작업하면서").
 *
 * ⚠️ **숫자를 글자로 박지 않는다.** 전부 `p`(현재 파라미터)와 `fitted`(맞춰진 축척)에서 읽어
 *    그린다 — 위 조절판을 움직이면 이 설명도 같이 바뀐다. 계산만 바꾸고 설명을 두면 화면이
 *    조용히 거짓말을 한다(CLAUDE.md 규칙, docs/backlog.md 2026-09-14 블록).
 */
function HowItWorks({ p, fitted, productUnitPrice, scaledOnUtilization, qsc, specWeights }: {
  p: TextbookParams; fitted: number; productUnitPrice: number; scaledOnUtilization: boolean;
  /** QSC 적용 현황. 숫자를 글자로 박지 않고 여기서 읽어 그린다. */
  qsc: Loaded["qsc"];
  /** 하드웨어 내부비중. 사양 설명이 이 값을 읽어 그린다. */
  specWeights: Loaded["specWeights"];
}) {
  // PC몫은 정가에서 나온다 — 기준정가 x (정가/기준정가)^β. 운영 산식 effectiveHourlyRate와 같은 식이다.
  const pcAt = (rate: number) => p.referenceHourlyRate * Math.pow(rate / p.referenceHourlyRate, p.rateElasticity);
  const MONTH_HOURS = 24 * 30;
  // 축척 계수를 사람이 읽을 수 있는 말로 바꾼다: "환산수요 N명당 PC 1대".
  const perPc = fitted > 0 ? Math.round(MONTH_HOURS / fitted / MONTH_HOURS * MONTH_HOURS / fitted) : null;
  const usersPerPc = fitted > 0 ? Math.round(1 / (fitted / MONTH_HOURS)) : null;
  void perPc;
  const male = PC_USE_RATE_MALE;
  const female = PC_USE_RATE_FEMALE;
  const pct = (v: number) => Math.round(v * 1000);
  return (
    <details className="app-card mt-4 rounded-xl px-4 py-3 text-xs leading-relaxed" open>
      <summary className="cursor-pointer text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
        계산기준 — 지금 수요를 어떻게 재고 있나
      </summary>

      <ol className="mt-3 space-y-3 text-[var(--sl-ink-soft)]">
        <li>
          <b className="text-[#171310] dark:text-[#f2ede2]">1. 인구를 &ldquo;PC방 이용자&rdquo;로 환산한다</b>
          <div className="mt-1">
            연령대마다 PC방 이용률이 다르고, 남녀는 약 3배 차이 납니다. 그래서 인구를 그대로 쓰지 않고
            이용률을 곱해 환산합니다.
          </div>
          <table className="mt-2 text-[11px]">
            <thead className="text-[var(--sl-ink-soft)]">
              <tr><th className="pr-4 text-left font-normal">1,000명당</th><th className="pr-4 text-right font-normal">남성</th><th className="text-right font-normal">여성</th></tr>
            </thead>
            <tbody>
              {([["10대", "age10s"], ["20대", "age20s"], ["30대", "age30s"], ["40대", "age40s"], ["50대", "age50s"]] as const).map(([label, key]) => (
                <tr key={key}>
                  <td className="pr-4">{label}</td>
                  <td className="pr-4 text-right tabular-nums">{pct(male[key])}명</td>
                  <td className="text-right tabular-nums">{pct(female[key])}명</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1">
            지역 남성비율로 남녀 이용률을 섞습니다. <b>성별×연령 교차 자료는 존재하지 않아서</b>
            (SGIS·소상공인365 둘 다 성별 총수와 연령 총수를 따로 줍니다) &ldquo;연령대 안의 성비 =
            지역 전체 성비&rdquo;로 근사합니다.
          </div>
        </li>

        <li>
          <b className="text-[#171310] dark:text-[#f2ede2]">2. 주거를 기본으로, 유동을 보태 수요를 만든다</b>
          <div className="mt-1 font-mono text-[11px]">
            수요 = 환산(주거 {p.residentRadius === 1000 ? "1km" : `${p.residentRadius}m`})
            {p.residentRingDecayM > 0 ? ` + Σ 고리 × e^(−(r−1000)/${p.residentRingDecayM})` : ""}
            {" + "}환산(유동 {p.floatingRadius}m) × {p.floatingFactor}
          </div>
          <div className="mt-1">
            <b>1km 밖 고리</b> — {p.residentRingDecayM > 0
              ? <>켜져 있습니다(λ={p.residentRingDecayM}m). 1~1.5km · 1.5~2km · 2~5km 고리 인구를 연령가중해 더하되, 멀수록
                덜 셉니다(1.25km 고리 무게 {Math.exp(-250 / p.residentRingDecayM).toFixed(2)} · 1.75km {Math.exp(-750 / p.residentRingDecayM).toFixed(2)}
                {" "}· 3.5km {Math.exp(-2500 / p.residentRingDecayM).toFixed(2)}). 고리 인구가 없는 매장은 &ldquo;자료없음&rdquo;으로 1km만 셉니다.
                {" "}고리 사람의 점유율은 {p.residentRingShare === "gravity"
                  ? <><b>&ldquo;우리와 그 근처 PC방 중 가까운 쪽으로 간다&rdquo;</b>로 띠마다 따로 구합니다 — 우리에서 d 떨어진
                    경쟁점이 반경 r 고리 주민 중 우리보다 가까운 비율 arccos(d÷2r)÷π를 그 경쟁점 무게로 씁니다(기하라 맞춘 계수가 없습니다).</>
                  : <><b>1km 안과 같은 점유율</b>을 씁니다. ⚠️ 그러면 1~2km 사람은 세면서 그 곁의 PC방은 경쟁으로 안 세게 되어
                    밀집 도심이 부풉니다(2026-09-23 측정: 발산역 +23 · 수원망포 +21%p). &ldquo;가까운 쪽으로&rdquo; 방식을 재고 표로 비교 중입니다.</>}</>
              : <>꺼져 있습니다. 2026-09-23에 θ 1.75·존구성 0.06과 묶음으로 켰다가(λ800·gravity·항아리) <b>2026-09-24에
                되돌렸습니다</b>. 후보지 13곳에서 새 배선이 평균 +4.8%p, 9곳 3%p↑, 내린 곳 0 — 경쟁점 1~2곳인 자리(호구포역 상한
                55% · 오송 +11 · 영월)에서 고리 수요가 점유율에 안 눌리고 그대로 통과했습니다. 실측 수요 잣대(14동네)도 λ0 1.14배
                vs λ800 0.58배로 고리가 수요를 실측 하한 위로 밀었습니다. 자사 40곳 성적은 옛/새 같았습니다(라벨 4곳 빼면 5.68 vs
                5.56%p, 2SE 1.94). 치른 값: 경쟁점 편향 −2 → −11%p · 자사우위 1.65 → 3.5배(실측 1.74). 1km·유동 {p.floatingRadius}m는
                전대상대(전대후문과 배후지를 나눠 쓰는데 사람은 후문에 몰림)·수원망포(500m쯤 역 유동이 딸려 들어옴)에서 좁혀 잡은
                값입니다. 재고 표 `_labCandidate.test.ts` (8) · `_bundleCandidate.test.ts`.</>}
          </div>
          <div className="mt-1">
            <b>특수수요 배수</b> — 군부대·대학가는 <b>인구 통계에 안 잡히는 이용자</b>를
            데려옵니다. 그래서 입지 보정이 아니라 <b>수요 산식 안에서</b> 곱합니다.
            {" "}지금 값: {Object.entries(p.specialDemandMultipliers)
              .filter(([k, v]) => v !== 1 && k !== "관광유흥")
              .map(([k, v]) => `${k} ×${v}`).join(" · ") || "전부 1.0"}.
          </div>
          <div className="mt-1 rounded border border-[var(--sl-line)] p-2">
            <div className="font-semibold">{p.specialDemandMultipliers["대학가"] === 1
              ? "⛔ 2026-09-24 — 대학가·산업단지 배수를 다시 껐습니다(1km 밖 고리와 같이 되돌림)"
              : "✅ 2026-09-23 저녁 — 대학가·산업단지를 다시 켜고 군부대를 내렸습니다"}</div>
            <div className="mt-1">
              지금 값: 대학가 <b>×{p.specialDemandMultipliers["대학가"]}</b> · 산업단지 <b>×{p.specialDemandMultipliers["산업단지"]}</b> ·
              군부대 <b>×{p.specialDemandMultipliers["군부대"]}</b>.
              {p.specialDemandMultipliers["대학가"] === 1 && <> 09-23 값(대학가 1.3·산업단지 1.4·군부대 2.0)은 고리 λ800 배선에서
                고른 것이라 고리를 끄면 근거가 같이 사라집니다(호구포역 상한 55%의 절반이 산업단지 1.4였습니다). 옛 배선에 배수만
                켜면 자사 MAE 5.84→5.22%p로 보이지만 2SE(1.4) 안이고 바깥 표본 근거가 없어 같이 껐습니다. 아래는 09-23 기록입니다.</>}
              {" "}껐던 이유(축척을 독점 3곳에서 맞추던 순환)는 2026-09-21에
              축척을 원장 실측으로 고정하면서 사라졌습니다. 이번엔 <b>그 동네 경쟁점 핑봇(바깥 표본)</b>을 같이 봤습니다 —
              대학가 동네는 우리 매장 5곳(−8.9%p)도 경쟁점 5곳(−3.3%p)도 과소예측돼 있었습니다. 우리만 그랬다면 점유율
              문제지만 경쟁점도 같으면 그 동네 <b>수요</b>가 작게 잡힌 것입니다. 값은 두 편향의 합이 최소인 곳입니다.
              ⚠️ 산업단지(우리 2곳·경쟁점 1곳)·군부대(2곳·2곳)는 표본이 작아 <b>값이 아니라 방향</b>입니다.
            </div>
          </div>
          <div className="mt-1 rounded border border-[var(--sl-line)] p-2">
            <div className="font-semibold">산업단지·기타는 2026-09-20 낮에, 대학가는 그날 밤에 껐습니다 (기록)</div>
            <div className="mt-1">
              1차 값(2026-09-16)은 <b>산업단지 ×1.39 · 기타 ×1.25</b>였는데, <b>순환에 오염돼</b>
              있었습니다. 그때 수요의 크기(축척)는 <b>독점 매장 3곳</b>에서 맞췄는데 그 3곳이
              탕정역(산업단지)·남악(기타)·광주각화(없음)입니다 — <b>두 유형이 자기 자신을 재는 자를
              부풀리고</b> 있었습니다.
            </div>
            <div className="mt-1">
              배수를 켜면 축척이 6.796 → 5.653으로 내려가, 배수가 <b>없는 22곳은 가만히 있는데 수요가
              16.8% 줄었습니다.</b> 그리고 &ldquo;전체 수요를 다 먹어도 실매출에 못 미치는&rdquo; 6곳이
              <b> 전부 &lsquo;없음&rsquo; 유형</b>이었습니다 — 제일 모자란 쪽에서 걷어다 특수수요 쪽에
              얹어 주고 있었던 것입니다.
            </div>
            <div className="mt-1 font-mono text-[11px]">
              자를 바로잡고 다시 측정 — 군부대 2.22(1차 2.25) · 대학가 1.45(1.45) ·
              <b> 산업단지 1.08(1.39) · 기타 0.94(1.25)</b>
            </div>
            <div className="mt-1">
              ※ 2026-09-21에 축척을 <b>원장 실측으로 못 박으면서</b> 이 순환 경로 자체가 없어졌습니다
              (축척이 더는 독점 3곳에서 안 옵니다). 다만 배수를 끈 판단은 그대로 둡니다 —
              당시 근거가 순환 하나만은 아니었습니다.
              <br />
              이때는 군부대·대학가를 <b>진짜 신호</b>로 보고 남겼고, 산업단지·기타만 껐습니다.
              끄고 나니 기준점 3곳이 전부 배수 1.00이 되어
              <b> 예외 규칙 없이 순환이 끊깁니다</b> — 기준점 벌어짐 1.416배 → <b>1.019배</b>,
              전체 수요 초과 매장 6곳 → <b>4곳</b>, 광주각화점 121% → <b>101%</b>.
            </div>
            <div className="mt-1">
              ⚠️ <b>성적으로 고른 값이 아닙니다.</b> 표본 안 오차는 21.59% → 22.08%로 오히려
              나빠집니다. 다만 <b>안 본 매장으로 재면 22.17% → 22.16%로 같습니다</b> — 1차 값의
              이득은 표본 안에서만 있던 과적합이었습니다.
            </div>
          </div>
          <div className="mt-1 rounded border border-[var(--sl-line)] p-2">
            <div className="font-semibold">대학가도 1.00으로 껐습니다 (2026-09-20 밤, 3차)</div>
            <div className="mt-1">
              2차에서는 <b>경쟁을 무시한 필요 점유율</b> 기준이라 1.45가 살아남았는데,
              <b> 경쟁 항까지 넣고 보면 달라집니다.</b> 근거 셋이 같은 곳을 가리켰습니다.
            </div>
            <div className="mt-1">
              <b>① 대학가는 방학에 안 뜁니다</b> — 여기가 결정적입니다. 월별 가동률로 재면
              방학(1·2·7·8월) ÷ 학기월이 <b>없음 1.178 · 군부대 1.260 · 대학가 1.019</b>입니다.
              일반 상권은 방학에 18% 뛰는데(중고생이 동네에 있습니다) 대학가는 안 뜁니다 —
              대학생이 고향으로 가기 때문입니다. 우리가 맞히는 건 <b>연평균</b>이라, 대학가는
              연평균 수요가 남들보다 <b>낮아야</b> 맞습니다. 그런데 배수를 <b>올려서</b> 주고
              있었습니다.
            </div>
            <div className="mt-1">
              <b>② 경쟁까지 넣은 함축배수가 1.03입니다.</b> 매장별로 역산하면 부경대 0.854 ·
              전대상대 1.024 · 전대후문 1.034 · 울산대 1.227 · 청주대 1.276 — <b>1.45는 다섯 곳 중
              아무에게도 안 맞습니다.</b> 대학가 5곳은 전부 &lsquo;경쟁 과소&rsquo;라, 1.45는 수요
              배수인 척하면서 실은 <b>경쟁 항의 오차를 대신 받던 값</b>이었습니다.
            </div>
            <div className="mt-1">
              <b>③ 교차검증이 1.45를 한 번도 안 골랐습니다</b> — 38겹 중 30겹이 1.1, 7겹이 1.0입니다.
            </div>
            <div className="mt-1 font-mono text-[11px]">
              안 본 매장 기준: 오차 22.16% → <b>19.02%</b> · ±20% 58% → <b>63%</b> ·
              ±30% 71% → <b>79%</b> · 최악 70.2% → <b>54.7%</b>
            </div>
            <div className="mt-1">
              📌 <b>&ldquo;오차 범위가 너무 크다&rdquo;에 직접 듣는 유일한 손잡이였습니다.</b> 나머지
              열한 개는 한 칸씩 훑어도 −0.8%p 이하이고, 다 같이 맞추면 안 본 매장에서 오히려
              나빠집니다(24.16%) — 38곳으로 손잡이 12개는 과적합입니다.
            </div>
            <div className="mt-1">
              ⚠️ <b>이것도 성적으로 고른 값이 아닙니다.</b> 근거는 ①의 계절 패턴과 ②의
              함축배수이고, 오차율은 확인일 뿐입니다. 표본이 늘면 ②를 다시 재야 합니다.
            </div>
            <div className="mt-1">
              ⚠️ 이제 1이 아닌 배수는 <b>군부대 2.25 하나뿐</b>입니다. <b>표본이 2곳이라 방향만
              믿습니다.</b> 그리고 유형마다 한 값을 곱하는데 <b>같은 군부대라도 규모가 다릅니다</b> —
              병력·종사자 수 자료가 생기면 곱셈이 아니라 <b>덧셈</b>이 맞습니다. (재학생 수로
              덧셈을 해 보니 <b>부호가 반대</b>로 나와 대학가에서는 안 통했습니다.)
            </div>
          </div>
          <div className="mt-1">
            유동 계수 <b>{p.floatingFactor}</b>는 <b>측정값이 아니라 보정상수</b>입니다. 한 숫자가 셋을
            떠맡습니다 — 단위 변환(주거는 &ldquo;명&rdquo;, 유동은 &ldquo;하루 통행량&rdquo;), 중복 제거(거주자 통행이
            양쪽에 두 번 세어짐), 방문객의 낮은 이용 성향. 그래서 <b>&ldquo;유동인구의
            {" "}{Math.round(p.floatingFactor * 100)}%가 수요&rdquo;라고 읽으면 안 됩니다.</b>
          </div>
        </li>

        <li>
          <b className="text-[#171310] dark:text-[#f2ede2]">3. 수요를 경쟁과 나눠 가동률을 낸다</b>
          {p.shareMode === "off" ? (
            <>
              <div className="mt-1 font-mono text-[11px]">
                가동률 = 수요 ÷ 자사PC &nbsp;&nbsp;(점유율 = 100%, <b>경쟁 항을 들어낸 상태</b>)
              </div>
              <div className="mt-1">
                지금은 점유율 환산을 <b>꺼 두었습니다.</b> 2026-09-16 점검에서 지금 환산이 실측
                점유율을 아무것도 설명하지 못한다는 게 드러났습니다 — 경쟁력격차 r=0.025 ·
                사양 −0.062 · 입지 0.075~0.220으로 전부 유의선 0.371 미달이고, 수준도 안 맞습니다
                (자사PC÷(자사PC+경쟁IP) 중앙 0.186 vs 실측 0.519).
              </div>
              <div className="mt-1">
                그래서 <b>경쟁을 0으로 놓고 시작</b>합니다. 아래 표의 <b>필요 점유율</b>이 각 매장이
                실제로 먹은 몫이고, 그 값으로 <b>수요식을 2차 검증</b>합니다. 100%를 넘는 매장은
                그 동네 수요를 과소평가했다는 뜻입니다.
              </div>
            </>
          ) : p.shareMode === "quality" ? (
            <>
              <div className="mt-1 font-mono text-[11px]">
                점유율 = 자사PC ÷ (자사PC + Σ 경쟁PC × (경쟁품질÷자사품질)<sup>{p.qualityExponent}</sup>
                {p.rivalDistanceDecay ? " × 거리무게" : <sub>[{p.effectiveRadiusM}m 안]</sub>})
                {p.outsideOptionIp > 0 ? ` + 안가는몫 ${p.outsideOptionIp}` : ""}
              </div>
              {p.rivalDistanceDecay ? (
                <div className="mt-1">
                  거리무게는 <b>{p.rivalDistanceDecay.plateauM}m 안이면 1</b>,
                  그 밖은 <b>exp(−(거리−{p.rivalDistanceDecay.plateauM})÷{p.rivalDistanceDecay.scaleM})</b>로
                  줄어듭니다(전체 ×{(p.rivalDistanceDecay.weightFactor ?? 1).toFixed(4)}).
                  평지 안에서는 거리가 아니라 <b>품질이 가릅니다</b> — 실무 의견이고 자료도 그쪽입니다.
                  평지 밖은 경계에 <b>절벽이 없습니다</b>(“401m는 어쩔 건가” 문제가 구조적으로 사라집니다).
                  <b> 값은 가동률 오차의 평균·폭을 같이 보고 골랐습니다</b>(2026-09-21).
                </div>
              ) : (
                <div className="mt-1">
                  <b>유효거리 {p.effectiveRadiusM}m 안</b>에 있는 경쟁점만 진짜 경쟁자로 셉니다. 그 안에서는
                  거리가 아니라 <b>품질이 가릅니다</b> — 실무 의견이고 자료도 그쪽입니다(지수 감쇠는
                  r=0.510, 계단은 0.560).
                </div>
              )}
              <div className="mt-1 rounded border border-[var(--sl-line)] p-2">
                <div className="font-semibold">
                  🆕 2km 경쟁점을 셉니다 (2026-09-22 채택 · 자료 {RIVAL_2KM_BUILT_AT.slice(0, 10)})
                </div>
                <div className="mt-1">
                  공식 경쟁점 DB는 <b>{RIVAL_2KM_OFFICIAL_RADIUS_M}m까지 사람이 조사</b>한 것입니다.
                  그 밖은 아무것도 안 세고 있었고, 그게 예측이 평균 <b>+3.28%p 높던</b> 원인이었습니다.
                  지금은 <b>{RIVAL_2KM_OUTER_RADIUS_M}m까지</b> 셉니다.
                </div>
                <div className="mt-1">
                  <b>어디에 있나</b>는 카카오 장소로 봅니다(오락실·성인PC방은 상호로 거릅니다).
                  <b> 그때 영업했나</b>는 공공데이터 인허가의 개업일·폐업일로 봅니다 — 지도는
                  &ldquo;지금&rdquo;만 알고 산식은 <b>평가창 당시</b>가 필요하기 때문입니다.
                  창 중간에 문을 닫았으면 <b>그 달 수만큼만</b> 셉니다.
                </div>
                <div className="mt-1 text-[var(--sl-ink-soft)]">
                  얻은 것: 평균오차 7.72 → <b>6.26%p</b> · 최악 24.07 → <b>17.68%p</b> ·
                  편향 +3.28 → <b>−0.63%p</b> · ±5%p 15 → 19곳 · 퍼짐 1.76 → 1.46배 ·
                  동네 수요를 통째로 먹는다고 나오던 매장 3 → <b>0곳</b>.
                  <b> 고른 계수는 하나도 없습니다.</b>
                </div>
                <div className="mt-1 text-[var(--sl-ink-soft)]">
                  ⚠️ <b>경쟁점 대수는 아직 모릅니다</b> — 500m 안 미조사 경쟁점과 같은 기본대수를
                  씁니다. 인허가에도 지도에도 대수가 없고, 2026-09-22에 하루 종일 파고도 못 풀었습니다.
                  ⚠️ 후보지는 평가창이 없어(개점 전) <b>지금 영업 중인 곳만</b> 셉니다.
                </div>
              </div>
              <div className="mt-1">
                품질 지수 <b>{p.qualityExponent}</b>{p.qualityExponent === 3
                  ? <>는 자사 40곳 안에서 고른 값입니다. 2026-09-23에 1.75로 내렸다가(존구성 0.06·고리 λ800과 묶음) <b>2026-09-24에
                    3으로 되돌렸습니다</b> — 묶음이 후보지를 한결같이 올렸기 때문입니다(위 1km 밖 고리 설명). 알려진 약점은 그대로입니다:
                    경쟁점 핑봇 47곳을 바깥 표본으로 세우면 자사우위를 3.50배로 예측하고 실측은 1.74배(1년차 자사 vs 성숙 경쟁점)입니다.
                    θ 혼자 내리면 자사·경쟁점이 같이 −10%p 과소예측되므로 수요를 같이 키워야 하는데, 그 수요 확대가 후보지에서 틀렸습니다.</>
                  : <>는 2026-09-23에 3에서 내린 값입니다. 3은 자사 40곳
                    안에서 고른 값이었는데, 경쟁점 핑봇 47곳을 바깥 표본으로 세우자 자사우위를 3.50배로 예측했고
                    실측은 1.74배(1년차 자사 vs 성숙 경쟁점)였습니다. <b>존구성 비중 {p.qualityWeights.zone}·1km 밖 고리
                    λ{p.residentRingDecayM}m와 한 묶음</b>입니다 — θ 혼자 내리면 자사·경쟁점이 같이 −10%p 과소예측됩니다.</>}
                (옛 근거: 매출 변화폭 역산 2.74~4.92·중앙 3.25 — 감각은 매출액, 측정은 가동률로 경로가 달랐습니다.)
              </div>
              <div className="mt-1">
                ⚠️ 이 항이 잘하는 건 <b>순서</b>지 오차 크기가 아닙니다. 실측 점유율과의 상관이
                0.223(상수배율) → <b>0.560</b>으로 오르지만, MAPE는 31.9% → 30.5%로 거의 안 줍니다.
                실측 점유율에 수요식 오차가 섞여 있어서입니다. 그래서 <b>{p.effectiveRadiusM}m는 잠정값</b>
                입니다 — 300·400·500m가 MAPE로 구별되지 않습니다.
              </div>
            </>
          ) : (
            <>
              <div className="mt-1 font-mono text-[11px]">
                가동률 = 수요 × 격차<sup>{p.gapExponent}</sup> ÷ (자사PC × 격차<sup>{p.gapExponent}</sup> + 경쟁IP)
                {p.outsideOptionIp > 0 ? ` + 안가는몫 ${p.outsideOptionIp}` : ""}
              </div>
              <div className="mt-1">
                <b>기각된 구조입니다(비교용).</b> 지수 <b>{p.gapExponent}</b>는 원래 <b>쏠림</b>을
                뜻하려던 값인데, 2026-09-16 검정에서 <b>쏠림이 아니라 수준 보정</b>이라는 게
                드러났습니다 — 격차를 아예 빼고 상수 배율 4만 써도 점유율 MAPE가 32.6%로 격차^4의
                32.0%와 같습니다. 홀드아웃에서도 무너집니다(표본 안 29.08% → LOO 36.20%,
                무작위 대조군 p=0.072). 격차와 실측 점유율의 상관은 <b>r=0.025</b>입니다.
              </div>
            </>
          )}
          {p.shareMode !== "off" && (() => {
            const on = ([
              // 중심도는 2026-09-20부터 **잔차화**해서 들어갑니다(아래 설명 참고).
              [p.centralityResidual ? "잔차화 중심도" : "상권 중심도", p.locationExponents.centrality, "자료"],
              ["접근성(층수)", p.locationExponents.access, "자료"],
              ["유동 방향", p.locationExponents.direction, "보류"],
              ["동선 방해", p.locationExponents.flowBlock, "보류"],
              ["간판·출입구", p.locationExponents.visibility, "보류"],
            ] as [string, number, string][]).filter(([, v]) => v !== 0);
            return (
              <div className="mt-2">
                <div className="font-mono text-[11px]">
                  점유율 × {on.length ? on.map(([n, v]) => `(${n}÷기준)^${v}`).join(" × ") : "1 (입지 항이 전부 꺼져 있습니다)"}
                </div>
                <div className="mt-1">
                  입지는 <b>경쟁력점수 안이 아니라 밖</b>에서 점유율에 곱합니다. 6층 매장은 경쟁점이 없어도
                  덜 오기 때문입니다 — 손님이 경쟁점으로 가는 게 아니라 <b>아예 안 옵니다.</b> 그래서
                  나눗셈이 아니라 곱셈입니다.
                  {on.length > 0 && <> 지금 켜진 항목은 <b>{on.map(([n, , l]) => `${n}[${l}]`).join(" · ")}</b>입니다.</>}
                </div>
                {p.centralityResidual && p.locationExponents.centrality !== 0 && (
                  <div className="mt-2 rounded border border-[var(--sl-line)] p-2">
                    <div className="font-semibold">중심도는 &quot;동네 규모&quot;를 걷어내고 씁니다 (2026-09-20)</div>
                    <div className="mt-1 font-mono text-[11px]">
                      잔차화 중심도 = 기준 × (중심도 ÷ {p.centralityResidual.geoMeanCentrality})
                      × ({p.centralityResidual.geoMeanFloating400.toLocaleString()} ÷ 유동400m)^{p.centralityResidual.slope}
                    </div>
                    <div className="mt-1">
                      중심도가 뜻하려던 것은 <b>&quot;같은 규모의 동네끼리 비교했을 때 우리가 상권 중심이냐 끝이냐&quot;</b>입니다.
                      그런데 날값에는 <b>동네 규모 자체가 섞여</b> 있었습니다 — 수요식이 쓰는 유동400m와 상관이 0.599라,
                      수요에서 이미 센 것을 점유율에서 <b>한 번 더</b> 곱하고 있었습니다.
                      유동400m 몫을 회귀로 걷어내니 겹침이 <b>0.599 → −0.154</b>로 사라집니다.
                    </div>
                    <div className="mt-1">
                      정직한 홀드아웃(축척과 기울기까지 훈련겹에서만 맞춤, 38곳)에서
                      <b> 손 안 댄 중심도 ν=0.25의 24.40%가 잔차화 ν=0.5에서 22.12%</b>로 좋아졌습니다
                      (2026-09-20 오후 기준 · 같은 날 특수수요 배수를 고치면서 기준선이 옮겨졌습니다).
                      무작위 대조군 200회도 통과했습니다(p=0.005).
                    </div>
                    <div className="mt-1">
                      ⚠️ 위 상수 셋은 <b>기존점 38곳에서 적합한 정규화</b>입니다(MAPE로 고른 자유계수가 아니라
                      회귀 기울기와 기하평균입니다). <b>표본이 늘면 다시 적합해야 합니다.</b>
                      유동400m가 없는 곳은 중심도 항을 <b>통째로 뺍니다</b> — 날값으로 되돌리지 않습니다.
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          {qsc && (
            <div className="mt-3 rounded border border-[var(--sl-line)] p-2">
              <div className="font-semibold">관리 점수는 QSC(본사 점검)에서 나옵니다</div>
              <div className="mt-1 font-mono text-[11px]">
                관리 점수 = 1 + (QSC − 60) × 0.1 &nbsp;&nbsp;(1~5로 자름 · QSC 100점 = 5점 · 60점 이하 = 1점)
              </div>
              <div className="mt-1">
                <b>개점 이후 전 기간</b> 점검의 평균을 씁니다. <b>0점 기록과 &quot;오픈 매장 점검&quot;은 뺍니다</b> —
                앞은 미실시·입력오류입니다.
              </div>
              <div className="mt-1">
                뒤(오픈 매장 점검)를 빼는 이유는 <b>천장 효과</b>입니다. 전체 6건 중 <b>4건이 만점 100</b>이라
                (야당·일산탄현·발산역·문산) <b>변별이 0인 자</b>입니다. 평균에 넣으면 그 매장만 점수를
                올려 줍니다. 낮은 2건은 전부 송도점이고 그중 0점은 이미 빠지므로, 살아남는 건
                <b> 송도 50점 하나뿐</b>입니다 — 한 매장으로 규칙을 세울 수는 없습니다.
              </div>
              <div className="mt-1">
                📌 사용자 관점(2026-09-20): <b>&ldquo;오픈매장점검은 아주 기본적인 것만 보고, 오픈 초기라
                일부 항목은 당연히 됐다고 보고 하는 거라 다른 QSC와 수준이 많이 다르다. 낮은 매장은 진짜
                문제가 있는 것이고, 높은 매장은 원래 높게 나오는 느낌&rdquo;</b>입니다. 그렇다면 낮은 점수는
                <b> 점수가 아니라 &lsquo;점검해 볼 곳&rsquo; 표시</b>로 쓰는 것이 맞습니다 — 평균에 섞으면
                천장 효과 때문에 자가 휩니다. (송도는 사흘 전 일반 QSC가 95점이라, 지금 자료로는 두 자가
                다른 것을 재는지 진짜 문제인지 못 가릅니다. 송도는 <b>검증 제외 매장</b>이라 성적에는 영향이 없습니다.)
              </div>
              <div className="mt-1">
                처음엔 매출 평가창과 같은 12개월로 잘랐는데, <b>QSC 점검이 연 1~2회라 12개월 창에 안 걸리는
                매장이 7곳</b>이었습니다(청주터미널점은 제일 이른 점검이 개점 13개월째라 한 달 차이로 빠졌습니다).
                창을 넓혀 재보니 12개월만 유독 나빴습니다 — 실측 매장 29 → 35곳, MAPE 22.28% → 22.02%.
                점검 <b>1건으로 판정하던 매장이 8곳에서 4곳</b>으로 줄어드는 게 더 큰 이득입니다.
                ⚠️ 대신 시점 통일을 포기한 것이라, 2026년 점검으로 2024년 매출을 설명하게 됩니다
                (QSC ↔ 개점시점 r=0.158로 코호트 교란이 거의 없어 감수했습니다).
              </div>
              <div className="mt-1">
                바닥 60은 <b>[감각] 계수</b>입니다. 매출 오차는 좋아지고(23.15% → 22.28%) 홀드아웃도
                안정적이지만(벌어짐 0.24%p · 훈련겹이 35/38회 이 값을 고름), <b>무작위 대조군은 못 넘습니다</b>
                (p=0.075). 점유율 단계에서는 넘는데(p=0.040) 매출까지 오면 수요식·단가 오차에 묻힙니다.
                그래서 자료가 아니라 <b>뜻으로 정한 값</b>입니다 — 표본이 늘면 다시 잽니다.
              </div>
              <div className="mt-1">
                지금 <b>{qsc.total}곳 중 {qsc.measured}곳</b>이 실제 점검 점수로 계산되고,
                나머지 {qsc.total - qsc.measured}곳은 <b>가맹점 평균</b>이 들어갑니다.
                {qsc.avg != null && qsc.min != null && qsc.max != null && (
                  <> 관리 점수는 <b>{qsc.min.toFixed(2)} ~ {qsc.max.toFixed(2)}</b>,
                    평균 <b>{qsc.avg.toFixed(2)}</b>입니다(종전에는 전 매장 4.00 고정이었습니다).</>
                )}
              </div>
              <div className="mt-1 text-[var(--sl-ink-soft)]">
                ⚠️ <b>후보지에는 가맹점 평균이 들어갑니다</b> — 안 연 매장은 점검을 받을 수 없기 때문입니다.
                그래서 이 항목은 <b>후보지 예상매출을 바꾸지 않습니다.</b> 기존점이 왜 빗나갔는지를
                설명하는 항목입니다. 운영 산식(V62)의 관리 점수는 4.00 고정 그대로입니다.
              </div>
            </div>
          )}
          <div className="mt-3 rounded border border-[var(--sl-line)] p-2">
            <div className="font-semibold">존구성은 <b>존 이름이 아니라 룸</b>으로 셉니다</div>
            <div className="mt-1 font-mono text-[11px]">
              존구성 = 룸종류점수 × {LAB_ZONE_WEIGHTS.diversity} + 특화좌석점수 × {LAB_ZONE_WEIGHTS.capacity}
            </div>
            <div className="mt-1">
              운영 산식은 <b>존 이름 8가지 중 몇 개를 갖고 있나</b>로 다양성을 셉니다. 그런데 그 이름표가
              한쪽에만 있습니다 — <b>VIP존·프렌즈존·퍼스트클래스존은 자사 29·19·19곳인데 경쟁점은 228건 전부 0건</b>입니다.
              우리 브랜드 용어라 조사자가 경쟁점의 같은 실체(파티션 1인석·유리파티션 다인석)를 보고도
              그 칸에 안 넣기 때문입니다. 자사에는 &quot;일반 2인석&quot; 칸이 아예 없어 우리 2인석은 전부 커플존으로
              들어갑니다. 그래서 <b>종류를 세면 자사가 항상 이깁니다.</b>
            </div>
            <div className="mt-1">
              그래서 실험실은 <b>벽으로 막힌 룸만</b> 셉니다(1인룸 · 2인룸 · 팀룸). 룸은 정의가 명확하고
              — 벽과 문이 있나 없나입니다 — 자사·경쟁점 양쪽 다 조사돼 있습니다. 파티션 높이나 재질
              판단이 안 들어갑니다. <b>개방석은 모든 PC방에 있어</b> 칸으로 세면 상수라, 개방형 이름표는
              <b> 좌석으로만</b> 들어갑니다(이름과 무관하게 실재하는 좌석은 전부 셉니다).
            </div>
            <div className="mt-1">
              <b>퍼스트클래스존은 팀룸과 한 칸</b>입니다 — 룸이고 10~12석이 들어가므로 같은 것입니다
              (좌석은 {FIRST_CLASS_ZONE_SEATS}석으로 셉니다). 고급 인테리어와 비싼 요금은 인테리어 항목과 단가가
              이미 보는 것이라 여기서 또 세면 이중계산이고, <b>수요가 없어 접은 존에 다양성 가점을 주는 것</b>도
              현실과 반대입니다.
            </div>
            <div className="mt-1">
              비중을 {LAB_ZONE_WEIGHTS.diversity} / {LAB_ZONE_WEIGHTS.capacity}로 둔 것은 룸만 세면 다양성이
              거의 <b>&quot;팀룸 있나 없나&quot;의 이진</b>이 되기 때문입니다. 거의 이진인 값에 무게를 싣는 것보다
              &quot;특화좌석이 얼마나 되냐&quot;가 더 많은 것을 담습니다.
            </div>
            <div className="mt-1 text-[var(--sl-ink-soft)]">
              ⚠️ <b>존구성에는 매장별 순서 정보가 없습니다</b>(무작위 대조군 MAPE p=0.455 · r p=0.066).
              값을 상수로 바꿔치기해도 성적이 안 떨어지고, 계단을 펴 값을 9개에서 40개로 늘려도 r이 0.002
              움직입니다. 그래서 이 변경은 <b>정확도가 아니라 뜻을 고친 것</b>입니다 —
              &quot;왜 우리가 이기는가&quot;의 답이 이름표여서는 안 되기 때문입니다.
              2026-09-17 측정: MAPE 22.02% → 22.60%. 운영 산식(V62)의 존구성은 그대로입니다.
            </div>
            <div className="mt-1 text-[var(--sl-ink-soft)]">
              {p.qualityWeights.zone === 0.238
                ? <>⛔ <b>존구성 비중 {p.qualityWeights.zone} — 2026-09-23에 0.06으로 줄였다가 2026-09-24에 되돌렸습니다.</b>
                  {" "}θ 3·고리 꺼짐과 한 묶음입니다(1km 밖 고리 설명). 알려진 약점은 남습니다: 자사 존구성 평균 3.19 vs 경쟁점
                  1.39로 2.3배인데 실측 자사우위는 1.74배라, 이 비중이면 우리 몫이 3.50배로 부풀어 보입니다. 09-23 격자에서 비중을
                  남길수록 순서(자사 r·짝 r)는 좋아졌고, 사전 기준 1위는 0.06이었습니다.</>
                : <>✅ <b>2026-09-23 — 경쟁력점수 안 존구성 비중을 0.238 → {p.qualityWeights.zone}로 줄였습니다(항목은 남깁니다).</b>
                  {" "}자사 존구성 평균 3.19 vs 경쟁점 1.39로 2.3배인데 실측 자사우위는 1.74배라, 옛 비중이면 우리 몫이
                  3.50배로 부풀었습니다. 비중 0~0.238을 돌리자 남길수록 순서(자사 r·짝 r)는 좋아지고 세게 두면 우위를
                  부풀려, 사전 기준 1위가 {p.qualityWeights.zone}이었습니다. θ {p.qualityExponent}·1km 밖 고리와 한 묶음입니다.
                  &quot;빼는 게 정답&quot;은 아닙니다 — 팀룸 유입 기전은 살아 있습니다.</>}
            </div>
          </div>
          <div className="mt-3 rounded border border-[var(--sl-line)] p-2">
            <div className="font-semibold">사양은 <b>성능 + 세대</b>로 셉니다 (GPU · CPU · 모니터)</div>
            <div className="mt-1 font-mono text-[11px]">
              GPU점수 = {LAB_PERF_ANCHOR_SCORE} + ln(성능지수/100) / 기울기 − {LAB_GEN_PENALTY} × ({LAB_ANCHOR_GENERATION} − 세대)
              <br />
              기울기 = 앵커 아래 {LAB_PERF_LOG_STEP} · 앵커 위 {LAB_PERF_LOG_STEP_UP}
              &nbsp;&nbsp;(RTX 5060 = 성능 100 · 5세대 = {LAB_PERF_ANCHOR_SCORE.toFixed(2)}점)
            </div>
            <div className="mt-1">
              운영 산식은 <b>세대 하나당 1점</b>입니다. 세대 숫자는 출시 연도지 성능이 아니라서, 같은 세대 안의
              티어 차이가 세대 하나보다 클 때 서열이 뒤집힙니다. 실제로 조사 자료에 이런 자리가 있었습니다 —
              <b> RTX 3060 Ti가 2.25점으로 RTX 4060(3.00점)보다 낮고</b>(23건), RTX 3070은 2.50점(12건),
              RTX 4070은 3.50점으로 RTX 5060(4.00점)보다 낮았습니다(9건).
            </div>
            <div className="mt-1">
              눈금은 <b>기존 사다리를 그대로 잇습니다.</b> RTX 5060 / 4060 / 3060 / 2060 = 4 / 3 / 2 / 1점이
              한 칸당 성능 ×0.83에 해당해서, 그 기울기({LAB_PERF_LOG_STEP})를 모델 전체로 넓혔을 뿐입니다.
            </div>
            <div className="mt-1">
              <b>성능만 보면 &quot;구형이라도 빠르면 장땡&quot;이 됩니다.</b> PC방에선 그렇지 않습니다 — 같은 성능이라도
              구형은 노후·고장, 신작 게임의 최신 기능 지원, 손님이 사양표에서 받는 인상에서 불리합니다.
              그래서 <b>세대 벌점 {LAB_GEN_PENALTY}점</b>을 한 세대마다 뺍니다. 앵커(RTX 50) 위쪽 기울기도
              따로 {LAB_PERF_LOG_STEP_UP}로 완만하게 뒀습니다 — RTX 5060이면 롤·오버워치·배그가 다 돌아가서
              그 위로는 손님 체감이 포화하기 때문입니다.
            </div>
            <div className="mt-1">
              둘을 같이 써야 풀립니다. 위 기울기 없이 세대 벌점만 주면 <b>RTX 3080이 벌점 0.30에서도 5.00에
              그대로 붙어 있습니다</b>(식으로 5.05가 나와 잘림). 둘을 같이 쓰면 RTX 3080 = <b>4.37점</b>으로
              신형 RTX 5060 Ti와 같은 자리가 되고, RTX 4070(4.43)이 한 세대 최신이라 한 끗 위에 섭니다.
            </div>
            <div className="mt-1">
              <b>CPU도 같은 구조를 씁니다</b>(세대 벌점은 {LAB_CPU_GEN_PENALTY}). 운영은 세대만 보고
              티어를 아예 안 봐서 <b>i3 13100F가 i5 13400F와 같은 3.00점</b>이었습니다(자사 9곳).
              새 표에서는 2.61 대 3.53으로 갈립니다. i7 12700F도 2.00 → 3.92로 제자리를 찾습니다.
            </div>
            <div className="mt-1">
              ⚠️ <b>CPU는 무작위 대조군을 못 넘었습니다</b>(p=0.213). 그래도 켠 이유는
              <b> 영향력과 서술은 다른 것</b>이기 때문입니다 — 매출에 얼마나 미치는지는 <b>비중</b>(하드웨어의
              {" "}{Math.round(LAB_SPEC_WEIGHTS.cpu * 100)}%)이 담당하고, 하드웨어가 실제로 다른지는
              <b> 변환표</b>가 담당합니다. 대조군은 영향력을 재는 도구라, 비중이 작은 항목이 못 넘는 건 당연합니다.
              경로도 있습니다 — 손님이 사양표를 몰라도 <b>프레임·버벅임은 느끼고</b>, 세대별 성능 우위는
              일반 고객도 아는 정보입니다.
            </div>
            <div className="mt-1">
              <b>모니터도 같은 구조입니다</b> — 앵커는 자사 표준 <b>240Hz = 4.00</b>,
              기울기는 아래 {LAB_MONITOR_HZ_STEP} · 위 {LAB_MONITOR_HZ_STEP_UP}입니다. 예전 운영은 구간표였는데
              경계가 실제 값 바로 위에 걸려 <b>140Hz(2.00)와 144Hz(3.00)가 1점 갈렸고</b>,
              4K·OLED는 Hz를 무시하고 5점 고정이었습니다(4K 60Hz도 만점).
              ✅ <b>2026-09-19에 이 잣대가 운영 V62로 넘어갔습니다</b> — 지금은 운영도 같은 식을 씁니다.
            </div>
            <div className="mt-1">
              모니터는 GPU처럼 성능 지표가 하나로 안 나오니 <b>원가·프리미엄 등급</b>을 대리지표로 씁니다:
              OLED +{LAB_MONITOR_BONUS.oled} · 4K +{LAB_MONITOR_BONUS.uhd4k} ·
              BenQ ZOWIE +{LAB_MONITOR_BONUS.zowie} · BenQ 일반 +{LAB_MONITOR_BONUS.benq} ·
              정품 게이밍 브랜드 +{LAB_MONITOR_BONUS.gamingBrand} ·
              울트라와이드 +{LAB_MONITOR_BONUS.ultrawide} · QHD +{LAB_MONITOR_BONUS.qhd.toFixed(2)}.
              한 칸에 여러 모델이 적힌 14건은 <b>낱개로 쪼개 각각 채점한 뒤 평균</b>냅니다 — 예전 운영처럼
              Hz를 먼저 평균내면 해상도·브랜드 가산이 뒤섞입니다(이 파싱 교정도 2026-09-19에 운영으로 넘어갔습니다).
            </div>
            <div className="mt-1">
              ⭐ <b>QHD +{LAB_MONITOR_BONUS.qhd.toFixed(2)}는 사용자가 준 등가점에서 역산한 값입니다.</b>
              &quot;32인치 FHD 240Hz(기본)와 27인치 QHD 165Hz는 사실 비슷하다&quot;는 판단을 그대로 식에 넣으면,
              QHD 가산이 <b>165Hz의 Hz 손실(−0.73)을 정확히 상쇄</b>해야 합니다. 그래서 27인치 QHD 165Hz가
              딱 4.00이 되어 기본과 같아집니다. 덕분에 <b>34인치 울트라와이드는 4.30</b>으로 특화 자격이
              생기고, 기본과 진짜 동급인 것(27인치 FHD 240Hz 무명)만 제외됩니다 — 자사 특화 제외가
              74개에서 <b>19개</b>로 줄었습니다.
            </div>
            <div className="mt-1 text-[var(--sl-ink-soft)]">
              ⚠️ <b>WQHD = QHD</b>(2560×1440)이고 <b>WWQHD가 울트라와이드</b>(3440×1440)입니다. 세로 픽셀이
              같으니 해상도 가산은 같고, 울트라와이드는 <b>시야(21:9)</b>를 따로 더합니다.
              울트라와이드 가산을 더 키우지 않은 이유는 <b>요금 프리미엄이 VIP존과 붙어 있어</b>
              모니터만의 몫을 가를 수 없기 때문입니다 — 요금은 단가가, 좌석은 존구성이 이미 봅니다.
              모니터도 대조군은 못 넘었습니다(p=0.293) — CPU와 같이 <b>서술을 고친 것</b>입니다.
              2026-09-18 측정: MAPE 22.85% → 22.70% · r 0.585 → 0.587 · 중앙 14.5% → 13.9%.
            </div>
            <div className="mt-1">
              <b>하드웨어 내부비중도 실험실 전용으로 갈랐습니다</b> — GPU {LAB_SPEC_WEIGHTS.vga} ·
              모니터 {LAB_SPEC_WEIGHTS.monitor} · CPU {LAB_SPEC_WEIGHTS.cpu} · RAM {LAB_SPEC_WEIGHTS.ram}
              (운영은 0.40 / 0.25 / 0.20 / 0.15 그대로). 오늘 자료를 전수로 보니
              <b> 자료가 제일 약한 모니터가 두 번째로 큰 비중</b>을 갖고 있었습니다(경쟁점 32% 빈칸 ·
              조사자 편차 · 자사는 240Hz 상수). 기여도도 같은 방향입니다 — GPU를 빼면 r이 0.587 → 0.562로
              떨어지는데 모니터를 빼면 오히려 0.592로 올라갑니다.
              ⚠️ 훑기에서는 GPU 0.55~0.60이 더 좋았지만 <b>거기까지 안 갔습니다</b> — 자료에 맞추면
              실험실 취지에 어긋납니다. 0.50은 뜻으로 고른 값입니다.
            </div>
            <div className="mt-1">
              <b>듀얼모니터 보조 화면은 모니터 채점에서 뺍니다.</b> 10인치 60Hz라 1.29점이 나오는데 그건
              품질이 나쁜 게 아니라 보조 화면이라 작은 것입니다. 그리고 <b>듀얼 좌석의 프리미엄은
              존구성이 이미 셉니다</b> — 조사 필드 정의가 &quot;1인석 = 칸막이·듀얼모니터만 있는 개방형
              좌석&quot;이라 특화좌석에 들어갑니다. 하드웨어에서 또 주면 이중계산입니다.
            </div>
            <div className="mt-1">
              <b>RAM은 안 바꿨습니다.</b> 16GB↔32GB 격차는 늘릴수록 단조롭게 나빠지고(1.0에서 22.76% ·
              2.0에서 23.05%) 지우는 쪽도 r이 0.002만 움직입니다. 다만 <b>&quot;차이가 없다&quot;가 아니라
              &quot;자료가 못 본다&quot;</b>입니다 — 16GB로 버벅이는 게임이 실재하는데(아이온2 등), 평가창이
              끝나는 해가 2024년 12곳 · 2025년 13곳이라 <b>38곳 중 25곳이 그 게임들 이전</b>입니다.
              운영과 같은 0.5로 둡니다.
            </div>
            <div className="mt-1 text-[var(--sl-ink-soft)]">
              ⚠️ <b>성능지수·세대벌점은 [감각] 계수입니다</b> — 공개 벤치마크 통념에서 온 근사치라 이 저장소
              자료로 검증할 수 없습니다. 대신 <b>무작위 대조군을 넘었습니다</b>: 점수 변화폭은 그대로 두고 어느
              모델에 붙는지만 300회 뒤섞으면 r 개선이 중앙 −0.002 · 95퍼센타일 0.014인데 실제 표는
              <b> +0.018(p=0.013)</b>입니다.
              2026-09-18 측정: MAPE 22.60% → 22.59% · r 0.563 → 0.581 · 중앙 15.4% → 14.8% ·
              ±20% 58% → 61% · 최대오차 76% → 62%. 운영 산식(V62)의 사양 점수는 그대로입니다.
            </div>
          </div>
          {/* 2026-09-21 — 눈금 보정을 채택하고도 화면이 이 단계를 아예 말하지 않고 있었다.
              숫자는 전부 p에서 읽는다(글자로 박지 않는다). */}
          {!p.indexCalibration && (
            <div className="mt-2 rounded border border-[var(--sl-line)] p-2">
              <div className="font-semibold">⛔ 여기 있던 &ldquo;눈금 보정&rdquo;은 껐습니다 (2026-09-21 밤)</div>
              <div className="mt-1">
                날 산식은 매장 간 차이를 실측의 <b>약 2배로 벌립니다.</b> 그래서 하루 동안 예측을
                가운데로 당기는 지수 보정을 켜 뒀는데, <b>그건 기전이 아니라 출력을 누르는 보정</b>이라
                껐습니다. 누르면 <b>어디서 넓어지는지가 안 보입니다.</b>
              </div>
              <div className="mt-1">
                그 보정이 삼키던 <b>수준 오차</b>는 하루 동안 아래 점유율 식의 &ldquo;안 가는 몫&rdquo;
                20대가 받고 있었는데, <b>2026-09-22에 그것도 뺐습니다</b>(지금 {p.outsideOptionIp}대).
                점 3개에 맞춘 값이었고, 정체가 상수가 아니라 <b>아직 안 세고 있는 반경 밖 경쟁점</b>이기
                때문입니다 — 500m 밖 2km 안에 남악 6곳 · 탕정역 3곳 · 광주각화 27건(미판정)이 있습니다.
              </div>
              <div className="mt-1">
                그 자리가 <b>2026-09-22 밤에 채워졌습니다</b> — 상수가 아니라 <b>진짜 2km 경쟁점</b>으로요.
                빼고 나서 드러났던 수준 오차 +3.28%p가 <b>−0.63%p</b>가 됐고, 동네 수요를 통째로
                먹는다고 나오던 매장 3곳도 <b>0곳</b>이 됐습니다. 상수 하나로는 못 하는 일이었습니다
                (상수는 전 매장을 똑같이 누르는데, 경쟁점은 매장마다 다르게 깎습니다).
              </div>
              <div className="mt-1 text-[var(--sl-ink-soft)]">
                치른 값은 적지 않습니다: 가동률 평균오차 4.18 → <b>6.52%p</b> · ±5%p 24 → 18곳 ·
                매출 MAPE 16.2 → <b>24.6%</b>. 실험실 산식은 <b>운영에 안 들어갑니다</b>
                (결재 숫자는 V62) — 그래서 성적을 주고 정직한 형태를 샀습니다.
                되살리려면 <code>indexCalibration</code>의 지수를 1에서 내리면 됩니다.
              </div>
            </div>
          )}
          {p.indexCalibration && (
            <div className="mt-2 rounded border border-[var(--sl-line)] p-2">
              <div className="font-semibold">그 다음 — 눈금을 실측에 맞춰 다시 새깁니다</div>
              <div className="mt-1 font-mono text-[11px]">
                가동률 = {p.indexCalibration.referenceUtilization}<sup>(1−{p.indexCalibration.ratioExponent})</sup>
                {" "}× (수요 × 점유율 ÷ 용량)<sup>{p.indexCalibration.ratioExponent}</sup>
              </div>
              <div className="mt-1">
                수요도 총공급도 <b>우리가 만든 지수</b>입니다 — 총공급은 경쟁점 PC에 품질비를
                {" "}{p.qualityExponent}제곱해 더한 값이라 실측할 방법이 없고, 매장 간 차이를 과장합니다.
                그래서 예측 전체를 <b>닻 {pct(p.indexCalibration.referenceUtilization)}</b>(기존점 실측
                가동률의 기하평균) 쪽으로 당깁니다. 닻에서는 안 움직이고, 그보다 낮게 나온 건 올리고
                높게 나온 건 내립니다. <b>매장마다 맞추는 게 아니라 전 매장 같은 곡선 하나</b>입니다.
              </div>
              <div className="mt-1">
                지수 <b>{p.indexCalibration.ratioExponent}</b>는 <b>자료가 고른 값이 아니라 용도로 고른
                값</b>입니다 — 자료는 이 값을 못 고릅니다(중첩 교차검증이 훈련평균과 같습니다).
                낮출수록 평균 오차가 줄고, 높일수록 매장 간 차이를 크게 말합니다.
                2026-09-21 저녁에 <b>0.327 → 0.45</b>로 올렸습니다: 가동률·매출의 <b>최악 오차가
                둘 다 줄고</b>(13.2→11.9%p · 56.9→51.8%) 후보지 간격이 1.62→2.03배로 돌아옵니다.
                대신 평균 오차가 가동률 0.35%p·매출 1.07%p 늘어납니다.
              </div>
              <div className="mt-1 text-[var(--sl-ink-soft)]">
                입지는 지수 <b>{p.indexCalibration.locationExponent}</b>로 점유율에 곱합니다
                (식에는 {p.indexCalibration.locationExponent}÷{p.indexCalibration.ratioExponent}로 넣고
                뒤에서 전체를 {p.indexCalibration.ratioExponent}제곱하므로 최종 지수가
                {" "}{p.indexCalibration.locationExponent}가 됩니다).
                ⚠️ 이 보정은 <b>순위를 거의 안 바꿉니다</b> — 바뀌는 건 간격입니다.
              </div>
            </div>
          )}
          <div className="mt-1">
            가동률 상한은 <b>{Math.round(p.maxUtilization * 100)}%</b>입니다
            (실측 월평균 최대가 46.5%, 월 최대의 최대가 52.0%).
          </div>
        </li>

        <li>
          <b className="text-[#171310] dark:text-[#f2ede2]">4. 가동률을 매출로 바꾼다</b>
          <div className="mt-1 font-mono text-[11px]">
            매출 = 자사PC × 720시간 × 가동률 × <b>PC 1대·1시간당 매출</b>
          </div>
          <div className="mt-1 font-mono text-[11px]">
            PC 1대·1시간당 매출 = <b>PC몫</b> + <b>상품몫</b>
          </div>
          <div className="mt-1 font-mono text-[11px]">
            PC몫   = {p.referenceHourlyRate}원 × (정가 ÷ {p.referenceHourlyRate})<sup>{p.rateElasticity}</sup>
            <br />상품몫 = {Math.round(productUnitPrice).toLocaleString()}원 (정가와 무관)
          </div>
          <div className="mt-1">
            손님 1명이 쓰는 돈(객단가)이 아니라 <b>PC 1대가 1시간 채워졌을 때 들어오는 총액</b>입니다.
            실측 32곳 중앙이 2,778원(PC몫 1,366 + 상품몫 1,456)입니다.
            건별 원장으로도 확인했습니다 — 광주첨단 2,682원 · 발산역 2,984원.
          </div>
          <div className="mt-1">
            <b>정가는 PC몫에만 들어갑니다.</b> 라면 값은 PC요금을 따라가지 않기 때문입니다.
            2026-09-16까지는 총단가 전체에 곱해서, 정가를 80% 올리면 총단가가 38% 오르는 것으로
            계산했습니다(지금 구조에서는 17%).
          </div>
          <div className="mt-1">
            지수 <b>{p.rateElasticity}</b>는 <b>정가를 올려도 그만큼 다 받지는 못한다</b>는 뜻입니다 —
            좌석 추가과금은 더해지지만 정액권 할인이 빼는데, 비싼 요금일수록 할인 비중이 큽니다.
            건별 원장 실측: 정액권 손님은 시간당 296~663원으로 <b>정가의 1/3</b>만 내고, 그 시간
            비중이 매장마다 2.1~9.1%입니다. 이 지수는 그 평균을 한 숫자로 담은 것입니다.
            {" "}정가 1,000원이면 PC몫 {Math.round(pcAt(1000)).toLocaleString()}원,
            1,700원이면 {Math.round(pcAt(1700)).toLocaleString()}원입니다.
            {" "}운영 산식(<code>usageRevenue.ts</code> <code>effectiveHourlyRate</code>)과 <b>같은 식</b>입니다.
          </div>
          <div className="mt-1">
            상품몫은 <b>후보지에서 예측할 방법이 아직 없습니다.</b> 2026-09-21에 후보지에서 아는
            변수 20개를 다시 훑었는데, 유의선(±0.41)을 넘은 건 <b>유동인구 하나</b>였고
            (500m r=0.434) 그마저 <b>홀드아웃에서 상수를 못 이깁니다</b>(LOO 189 vs 204원,
            95% 구간이 0을 품습니다). 뜻은 통하니 갈래를 닫지는 않고, 표본 45~50곳에서 다시 잽니다.
            {" "}그래서 전 매장 같은 값 하나를 씁니다. 상품매출 비율은 <b>파라미터가 아니라 결과</b>입니다.
          </div>
          <div className="mt-1">
            {p.productUnitPriceFixed ? (
              <>
                ⭐ 그 값은 <b>한 번 재서 못 박았습니다</b>(2026-09-21). 그전에는 표본 평균으로
                <b> 매번 다시 맞췄는데</b>, 그러면 매장을 하나 넣고 빼는 것만으로 산식이 움직입니다.
                {" "}출처도 바꿨습니다 — 전에는 &ldquo;총매출 − 정가로 만든 PC몫&rdquo;이라는 <b>잔차</b>였고,
                지금은 매출DB의 <b>상품매출을 직접</b> 잰 값입니다. 평균은 같지만(둘 다 1,493원)
                퍼짐이 다릅니다: 직접 SD 242원 vs 잔차 SD <b>328원</b>. 그 차이는 먹거리 차이가 아니라
                <b> PC요금 모형이 틀린 만큼</b>이 상품몫으로 흘러든 것입니다.
              </>
            ) : (
              <>⚠️ 지금은 그 값을 <b>표본 평균으로 매번 다시 맞추고</b> 있습니다 — 표본이 바뀌면 값도 바뀝니다.</>
            )}
          </div>
        </li>

        <li>
          <b className="text-[#171310] dark:text-[#f2ede2]">축척은 둘이고, 각각 실측값에서 옵니다</b>
          <div className="mt-1">
            층마다 실측값이 따로 있으니(가동률은 매출DB, 매출도 매출DB) 축척도 따로 둡니다.
            하나로 겸하게 하면 매출 환산이 틀린 만큼이 <b>가동률로 되밀려 들어갑니다</b> —
            2026-09-16까지 그랬고, 그래서 독점 3곳 가동률이 −3.2~−5.3% 어긋나 보였습니다.
          </div>
          <div className="mt-1">
            ① 1인당 월이용시간 <b>{fitted.toFixed(3)}시간</b>
            {p.hoursPerUserFixed ? (
              <> ← <b>가맹점 건별 매출원장 실측</b>입니다(2026-09-21부터). 자료에 맞추는 게 아니라
              <b> 못 박은 값</b>이라, 여기서 남는 어긋남이 곧 &ldquo;수요 추정이 몇 배 틀렸나&rdquo;가 됩니다.
              원장 8곳 중 <b>오픈 1년 안 4곳</b>의 평균입니다 — 1년 넘은 매장은 1인당 시간이
              1.41배로 늘어(단골 축적) 평가창과 시점이 안 맞아 뺐습니다.</>
            ) : (
              <> ← 독점매장 <b>실측 가동률</b>에서 역산한 값입니다(2026-09-21 이전 방식).</>
            )}
            {usersPerPc != null && <> (환산수요 <b>{usersPerPc.toLocaleString()}명</b>이 PC 1대를 100% 채우는 셈)</>}
          </div>
          <div className="mt-1">
            ② 상품몫 <b>{Math.round(productUnitPrice).toLocaleString()}원</b>
            {p.productUnitPriceFixed
              ? <> ← 기존점 <b>상품매출 직접 측정</b>(2026-09-21). 자료에 맞추는 게 아니라 <b>못 박은 값</b>입니다</>
              : <> ← 전 매장 <b>실매출</b>에서 매번 맞춥니다</>}
            {" "}(PC몫은 정가에서 바로 나오므로 맞출 게 없습니다)
          </div>
          {!scaledOnUtilization && (
            <div className="mt-1 text-[var(--sl-warn,#b4530a)]">
              ⚠ 실측 가동률이 하나도 없어 ①을 매출로 맞췄습니다. 두 층이 다시 엉킨 상태입니다.
            </div>
          )}
        </li>
      </ol>

      <div className="mt-3 rounded-lg bg-[#171310]/5 px-3 py-2 dark:bg-white/5">
        <b className="text-[#171310] dark:text-[#f2ede2]">판정 기준</b> — 독점매장(경쟁 0곳)은 점유율이
        1이라 <b>수요식만 발가벗겨집니다.</b> 거기서 안 맞으면 수요가 틀린 것이고 경쟁력·입지로 덮을 수도
        없습니다. 다만 독점이 3곳뿐이라(탕정역·광주각화·남악) 오차 1.1%와 1.3%의 차이는 잡음입니다 —
        <b> 5% 이내인지만 통과/탈락으로 보고</b>, 통과한 것들 중에서 전체로 가릅니다.
      </div>
    </details>
  );
}


/**
 * 지금 쓰는 계수를 **읽기 전용**으로 보여준다.
 *
 * 2026-09-16까지는 여기가 슬라이드 조절판이었다. 사용자 방향으로 걷어냈다 —
 * "웹에서 슬라이드 조절해서 맞춰보진 않을 거야, 작업은 너한테 시킬 거임."
 * 계수를 바꿔야 하면 `textbookModel.ts`의 `DEFAULT_TEXTBOOK_PARAMS`에서 바꾼다.
 *
 * 출처 라벨의 뜻(2026-09-17 규칙):
 *   [자료] 자료가 정했고 관문(홀드아웃·5겹·대조군)을 통과했다
 *   [감각] 실무 감각으로 박았다 — 자료가 아직 말을 못 한다
 *   [보류] 계수 0으로 자리만 둔다
 */
function ParamSummary({ p, counts }: {
  p: TextbookParams;
  counts: { f100: number; f200: number; f300: number; f400: number; f500: number; total: number };
}) {
  const num = (v: number, d = 2) => v.toFixed(d).replace(/\.?0+$/, "");
  const groups: { title: string; rows: { label: string; value: string; tag?: string }[] }[] = [
    {
      title: "1단계 · 수요",
      rows: [
        { label: "유동인구 반경", value: `${p.floatingRadius}m` },
        { label: "주거인구 반경", value: `${p.residentRadius}m` },
        { label: "유동 계수", value: num(p.floatingFactor) },
        { label: "1km 밖 고리 감쇠 λ", value: p.residentRingDecayM > 0 ? `${p.residentRingDecayM}m` : "끔" },
        { label: "고리 수요의 점유율", value: p.residentRingShare === "gravity" ? "가까운 쪽으로(기하)" : "1km 안과 같게" },
        { label: "막힌 상권 보정", value: p.useRingEnclosure ? "켬 (막힌 방향 ÷ 4 깎음)" : "끔" },
        { label: "상권 흡인력", value: num(p.agglomerationFactor) },
      ],
    },
    {
      title: "2단계 · 점유율",
      rows: [
        { label: "점유율 방식", value: p.shareMode === "quality" ? "품질 반영" : "끔" },
        { label: "유효거리", value: `${p.effectiveRadiusM}m` },
        { label: "품질 지수 θ", value: num(p.qualityExponent) },
        { label: "PC방 안 가는 몫", value: `${p.outsideOptionIp.toLocaleString()} IP` },
      ],
    },
    {
      title: "입지 (점유율에 곱한다)",
      rows: [
        {
          label: p.centralityResidual ? "잔차화 중심도 ν" : "상권 중심도 ν",
          value: num(p.locationExponents.centrality), tag: "자료",
        },
        { label: "접근성(층수) κ", value: num(p.locationExponents.access), tag: "자료" },
        { label: "유동 방향 ω", value: num(p.locationExponents.direction), tag: "보류" },
        { label: "동선 방해", value: num(p.locationExponents.flowBlock), tag: "보류" },
        { label: "가시성", value: num(p.locationExponents.visibility), tag: "보류" },
      ],
    },
    {
      title: "3단계 · 매출",
      rows: [
        { label: "정가 탄력도", value: num(p.rateElasticity, 3) },
        { label: "기준 정가", value: `${p.referenceHourlyRate.toLocaleString()}원` },
        { label: "가동률 상한", value: `${(p.maxUtilization * 100).toFixed(0)}%` },
      ],
    },
  ];

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">지금 쓰는 계수</h2>
        <p className="text-xs text-[var(--sl-ink-soft)]">
          화면에서 못 바꿉니다 — 코드에 고정돼 있습니다. 바꿔야 하면 말씀해 주세요.
        </p>
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map((g) => (
          <div key={g.title} className="app-card rounded-xl p-4">
            <h3 className="text-xs font-semibold text-[#171310] dark:text-[#f2ede2]">{g.title}</h3>
            <dl className="mt-2 space-y-1.5">
              {g.rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-[var(--sl-ink-soft)]">
                    {r.tag && (
                      <span className={`mr-1 rounded px-1 py-0.5 text-[10px] ${
                        r.tag === "자료"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : "bg-[#171310]/[0.07] text-[var(--sl-ink-soft)] dark:bg-white/10"
                      }`}>{r.tag}</span>
                    )}
                    {r.label}
                  </dt>
                  <dd className="shrink-0 text-xs font-semibold tabular-nums text-[#171310] dark:text-[#f2ede2]">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      <p className="mt-2 text-xs text-[var(--sl-ink-soft)]">
        기초자료 수집 현황 — 유동인구 100m {counts.f100}곳 · 200m {counts.f200}곳 · 300m {counts.f300}곳 ·
        400m {counts.f400}곳 · 500m {counts.f500}곳 (표본 {counts.total}곳)
      </p>
    </section>
  );
}

function StoreTable({ score, qscByStore, p, windowFill }: {
  score: TextbookScore; qscByStore: Loaded["qscByStore"]; p: TextbookParams;
  windowFill: Loaded["windowFillByStore"];
}) {
  /** QSC가 있는 매장이 하나라도 있을 때만 두 열을 그린다. 없으면 빈 칸만 늘어난다. */
  const hasQsc = [...qscByStore.values()].some((v) => v.qsc != null);
  return (
    <section className="mt-6">
      {/* 2026-09-24 사용자: "매장별 표에 가동률 순서로 나열해줘. 일단 가동률 우선 작업 중이니까" — 오차 큰 순에서
          실측 가동률 높은 순으로. 실측이 없는 행은 뒤로. */}
      <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">매장별 (실측 가동률 높은 순)</h2>
      <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
        <b>가동률차</b>는 예상 − 실측을 <b>퍼센트포인트</b>로 적은 값입니다 — 양수면 예상이 높다는 뜻입니다.
        <b> 수요 전부라면</b>은 점유율 항을 끈 값 — 이 동네 수요가 전부 우리에게 온다면 PC가 몇 % 도는가입니다.
        경쟁점 유무와 무관합니다.
        <b> 실제 먹은 몫</b>은 실측가동률 ÷ 수요 전부라면입니다.
      </p>
      <p className="mt-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        2026-09-16에 이 두 열이 말이 안 되게 나오던 문제를 고쳤습니다. 화면이 &ldquo;PC방 안 가는 몫&rdquo;을
        모델 기본값(0) 대신 <b>500으로 덮어쓰고</b> 있었습니다. 그러면 경쟁점이 0곳인 독점 매장도
        점유율이 17%로 계산되는데, <b>그때 수요 축척은 &ldquo;독점이면 점유율 1&rdquo;을 전제로 독점 매장에
        맞췄습니다.</b> 전제가 깨지니 수요가 6배 부풀려졌고, 점유율이 그만큼 작아져 매출만 얼추 맞는
        상태였습니다. 그걸 0으로 되돌리자 전체 MAPE가 41.8% → 23.4%로 내려갔습니다.
        <br />
        ⚠️ <b>2026-09-21에 하루 동안 20대로 올렸다가, 2026-09-22에 다시 {p.outsideOptionIp}대로 뺐습니다.</b>
        축척을 원장 실측으로 못 박고 나니 경쟁점 없는 매장 3곳에서 수요식이 <b>19% 과대</b>인 게
        드러났고(점유율이 1이라 그 초과분이 &ldquo;안 가는 몫&rdquo;처럼 보였습니다), 매장별로
        20.9 · 19.8 · 19.3대가 나와 20대를 썼습니다. 뺀 이유는 <b>점 3개에 맞춘 값</b>이었고,
        그 3곳이 사실 독점이 아니기 때문입니다 — 500m 안에 없을 뿐 2km 안에는 영업 중인 경쟁점이
        있습니다(남악 6곳 · 탕정역 3곳 · 광주각화 27건 미판정). 필요한 몫도 매장마다 달라서
        남악 10.4대 vs 광주각화 <b>51.9대</b>입니다 — 상수가 아니라 <b>반경 밖 경쟁점</b>입니다.
        <br />
        ✅ <b>그 반경 밖 경쟁점을 2026-09-22 밤에 실제로 넣었습니다</b>(아래 &ldquo;2km 경쟁점&rdquo; 설명).
        그래서 이 칸은 <b>{p.outsideOptionIp}대로 두는 게 맞습니다</b> — 상수로 메우던 자리를
        진짜 경쟁점이 대신 채웠습니다.
      </p>
      <div className="mt-2 overflow-x-auto">
        {/* 숫자 칸은 한 줄로 고정한다 — 2026-09-23 사용자 요청("실제매출란이 2줄 먹어서 칸이 넓어졌는데
            1줄로"). 마지막 칸(비고)만 줄바꿈을 둔다. 표는 overflow-x-auto라 옆으로 밀리면 스크롤이 생긴다. */}
        <table className="w-full min-w-[720px] text-left text-sm [&_th]:whitespace-nowrap [&_td:not(:last-child)]:whitespace-nowrap">
          <thead className="border-b border-[#171310]/10 text-xs text-[var(--sl-ink-soft)] dark:border-white/10">
            <tr>
              <th scope="col" className="px-3 py-2">매장</th>
              {hasQsc && (
                <>
                  <th scope="col" className="px-3 py-2 text-right" title="개점 이후 전 기간 점검의 평균. 0점 기록과 오픈 매장 점검은 뺀 값이다.">QSC</th>
                  <th scope="col" className="px-3 py-2 text-right" title="1 + (QSC-60) x 0.1, 1~5로 자름. 회색 값은 그 매장에 QSC가 없어 가맹점 평균을 받은 것이다.">관리</th>
                </>
              )}
              <th scope="col" className="px-3 py-2 text-right">예상매출</th>
              <th scope="col" className="px-3 py-2 text-right">실제매출</th>
              <th scope="col" className="px-3 py-2 text-right">오차</th>
              <th scope="col" className="px-3 py-2 text-right">예상가동률</th>
              <th scope="col" className="px-3 py-2 text-right">실측가동률</th>
              <th scope="col" className="px-3 py-2 text-right" title="예상 − 실측, 퍼센트포인트. 양수면 예상이 실측보다 높다는 뜻이다. 가동률은 그 자체가 %라서 상대오차가 아니라 %p로 보여준다.">가동률차<span className="ml-0.5 text-[10px] font-normal text-[var(--sl-ink-soft)]">(%p)</span></th>
              <th scope="col" className="px-3 py-2 text-right" title="점유율 항을 아예 끈 예측 가동률 — 이 동네 수요가 전부 우리에게 온다면 PC가 몇 % 돌아가나. 경쟁점 유무와 무관하고, 100%를 넘으면 수요가 우리 용량보다 크다는 뜻이다.">수요 전부라면</th>
              <th scope="col" className="px-3 py-2 text-right" title="실측가동률 ÷ 수요 전부라면 — 이 매장이 그 동네 수요 중 실제로 먹은 몫">실제 먹은 몫</th>
              <th scope="col" className="px-3 py-2 text-right">산식 점유율</th>
              <th scope="col" className="px-3 py-2">비고</th>
            </tr>
          </thead>
          <tbody>
            {[...score.rows].sort((a, b) => (b.actualUtilization ?? -1) - (a.actualUtilization ?? -1)).map((r) => {
              const bad = (r.absErrPct ?? 0) > 0.2;
              const q = qscByStore.get(r.storeCode);
              return (
                <tr key={r.storeCode} className="border-b border-[#171310]/[0.06] dark:border-white/[0.06]">
                  <td className="px-3 py-2">{r.storeName ?? r.storeCode}</td>
                  {hasQsc && (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--sl-ink-soft)]">
                        {q?.qsc == null ? "-" : q.qsc.toFixed(1)}
                      </td>
                      {/* 실측이 아니라 가맹점 평균을 받은 매장은 흐리게 — "몰라서 평균"과
                          "재보니 평균"을 같은 색으로 보여주면 사람이 구분을 못 한다. */}
                      <td className={`px-3 py-2 text-right tabular-nums ${
                        q?.qsc == null ? "text-[var(--sl-ink-soft)] italic"
                          : (q.management ?? 4) < 3.5 ? "font-semibold text-amber-700 dark:text-amber-400" : "font-semibold"
                      }`} title={q?.qsc == null ? "QSC 기록이 없어 가맹점 평균이 들어갔다" : undefined}>
                        {q?.management == null ? "-" : q.management.toFixed(2)}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums">{manwon(r.predicted)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{manwon(r.actual)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${bad ? "font-semibold text-red-600 dark:text-red-400" : ""}`}>
                    {pct(r.absErrPct)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(r.utilization)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(r.actualUtilization)}</td>
                  {/* 가동률은 그 자체가 %라서 상대오차로 보여주면 오해를 부른다(2026-09-16
                      사용자 지적: "52.6% 실제 31.6%면 21 아니냐? 왜 66.7%나옴?").
                      퍼센트포인트 차이를 부호까지 붙여 보여준다 — 양수면 예상이 높다는 뜻. */}
                  <td className={`px-3 py-2 text-right tabular-nums ${
                    Math.abs(((r.utilization ?? 0) - (r.actualUtilization ?? 0))) > 0.1
                      ? "font-semibold text-red-600 dark:text-red-400" : ""
                  }`}>
                    {r.utilization == null || r.actualUtilization == null
                      ? "-"
                      : `${(r.utilization - r.actualUtilization) >= 0 ? "+" : ""}${((r.utilization - r.actualUtilization) * 100).toFixed(1)}%p`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(r.utilizationNoShare)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${(r.requiredShare ?? 0) > 1 ? "text-red-600 dark:text-red-400" : ""}`}>
                    {pct(r.requiredShare)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(r.share)}</td>
                  <td className="px-3 py-2 text-xs text-[var(--sl-ink-soft)]">
                    {/* 평가창이 덜 찬 매장은 실측 가동률이 12개월 완주 평균이 아니다 — 티를 낸다. */}
                    {(() => {
                      const w = windowFill.get(r.storeCode);
                      if (!w || w.total === 0 || w.filled >= w.total) return null;
                      return (
                        <b className="text-[var(--sl-warn,#b4530a)]" title="실측 가동률이 12개월 완주 평균이 아닙니다. 달이 차면 값이 움직입니다.">
                          ⚠ 평가창 {w.filled}/{w.total}달{" "}
                        </b>
                      );
                    })()}
                    {r.capped && "가동률 상한 "}
                    {r.missing.length > 0 && `자료없음: ${r.missing.join(", ")}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── 모델에서 빠진 매장 (2026-09-18) ────────────────────────────────────────
//
// 사용자 요청: *"실험실에 송도점이랑 동탄북광장점 같이 보여지게 해라."*
//
// ⚠️ **성적에 안 들어간다.** 위 표(학습 대상)와 같은 축척·같은 계수로 예측만 내서 나란히
//    놓는 것이다. 빠진 이유가 산식 밖의 사정(오픈 후 가격전쟁·운영관리 문제)이라, 섞으면
//    축척과 계수가 그 사정을 배운다. 그래서 표를 아예 따로 둔다.
//
// 그래도 보는 이유는 있다 — **산식이 "그 사정이 없었다면 얼마"라고 말하는지**가 여기 나온다.
function ExcludedTable({ rows, p }: { rows: LabRow[]; p: TextbookParams }) {
  if (!rows.length) return null;
  const computed = rows
    .map((r) => ({ row: r, b: computeTextbook(r.input, p) }))
    // 2026-09-24 사용자 요청: 가동률 우선 작업 중이라 표를 예상 가동률 높은 순으로(매출 순이었다).
    .sort((a, b) => (b.b.utilization ?? -1) - (a.b.utilization ?? -1));
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
        모델에서 빠진 매장 {rows.length}곳{" "}
        <span className="font-normal text-[var(--sl-ink-soft)]">(참고 — 성적에 안 들어감)</span>
      </h2>
      <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        이 매장들은 <b>오픈 후 생긴 사정</b> 때문에 학습에서 뺀 곳입니다. 위 성적·축척·계수에는
        한 글자도 안 들어가고, <b>같은 축척으로 예측만 다시 내서</b> 나란히 놓은 것입니다.
        <b> 산식이 &ldquo;그 사정이 없었다면 얼마&rdquo;라고 보는지</b>를 실측과 견주시면 됩니다.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-[#171310]/10 text-xs text-[var(--sl-ink-soft)] dark:border-white/10">
            <tr>
              <th scope="col" className="px-3 py-2">매장</th>
              <th scope="col" className="px-3 py-2 text-right">예상</th>
              <th scope="col" className="px-3 py-2 text-right">실측</th>
              <th scope="col" className="px-3 py-2 text-right">차이</th>
              <th scope="col" className="px-3 py-2 text-right">예상 가동률</th>
              <th scope="col" className="px-3 py-2 text-right">점유율</th>
              <th scope="col" className="px-3 py-2">뺀 이유</th>
            </tr>
          </thead>
          <tbody>
            {computed.map(({ row, b }) => {
              const diff = b.monthlyRevenue != null && row.actualRevenue > 0
                ? b.monthlyRevenue / row.actualRevenue - 1 : null;
              return (
                <tr key={row.input.storeCode} className="border-b border-[#171310]/[0.06] dark:border-white/[0.06]">
                  <td className="px-3 py-2">{row.input.storeName ?? row.input.storeCode}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{manwon(b.monthlyRevenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{manwon(row.actualRevenue)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${
                    diff != null && Math.abs(diff) > 0.2 ? "font-semibold text-red-600 dark:text-red-400" : ""
                  }`}>
                    {diff == null ? "-" : `${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(b.utilization)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(b.share)}</td>
                  <td className="px-3 py-2 text-xs text-[var(--sl-ink-soft)]">{row.excludedReason ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── 신규후보지 (2026-09-18) ────────────────────────────────────────────────
//
// ⚠️ **이 표에는 오차 열이 없다. 없는 게 맞다.** 후보지는 실매출이 아직 없어서 채점할
//    대상이 자체가 없다. 나중에 "적중률이 왜 안 보이지" 하고 열을 만들지 말 것 — 만들려면
//    개점 후 실매출이 쌓여 기존점으로 넘어간 뒤다(그때는 위 매장별 표가 잡는다).
function CandidateTable({ rows, p, franchiseManagement, existingCount, actualUtilRange }: {
  rows: LabCandidateRow[];
  /** 기존점에서 **맞춰진 축척까지 먹인** 파라미터. 후보지로 다시 맞추지 않는다. */
  p: TextbookParams;
  franchiseManagement: number | null;
  existingCount: number;
  /**
   * 기존점 **실측** 가동률의 최소~최대 (2026-09-21 신설).
   *
   * ── 왜 이걸 표에 들고 오나 ────────────────────────────────────────────────
   * 가동률 자로 산식을 다시 재 보니 **후보지 예측이 기존점 실측보다 2.42배 넓게** 퍼진다
   * (SD(log) 0.459 vs 0.189). 13곳 중 4곳은 우리가 **한 번도 관측한 적 없는** 낮은 구간에
   * 떨어진다(창원상남 7.8% · 영월 8.6% · 울산삼산 13.5% · 춘천퇴계 16.9%).
   * 그 숫자들은 "그만큼 나쁘다"가 아니라 **"산식이 그만큼 벌린다"**일 수 있다.
   *
   * 사용자 결정(2026-09-21 낮): **산식은 안 고치고 경고만 띄운다.** 지수를 고치면
   * (b=0.30·c=0.135) 평균은 좋아지지만 최악이 49 → 62%로 나빠지고, 그래도 '전부 평균'을
   * 유의하게 못 이기기 때문이다. 계수를 늘리는 대신 **읽는 사람이 알게** 하는 쪽을 택했다.
   *
   * ⚠️ **그날 저녁에 결정이 바뀌었다** — 지수 눈금 보정을 채택했고(b=0.327), 같은 날 밤
   *    변별력 때문에 b를 0.45로 올렸다(`textbookModel`의 `indexCalibration` 주석).
   *    그래서 위 "2.42배 넓게 퍼진다"는 **보정 전** 이야기다. 지금은 보정이 폭을 줄여
   *    범위 밖 후보지가 0곳이라 이 경고가 안 뜬다. 경고는 그대로 남겨 둔다 —
   *    표본이나 계수가 바뀌어 다시 범위 밖으로 나가면 그때 알려 줘야 한다.
   *
   * ⚠️ 이건 "산식이 틀렸다"는 표시가 아니다. 표본 38곳은 **우리가 골라서 연** 자리들이라
   *    가동률이 좁게 모여 있다(열위 표본은 영원히 안 나온다). 그러니 범위 밖은
   *    "나쁘다"가 아니라 **"검증된 적 없다"**는 뜻이다.
   * 근거: `_candidateUtilTrust.test.ts` · `_ratioExponent.test.ts`
   */
  actualUtilRange: { min: number; max: number } | null;
}) {
  const computed = rows.map((r) => ({ row: r, b: computeTextbook(r.input, p) }))
    // 2026-09-24 사용자 요청: 가동률 우선 작업 중이라 표를 예상 가동률 높은 순으로(매출 순이었다).
    .sort((a, b) => (b.b.utilization ?? -1) - (a.b.utilization ?? -1));
  if (!computed.length) {
    return (
      <section className="mt-10">
        <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">신규후보지</h2>
        <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
          실험실 복제본에 후보지가 없습니다. <code>scripts/syncLabCollections.mjs</code>로 채웁니다.
        </p>
      </section>
    );
  }
  // 자료가 모자란 곳이 몇 곳인지 — 숫자를 글자로 박지 않고 여기서 세어 그린다.
  const shortCount = computed.filter((c) => c.b.missing.length > 0).length;
  // 기존점 실측 가동률 범위 밖으로 나간 후보지 수. 같은 이유로 **세어서** 그린다.
  const outOfRange = actualUtilRange == null ? 0 : computed.filter((c) =>
    c.b.utilization != null && !c.b.capped
    && (c.b.utilization < actualUtilRange.min || c.b.utilization > actualUtilRange.max)).length;
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
        신규후보지 {computed.length}곳 — 교과서식 예측
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-[var(--sl-ink-soft)]">
        후보지는 <b>실매출이 없어 채점할 수 없습니다</b> — 그래서 오차 열이 없습니다. 대신
        축척 둘(1인 월 {p.hoursPerUserPerMonth.toFixed(2)}시간
        {p.hoursPerUserFixed ? " ← 원장 실측" : ` ← 기존 가맹점 ${existingCount}곳에서 역산`} ·
        상품몫 {Math.round(p.productUnitPrice).toLocaleString()}원/PC·시간
        {p.productUnitPriceFixed ? " ← 상품매출 직접 측정, 고정" : ` ← 기존 가맹점 ${existingCount}곳에서 매번 적합`})을
        {" "}<b>그대로 받아</b> 예측만 합니다.
        후보지로 축척을 다시 맞추면 예측값으로 예측값을 맞추는 순환이 됩니다.
      </p>
      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        후보지에 원래 없는 둘은 이렇게 채웁니다.
        <b> 실측 가동률</b>은 이것 자체가 예측 대상이라 안 넣습니다.
        <b> QSC</b>는 신규점에 점검 기록이 있을 수 없어 <b>관리 점수에 가맹점 평균
        {franchiseManagement == null ? "" : ` ${franchiseManagement.toFixed(2)}점`}</b>이 들어갑니다 —
        기존점 중 QSC가 없는 곳에 주는 값과 같습니다.
        자사 시설 빈칸은 결측이 아니라 <b>회사 표준 구성</b>으로 채웁니다.
        {shortCount > 0 && <> 지금 자료가 모자란 곳이 <b>{shortCount}곳</b> 있습니다(맨 오른쪽 열).</>}
      </p>
      {/* 2026-09-21 — 가동률 외삽 경고. 사용자 결정으로 산식은 안 고치고 경고만 띄운다. */}
      {actualUtilRange && outOfRange > 0 && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <b>🔴 예상 가동률 {outOfRange}곳이 검증 범위 밖입니다.</b> 기존 가맹점 {existingCount}곳의
          <b> 실측</b> 가동률은 {pct(actualUtilRange.min)}~{pct(actualUtilRange.max)}인데, 이 후보지들의 예측은 그 밖입니다.
          {" "}<b>한 번도 관측한 적 없는 구간</b>이라 숫자를 그대로 믿으면 안 됩니다.
          <br />
          이유: &ldquo;동네 수요 ÷ 총공급&rdquo;은 <b>우리가 만든 지수</b>라 매장 간 차이를 실제보다 크게
          벌립니다. 그래서 예측을 가운데로 당기는 보정을 먹이는데
          {p.indexCalibration ? <> (지금 지수 <b>{p.indexCalibration.ratioExponent}</b>,
          닻 {pct(p.indexCalibration.referenceUtilization)})</> : <> (지금은 <b>꺼져 있습니다</b>)</>},
          그러고도 범위를 벗어났다면 당기기 전 값이 아주 멀었다는 뜻입니다.
          {" "}<b>그래서 범위 밖 숫자는 &ldquo;그만큼 나쁘다&rdquo;가 아니라 &ldquo;산식이 그만큼 벌린다&rdquo;일 수 있습니다.</b>
          <br />
          ⚠️ 다만 이건 산식이 틀렸다는 뜻이 아닙니다 — 기존점 {existingCount}곳은 <b>우리가 골라서 연 자리들</b>이라
          가동률이 좁게 모여 있는 게 당연합니다. 범위 밖은 <b>&ldquo;나쁘다&rdquo;가 아니라 &ldquo;검증된 적 없다&rdquo;</b>는 뜻입니다.
          순위는 참고가 되지만(r≈0.5) <b>폭은 과장돼 있습니다.</b>
        </p>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-[#171310]/10 text-xs text-[var(--sl-ink-soft)] dark:border-white/10">
            <tr>
              <th scope="col" className="px-3 py-2">후보지</th>
              <th scope="col" className="px-3 py-2 text-right" title="후보지의 PC수는 expectedPcCount(예상PC대수)다.">PC</th>
              <th scope="col" className="px-3 py-2 text-right">예상매출</th>
              <th scope="col" className="px-3 py-2 text-right">예상가동률</th>
              <th scope="col" className="px-3 py-2 text-right" title="자사PC x 자사품질^θ ÷ (자사 + 유효거리 안 경쟁점들). 100%면 유효거리 안에 겨룰 상대가 없다는 뜻이다.">점유율</th>
              <th scope="col" className="px-3 py-2 text-right" title="1단계 수요 — 이 동네에서 한 달에 PC방을 쓰는 사람 수">수요(명)</th>
              <th scope="col" className="px-3 py-2 text-right" title="PC몫(정가 기반) + 상품몫. 상품몫은 전 매장 실측에서 구한 상수다.">총단가</th>
              <th scope="col" className="px-3 py-2 text-right" title="입지가 점유율에 곱한 배율. 1이면 입지가 아무 일도 안 한 것(자료없음 또는 계수 0).">입지배율</th>
              <th scope="col" className="px-3 py-2">비고</th>
            </tr>
          </thead>
          <tbody>
            {computed.map(({ row, b }) => (
              <tr key={row.input.storeCode} className="border-b border-[#171310]/[0.06] dark:border-white/[0.06]">
                <td className="px-3 py-2">
                  {row.input.storeName ?? row.input.storeCode}
                  <span className="ml-1.5 text-xs text-[var(--sl-ink-soft)]">{row.input.storeCode}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.input.pcCount ?? "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{manwon(b.monthlyRevenue)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {pct(b.utilization)}
                  {b.capped && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400" title="가동률 상한에 걸려 매출이 깎였다">상한</span>}
                  {/* 외삽 경고 — 기존점 실측 범위 밖이면 검증된 적 없는 구간이다(2026-09-21). */}
                  {actualUtilRange && b.utilization != null && !b.capped
                    && (b.utilization < actualUtilRange.min || b.utilization > actualUtilRange.max) && (
                    <span
                      className="ml-1 text-xs font-semibold text-rose-700 dark:text-rose-400"
                      title={`기존점 ${existingCount}곳의 실측 가동률은 ${pct(actualUtilRange.min)}~${pct(actualUtilRange.max)}입니다.`
                        + ` 이 후보지 예측(${pct(b.utilization)})은 그 밖이라 검증된 적이 없는 구간입니다.`
                        + ` "그만큼 나쁘다"가 아니라 "산식이 그만큼 벌린다"일 수 있으니 숫자를 그대로 믿지 마세요.`}
                    >
                      🔴 검증범위 밖
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(b.share)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--sl-ink-soft)]">
                  {b.totalDemandUsers == null ? "-" : Math.round(b.totalDemandUsers).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--sl-ink-soft)]">
                  {b.unitPrice == null ? "-" : `${Math.round(b.unitPrice).toLocaleString()}원`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--sl-ink-soft)]">
                  {b.locationMultiplier == null ? "-" : b.locationMultiplier.toFixed(3)}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--sl-ink-soft)]">
                  {b.missing.length > 0 && `자료없음: ${b.missing.join(", ")}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[var(--sl-ink-soft)]">
        운영 V62 예상매출은 <Link href="/store-eval/candidates" className="underline">신규후보지</Link> 화면에 있습니다.
        두 산식은 <b>서로 다른 것을 봅니다</b> — V62는 기존 가맹점 실적에 회귀로 맞추고,
        여기 교과서식은 동네 수요에서 우리 몫을 떼어 냅니다. 어느 쪽이 맞는지는
        <b> 후보지에서는 판정할 수 없습니다</b>(실매출이 없습니다). 개점 후 실적이 쌓이면 그때 갈립니다.
      </p>
    </section>
  );
}

// ── 매장별 경쟁점 인식 (2026-09-18) ────────────────────────────────────────
//
// 사용자: *"각 매장별로 경쟁점 어떻게, 어느매장을 인식하고있는지 알고싶다.
//          어느매장까지 경쟁점으로 보고있는지 내가봐야겠어"*
//
// ⚠️ **모델이 실제로 든 배열(`input.rivals`)을 그대로 그린다.** 경쟁점 목록을 여기서 다시
//    조립하면 순서·필터가 어긋나 "엉뚱한 매장이 잡혔다"는 오해를 만든다. 이름도 그 배열에
//    같이 실어 뒀다(textbookModel.ts rivals.name).
//
// ⚠️ **2026-09-21에 뜻이 바뀌었다.** 그 전에는 이진 절단이었다(유효거리 안이면 100%, 1m라도
//    밖이면 0). 지금은 **거리 감쇠**다 — 평지 안은 100%, 밖은 exp로 완만히 줄여서 센다.
//    이 표가 계속 계단으로 그리고 있어서 화면이 "302m는 안 셈"이라고 거짓말하고 있었다.
//    이제 **산식과 같은 무게 함수**를 써서 몇 %로 세는지를 그대로 보여준다.
function RivalRecognition({ groups, p }: {
  groups: { kind: "기존점" | "후보지"; input: TextbookInput }[];
  p: TextbookParams;
}) {
  const [open, setOpen] = useState(false);
  const rows = groups.map(({ kind, input }) => {
    const oq = input.ownQualityParts ? computeQualityScore(input.ownQualityParts, p.qualityWeights) : null;
    const rivals = (input.rivals ?? []).map((v) => {
      const q = v.parts ? computeQualityScore(v.parts, p.qualityWeights) : null;
      // ⚠️ **산식과 같은 식**을 쓴다(textbookModel의 computeTextbook 품질 모드).
      //    여기서 따로 구현하면 화면과 산식이 어긋난다 — 실제로 2026-09-21에 그랬다.
      const dw = rivalDistanceWeight(v.distanceM, p);
      // 분모에 실제로 더해지는 무게. 자사 PC와 견줘야 크기가 읽힌다.
      const ratio = oq != null && oq > 0 && q != null && q > 0 ? q / oq : 1;
      return { ...v, q, distWeight: dw, inRange: dw > 0, weight: v.ip * Math.pow(ratio, p.qualityExponent) * dw };
    }).sort((a, b) => (a.distanceM ?? 9e9) - (b.distanceM ?? 9e9));
    // "센다"의 기준 — 무게 20% 미만은 사실상 안 세는 것으로 본다(점검표와 같은 문턱).
    const counted = rivals.filter((r) => r.distWeight >= 0.2);
    const rivalWeight = rivals.reduce((a, r) => a + r.weight, 0);
    return { kind, input, oq, rivals, counted, rivalWeight };
  }).sort((a, b) => (b.rivals.length - b.counted.length) - (a.rivals.length - a.counted.length));

  const droppedTotal = rows.reduce((a, r) => a + (r.rivals.length - r.counted.length), 0);
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">매장별 경쟁점 인식</h2>
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="app-btn-outline shrink-0 rounded-lg px-3 py-1.5 text-xs">
          {open ? "접기" : `펼치기 (${rows.length}곳)`}
        </button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--sl-ink-soft)]">
        산식이 <b>어느 매장을 경쟁점으로 세고 있는지</b> 그대로 보여줍니다. 지금 방식은
        {p.rivalDistanceDecay ? (
          <>
            {" "}<b>거리 감쇠</b>입니다 — <b>{p.rivalDistanceDecay.plateauM}m 안은 100%</b>로 세고,
            그 밖은 <b>exp(−(거리−{p.rivalDistanceDecay.plateauM})÷{p.rivalDistanceDecay.scaleM})</b>로
            완만히 줄여서 셉니다(전체에 ×{(p.rivalDistanceDecay.weightFactor ?? 1).toFixed(4)} 총량 정규화).
            거리 경계에서 <b>절벽이 없습니다</b>. 다만 도로 같은 장벽은 아직 안 봅니다.
            무게 20% 미만이라 사실상 안 세지는 곳이 <b>{droppedTotal}곳</b>입니다.
          </>
        ) : (
          <>
            {" "}<b>유효거리 {p.effectiveRadiusM}m 안이면 100% 세고, 1m라도 밖이면 0</b>입니다 —
            거리에 따라 점점 약해지지도 않고, 도로 같은 장벽도 보지 않습니다.
            조사된 경쟁점 중 <b>{droppedTotal}곳</b>이 거리 때문에 빠져 있습니다.
          </>
        )}
      </p>
      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <b>무게</b>는 분모에 실제로 더해지는 값입니다 — 경쟁점 PC수 × (경쟁력비)<sup>{p.qualityExponent}</sup>.
        지수가 {p.qualityExponent}이라 경쟁력이 절반이면 무게는 {Math.pow(0.5, p.qualityExponent).toFixed(3)}배가 됩니다.
        <b> 그래서 PC가 많아도 경쟁력이 낮으면 거의 안 세어집니다.</b>
        점유율 = 자사PC ÷ (자사PC + 무게합)이고, 여기에 입지 배율을 곱한 뒤 100%로 자릅니다.
      </p>
      {open && (
        <div className="mt-3 space-y-2">
          {rows.map(({ kind, input, oq, rivals, counted, rivalWeight }) => (
            <details key={`${kind}:${input.storeCode}`} className="app-card rounded-xl px-4 py-3">
              <summary className="cursor-pointer text-sm">
                <span className="font-semibold">{input.storeName ?? input.storeCode}</span>
                <span className="ml-2 text-xs text-[var(--sl-ink-soft)]">
                  {kind} · 자사 {input.pcCount ?? "-"}대 · 경쟁력 {oq?.toFixed(2) ?? "-"}
                  {" · "}조사 {rivals.length}곳 중 <b>{counted.length}곳</b> 셈
                  {rivals.length > counted.length && (
                    <span className="text-amber-700 dark:text-amber-400"> ({rivals.length - counted.length}곳 거리로 사실상 빠짐)</span>
                  )}
                  {" · "}무게합 {rivalWeight.toFixed(1)}
                </span>
              </summary>
              {rivals.length === 0 ? (
                <p className="mt-2 text-xs text-[var(--sl-ink-soft)]">조사된 경쟁점이 없습니다 — 독점 상권으로 계산됩니다(점유율 100%).</p>
              ) : (
                <table className="mt-2 w-full text-left text-xs">
                  <thead className="text-[var(--sl-ink-soft)]">
                    <tr>
                      <th scope="col" className="py-1 pr-2">경쟁점</th>
                      <th scope="col" className="py-1 pr-2 text-right">거리</th>
                      <th scope="col" className="py-1 pr-2 text-right">PC</th>
                      <th scope="col" className="py-1 pr-2 text-right">경쟁력</th>
                      <th scope="col" className="py-1 pr-2 text-right">자사대비</th>
                      <th scope="col" className="py-1 pr-2 text-right">거리무게</th>
                      <th scope="col" className="py-1 pr-2 text-right">무게</th>
                      <th scope="col" className="py-1">얼마나 세나</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rivals.map((v, i) => (
                      <tr key={`${v.name ?? "?"}-${i}`} className={v.distWeight >= 0.2 ? "" : "opacity-50"}>
                        <td className="py-1 pr-2">{v.name ?? "(이름없음)"}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {v.distanceM == null ? "모름" : `${Math.round(v.distanceM)}m`}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">{v.ip}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{v.q?.toFixed(2) ?? "-"}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {oq && v.q ? `${((v.q / oq - 1) * 100).toFixed(0)}%` : "-"}
                        </td>
                        {/* 거리무게를 따로 보여준다 — 감쇠는 0/1이 아니라 **몇 %인지**가 요점이다. */}
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {`${(v.distWeight * 100).toFixed(0)}%`}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums font-semibold">
                          {v.weight.toFixed(1)}
                        </td>
                        <td className="py-1">
                          {v.distWeight >= 0.999
                            ? <span className="text-[var(--sl-ink-soft)]">온전히 셈</span>
                            : v.distWeight >= 0.2
                              ? <span className="text-[var(--sl-ink-soft)]">부분으로 셈</span>
                              : <span className="text-amber-700 dark:text-amber-400">
                                  사실상 안 셈{p.rivalDistanceDecay ? "" : ` (${p.effectiveRadiusM}m 초과)`}
                                </span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

