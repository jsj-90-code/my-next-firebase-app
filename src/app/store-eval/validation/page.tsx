"use client";

// 6. 기존 가맹점 검증 화면.
// 계산은 전부 src/lib/storeEval/calc.ts의 순수함수를 그대로 호출한다 - 이 파일에서 새로운
// 산식을 만들지 않는다 (요청사항). 이 화면이 하는 일은: Firestore에서 기존 가맹점 원본
// 데이터를 모아서 calc.ts가 요구하는 입력 형태로 가공하고, 계산 결과를 표/카드로 보여주는 것뿐이다.
//
// 2026-08-20 갱신: v61Predicted(스프레드시트에서 그대로 복사한 캐시값)를 더 이상 쓰지 않는다.
// 12개월 완료·블랙라벨·정상영업·산식학습제외 아닌 표본은 리브-원-아웃으로, 그 외 전부
// (12개월 미완료·브랜드 미확인·사후 운영이슈 등)는 학습에 전혀 쓰이지 않은 완전 외부 검증군으로
// runCohortValidation이 직접 예측한다(calc.ts). V62(외부유입 보정)는 이제 runCohortValidation
// 내부에서 실제 09_입지동선평가!외부유입제한 값으로 계산한다(예전엔 이 화면에서 "없음" 취급으로
// 방치돼 있던 죽은 코드였다 - 실제 반영으로 고쳤다).

import { useEffect, useMemo, useState } from "react";
import {
  buildParityComparisonRows,
  computeValidationRow,
  runCohortValidation,
  summarizeValidation,
  summarizeValidationRows,
  computeCompetitorInvestigationSummary,
  type CompetitorInvestigationSummaryStatus,
  type DataCompletenessGrade,
  type ErrorCauseCode,
  type OperationalStatus,
  type ParityComparisonRow,
  type TenureCohort,
  type ValidationInputRow,
  type ValidationStoreInput,
  type ValidationStoreRow,
  type ValidationSummary2,
  type ValidationSummaryResult,
} from "@/lib/storeEval/calc";
import { formatNumber, formatPercent, formatWon } from "@/lib/storeEval/format";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import { getLocationEvaluation, getModelSettings, listCompetitors, listExistingStores } from "@/lib/storeEval/store";
import type { ModelSettings } from "@/lib/storeEval/types";

// 기존 Google Sheet 참고 결과 (06_검증대시보드, docs/model-spec.md 근거). 코드에서 재계산하지
//않고 시트에 이미 확정된 값을 그대로 옮겨 참고용으로만 비교한다 - 우리 쪽 산정식이 아니다.
const REFERENCE_BENCHMARK = {
  정식검증: { sampleCount: 26, meanAbsoluteErrorPct: 0.117, medianAbsoluteErrorPct: 0.091, within10PctRatio: 0.577, within20PctRatio: 0.769 },
  조기검증: { sampleCount: 5, meanAbsoluteErrorPct: 0.138, medianAbsoluteErrorPct: 0.134, within10PctRatio: 0.2, within20PctRatio: 0.8 },
  통합: { sampleCount: 31, meanAbsoluteErrorPct: 0.121, medianAbsoluteErrorPct: 0.099, within10PctRatio: 0.516, within20PctRatio: 0.774 },
};
type ReferenceBenchmark = (typeof REFERENCE_BENCHMARK)["정식검증"];

const ERROR_CAUSE_LABELS: Record<ErrorCauseCode, string> = {
  within_range: "목표 범위 이내",
  external_inflow_underreflected: "외부유입 제한 과소반영(추정)",
  special_demand_underreflected: "특수수요 과소반영(추정)",
  competitor_data_missing: "경쟁점 데이터 부족(추정)",
  access_overestimated: "접근성 과대평가(추정)",
  demand_share_overestimated: "수요확보율 과대평가(추정)",
  demand_conversion_underestimated: "수요전환율 과소평가(추정)",
  not_verifiable: "검증 불가(실적 없음)",
};

const OPERATIONAL_STATUS_LABELS: Record<OperationalStatus, string> = {
  normal: "정상",
  early: "초기(12개월 미만)",
  post_open_issue: "사후 운영이슈",
  abnormal: "비정상영업",
};

