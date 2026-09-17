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
  getLabModelSettings, listLabCompetitors, listLabLocationEvaluations,
  listLabExistingStores, listLabRoadviewJudgments, listLabQscScores, listEvaluationSales,
} from "@/lib/storeEval/store";
import { computeOverflowPcHours, runUsageCohortValidation } from "@/lib/storeEval/usageRevenue";
import {
  DEFAULT_TEXTBOOK_PARAMS, PC_USE_RATE_MALE, PC_USE_RATE_FEMALE, scoreTextbook,
  type FloatingRadius, type ResidentRadius,
  type TextbookParams, type TextbookScore,
} from "@/lib/storeEval/textbookModel";
import type { Competitor, ModelSettings } from "@/lib/storeEval/types";

// 모델 입력 조립은 labInput.ts에 있다 — 측정 하네스와 **같은 코드**를 써야 한다.
// 화면에만 항목을 붙이다 하네스가 입지를 통째로 빠뜨린 적이 있다(2026-09-16).
import { buildLabRows, utilizationByStore, type LabRow } from "@/lib/storeEval/labInput";

type Loaded = {
  rows: LabRow[];
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
  const [storedStores, settingsDoc, allCompetitors, allLocationEvaluations, roadviewByKey, qscByStoreCode] = await Promise.all([
    listLabExistingStores(),
    getLabModelSettings(),
    listLabCompetitors(),
    listLabLocationEvaluations(),
    listLabRoadviewJudgments(),
    // QSC 점검 기록 -> 관리 점수(labInput.ts qscInWindowAverage + qscToManagementScore). 전용 컬렉션이라
    // 동기화가 안 건드리고, 운영 V62는 아예 읽지 않는다.
    listLabQscScores(),
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
  const rows = buildLabRows({ stores, compsByCode, utilByStore, settings, roadviewByKey, qscByStoreCode });

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
  return { rows, current, qsc, qscByStore };
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
          <ScoreBoard score={score} current={data.current} />
          <HowItWorks p={p} fitted={score.fittedHoursPerUser} productUnitPrice={score.fittedProductUnitPrice}
            scaledOnUtilization={score.scaledOnUtilization} qsc={data.qsc} />
          <ParamSummary p={p} counts={counts} />
          <StoreTable score={score} qscByStore={data.qscByStore} />
        </>
      )}
    </div>
  );
}

