"use client";

// 6. 기존 가맹점 검증 화면.
// 계산은 전부 src/lib/storeEval/calc.ts의 순수함수를 그대로 호출한다 - 이 파일에서 새로운
// 산식을 만들지 않는다 (요청사항). 이 화면이 하는 일은: Firestore에서 기존 가맹점 원본
// 데이터를 모아서 calc.ts가 요구하는 입력 형태로 가공하고, 계산 결과를 표/카드로 보여주는 것뿐이다.
//
// 2026-08-20 갱신: v61Predicted(스프레드시트에서 그대로 복사한 캐시값)를 더 이상 쓰지 않는다.
// 12개월 완료·블랙라벨·정상영업·산식학습제외 아닌 표본은 리브-원-아웃으로, 그 외 전부
// (12개월 미완료·브랜드 미확인·사후 운영이슈 등)는 학습에 전혀 쓰이지 않은 완전 외부 검증군으로
// runCohortValidation이 직접 예측한다(calc.ts). V62(외부유입 보정) 레이어는 그 예측값 위에
// 그대로 얹는다.

import { useEffect, useMemo, useState } from "react";
import {
  computeBoundedSales,
  computeV62Final,
  getV62Rate,
  runCohortValidation,
  summarizeValidationRows,
  type TenureCohort,
  type ValidationStoreInput,
  type ValidationStoreRow,
  type ValidationSummary2,
} from "@/lib/storeEval/calc";
import { formatNumber, formatPercent, formatWon } from "@/lib/storeEval/format";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import { getLocationEvaluation, getModelSettings, listExistingStores } from "@/lib/storeEval/store";
import type { ModelSettings } from "@/lib/storeEval/types";