const DATA_COMPLETENESS_LABELS: Record<DataCompletenessGrade, string> = {
  complete: "완전(100점)",
  partial: "부분(75점)",
  excluded: "제외 대상(75점 미만)",
};

const COMPETITOR_STATUS_LABELS: Record<CompetitorInvestigationSummaryStatus, string> = {
  detailed_complete: "경쟁점 전체 상세조사",
  mixed: "상세·간이 혼재",
  light: "외관·간이조사만 존재",
  uninvestigated: "미조사",
};

const DIFF_STAGE_LABELS: Record<ParityComparisonRow["diffStage"], string> = {
  V61예측차이: "V61 예측 단계",
  외부유입보정률차이: "외부유입 보정률 단계",
  반올림차이: "반올림 단계(미미함)",
  일치: "일치",
  비교불가: "비교 불가(짝 없음)",
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; rows: ValidationStoreRow[]; settings: ModelSettings };

async function loadValidationData(): Promise<{ rows: ValidationStoreRow[]; settings: ModelSettings } | null> {
  const [stores, settingsDoc] = await Promise.all([listExistingStores(), getModelSettings()]);
  if (stores.length === 0) return null;
  const settings: ModelSettings = settingsDoc ?? { ...defaultModelSettings(), updatedAt: 0, updatedBy: null };

  const inputs: ValidationStoreInput[] = await Promise.all(
    stores.map(async (s) => {
      const [loc, competitors] = await Promise.all([getLocationEvaluation(s.storeCode), listCompetitors(s.storeCode)]);
      return {
        storeCode: s.storeCode,
        storeName: s.storeName,
        // 매출DB!지점명 배경색(노란색=블랙라벨) 기준으로 cron-sync가 채운 값을 우선 쓴다 -
        // 09_입지동선평가엔 행이 있는 매장만 브랜드가 있어 전체를 못 덮지만, 매출DB엔 전
        // 매장이 다 있어 이쪽이 더 포괄적이다(둘이 있는 41곳은 값이 서로 일치함을 확인함).
        brand: s.brandType ?? loc?.brandType ?? null,
        openedAt: s.openedAt,
        completedMonths: s.completedMonths ?? 0,
        franchiseStatus: s.franchiseStatus,
        isPostOpenIssue: s.excludedFromModel,
        postOpenIssueReason: s.excludedReason,
        pcCount: s.pcCount,
        hourlyRate: s.hourlyRate,
        ownDemand: s.ownDemand,
        competitivenessScore: s.competitivenessScore,
        actualRevenueAvg: s.actualMonthlyRevenueAvg,
        specialDemandType: s.specialDemandType,
        specialDemandIntensity: s.specialDemandIntensity,
        inflowRestriction: loc?.inflowRestriction ?? null,
        hasLocationEvaluation: loc != null,
        floor: s.floor,
        groundLevel: s.groundLevel,
        hasElevator: s.hasElevator,
        competitorSummary: computeCompetitorInvestigationSummary(competitors),
        sheetV61Predicted: s.v61Predicted,
      };
    }),
  );

  const { rows } = runCohortValidation(inputs, settings);
  return { rows, settings };
}

const COHORT_LABELS: Record<TenureCohort, string> = {
  "정식 검증군": "정식 검증군 (12개월 이상)",
  "조기 검증 A": "조기 검증 A (9~11개월)",
  "조기 검증 B": "조기 검증 B (6~8개월)",
  "조기 검증 C": "조기 검증 C (3~5개월)",
  참고용: "참고용 (1~2개월)",
  제외: "제외 (완료월 없음)",
};

function directionColor(direction: ValidationStoreRow["direction"]): string {
  if (direction === "과대예측") return "text-red-600 dark:text-red-400";
  if (direction === "과소예측") return "text-blue-600 dark:text-blue-400";
  return "text-zinc-500 dark:text-zinc-400";
}