function ScoreBoard({ score, current }: { score: TextbookScore; current: Loaded["current"] }) {
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
        표본 {score.sampleCount}곳 · 목표 MAPE 10%(마지노선 20%) · 축척 둘은 매번 자동으로 맞춥니다
        (1인당 월이용시간 {score.fittedHoursPerUser.toFixed(2)}시간 ← 독점 실측가동률 ·
        상품몫 {Math.round(score.fittedProductUnitPrice).toLocaleString()}원/PC·시간 ← 독점 실매출).
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
function HowItWorks({ p, fitted, productUnitPrice, scaledOnUtilization, qsc }: {
  p: TextbookParams; fitted: number; productUnitPrice: number; scaledOnUtilization: boolean;
  /** QSC 적용 현황. 숫자를 글자로 박지 않고 여기서 읽어 그린다. */
  qsc: Loaded["qsc"];
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
            {" + "}환산(유동 {p.floatingRadius}m) × {p.floatingFactor}
          </div>
          <div className="mt-1">
            <b>특수수요 배수</b> — 군부대·대학가·산업단지는 <b>인구 통계에 안 잡히는 이용자</b>를
            데려옵니다. 그래서 입지 보정이 아니라 <b>수요 산식 안에서</b> 곱합니다.
            {" "}지금 값: {Object.entries(p.specialDemandMultipliers)
              .filter(([k, v]) => v !== 1 && k !== "관광유흥")
              .map(([k, v]) => `${k} ×${v}`).join(" · ") || "전부 1.0"}.
            {" "}2026-09-16에 필요 점유율로 측정했습니다(군부대 118.3% · 대학가 76.0% ·
            산업단지 72.8% vs 없음 52.5%).
            {" "}<b>표본이 2~5곳이라 확정값이 아닙니다</b> — 경쟁력 작업을 끝낸 뒤 2차 가공합니다.
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
                점유율 = 자사PC ÷ (자사PC + Σ<sub>[{p.effectiveRadiusM}m 안]</sub> 경쟁PC × (경쟁품질÷자사품질)<sup>{p.qualityExponent}</sup>)
                {p.outsideOptionIp > 0 ? ` + 안가는몫 ${p.outsideOptionIp}` : ""}
              </div>
              <div className="mt-1">
                <b>유효거리 {p.effectiveRadiusM}m 안</b>에 있는 경쟁점만 진짜 경쟁자로 셉니다. 그 안에서는
                거리가 아니라 <b>품질이 가릅니다</b> — 실무 의견이고 자료도 그쪽입니다(지수 감쇠는
                r=0.510, 계단은 0.560).
              </div>
              <div className="mt-1">
                품질 지수 <b>{p.qualityExponent}</b>는 두 경로가 따로 찾아와 만난 값입니다. 자료로 고른
                최선이 3이고, 매출 변화폭에서 역산한 값이 2.74~4.92·중앙 3.25입니다.
                <b> 감각은 매출액, 측정은 가동률 — 경로가 완전히 다릅니다.</b>
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
              ["상권 중심도", p.locationExponents.centrality, "자료"],
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
                앞은 미실시·입력오류이고, 뒤는 오픈 직후 체크리스트라 재는 것이 다릅니다.
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
            상품몫은 <b>후보지에서 예측할 방법이 아직 없습니다.</b> PC대수 r=0.251 · 정가 r=−0.015 ·
            가동률 r=0.118로 전부 유의선 0.354 미만입니다. 그래서 전 매장 같은 값(독점 실매출로
            맞춘 상수)을 씁니다. 상품매출 비율은 이제 <b>파라미터가 아니라 결과</b>입니다.
          </div>
        </li>

        <li>
          <b className="text-[#171310] dark:text-[#f2ede2]">축척은 둘이고, 각각 실측값에 맞춥니다</b>
          <div className="mt-1">
            층마다 실측값이 따로 있으니(가동률은 매출DB, 매출도 매출DB) 축척도 따로 맞춥니다.
            하나로 겸하게 하면 매출 환산이 틀린 만큼이 <b>가동률로 되밀려 들어갑니다</b> —
            2026-09-16까지 그랬고, 그래서 독점 3곳 가동률이 −3.2~−5.3% 어긋나 보였습니다.
          </div>
          <div className="mt-1">
            ① 1인당 월이용시간 <b>{fitted.toFixed(3)}시간</b> ← 독점매장 <b>실측 가동률</b>
            {usersPerPc != null && <> (환산수요 <b>{usersPerPc.toLocaleString()}명</b>이 PC 1대를 100% 채우는 셈)</>}
          </div>
          <div className="mt-1">
            ② 상품몫 <b>{Math.round(productUnitPrice).toLocaleString()}원</b> ← 독점매장 <b>실매출</b> (PC몫은 정가에서 바로 나오므로 맞출 게 없습니다)
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
        { label: "상권 중심도 ν", value: num(p.locationExponents.centrality), tag: "자료" },
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

function StoreTable({ score, qscByStore }: { score: TextbookScore; qscByStore: Loaded["qscByStore"] }) {
  /** QSC가 있는 매장이 하나라도 있을 때만 두 열을 그린다. 없으면 빈 칸만 늘어난다. */
  const hasQsc = [...qscByStore.values()].some((v) => v.qsc != null);
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">매장별 (오차 큰 순)</h2>
      <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
        <b>가동률차</b>는 예상 − 실측을 <b>퍼센트포인트</b>로 적은 값입니다 — 양수면 예상이 높다는 뜻입니다.
        <b> 수요 전부라면</b>은 점유율 항을 끈 값 — 이 동네 수요가 전부 우리에게 온다면 PC가 몇 % 도는가입니다.
        경쟁점 유무와 무관합니다.
        <b> 실제 먹은 몫</b>은 실측가동률 ÷ 수요 전부라면입니다.
      </p>
      <p className="mt-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        2026-09-16에 이 두 열이 말이 안 되게 나오던 문제를 고쳤습니다. 화면이 &ldquo;PC방 안 가는 몫&rdquo;을
        모델 기본값(0) 대신 <b>500으로 덮어쓰고</b> 있었습니다. 그러면 경쟁점이 0곳인 독점 매장도
        점유율이 17%로 계산되는데, <b>수요 축척은 &ldquo;독점이면 점유율 1&rdquo;을 전제로 독점 매장에
        맞춥니다.</b> 전제가 깨지니 수요가 6배 부풀려졌고, 점유율이 그만큼 작아져 매출만 얼추 맞는
        상태였습니다. 지금은 독점 매장이 점유율 100%를 받고 전체 MAPE도 41.8% → 23.4%로 내려갔습니다.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
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
            {score.rows.map((r) => {
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