// 목표 기준 (요청사항 8). ModelSettings에 없는 이유: 이 페이지 전용 "최종 목표" 상수라
// 운영설정(계산 계수)과 성격이 다르다 - 계수가 아니라 프로젝트 완료 기준이다.
const ACCURACY_TARGETS = { mape: 0.1, medianAe: 0.08, within10: 0.8, maxOver20: 0.1 };
// 기존 Google Sheet 참고 결과 (12_운영판정!B9/C9/E9, 26곳 - docs/model-spec.md 근거)
const REFERENCE_BENCHMARK = { sampleCount: 26, meanAbsoluteErrorPct: 0.117, medianAbsoluteErrorPct: 0.091, within20PctRatio: 0.769 };

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
      const loc = await getLocationEvaluation(s.storeCode);
      return {
        storeCode: s.storeCode,
        storeName: s.storeName,
        brand: loc?.brandType ?? null,
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

function CohortTable({ rows }: { rows: ValidationStoreRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[1200px] text-sm">
        <thead className="bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th className="px-3 py-2">점포명</th>
            <th className="px-3 py-2">브랜드</th>
            <th className="px-3 py-2">오픈일</th>
            <th className="px-3 py-2">완료월수</th>
            <th className="px-3 py-2">정상영업</th>
            <th className="px-3 py-2">예상매출평균</th>
            <th className="px-3 py-2">실제매출평균</th>
            <th className="px-3 py-2">오차금액</th>
            <th className="px-3 py-2">절대오차율</th>
            <th className="px-3 py-2">방향</th>
            <th className="px-3 py-2">핵심정확도 포함</th>
            <th className="px-3 py-2">제외/참고 사유</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.storeCode} className="text-zinc-800 dark:text-zinc-200">
              <td className="px-3 py-2 font-medium">{r.storeName}</td>
              <td className="px-3 py-2">{r.brand ?? "확인필요"}</td>
              <td className="px-3 py-2">{r.openedAt ?? "-"}</td>
              <td className="px-3 py-2">{r.completedMonths}개월</td>
              <td className="px-3 py-2">{r.franchiseStatus === "정상" ? "정상" : (r.franchiseStatus ?? "-")}</td>
              <td className="px-3 py-2">{formatWon(r.predictedRevenueAvg)}</td>
              <td className="px-3 py-2">{formatWon(r.actualRevenueAvg)}</td>
              <td className="px-3 py-2">{formatWon(r.errorAmount)}</td>
              <td className="px-3 py-2">{formatPercent(r.absoluteErrorPct)}</td>
              <td className={`px-3 py-2 font-medium ${directionColor(r.direction)}`}>{r.direction ?? "-"}</td>
              <td className="px-3 py-2">{r.includedInCoreAccuracy ? "예" : "아니오"}</td>
              <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">{r.exclusionReason ?? "-"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={12} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
                해당 코호트에 점포가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SummaryBlock({ title, summary, benchmark }: { title: string; summary: ValidationSummary2; benchmark?: typeof REFERENCE_BENCHMARK }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard title="표본 수" value={`${formatNumber(summary.sampleCount)}곳`} />
        <SummaryCard title="평균절대오차(MAPE)" value={formatPercent(summary.meanAbsoluteErrorPct)} passed={summary.passed.mape} />
        <SummaryCard title="중앙값절대오차" value={formatPercent(summary.medianAbsoluteErrorPct)} passed={summary.passed.medianAe} />
        <SummaryCard title="±10% 이내" value={formatPercent(summary.within10PctRatio)} passed={summary.passed.within10} />
        <SummaryCard title="±20% 초과" value={formatPercent(summary.over20PctRatio)} passed={summary.passed.over20} />
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
        <SummaryCard title="전체 예측편향" value={formatPercent(summary.meanBiasPct)} />
      </div>
      {benchmark && (
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          기존 Google Sheet 참고 결과({benchmark.sampleCount}개 점포): 평균오차 {formatPercent(benchmark.meanAbsoluteErrorPct)} · 중앙값{" "}
          {formatPercent(benchmark.medianAbsoluteErrorPct)} · ±20% 이내 {formatPercent(benchmark.within20PctRatio)}
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

    const coreRows = rows.filter((r) => r.includedInCoreAccuracy);
    const earlyNormalRows = rows.filter(
      (r) => !r.includedInCoreAccuracy && (r.cohort === "조기 검증 A" || r.cohort === "조기 검증 B" || r.cohort === "조기 검증 C") && !r.isPostOpenIssue && r.franchiseStatus === "정상" && (r.brand === "블랙라벨" || r.brand == null),
    );
    const combinedRows = [...coreRows, ...earlyNormalRows];
    const referenceRows = rows.filter((r) => r.isPostOpenIssue || r.cohort === "참고용");

    const coreSummary = summarizeValidationRows(coreRows, ACCURACY_TARGETS);
    const earlySummary = summarizeValidationRows(earlyNormalRows, ACCURACY_TARGETS);
    const combinedSummary = summarizeValidationRows(combinedRows, ACCURACY_TARGETS);
    const referenceSummary = summarizeValidationRows(referenceRows, ACCURACY_TARGETS);

    const byCohort = new Map<TenureCohort, ValidationStoreRow[]>();
    for (const r of rows) {
      const list = byCohort.get(r.cohort) ?? [];
      list.push(r);
      byCohort.set(r.cohort, list);
    }

    // V62(외부유입 보정) 레이어 - 방금 계산한 V61(핵심표본, 리브-원-아웃)을 그대로 얹는다.
    const v62Rows = coreRows.map((r) => {
      const loc = r.brand; // 이미 브랜드는 있으나 외부유입은 별도 로드 필요 - 근사로 판정 생략
      const v62Rate = getV62Rate(null, settings); // 외부유입 값은 이 화면에서 별도 페치하지 않으므로 "없음" 취급(0%)
      const v62 = computeV62Final(r.predictedRevenueAvg, v62Rate);
      const bounded = computeBoundedSales(v62, settings);
      return { ...r, v62, ...bounded, loc };
    });

    return { rows, coreRows, earlyNormalRows, combinedRows, referenceRows, coreSummary, earlySummary, combinedSummary, referenceSummary, byCohort, v62Rows, settings };
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

  const { coreSummary, combinedSummary, byCohort } = computed;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">6. 기존 가맹점 검증</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          V61 실측 학습모형(비음수 릿지회귀)의 예측치를 재직기간별 코호트로 나눠 검증합니다. 12개월 완료·블랙라벨·정상영업
          표본은 리브-원-아웃, 그 외는 학습에 전혀 쓰이지 않은 완전 외부 검증군으로 예측합니다.
        </p>
      </div>

      {/* 최상단 요약 (요청사항 8 형식) */}
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
            20% 초과: {coreSummary.buckets[4].count + coreSummary.buckets[5].count}개 (
            {formatPercent(coreSummary.over20PctRatio)})
          </li>
          <li>최종 ±10% 적중률: {formatPercent(coreSummary.within10PctRatio)}</li>
          <li>평균 절대오차율: {formatPercent(coreSummary.meanAbsoluteErrorPct)}</li>
          <li>중앙값 절대오차율: {formatPercent(coreSummary.medianAbsoluteErrorPct)}</li>
          <li className="font-semibold">
            정확도 목표(MAPE≤10%·중앙값≤8%·±10% 80%이상·±20%초과 10%이하): {coreSummary.targetsMetAll ? "달성" : "미달성"}
          </li>
        </ul>
      </section>

      <SummaryBlock title="1. 12개월 완료 정상영업점 적중률 (핵심 검증군, 리브-원-아웃)" summary={coreSummary} benchmark={REFERENCE_BENCHMARK} />
      <SummaryBlock title="2. 12개월 미완료 정상영업점 조기 적중률 (완전 외부 검증군)" summary={computed.earlySummary} />
      <SummaryBlock title="3. 두 검증군을 합친 전체 적중률" summary={combinedSummary} />
      <SummaryBlock title="4. 사후 운영이슈·참고용 점포까지 포함한 참고 적중률" summary={computed.referenceSummary} />

      {!coreSummary.targetsMetAll && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <h3 className="font-semibold">목표 미달성 — 정확도가 나온 것처럼 표시하지 않습니다</h3>
          <p className="mt-1">
            오차가 큰 점포의 공통 특징·데이터 누락 여부·산식 개선 후보는 화면 표만으로는 자동 판정하지 않습니다. 아래 점포별 표에서
            절대오차율이 큰 순서로 직접 확인하고, 필요하면 docs/data-issues.md에 원인 분석을 추가로 기록해주세요.
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