function SummaryCard({ title, value, passed, sub }: { title: string; value: string; passed?: boolean; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
      <p className="mt-1 flex items-baseline gap-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {value}
        {passed !== undefined && (
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
              passed
                ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
            }`}
          >
            {passed ? "통과" : "미달"}
          </span>
        )}
      </p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{sub}</p>}
    </div>
  );
}

function countBy<T extends string>(rows: ValidationStoreRow[], pick: (r: ValidationStoreRow) => T): { key: T; count: number }[] {
  const counts = new Map<T, number>();
  for (const r of rows) {
    const key = pick(r);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count }));
}

function BreakdownCard({ title, rows, labels }: { title: string; rows: { key: string; count: number }[]; labels: Record<string, string> }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-zinc-800 dark:text-zinc-200">
        {rows.map((r) => (
          <li key={r.key} className="flex justify-between">
            <span>{labels[r.key] ?? r.key}</span>
            <span className="font-medium">{r.count}곳</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CohortTable({ rows }: { rows: ValidationStoreRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[1600px] text-sm">
        <thead className="bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th className="px-3 py-2">점포명</th>
            <th className="px-3 py-2">브랜드</th>
            <th className="px-3 py-2">완료월수</th>
            <th className="px-3 py-2">운영상태</th>
            <th className="px-3 py-2">데이터완성도</th>
            <th className="px-3 py-2">경쟁조사상태</th>
            <th className="px-3 py-2">예상매출(V62)</th>
            <th className="px-3 py-2">실제매출평균</th>
            <th className="px-3 py-2">오차금액</th>
            <th className="px-3 py-2">절대오차율</th>
            <th className="px-3 py-2">방향</th>
            <th className="px-3 py-2">우선 추정 원인</th>
            <th className="px-3 py-2">핵심정확도 포함</th>
            <th className="px-3 py-2">제외/참고 사유</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.storeCode} className="text-zinc-800 dark:text-zinc-200">
              <td className="px-3 py-2 font-medium">{r.storeName}</td>
              <td className="px-3 py-2">{r.brand ?? "확인필요"}</td>
              <td className="px-3 py-2">{r.completedMonths}개월</td>
              <td className="px-3 py-2">{OPERATIONAL_STATUS_LABELS[r.operationalStatus]}</td>
              <td className="px-3 py-2">{DATA_COMPLETENESS_LABELS[r.dataCompleteness.grade]}</td>
              <td className="px-3 py-2">{COMPETITOR_STATUS_LABELS[r.competitorSummary?.status ?? "uninvestigated"]}</td>
              <td className="px-3 py-2">{formatWon(r.v62PredictedRevenueAvg)}</td>
              <td className="px-3 py-2">{formatWon(r.actualRevenueAvg)}</td>
              <td className="px-3 py-2">{formatWon(r.errorAmount)}</td>
              <td className="px-3 py-2">{formatPercent(r.absoluteErrorPct)}</td>
              <td className={`px-3 py-2 font-medium ${directionColor(r.direction)}`}>{r.direction ?? "-"}</td>
              <td className="px-3 py-2 text-xs">{ERROR_CAUSE_LABELS[r.errorCause]}</td>
              <td className="px-3 py-2">{r.includedInCoreAccuracy ? "예" : "아니오"}</td>
              <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">{r.exclusionReason ?? "-"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={14} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
                해당 코호트에 점포가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** sheetParity(computeValidationRow/summarizeValidation, 기존 golden-data 검증됨) 요약 카드. */
function SheetParitySummaryBlock({ title, summary, benchmark }: { title: string; summary: ValidationSummaryResult; benchmark?: ReferenceBenchmark }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard title="표본 수" value={`${formatNumber(summary.sampleCount)}곳`} />
        <SummaryCard title="평균절대오차" value={formatPercent(summary.meanAbsoluteError)} />
        <SummaryCard title="중앙값절대오차" value={formatPercent(summary.medianAbsoluteError)} />
        <SummaryCard title="±10% 이내" value={formatPercent(summary.within10PctRatio)} />
        <SummaryCard title="±20% 이내" value={formatPercent(summary.within20PctRatio)} />
        <SummaryCard title="평균편향" value={formatPercent(summary.meanBias)} />
      </div>
      {benchmark && (
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          기존 Google Sheet 참고 결과({benchmark.sampleCount}개 점포): 평균오차 {formatPercent(benchmark.meanAbsoluteErrorPct)} · 중앙값{" "}
          {formatPercent(benchmark.medianAbsoluteErrorPct)} · ±10% 이내 {formatPercent(benchmark.within10PctRatio)} · ±20% 이내{" "}
          {formatPercent(benchmark.within20PctRatio)}
        </p>
      )}
    </section>
  );
}

function ParityComparisonTable({ rows }: { rows: ParityComparisonRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[1700px] text-sm">
        <thead className="bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th className="px-3 py-2">점포명</th>
            <th className="px-3 py-2">실제매출</th>
            <th className="px-3 py-2">시트 V61</th>
            <th className="px-3 py-2">웹 V61</th>
            <th className="px-3 py-2">시트 보정률</th>
            <th className="px-3 py-2">웹 보정률</th>
            <th className="px-3 py-2">시트 V62</th>
            <th className="px-3 py-2">웹 V62</th>
            <th className="px-3 py-2">예측금액 차이</th>
            <th className="px-3 py-2">시트 절대오차율</th>
            <th className="px-3 py-2">웹 절대오차율</th>
            <th className="px-3 py-2">차이 발생 단계</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.storeCode} className="text-zinc-800 dark:text-zinc-200">
              <td className="px-3 py-2 font-medium">{r.storeName}</td>
              <td className="px-3 py-2">{formatWon(r.actualRevenueAvg)}</td>
              <td className="px-3 py-2">{formatWon(r.sheetV61Predicted)}</td>
              <td className="px-3 py-2">{formatWon(r.webV61Predicted)}</td>
              <td className="px-3 py-2">{formatPercent(r.sheetInflowRate)}</td>
              <td className="px-3 py-2">{formatPercent(r.webInflowRate)}</td>
              <td className="px-3 py-2">{formatWon(r.sheetV62Predicted)}</td>
              <td className="px-3 py-2">{formatWon(r.webV62Predicted)}</td>
              <td className="px-3 py-2">{formatWon(r.predictionDiff)}</td>
              <td className="px-3 py-2">{formatPercent(r.sheetAbsoluteErrorPct)}</td>
              <td className="px-3 py-2">{formatPercent(r.webAbsoluteErrorPct)}</td>
              <td className="px-3 py-2 text-xs">{DIFF_STAGE_LABELS[r.diffStage]}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={12} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
                비교할 매장이 없습니다(시트 V61 캐시값이 있는 블랙라벨 매장만 대상).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SummaryBlock({ title, summary, benchmark }: { title: string; summary: ValidationSummary2; benchmark?: ReferenceBenchmark }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard title="표본 수" value={`${formatNumber(summary.sampleCount)}곳`} />
        <SummaryCard title="평균절대오차(MAPE)" value={formatPercent(summary.meanAbsoluteErrorPct)} passed={summary.passed.mape} />
        <SummaryCard title="중앙값절대오차" value={formatPercent(summary.medianAbsoluteErrorPct)} passed={summary.passed.medianAe} />
        <SummaryCard title="±5% 이내" value={formatPercent(summary.within5PctRatio)} />
        <SummaryCard title="±10% 이내" value={formatPercent(summary.within10PctRatio)} passed={summary.passed.within10} />
        <SummaryCard title="±20% 이내" value={formatPercent(summary.within20PctRatio)} passed={summary.passed.within20} />
        <SummaryCard title="평균편향" value={formatPercent(summary.meanBiasPct)} passed={summary.passed.bias} />
        <SummaryCard
          title="과대예측"
          value={`${summary.overPredictedCount}곳`}
          sub={summary.overPredictedMeanPct != null ? `평균 +${formatPercent(summary.overPredictedMeanPct)}` : undefined}
        />
        <SummaryCard
          title="과소예측"
          value={`${summary.underPredictedCount}곳`}
          sub={summary.underPredictedMeanPct != null ? `평균 ${formatPercent(summary.underPredictedMeanPct)}` : undefined}
        />
      </div>
      <p
        className={`rounded-lg px-3 py-2 text-xs font-medium ${
          summary.overallStatus === "정식 사용 가능"
            ? "bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-300"
            : summary.overallStatus === "조건부 사용"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
              : "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-300"
        }`}
      >
        현재 상태: {summary.overallStatus} — {summary.statusReason}
      </p>
      {benchmark && (
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          기존 Google Sheet 참고 결과({benchmark.sampleCount}개 점포): 평균오차 {formatPercent(benchmark.meanAbsoluteErrorPct)} · 중앙값{" "}
          {formatPercent(benchmark.medianAbsoluteErrorPct)} · ±10% 이내 {formatPercent(benchmark.within10PctRatio)} · ±20% 이내{" "}
          {formatPercent(benchmark.within20PctRatio)}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">오차 구간</th>
              <th className="px-3 py-2">점포 수</th>
              <th className="px-3 py-2">비율</th>
              <th className="px-3 py-2">점포명</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {summary.buckets.map((b) => (
              <tr key={b.label}>
                <td className="px-3 py-2 font-medium">{b.label}</td>
                <td className="px-3 py-2">{b.count}곳</td>
                <td className="px-3 py-2">{formatPercent(b.ratio)}</td>
                <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">{b.storeNames.join(", ") || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ValidationPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setState({ status: "loading" });
      try {
        const data = await loadValidationData();
        if (cancelled) return;
        setState(data ? { status: "ready", rows: data.rows, settings: data.settings } : { status: "empty" });
      } catch (err) {
        if (cancelled) return;
        setState({ status: "error", message: err instanceof Error ? err.message : "데이터를 불러오지 못했습니다." });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const computed = useMemo(() => {
    if (state.status !== "ready") return null;
    const { rows, settings } = state;

    const targets = {
      mape: settings.targetMAE,
      medianAe: settings.targetMedianAE,
      within10: settings.target10pctRatio,
      within20: settings.target20pctRatio,
      maxBias: settings.maxAvgBias,
    };

    // 블랙라벨 매장만 검증한다 — 리그PC방·브랜드 미확인 매장은 코호트 표시 자체에서 뺀다
    // (사용자 지시: "정식검증군에 리그매장 들어가있다, 블랙라벨매장만 검증할거다").
    const blackLabelRows = rows.filter((r) => r.brand === "블랙라벨");
    const excludedNonBlackLabelCount = rows.length - blackLabelRows.length;

    const coreRows = blackLabelRows.filter((r) => r.includedInCoreAccuracy);
    // 요청사항 1 — 조기검증 포함조건: 완료개월 3~11개월(코호트 A/B/C) + 실제/예측 존재 + 블랙라벨
    // + 학습제외 아님(사후 운영이슈 아님) + 정상영업.
    const earlyNormalRows = blackLabelRows.filter(
      (r) =>
        !r.includedInCoreAccuracy &&
        (r.cohort === "조기 검증 A" || r.cohort === "조기 검증 B" || r.cohort === "조기 검증 C") &&
        !r.isPostOpenIssue &&
        r.franchiseStatus === "정상" &&
        r.actualRevenueAvg != null &&
        r.v62PredictedRevenueAvg != null,
    );
    const combinedRows = [...coreRows, ...earlyNormalRows];
    const referenceRows = blackLabelRows.filter((r) => r.isPostOpenIssue || r.cohort === "참고용");

    const coreSummary = summarizeValidationRows(coreRows, targets);
    const earlySummary = summarizeValidationRows(earlyNormalRows, targets);
    const combinedSummary = summarizeValidationRows(combinedRows, targets);
    const referenceSummary = summarizeValidationRows(referenceRows, targets);

    // sheetParity — 시트에 저장된 V61 캐시값 + 외부유입 보정만 적용해 "시트가 원래 보여주던
    // 결과"를 재현한다(computeValidationRow/summarizeValidation은 이미 golden-data로 검증됨).
    // loocvValidation(위 coreRows 등)과 절대 같은 표에 섞지 않는다.
    const toSheetInputRow = (r: ValidationStoreRow): ValidationInputRow | null => {
      if (r.sheetV61Predicted == null || r.actualRevenueAvg == null) return null;
      return {
        storeCode: r.storeCode,
        storeName: r.storeName,
        actualSales: r.actualRevenueAvg,
        v61Predicted: r.sheetV61Predicted,
        inflowRestriction: r.inflowRestriction ?? "미평가",
        brandType: r.brand ?? "확인필요",
      };
    };
    const sheetCoreComputed = coreRows.map(toSheetInputRow).filter((r): r is ValidationInputRow => r != null).map((r) => computeValidationRow(r, settings));
    const sheetEarlyComputed = earlyNormalRows.map(toSheetInputRow).filter((r): r is ValidationInputRow => r != null).map((r) => computeValidationRow(r, settings));
    const sheetCombinedComputed = [...sheetCoreComputed, ...sheetEarlyComputed];
    const sheetCoreSummary = summarizeValidation(sheetCoreComputed, settings);
    const sheetEarlySummary = summarizeValidation(sheetEarlyComputed, settings);
    const sheetCombinedSummary = summarizeValidation(sheetCombinedComputed, settings);

    // 매장별 비교표(sheetParity vs loocvValidation) — 정식검증+조기검증 대상만.
    const parityRows = buildParityComparisonRows(combinedRows, combinedRows, settings);

    const byCohort = new Map<TenureCohort, ValidationStoreRow[]>();
    for (const r of blackLabelRows) {
      const list = byCohort.get(r.cohort) ?? [];
      list.push(r);
      byCohort.set(r.cohort, list);
    }

    const completenessCounts = countBy(combinedRows, (r) => r.dataCompleteness.grade);
    const competitorStatusCounts = countBy(combinedRows, (r) => r.competitorSummary?.status ?? "uninvestigated");

    return {
      rows,
      excludedNonBlackLabelCount,
      coreRows,
      earlyNormalRows,
      combinedRows,
      referenceRows,
      coreSummary,
      earlySummary,
      combinedSummary,
      referenceSummary,
      sheetCoreSummary,
      sheetEarlySummary,
      sheetCombinedSummary,
      parityRows,
      byCohort,
      completenessCounts,
      competitorStatusCounts,
      settings,
    };
  }, [state]);

  if (state.status === "loading") {
    return (
      <div className="rounded-2xl border border-zinc-200 px-8 py-16 text-center text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        불러오는 중...
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
        <h2 className="text-lg font-semibold">데이터를 불러오지 못했습니다</h2>
        <p className="mt-2 text-sm leading-6">{state.message}</p>
      </div>
    );
  }

  if (state.status === "empty" || !computed) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">아직 등록된 기존 가맹점이 없습니다</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          기존 가맹점 마스터(storeEvalExistingStores)와 학습 특징치가 Firestore에 들어오면 이 화면에 검증 결과가 표시됩니다.
        </p>
      </div>
    );
  }

  const {
    coreSummary,
    combinedSummary,
    byCohort,
    completenessCounts,
    competitorStatusCounts,
    excludedNonBlackLabelCount,
    sheetCoreSummary,
    sheetEarlySummary,
    sheetCombinedSummary,
    parityRows,
  } = computed;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">6. 기존 가맹점 검증</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          V61 실측 학습모형(비음수 릿지회귀)에 외부유입 보정(V62)까지 적용한 예측치를 재직기간별 코호트로 나눠 검증합니다. 12개월 완료·
          블랙라벨·정상영업 표본은 리브-원-아웃, 그 외는 학습에 전혀 쓰이지 않은 완전 외부 검증군으로 예측합니다. 블랙라벨 매장만
          검증하며{excludedNonBlackLabelCount > 0 ? `, 리그PC방·브랜드 미확인 ${excludedNonBlackLabelCount}곳은 이 화면에서 제외됩니다.` : "."}
        </p>
      </div>

      {/* 요청사항 6 — 공식 성능/이관 검증용 구분 결론 */}
      <section className="rounded-xl border border-sky-300 bg-sky-50 p-4 text-sm leading-6 text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
        <h3 className="font-semibold">웹 V62와 시트 V62 차이 원인 확인 결과</h3>
        <p className="mt-1">
          아래 "sheetParity"는 시트에 저장된 V61 캐시값 그대로 재현한 결과, "loocvValidation"은 매 매장을 학습에서 뺀 뒤 다시 학습해
          예측한 결과입니다. 두 값의 차이는 계산 버그가 아니라 <b>검증점포를 학습에 포함했는지 여부</b>(시트=전체 26곳으로 학습한 모형이
          자기 자신을 예측 / 웹=리브-원-아웃으로 자기 자신을 뺀 모형이 예측)에서 대부분 설명됩니다. 나머지 항목(입력 특징값·결측값 처리·
          릿지계수/lambda·외부유입 보정 순서·반올림 시점)은 점검 결과 동일했습니다 — 아래 "차이 원인 점검표" 참고. LOOCV 구현 자체에는
          문제가 없다고 확인했으므로, <b>공식 모델 성능은 loocvValidation을 사용</b>하고 sheetParity는 이관(마이그레이션) 검증용으로만
          남겨둡니다.
        </p>
      </section>

      {/* 최상단 요약 (요청사항 8/10 형식) */}
      <section className="rounded-2xl border border-zinc-300 bg-zinc-50 p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">검증 결과 요약</h2>
        <ul className="mt-3 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
          <li>핵심 검증점포: {coreSummary.sampleCount}개</li>
          <li>
            ±5% 이내: {coreSummary.buckets[0].count}개 ({formatPercent(coreSummary.buckets[0].ratio)})
          </li>
          <li>
            5% 초과~10% 이내: {coreSummary.buckets[1].count}개 ({formatPercent(coreSummary.buckets[1].ratio)})
          </li>
          <li>
            10% 초과~20% 이내: {coreSummary.buckets[2].count + coreSummary.buckets[3].count}개 (
            {formatPercent((coreSummary.buckets[2].count + coreSummary.buckets[3].count) / (coreSummary.sampleCount || 1))})
          </li>
          <li>
            20% 초과: {coreSummary.buckets[4].count + coreSummary.buckets[5].count}개 ({formatPercent(coreSummary.over20PctRatio)})
          </li>
          <li>최종 ±10% 적중률: {formatPercent(coreSummary.within10PctRatio)}</li>
          <li>평균 절대오차율: {formatPercent(coreSummary.meanAbsoluteErrorPct)}</li>
          <li>중앙값 절대오차율: {formatPercent(coreSummary.medianAbsoluteErrorPct)}</li>
          <li className="font-semibold">
            현재 상태: {coreSummary.overallStatus} — {coreSummary.statusReason}
          </li>
        </ul>
      </section>

      <SummaryBlock title="1. 12개월 완료 정상영업점 적중률 (정식검증, 리브-원-아웃)" summary={coreSummary} benchmark={REFERENCE_BENCHMARK.정식검증} />
      <SummaryBlock title="2. 12개월 미완료 정상영업점 조기 적중률 (조기검증, 완전 외부 검증군)" summary={computed.earlySummary} benchmark={REFERENCE_BENCHMARK.조기검증} />
      <SummaryBlock title="3. 정식검증+조기검증 통합 적중률" summary={combinedSummary} benchmark={REFERENCE_BENCHMARK.통합} />
      <SummaryBlock title="4. 사후 운영이슈·참고용 점포까지 포함한 참고 적중률" summary={computed.referenceSummary} />

      <section className="space-y-4 rounded-2xl border border-zinc-300 p-5 dark:border-zinc-700">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">sheetParity — 시트 재현 (이관 검증용, 공식 성능 아님)</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            시트에 저장된 V61 예측값(재계산 없이 그대로)에 외부유입 보정만 적용한 결과입니다. 아래 loocvValidation과 절대 섞지 않습니다.
          </p>
        </div>
        <SheetParitySummaryBlock title="정식검증(시트 재현)" summary={sheetCoreSummary} benchmark={REFERENCE_BENCHMARK.정식검증} />
        <SheetParitySummaryBlock title="조기검증(시트 재현)" summary={sheetEarlySummary} benchmark={REFERENCE_BENCHMARK.조기검증} />
        <SheetParitySummaryBlock title="통합(시트 재현)" summary={sheetCombinedSummary} benchmark={REFERENCE_BENCHMARK.통합} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">매장별 비교표 — sheetParity vs loocvValidation</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            정식검증+조기검증 대상 매장만. "차이 발생 단계"는 V61 예측 → 외부유입 보정률 → 반올림 순으로 처음 어긋난 지점을 표시합니다.
          </p>
        </div>
        <ParityComparisonTable rows={parityRows} />
      </section>

      <section className="rounded-xl border border-zinc-300 bg-white p-4 text-sm leading-6 dark:border-zinc-700 dark:bg-zinc-950">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">차이 원인 점검표</h3>
        <ul className="mt-2 space-y-1.5 text-zinc-700 dark:text-zinc-300">
          <li>
            <b>학습대상 점포 차이</b>: 없음 — 시트·웹 모두 블랙라벨·정상영업·산식학습제외 아님·12개월 완료 26곳을 학습에 쓴다.
          </li>
          <li>
            <b>검증점포 학습 제외 여부</b>: 있음(핵심 원인) — 시트는 26곳 전체로 학습한 단일 모형이 자기 자신을 예측(인샘플), 웹은
            리브-원-아웃으로 자기 자신을 뺀 25곳 모형이 예측(완전 홀드아웃)한다. 웹이 시트보다 값이 더 크게 흔들리는 건 정상이다.
          </li>
          <li>
            <b>입력 특징값 차이</b>: 없음 — 요금·자사수요/PC대수·경쟁력점수 3개 특징 모두 storeEvalExistingStores의 같은 필드를 쓴다.
          </li>
          <li>
            <b>결측값 처리 차이</b>: 없음 — 둘 다 학습표본 최소개수(12) 미달이면 예측하지 않는다(임의로 채우지 않음).
          </li>
          <li>
            <b>표준화 방식 차이</b>: 있음(부수 효과) — 웹 리브-원-아웃은 매번 25곳 기준으로 평균/표준편차를 다시 구하고, 시트는 26곳
            고정 기준이다. 리브-원-아웃 방식상 불가피하며, 표본 하나 차이라 영향은 작다.
          </li>
          <li>
            <b>릿지계수와 lambda 차이</b>: 없음 — ridgeLambda=1·ridgeWeight=0.6·baselineWeight=0.4·최소표본12 모두 08_계산기준
            VALIDATION 값을 운영설정에서 그대로 쓴다.
          </li>
          <li>
            <b>외부유입 보정 적용 순서</b>: 없음 — 둘 다 V62=V61×(1+보정률)을 V61 확정 이후에 적용하고, 보정률 조회 소스(09_입지동선평가!
            외부유입제한)도 동일하다.
          </li>
          <li>
            <b>반올림 시점 차이</b>: 없음 — 둘 다 V61을 반올림한 뒤 그 값으로 V62를 다시 반올림한다(이중 반올림이지만 시트·웹 동일).
          </li>
        </ul>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BreakdownCard title="데이터 완성도별 매장 수 (정식+조기)" rows={completenessCounts} labels={DATA_COMPLETENESS_LABELS} />
        <BreakdownCard title="경쟁점 조사상태별 매장 수 (정식+조기)" rows={competitorStatusCounts} labels={COMPETITOR_STATUS_LABELS} />
      </section>

      {!coreSummary.targetsMetAll && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <h3 className="font-semibold">목표 미달성 — 정확도가 나온 것처럼 표시하지 않습니다</h3>
          <p className="mt-1">
            점포별 표의 "우선 추정 원인" 열은 확정 진단이 아니라 검토 우선순위 참고용입니다. 오차가 큰 점포는 아래 표에서 절대오차율이
            큰 순서로 직접 확인하고, 필요하면 docs/data-issues.md에 원인 분석을 추가로 기록해주세요.
          </p>
        </section>
      )}

      {/* 코호트별 상세 표 */}
      {(["정식 검증군", "조기 검증 A", "조기 검증 B", "조기 검증 C", "참고용", "제외"] as TenureCohort[]).map((cohort) => {
        const rows = byCohort.get(cohort) ?? [];
        return (
          <section key={cohort}>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {COHORT_LABELS[cohort]} ({rows.length}곳)
            </h2>
            <div className="mt-2">
              <CohortTable rows={rows} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
