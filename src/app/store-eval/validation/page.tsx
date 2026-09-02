"use client";

// 6. 기존 가맹점 검증 화면.
// 계산은 전부 src/lib/storeEval/calc.ts의 순수함수를 그대로 호출한다 - 이 파일에서 새로운
// 산식을 만들지 않는다 (요청사항). 이 화면이 하는 일은: Firestore에서 기존 가맹점 원본
// 데이터를 모아서 calc.ts가 요구하는 입력 형태로 가공하고, 계산 결과를 표/카드로 보여주는 것뿐이다.
//
// 2026-08-20 갱신: v61Predicted(스프레드시트에서 그대로 복사한 캐시값)를 더 이상 쓰지 않는다.
// 완료월 CORE_VALIDATION_MIN_MONTHS 이상·블랙라벨·정상영업·산식학습제외 아닌 표본은 리브-원-아웃으로,
// 그 외 전부(브랜드 미확인·사후 운영이슈 등)는 학습에 전혀 쓰이지 않은 완전 외부 검증군으로
// runCohortValidation이 직접 예측한다(calc.ts). V62(외부유입 보정)는 이제 runCohortValidation
// 내부에서 실제 09_입지동선평가!외부유입제한 값으로 계산한다(예전엔 이 화면에서 "없음" 취급으로
// 방치돼 있던 죽은 코드였다 - 실제 반영으로 고쳤다).

import { useEffect, useMemo, useState } from "react";
import {
  buildParityComparisonRows,
  computeExistingStoreMeasuredForecast,
  computeValidationRow,
  describeNotVerifiableReason,
  diagnoseLoocvSensitivity,
  runCohortValidation,
  summarizeValidation,
  summarizeValidationRows,
  computeCompetitorInvestigationSummary,
  CORE_VALIDATION_MIN_MONTHS,
  type CompetitorInvestigationSummaryStatus,
  type DataCompletenessGrade,
  type ErrorCauseCode,
  type LoocvSensitivityDiagnostic,
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
import { getModelSettings, listAllCompetitors, listAllLocationEvaluations, listExistingStores } from "@/lib/storeEval/store";
import type { Competitor, ExistingStore, LocationEvaluation, ModelSettings } from "@/lib/storeEval/types";

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
  monopoly_market_unmodeled: "확인된 독점상권(경쟁점 없음, 모델 미반영)",
  access_overestimated: "접근성 과대평가(추정)",
  demand_share_overestimated: "수요확보율 과대평가(추정)",
  demand_conversion_underestimated: "수요전환율 과소평가(추정)",
  // 실제로는 항상 describeNotVerifiableReason()으로 대체 표시되어 이 값 자체는 화면에 안 뜨지만
  // (line 262 참고), 혹시 모를 다른 참조를 위해 "실적 없음"으로 단정하지 않는 중립적 문구로 둔다
  // — 검단사거리점처럼 실제매출은 있는데 예측만 안 나오는 경우도 이 코드로 분류되기 때문이다.
  not_verifiable: "검증 불가(사유 확인 필요)",
};

const OPERATIONAL_STATUS_LABELS: Record<OperationalStatus, string> = {
  normal: "정상",
  // 2026-09-02 이후 이 상태는 "완료월 1개월 미만 등으로 정식 검증군에 못 든 매장"을 뜻한다
  // (calc.ts computeOperationalStatus는 cohort로만 판정하므로 12개월과 무관하다). 12개월
  // 미만 표기는 운영기간 열의 TenureBadge가 따로 담당한다.
  early: "초기(완료월 부족)",
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
  confirmed_no_competitor: "확인된 독점상권(경쟁점 없음)",
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
  | {
      status: "ready";
      rows: ValidationStoreRow[];
      settings: ModelSettings;
      existingStoresByCode: Map<string, ExistingStore>;
      competitorsByCode: Map<string, Competitor[]>;
      locationEvaluationsByCode: Map<string, LocationEvaluation | null>;
    };

async function loadValidationData(): Promise<{
  rows: ValidationStoreRow[];
  settings: ModelSettings;
  existingStoresByCode: Map<string, ExistingStore>;
  competitorsByCode: Map<string, Competitor[]>;
  locationEvaluationsByCode: Map<string, LocationEvaluation | null>;
} | null> {
  // 2026-08-31 — 매장별로 경쟁점/입지평가를 개별 where 쿼리하던 방식(133곳 x 2 = 260회 이상)을
  // 컬렉션 전체를 한 번씩만 읽는 방식으로 교체했다(cronSync.ts가 이미 쓰고 있던 것과 동일한
  // 패턴). 이 화면을 열 때마다 Firestore 일일 읽기 할당량을 크게 소모하고 있었던 게 원인으로
  // 확인돼 급하게 고쳤다 - 계산 로직은 전혀 안 바꾸고 데이터 조회 방식만 바꾼다.
  const [stores, settingsDoc, allCompetitors, allLocationEvaluations] = await Promise.all([
    listExistingStores(),
    getModelSettings(),
    listAllCompetitors(),
    listAllLocationEvaluations(),
  ]);
  if (stores.length === 0) return null;
  const settings: ModelSettings = settingsDoc ?? { ...defaultModelSettings(), updatedAt: 0, updatedBy: null };

  const existingStoresByCode = new Map(stores.map((s) => [s.storeCode, s]));
  const allCompetitorsByCandidateCode = new Map<string, Competitor[]>();
  for (const c of allCompetitors) {
    const list = allCompetitorsByCandidateCode.get(c.candidateCode) ?? [];
    list.push(c);
    allCompetitorsByCandidateCode.set(c.candidateCode, list);
  }
  const allLocationEvaluationsByCandidateCode = new Map(allLocationEvaluations.map((l) => [l.candidateCode, l]));

  const competitorsByCode = new Map<string, Competitor[]>();
  // 2026-08-30(§12) — computeExistingStoreMeasuredForecast가 이제 loc을 받으므로(자사 입지10%
  // 컴포넌트), 이 루프에서 어차피 매장마다 한 번씩 조회하는 loc을 재사용할 수 있게 저장해둔다.
  const locationEvaluationsByCode = new Map<string, LocationEvaluation | null>();

  const inputs: ValidationStoreInput[] = stores.map((s) => {
      // 전환 시 실제 가맹점코드가 후보지코드와 달라질 수 있다(2026-08-22 확인) - 경쟁점/입지평가는
      // 후보지코드(candidateCode)로 저장돼 있으므로, originCandidateCode가 있으면 그걸로 찾는다.
      const lookupCode = s.originCandidateCode ?? s.storeCode;
      const loc = allLocationEvaluationsByCandidateCode.get(lookupCode) ?? null;
      const competitors = allCompetitorsByCandidateCode.get(lookupCode) ?? [];
      competitorsByCode.set(s.storeCode, competitors);
      locationEvaluationsByCode.set(s.storeCode, loc);
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
        evaluationPcCount: s.evaluationPcCount,
        hourlyRate: s.hourlyRate,
        ownDemand: s.ownDemand,
        marketDemand: s.marketDemand,
        competitorIp: s.competitorIp,
        competitivenessScore: s.competitivenessScore,
        competitivenessGap: s.competitivenessGap,
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
    });

  const { rows } = runCohortValidation(inputs, settings);
  return { rows, settings, existingStoresByCode, competitorsByCode, locationEvaluationsByCode };
}

// 2026-09-02 — 정식 검증군 기준이 12개월 → 1개월로 바뀌었다(calc.ts CORE_VALIDATION_MIN_MONTHS,
// 사용자 확정). 조기검증 구간 라벨은 그 상수를 다시 올릴 때만 쓰인다(현재 도달 불가).
const COHORT_LABELS: Record<TenureCohort, string> = {
  "정식 검증군": `정식 검증군 (${CORE_VALIDATION_MIN_MONTHS}개월 이상)`,
  "조기 검증 A": "조기 검증 A (9~11개월)",
  "조기 검증 B": "조기 검증 B (6~8개월)",
  "조기 검증 C": "조기 검증 C (3~5개월)",
  참고용: "참고용 (완료월 부족)",
  제외: "제외 (완료월 없음)",
};

function directionColor(direction: ValidationStoreRow["direction"]): string {
  if (direction === "과대예측") return "text-[var(--sl-danger)]";
  if (direction === "과소예측") return "text-[var(--sl-info)]";
  return "text-[#8a8072]";
}

function SummaryCard({ title, value, passed, sub }: { title: string; value: string; passed?: boolean; sub?: string }) {
  return (
    <div className="app-card rounded-xl p-4">
      <p className="text-xs font-medium text-[#8a8072]">{title}</p>
      <p className="mt-1 flex items-baseline gap-1.5 text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">
        {value}
        {passed !== undefined && (
          <span className={`app-badge ${passed ? "app-badge-ok" : "app-badge-danger"}`}>
            {passed ? "통과" : "미달"}
          </span>
        )}
      </p>
      {sub && <p className="mt-0.5 text-xs text-[#8a8072]">{sub}</p>}
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
    <div className="app-card rounded-xl p-4">
      <p className="text-xs font-medium text-[#8a8072]">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-[#171310] dark:text-[#f2ede2]">
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
    <div className="overflow-x-auto rounded-xl border border-[#171310]/[0.08] dark:border-white/[0.08]">
      <table className="w-full min-w-[1600px] text-sm">
        <thead className="app-card-sm text-left text-xs font-medium text-[#8a8072]">
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
            <th className="px-3 py-2">정식검증 포함</th>
            <th className="px-3 py-2">조기검증 포함</th>
            <th className="px-3 py-2">제외/참고 사유</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#171310]/[0.06] dark:divide-white/[0.06]">
          {rows.map((r) => (
            <tr key={r.storeCode} className="text-[#171310] dark:text-[#f2ede2]">
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
              <td className="px-3 py-2 text-xs">
                {r.errorCause === "not_verifiable" ? describeNotVerifiableReason(r) : ERROR_CAUSE_LABELS[r.errorCause]}
              </td>
              <td className="px-3 py-2">{r.includedInCoreAccuracy ? "예" : "아니오"}</td>
              <td className="px-3 py-2">{r.includedInEarlyValidation ? "예" : "아니오"}</td>
              <td className="px-3 py-2 text-xs text-[#8a8072]">{r.exclusionReason ?? "-"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={15} className="px-3 py-6 text-center text-[#8a8072]">
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
      <h3 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard title="표본 수" value={`${formatNumber(summary.sampleCount)}곳`} />
        <SummaryCard title="평균절대오차" value={formatPercent(summary.meanAbsoluteError)} />
        <SummaryCard title="중앙값절대오차" value={formatPercent(summary.medianAbsoluteError)} />
        <SummaryCard title="±10% 이내" value={formatPercent(summary.within10PctRatio)} />
        <SummaryCard title="±20% 이내" value={formatPercent(summary.within20PctRatio)} />
        <SummaryCard title="평균편향" value={formatPercent(summary.meanBias)} />
      </div>
      {benchmark && (
        <p className="app-card-sm rounded-lg px-3 py-2 text-xs text-[#5c5346] dark:text-[#c9bfae]">
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
    <div className="overflow-x-auto rounded-xl border border-[#171310]/[0.08] dark:border-white/[0.08]">
      <table className="w-full min-w-[1700px] text-sm">
        <thead className="app-card-sm text-left text-xs font-medium text-[#8a8072]">
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
            <th className="px-3 py-2">비고</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#171310]/[0.06] dark:divide-white/[0.06]">
          {rows.map((r) => (
            <tr key={r.storeCode} className="text-[#171310] dark:text-[#f2ede2]">
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
              <td className="px-3 py-2 text-xs">
                {r.isLoocvHighVariance && (
                  <span className="app-badge app-badge-warn">LOOCV 고변동 점포</span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={13} className="px-3 py-6 text-center text-[#8a8072]">
                비교할 매장이 없습니다(시트 V61 캐시값이 있는 블랙라벨 매장만 대상).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * "LOOCV 고변동 점포"(예: 시흥배곧점, ±30% 초과)의 원인을 그대로 보여주는 진단 블록. 계수·
 * 입력값을 수정하지 않고 diagnoseLoocvSensitivity 결과를 노출만 한다(1회성 스크립트 대체).
 */
function LoocvDiagnosticBlock({ diagnostic }: { diagnostic: LoocvSensitivityDiagnostic }) {
  const fmtNum = (v: number | null) => (v == null ? "-" : v.toFixed(4));
  return (
    <div className="rounded-xl border border-[var(--sl-warn)]/30 bg-[var(--sl-warn-soft)] p-4 text-sm leading-6 text-[#171310] dark:text-[#f2ede2]">
      <h4 className="font-semibold">{diagnostic.storeName} — LOOCV 고변동 원인 진단(참고용, 계수 임의 수정 없음)</h4>
      <ul className="mt-2 space-y-1 text-xs">
        <li>입력 특징값(log요금·log수요/PC·경쟁력점수): {diagnostic.featuresRaw.map((v) => v.toFixed(4)).join(", ")}</li>
        <li>
          학습표본 수: 포함 {diagnostic.sampleCountWith}곳 / 제외(리브-원-아웃) {diagnostic.sampleCountWithout}곳
        </li>
        <li>회귀계수(포함): {diagnostic.coefficientsWith?.map(fmtNum).join(", ") ?? "-"}</li>
        <li>회귀계수(제외): {diagnostic.coefficientsWithout?.map(fmtNum).join(", ") ?? "-"}</li>
        <li>ridge 단독 예측: {formatWon(diagnostic.ridgeOnlyPrediction)}</li>
        <li>baseline(중앙값) 단독 예측: {formatWon(diagnostic.baselineOnlyPrediction)}</li>
        <li>0.6/0.4 혼합 예측(제외 학습모형 기준): {formatWon(diagnostic.blendedPrediction)}</li>
        <li>
          학습범위 이탈 여부: {diagnostic.isOutOfTrainingRange ? "예 — 이 매장을 빼면 나머지 표본 범위 밖의 값이 된다" : "아니오"}
        </li>
      </ul>
    </div>
  );
}

// 처음 이 화면을 보는 사람을 위한 상태 배지 — overallStatus(calc.ts summarizeValidationRows)를
// 색상·평문 설명으로 번역해서 보여준다. 판정 로직은 그대로, 표시만 눈에 띄게 바꾼 것.
const OVERALL_STATUS_STYLE: Record<ValidationSummary2["overallStatus"], { badge: string; plain: string }> = {
  "정식 사용 가능": {
    badge: "border-[var(--sl-ok)]/35 bg-[var(--sl-ok-soft)] text-[#171310] dark:text-[#f2ede2]",
    plain: "모델이 목표 정확도를 모두 충족했습니다. 신규 후보지 매출 예측에 그대로 사용해도 됩니다.",
  },
  "조건부 사용": {
    badge: "border-[var(--sl-warn)]/35 bg-[var(--sl-warn-soft)] text-[#171310] dark:text-[#f2ede2]",
    plain: "일부 목표치를 못 채웠습니다. 참고용으로 쓰되, 중요한 의사결정 전에는 아래에서 오차가 큰 매장을 함께 확인하세요.",
  },
  "재보정 필요": {
    badge: "border-[var(--sl-danger)]/35 bg-[var(--sl-danger-soft)] text-[#171310] dark:text-[#f2ede2]",
    plain: "정확도 목표를 다수 못 채웠습니다. 이 결과를 그대로 의사결정에 쓰지 말고 원인 분석이 먼저 필요합니다.",
  },
};

/** 화면 맨 위에서 "지금 이 모델을 믿고 써도 되는지"를 한눈에 보여주는 배지. */
function HeadlineStatusBanner({ summary }: { summary: ValidationSummary2 }) {
  const style = OVERALL_STATUS_STYLE[summary.overallStatus];
  return (
    <section className={`rounded-2xl border-2 p-5 ${style.badge}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">현재 모델 상태 (정식검증 기준)</p>
          <p className="mt-1 text-2xl font-bold">{summary.overallStatus}</p>
        </div>
        <div className="flex gap-6">
          <div>
            <p className="text-xs opacity-70">±10% 이내 적중률</p>
            <p className="text-xl font-semibold">{formatPercent(summary.within10PctRatio)}</p>
          </div>
          <div>
            <p className="text-xs opacity-70">평균 오차율(MAPE)</p>
            <p className="text-xl font-semibold">{formatPercent(summary.meanAbsoluteErrorPct)}</p>
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6">{style.plain}</p>
    </section>
  );
}

// 2026-08-30 — "10퍼 얼마 20퍼얼마 적중률을 가시성 좋게 보고 싶다"는 요청으로 추가. 계산은
// 전부 이미 있던 summarizeValidationRows/bucketizeErrors(calc.ts) 결과 그대로 쓰고, 이 컴포넌트는
// 그 값을 막대그래프로 보여주기만 한다 — 새 계산 없음. 예전엔 이 버킷 표(오차구간/점포수/비율)가
// 아래 "자세히 보기(전문가용)" 안에 텍스트 테이블로만 있어서 눈에 잘 안 띄었다 — 헤드라인 바로
// 아래, 접히지 않는 위치에 막대그래프로 다시 보여준다.
// 누적 4단계(10%/20%/30% 이내 + 30% 초과) 전용 색상.
const ERROR_BUCKET_COLORS = ["var(--sl-ok)", "var(--sl-ok)", "var(--sl-warn)", "var(--sl-danger)"];

// 2026-08-31 — 요청사항: 오차구간을 개별(±5%/5~10%/...) 대신 "10%p 단위 이내 누적 몇 곳"으로
// 보여주는 게 한눈에 들어온다는 사용자 피드백. summary.buckets(기존 discrete 6구간, 새 계산 없음)를
// 그대로 재구성만 한다 - calc.ts는 건드리지 않는다. buckets는 [±5, 5~10, 10~15, 15~20, 20~30, 30초과]
// 순서로 고정돼 있음(bucketizeErrors 참고).
function buildCumulativeErrorBands(summary: ValidationSummary2): { label: string; count: number; ratio: number; storeNames: string[] }[] {
  const [b0, b1, b2, b3, b4, b5] = summary.buckets;
  const n = summary.sampleCount;
  const within10Count = b0.count + b1.count;
  const within20Count = within10Count + b2.count + b3.count;
  const within30Count = within20Count + b4.count;
  // 2026-09-01 — count/ratio(달성률)는 그대로 누적으로 두되, storeNames는 각 구간에 "새로
  // 추가되는 매장만" 보여주도록 수정했다(사용자 지적: "20% 리스트에 10% 매장까지 또 나온다").
  // 예전엔 하위 구간 매장을 계속 합쳐서 보여줘 중복이었다.
  return [
    { label: "10% 이내", count: within10Count, ratio: n ? within10Count / n : 0, storeNames: [...b0.storeNames, ...b1.storeNames] },
    { label: "20% 이내", count: within20Count, ratio: n ? within20Count / n : 0, storeNames: [...b2.storeNames, ...b3.storeNames] },
    { label: "30% 이내", count: within30Count, ratio: n ? within30Count / n : 0, storeNames: [...b4.storeNames] },
    { label: "30% 초과", count: b5.count, ratio: b5.ratio, storeNames: b5.storeNames },
  ];
}

function ErrorBucketChart({ summary }: { summary: ValidationSummary2 }) {
  const bands = buildCumulativeErrorBands(summary);
  return (
    <div className="app-card rounded-2xl p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">오차 구간별 적중률 (10%p 단위 누적)</h3>
        <p className="text-xs text-[#8a8072]">{summary.sampleCount}곳 기준</p>
      </div>
      <div className="mt-4 space-y-3">
        {bands.map((b, i) => (
          <div key={b.label}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-[#171310] dark:text-[#f2ede2]">{b.label}</span>
              <span className="whitespace-nowrap text-[#5c5346] dark:text-[#c9bfae]">
                {b.count}곳 · <span className="font-semibold">{formatPercent(b.ratio)}</span>
              </span>
            </div>
            <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-[#171310]/[0.08] dark:bg-white/[0.12]">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, b.ratio * 100)}%`, background: ERROR_BUCKET_COLORS[i] }}
              />
            </div>
            {b.storeNames.length > 0 && (
              <p className="mt-0.5 text-[10px] text-[#8a8072]">{b.storeNames.join(", ")}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 처음 보는 사람을 위한 용어 설명. <details>로 만들어 기본은 펼쳐두되(요청사항: 처음 보는
 * 사람도 이해할 수 있게) 익숙한 사용자는 클릭 한 번으로 접을 수 있다. 판정/계산 로직과는
 * 무관한 순수 설명 텍스트라 여기 문구를 고쳐도 검증 결과에 영향을 주지 않는다.
 */
function GlossarySection() {
  return (
    <details className="app-card rounded-2xl p-5 text-sm leading-6">
      <summary className="cursor-pointer text-base font-semibold text-[#171310] dark:text-[#f2ede2]">
        📖 용어가 헷갈리시나요? (V61/V62/LOOCV 등 설명 — 클릭하면 펼쳐집니다)
      </summary>
      <div className="mt-3 space-y-3 text-[#5c5346] dark:text-[#c9bfae]">
        <p>
          이 화면은 <b>신규 매장 매출 예측 모델</b>이 실제로 얼마나 정확한지, 이미 운영 중인 가맹점의 실제 매출과 비교해서 검증합니다.
          아래 숫자들이 목표치를 넘으면 이 모델을 새 후보지 평가에 그대로 써도 된다는 뜻입니다.
        </p>
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <li>
            <b>V61</b> — 기본 매출 예측 모델(요금·예상수요·경쟁력점수로 예측)
          </li>
          <li>
            <b>V62</b> — V61에 "외부유입 제한" 보정까지 더한 최종 예측치(실제 후보지 평가에 쓰는 값)
          </li>
          <li>
            <b>리브원아웃 교차검증(LOOCV)</b> — 한 매장을 학습 데이터에서 빼고, 마치 처음 보는 신규 매장인 것처럼 그 매장의 매출을
            예측해보는 방법. 실제 신규 후보지를 예측할 때와 조건이 가장 비슷해서, 이 숫자가 곧 진짜 모델 성능입니다.
          </li>
          <li>
            <b>V62 운영 결과(시트 재현)</b> — 원본 구글시트가 예전에 계산해둔 값을 웹이 똑같이 재현하는지 확인하는 것. 모델 성능
            검증이 아니라 "이관이 제대로 됐는지" 확인용입니다.
          </li>
          <li>
            <b>코호트(정식검증)</b> — 오픈한 지 얼마나 됐는지로 나눈 그룹. 2026-09-02부터 실제매출이 확정된 달이{" "}
            {CORE_VALIDATION_MIN_MONTHS}개월 이상인 정상영업 블랙라벨 매장은 전부 "정식검증" 대상입니다(이전에는 12개월
            이상만 정식검증, 그 미만은 "조기검증"으로 따로 집계했습니다). 다만 아래 표의 <b>운영기간</b> 열에는 12개월
            완료 여부를 계속 표시합니다 — 집계에서 빼지는 않지만, 오픈 프로모션 효과가 아직 섞여 있을 수 있는 매장을 눈으로
            구분하기 위해서입니다.
          </li>
          <li>
            <b>MAPE(평균절대오차율)</b> — 예측이 실제매출과 평균적으로 몇 % 차이 나는지. 낮을수록 좋습니다.
          </li>
          <li>
            <b>±10% 이내 적중률</b> — 예측이 실제매출과 10% 이내로 맞은 매장의 비율. 높을수록 좋습니다(목표 80%).
          </li>
          <li>
            <b>편향</b> — 예측이 실제보다 전체적으로 높게(+) 또는 낮게(-) 쏠려 있는지.
          </li>
        </ul>
      </div>
    </details>
  );
}

/** 오차율만 보고 "잘 맞았는지"를 3단계 배지로 보여준다(±10%/±20% 버킷과 동일 경계, 새 기준 아님). */
function AccuracyBadge({ absoluteErrorPct }: { absoluteErrorPct: number | null }) {
  if (absoluteErrorPct == null) {
    return <span className="app-badge app-badge-neutral">확인 불가</span>;
  }
  if (absoluteErrorPct <= 0.1) {
    return <span className="app-badge app-badge-ok">적중</span>;
  }
  if (absoluteErrorPct <= 0.2) {
    return <span className="app-badge app-badge-warn">근접</span>;
  }
  return <span className="app-badge app-badge-danger">차이 큼</span>;
}

/**
 * 운영기간 배지.
 *
 * 2026-09-02에 정식검증 기준이 12개월 → 1개월로 내려갔지만, 사용자 요청("검증탭에 12개월 미만
 * 매장 표기하는 건 유지해")에 따라 **12개월 완료 여부 표기는 그대로 남긴다**. 이제 이 표기는
 * 정식검증 포함/제외를 가르는 기준이 아니라, "오픈 프로모션 효과가 아직 섞여 있을 수 있는
 * 매장"을 눈으로 구분하기 위한 참고 표시다. 정식검증에서 실제로 빠진 매장은 옆의 "검증 제외"
 * 배지로 따로 알려준다(사후 운영이슈 등).
 */
const FULL_TENURE_MONTHS = 12;

function TenureBadge({
  cohort,
  completedMonths,
}: {
  cohort: ValidationStoreRow["cohort"];
  completedMonths: number;
}) {
  const isFullTenure = completedMonths >= FULL_TENURE_MONTHS;
  const isFormal = cohort === "정식 검증군";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`app-badge ${isFullTenure ? "app-badge-info" : "app-badge-warn"}`}>
        {isFullTenure ? `${FULL_TENURE_MONTHS}개월 이상` : `${FULL_TENURE_MONTHS}개월 미만 (${completedMonths}개월)`}
      </span>
      {!isFormal && <span className="app-badge app-badge-neutral">검증 제외</span>}
    </span>
  );
}

/**
 * 처음 보는 사람을 위한 "결론만" 표 — 블랙라벨 전체 매장을 매장명·운영기간·실제매출·예측매출·
 * 오차율·적중 여부만으로 보여준다(브랜드·운영상태·데이터완성도 등 전문 컬럼은 아래 "자세히
 * 보기"의 코호트별 상세표에만 남겨둔다). 계산은 하지 않고 이미 계산된 ValidationStoreRow
 * 필드를 그대로 옮겨 보여줄 뿐이다. 2026-09-02부터 실제매출이 1개월이라도 확정된 정상영업
 * 블랙라벨 매장은 전부 정식검증 표본이라, 이 표의 매장 대부분이 위 요약 통계에도 포함된다
 * (calc.ts CORE_VALIDATION_MIN_MONTHS 참고).
 */
function SimpleResultTable({ rows }: { rows: ValidationStoreRow[] }) {
  const sorted = [...rows].sort((a, b) => {
    const aFormal = a.cohort === "정식 검증군" ? 0 : 1;
    const bFormal = b.cohort === "정식 검증군" ? 0 : 1;
    if (aFormal !== bFormal) return aFormal - bFormal;
    return (b.absoluteErrorPct ?? -1) - (a.absoluteErrorPct ?? -1);
  });
  return (
    <div className="overflow-x-auto rounded-xl border border-[#171310]/[0.08] dark:border-white/[0.08]">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="app-card-sm text-left text-xs font-medium text-[#8a8072]">
          <tr>
            <th className="px-3 py-2">매장명</th>
            <th className="px-3 py-2">운영기간</th>
            <th className="px-3 py-2">실제매출(월평균)</th>
            <th className="px-3 py-2">모델 예측매출</th>
            <th className="px-3 py-2">오차율</th>
            <th className="px-3 py-2">결과</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#171310]/[0.06] dark:divide-white/[0.06]">
          {sorted.map((r) => (
            <tr key={r.storeCode} className="text-[#171310] dark:text-[#f2ede2]">
              <td className="px-3 py-2 font-medium">{r.storeName}</td>
              <td className="px-3 py-2">
                <TenureBadge cohort={r.cohort} completedMonths={r.completedMonths} />
              </td>
              <td className="px-3 py-2">{formatWon(r.actualRevenueAvg)}</td>
              <td className="px-3 py-2">{formatWon(r.v62PredictedRevenueAvg)}</td>
              <td className="px-3 py-2">{formatPercent(r.absoluteErrorPct)}</td>
              <td className="px-3 py-2">
                <AccuracyBadge absoluteErrorPct={r.absoluteErrorPct} />
                {/* 2026-08-25 추가 — 실제매출은 있는데 예측이 안 나온 매장(검단사거리점 등)이
                    "실적 없음"으로 오인되지 않도록, 이미 계산된 사유(describeNotVerifiableReason)를
                    바로 옆에 보여준다. 자세히 보기의 전문가용 표에만 있던 걸 여기로도 노출. */}
                {r.absoluteErrorPct == null && r.errorCause === "not_verifiable" && (
                  <span className="ml-1.5 text-[11px] text-[#8a8072]">({describeNotVerifiableReason(r)})</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryBlock({ title, summary, benchmark }: { title: string; summary: ValidationSummary2; benchmark?: ReferenceBenchmark }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">{title}</h3>
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
            ? "bg-[var(--sl-ok-soft)] text-[var(--sl-ok)]"
            : summary.overallStatus === "조건부 사용"
              ? "bg-[var(--sl-warn-soft)] text-[var(--sl-warn)]"
              : "bg-[var(--sl-danger-soft)] text-[var(--sl-danger)]"
        }`}
      >
        현재 상태: {summary.overallStatus} — {summary.statusReason}
      </p>
      {benchmark && (
        <p className="app-card-sm rounded-lg px-3 py-2 text-xs text-[#5c5346] dark:text-[#c9bfae]">
          기존 Google Sheet 참고 결과({benchmark.sampleCount}개 점포): 평균오차 {formatPercent(benchmark.meanAbsoluteErrorPct)} · 중앙값{" "}
          {formatPercent(benchmark.medianAbsoluteErrorPct)} · ±10% 이내 {formatPercent(benchmark.within10PctRatio)} · ±20% 이내{" "}
          {formatPercent(benchmark.within20PctRatio)}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-[#171310]/[0.08] dark:border-white/[0.08]">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="app-card-sm text-left text-xs font-medium text-[#8a8072]">
            <tr>
              <th className="px-3 py-2">오차 구간</th>
              <th className="px-3 py-2">점포 수</th>
              <th className="px-3 py-2">비율</th>
              <th className="px-3 py-2">점포명</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#171310]/[0.06] dark:divide-white/[0.06]">
            {summary.buckets.map((b) => (
              <tr key={b.label}>
                <td className="px-3 py-2 font-medium">{b.label}</td>
                <td className="px-3 py-2">{b.count}곳</td>
                <td className="px-3 py-2">{formatPercent(b.ratio)}</td>
                <td className="px-3 py-2 text-xs text-[#8a8072]">{b.storeNames.join(", ") || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * "실측기반 예상월매출" 백테스트 결과 표시(2026-08-21, 처음 검증). SummaryBlock과 다르게
 * passed 배지·overallStatus 배지를 안 보여준다 — targetMAE 등은 V61/V62 전용으로 설계된
 * 목표치라 이 지표에 그대로 들이대면 "이미 검증된 목표가 있다"는 오해를 준다. 숫자만 그대로
 * 보여주고 통과/미달 판단은 화면이 아니라 사용자가 한다.
 */
function MeasuredForecastSummaryBlock({ summary }: { summary: ValidationSummary2 }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <SummaryCard title="표본 수" value={`${formatNumber(summary.sampleCount)}곳`} />
      <SummaryCard title="평균절대오차(MAPE)" value={formatPercent(summary.meanAbsoluteErrorPct)} />
      <SummaryCard title="중앙값절대오차" value={formatPercent(summary.medianAbsoluteErrorPct)} />
      <SummaryCard title="±5% 이내" value={formatPercent(summary.within5PctRatio)} />
      <SummaryCard title="±10% 이내" value={formatPercent(summary.within10PctRatio)} />
      <SummaryCard title="±20% 이내" value={formatPercent(summary.within20PctRatio)} />
      <SummaryCard title="평균편향" value={formatPercent(summary.meanBiasPct)} />
      <SummaryCard
        title="과대예측/과소예측"
        value={`${summary.overPredictedCount}곳 / ${summary.underPredictedCount}곳`}
      />
    </div>
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
        setState(
          data
            ? {
                status: "ready",
                rows: data.rows,
                settings: data.settings,
                existingStoresByCode: data.existingStoresByCode,
                competitorsByCode: data.competitorsByCode,
                locationEvaluationsByCode: data.locationEvaluationsByCode,
              }
            : { status: "empty" },
        );
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
    const { rows, settings, existingStoresByCode, competitorsByCode, locationEvaluationsByCode } = state;

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

    // 2026-08-21 — "실측기반 예상월매출"(AA경로) 백테스트. 정식검증(coreRows)과 같은 매장
    // 모집단에, 이 경로만의 조건(자사 시설값 완비 + 경쟁점 실측 존재)을 추가로 요구한다.
    // computeExistingStoreMeasuredForecast(calc.ts)가 표본 포함 여부와 사유를 그대로 반환한다 —
    // 화면에서 다시 판단하지 않는다(무음 누락 금지, excludedNonBlackLabelCount와 같은 패턴).
    const measuredForecastResults = coreRows.map((r) => {
      const store = existingStoresByCode.get(r.storeCode);
      const competitors = competitorsByCode.get(r.storeCode) ?? [];
      const loc = locationEvaluationsByCode.get(r.storeCode) ?? null;
      const forecast = store ? computeExistingStoreMeasuredForecast(store, competitors, loc, settings) : null;
      return { row: r, forecast };
    });
    const measuredForecastExcluded = measuredForecastResults.filter((m) => !m.forecast || m.forecast.excludedReason != null);
    const measuredForecastIncluded = measuredForecastResults
      .filter((m): m is { row: ValidationStoreRow; forecast: NonNullable<(typeof measuredForecastResults)[number]["forecast"]> } =>
        m.forecast != null && m.forecast.excludedReason == null,
      )
      .map((m) => ({
        storeName: m.row.storeName,
        actualRevenueAvg: m.row.actualRevenueAvg,
        forecastRevenue: m.forecast.measuredForecastMonthlyRevenue,
        coverageRatio: m.forecast.competitorCoverageRatio,
        isLowCoverageReliability: m.forecast.isLowCoverageReliability,
        errorAmount:
          m.forecast.measuredForecastMonthlyRevenue != null && m.row.actualRevenueAvg != null
            ? m.forecast.measuredForecastMonthlyRevenue - m.row.actualRevenueAvg
            : null,
        absoluteErrorPct:
          m.forecast.measuredForecastMonthlyRevenue != null && m.row.actualRevenueAvg != null && m.row.actualRevenueAvg > 0
            ? Math.abs(m.forecast.measuredForecastMonthlyRevenue - m.row.actualRevenueAvg) / m.row.actualRevenueAvg
            : null,
      }))
      .filter((m) => m.absoluteErrorPct != null);
    const measuredForecastSummary = summarizeValidationRows(measuredForecastIncluded, targets);
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

    // "12개월 완료 블랙라벨 N곳 / 공식 정식검증 포함 M곳" — 코호트만 기준인 전체 집합과, 그중
    // 사후운영이슈 등으로 공식 정식검증(coreRows)에서 빠진 매장을 구분해 보여준다. 매장명을
    // 하드코딩하지 않고 exclusionReason을 그대로 노출한다.
    const fullTenureRows = byCohort.get("정식 검증군") ?? [];
    const fullTenureExcluded = fullTenureRows.filter((r) => !r.includedInCoreAccuracy);

    const completenessCounts = countBy(combinedRows, (r) => r.dataCompleteness.grade);
    const competitorStatusCounts = countBy(combinedRows, (r) => r.competitorSummary?.status ?? "uninvestigated");

    // 12_운영판정!D21(입지평가 누락 COUNTIFS)에 대응 — 학습/조기검증에 실제로 쓰이는 매장 중
    // 09_입지동선평가를 아직 안 채운 곳이 있는지 화면에서 바로 세어 보여준다(0곳이 정상).
    // 예측값을 바꾸는 계산이 아니라 데이터 입력 누락을 알려주는 체크리스트다.
    const missingLocationEvalRows = combinedRows.filter((r) => !r.hasLocationEvaluation);

    return {
      rows,
      blackLabelRows,
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
      fullTenureRows,
      fullTenureExcluded,
      measuredForecastIncluded,
      measuredForecastExcluded,
      measuredForecastSummary,
      missingLocationEvalRows,
      completenessCounts,
      competitorStatusCounts,
      settings,
    };
  }, [state]);

  if (state.status === "loading") {
    return (
      <div className="app-card rounded-2xl px-8 py-16 text-center text-[#5c5346] dark:text-[#c9bfae]">
        불러오는 중...
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-2xl border border-[var(--sl-danger)]/30 bg-[var(--sl-danger-soft)] p-8 text-[#171310] dark:text-[#f2ede2]">
        <h2 className="text-lg font-semibold">데이터를 불러오지 못했습니다</h2>
        <p className="mt-2 text-sm leading-6">{state.message}</p>
      </div>
    );
  }

  if (state.status === "empty" || !computed) {
    return (
      <div className="app-card rounded-2xl p-8 text-center">
        <h2 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">아직 등록된 기존 가맹점이 없습니다</h2>
        <p className="mt-2 text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
          기존 가맹점 마스터(storeEvalExistingStores)와 학습 특징치가 Firestore에 들어오면 이 화면에 검증 결과가 표시됩니다.
        </p>
      </div>
    );
  }

  const {
    coreSummary,
    coreRows,
    blackLabelRows,
    combinedSummary,
    byCohort,
    completenessCounts,
    competitorStatusCounts,
    excludedNonBlackLabelCount,
    sheetCoreSummary,
    sheetEarlySummary,
    sheetCombinedSummary,
    parityRows,
    fullTenureRows,
    fullTenureExcluded,
    missingLocationEvalRows,
    combinedRows,
    measuredForecastIncluded,
    measuredForecastExcluded,
    measuredForecastSummary,
    settings,
  } = computed;

  const loocvHighVarianceRows = parityRows.filter((r) => r.isLoocvHighVariance);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold text-[#171310] dark:text-[#f2ede2]">6. 기존 가맹점 검증</h1>
        <p className="mt-1 text-sm text-[#5c5346] dark:text-[#c9bfae]">
          신규 매장 매출을 예측하는 모델이 얼마나 정확한지, 이미 운영 중인 블랙라벨 매장의 실제 매출과 비교해 확인하는 화면입니다.
        </p>
        <p className="mt-1 text-xs text-[#8a8072]">
          블랙라벨 매장만 검증하며{excludedNonBlackLabelCount > 0 ? `, 리그PC방·브랜드 미확인 ${excludedNonBlackLabelCount}곳은 이 화면에서 제외됩니다.` : "."}{" "}
          계산 방식(리브원아웃 교차검증 등)의 자세한 설명은 아래 용어 설명과 "자세히 보기"를 참고하세요.
        </p>
      </div>

      <HeadlineStatusBanner summary={combinedSummary} />

      {/* 요청사항 — "처음 보는 사람도 이해할 수 있게": 결론만 평문으로 먼저 보여주고, 표도
          전문 컬럼(브랜드/운영상태/데이터완성도/우선추정원인 등) 없이 매장명·실제매출·예측매출·
          오차율·적중여부만 남긴다. 아래 전문가용 상세 데이터와 계산 결과는 완전히 동일하다 —
          보여주는 범위만 줄인 것이지 새 계산은 하나도 없다.
          2026-08-30 — 사용자 요청으로 헤드라인을 "12개월 이상만"(coreSummary)에서
          "정식검증+조기검증 통합"(combinedSummary)으로 바꿨다.
          2026-09-02 — 사용자 확정("12개월 미만인 매장도 정상으로 평가해, 어차피 비슷비슷함")에 따라
          정식검증 기준 자체를 12개월 → 1개월로 내렸다(calc.ts CORE_VALIDATION_MIN_MONTHS). 이제
          학습표본 자격도 같은 기준이라 조기검증 집계는 비게 되고, coreSummary와 combinedSummary가
          같은 매장 집합이 된다. */}
      <section className="space-y-3">
        <p className="text-sm leading-6 text-[#5c5346] dark:text-[#c9bfae]">
          정상 운영 중인 블랙라벨 매장(실제매출이 {CORE_VALIDATION_MIN_MONTHS}개월 이상 확정된{" "}
          <b>{combinedSummary.sampleCount}곳</b>)으로 확인한 결과,{" "}
          <b>{combinedRows.filter((r) => r.absoluteErrorPct != null && r.absoluteErrorPct <= 0.1).length}곳</b>(
          {formatPercent(combinedSummary.within10PctRatio)})은 모델 예측이 실제 매출과 <b>10% 이내</b>로 맞았습니다. 나머지{" "}
          {combinedRows.filter((r) => r.absoluteErrorPct != null && r.absoluteErrorPct > 0.1).length}곳은 10%보다 더 차이가 났고,
          전체 평균으로는 실제 매출과 <b>{formatPercent(combinedSummary.meanAbsoluteErrorPct)}</b> 정도 차이가 났습니다.
        </p>
        <p className="text-xs text-[#8a8072]">
          아래 표는 블랙라벨 매장 전체({blackLabelRows.length}곳)입니다. 2026-09-02부터 실제매출이{" "}
          {CORE_VALIDATION_MIN_MONTHS}개월이라도 확정된 정상영업 매장은 전부 정식검증 표본이자 학습표본입니다(예전에는
          12개월 이상만 정식검증). 완료월이 1~2개월인 매장은 오픈 프로모션 효과가 섞여 있을 수 있다는 점은 감안해서
          보셔야 합니다.
        </p>

        <ErrorBucketChart summary={combinedSummary} />

        <SimpleResultTable rows={blackLabelRows} />
      </section>

      <GlossarySection />

      <details className="app-card rounded-2xl p-5">
        <summary className="cursor-pointer text-base font-semibold text-[#171310] dark:text-[#f2ede2]">
          🔍 자세히 보기 (전문가·분석용 상세 데이터)
        </summary>
        <div className="mt-6 space-y-10">
      {/* 요청사항 6 — 공식 성능/이관 검증용 구분 결론 */}
      <section className="rounded-xl border border-[var(--sl-info)]/30 bg-[var(--sl-info-soft)] p-4 text-sm leading-6 text-[#171310] dark:text-[#f2ede2]">
        <h3 className="font-semibold">웹 V62와 시트 V62 차이 원인 확인 결과</h3>
        <p className="mt-1">
          아래 <b>"V62 운영 결과"</b>는 시트에 저장된 V61 캐시값 그대로 재현한 결과, <b>"리브원아웃 교차검증"</b>은 매 매장을 학습에서
          뺀 뒤 다시 학습해 예측한 결과입니다. 두 값의 차이는 계산 버그가 아니라 <b>검증점포를 학습에 포함했는지 여부</b>(시트=전체 26곳으로
          학습한 모형이 자기 자신을 예측 / 웹=리브-원-아웃으로 자기 자신을 뺀 모형이 예측)에서 대부분 설명됩니다. 나머지 항목(입력
          특징값·결측값 처리·릿지계수/lambda·외부유입 보정 순서·반올림 시점)은 점검 결과 동일했습니다 — 아래 "차이 원인 점검표" 참고.
          리브원아웃 교차검증 구현 자체에는 문제가 없다고 확인했으므로, <b>모델 검증 적중률(공식 성능)은 리브원아웃 교차검증을 사용</b>하고
          V62 운영 결과(시트 재현 적중률)는 이관(마이그레이션) 검증용으로만 남겨둡니다. 실제 신규후보지 평가에 쓰는 예상매출은 항상
          V62 운영 결과이며, 리브원아웃 교차검증 값은 신규후보지 운영 예상매출로 쓰지 않습니다.
        </p>
      </section>

      {/* 최상단 요약 (요청사항 8/10 형식) */}
      <section className="app-card-sm rounded-2xl p-5">
        <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">검증 결과 요약</h2>
        <ul className="mt-3 space-y-1 text-sm text-[#5c5346] dark:text-[#c9bfae]">
          <li>
            정식검증 코호트 블랙라벨: {fullTenureRows.length}곳 / 공식 정식검증 포함: {coreSummary.sampleCount}곳
          </li>
          {fullTenureExcluded.length > 0 && (
            <li className="text-xs text-[#8a8072]">
              {fullTenureExcluded.map((r) => `${r.storeName}(${r.exclusionReason})`).join(", ")}
            </li>
          )}
          <li className={missingLocationEvalRows.length > 0 ? "font-semibold text-[var(--sl-warn)]" : ""}>
            입지평가 누락(정식+조기검증 대상): {missingLocationEvalRows.length}곳
            {missingLocationEvalRows.length > 0 && ` — ${missingLocationEvalRows.map((r) => r.storeName).join(", ")}`}
          </li>
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
            현재 상태: {coreSummary.overallStatus} — 리브원아웃 기준 {coreSummary.statusReason}
          </li>
        </ul>
      </section>

      <div>
        <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">모델 검증 적중률 (리브원아웃 교차검증 — 신규점포 일반화 성능 참고)</h2>
        <p className="mt-1 text-xs text-[#8a8072]">
          여기가 이 화면의 핵심입니다 — 신규 후보지를 예측할 때와 가장 비슷한 조건으로 측정한 <b>진짜 모델 성능</b>입니다.
        </p>
      </div>
      <SummaryBlock title="1. 정상영업점 적중률 (정식검증, 리브-원-아웃)" summary={coreSummary} benchmark={REFERENCE_BENCHMARK.정식검증} />
      <SummaryBlock
        title="2. 조기검증 적중률 (2026-09-02부터 정식검증에 통합 — 표본 0곳)"
        summary={computed.earlySummary}
        benchmark={REFERENCE_BENCHMARK.조기검증}
      />
      <SummaryBlock title="3. 정식검증+조기검증 통합 적중률" summary={combinedSummary} benchmark={REFERENCE_BENCHMARK.통합} />
      <SummaryBlock title="4. 사후 운영이슈·참고용 점포까지 포함한 참고 적중률" summary={computed.referenceSummary} />

      <section className="space-y-4 app-card rounded-2xl p-5">
        <div>
          <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">
            시트 재현 적중률 — V62 운영 결과 (이관 검증용, 공식 성능 아님)
          </h2>
          <p className="mt-1 text-xs text-[#8a8072]">
            시트에 저장된 V61 예측값(재계산 없이 그대로)에 외부유입 보정만 적용한 결과입니다. 실제 신규후보지 평가에 쓰는 예상매출이
            이 방식과 같습니다. 위 리브원아웃 교차검증과 절대 섞지 않습니다.
          </p>
        </div>
        <SheetParitySummaryBlock title="정식검증(시트 재현)" summary={sheetCoreSummary} benchmark={REFERENCE_BENCHMARK.정식검증} />
        <SheetParitySummaryBlock title="조기검증(시트 재현)" summary={sheetEarlySummary} benchmark={REFERENCE_BENCHMARK.조기검증} />
        <SheetParitySummaryBlock title="통합(시트 재현)" summary={sheetCombinedSummary} benchmark={REFERENCE_BENCHMARK.통합} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">매장별 비교표 — V62 운영 결과 vs 리브원아웃 교차검증</h2>
          <p className="mt-1 text-xs text-[#8a8072]">
            정식검증+조기검증 대상 매장만. "차이 발생 단계"는 V61 예측 → 외부유입 보정률 → 반올림 순으로 처음 어긋난 지점을 표시합니다.
          </p>
        </div>
        <ParityComparisonTable rows={parityRows} />
      </section>

      {loocvHighVarianceRows.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">LOOCV 고변동 점포 진단</h2>
          <p className="text-xs text-[#8a8072]">
            V61 예측 단계에서 웹(리브원아웃 교차검증)과 시트(V62 운영 결과)의 차이가 {formatPercent(0.3)}를 넘는 매장입니다. 구현
            오류가 아니라 이 매장을 학습에서 뺐을 때 모형이 크게 흔들린다는 신호이며, 계수나 입력값을 임의로 수정하지 않습니다.
          </p>
          {loocvHighVarianceRows.map((r) => {
            const diagnostic = diagnoseLoocvSensitivity(r.storeCode, combinedRows, settings);
            return diagnostic ? <LoocvDiagnosticBlock key={r.storeCode} diagnostic={diagnostic} /> : null;
          })}
        </section>
      )}

      <section className="app-card rounded-xl p-4 text-sm leading-6">
        <h3 className="font-semibold text-[#171310] dark:text-[#f2ede2]">차이 원인 점검표</h3>
        <ul className="mt-2 space-y-1.5 text-[#5c5346] dark:text-[#c9bfae]">
          <li>
            <b>학습대상 점포 차이</b>: 있음 — 시트는 12개월 완료 26곳으로 학습했지만, 웹은 2026-09-02부터 완료월{" "}
            {CORE_VALIDATION_MIN_MONTHS}개월 이상 매장까지 학습에 쓴다(calc.ts CORE_VALIDATION_MIN_MONTHS).
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

      <section className="space-y-3 app-card rounded-2xl p-5">
        <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">
          5. 실측기반 예상월매출 검증 (신규 — 경쟁점 실가동좌석 기반, 이번에 처음 검증)
        </h2>
        <p className="mt-1 text-sm text-[#5c5346] dark:text-[#c9bfae]">
          V61/V62(인구·이용률 기반)과 완전히 별개인 두 번째 경로를 기존 가맹점 실제매출로 처음 검증해봤습니다. 이 경로는 원본
          시트에도 존재 목적이 문서화돼 있지 않고 지금까지 검증된 적이 없어서, V61/V62 같은 통과/미달 목표(목표 MAE 등)를 적용하지
          않고 수치만 그대로 보여줍니다 — 계속 쓸지 여부는 이 결과를 보고 판단해주세요.
        </p>
        <p className="mt-2 text-xs text-[#8a8072]">
          정식검증({coreSummary.sampleCount}곳) 중 자사 시설값이 완비되고 경쟁점 실측(핑봇)이 있는{" "}
          {measuredForecastIncluded.length}곳만 표본에 포함했습니다.
          {measuredForecastExcluded.length > 0 &&
            ` 제외 ${measuredForecastExcluded.length}곳: ${measuredForecastExcluded
              .map((m) => `${m.row.storeName}(${m.forecast?.excludedReason ?? "산출 불가"})`)
              .join(", ")}`}
        </p>
        <div className="mt-4">
          <MeasuredForecastSummaryBlock summary={measuredForecastSummary} />
        </div>
        {measuredForecastIncluded.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-[#171310]/[0.08] dark:border-white/[0.08]">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="app-card-sm text-left text-xs font-medium text-[#8a8072]">
                <tr>
                  <th className="px-3 py-2">점포명</th>
                  <th className="px-3 py-2">실측기반 예상월매출</th>
                  <th className="px-3 py-2">실제매출평균</th>
                  <th className="px-3 py-2">절대오차율</th>
                  <th className="px-3 py-2">경쟁점 핑봇 커버율</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#171310]/[0.06] dark:divide-white/[0.06]">
                {measuredForecastIncluded.map((m) => (
                  <tr key={m.storeName}>
                    <td className="px-3 py-2 font-medium">{m.storeName}</td>
                    <td className="px-3 py-2">{formatWon(m.forecastRevenue)}</td>
                    <td className="px-3 py-2">{formatWon(m.actualRevenueAvg)}</td>
                    <td className="px-3 py-2">{formatPercent(m.absoluteErrorPct)}</td>
                    <td className={`px-3 py-2 ${m.isLowCoverageReliability ? "text-[var(--sl-warn)]" : ""}`}>
                      {formatPercent(m.coverageRatio)}
                      {m.isLowCoverageReliability && " (낮음)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-xs text-[#8a8072]">
              경쟁점 핑봇 커버율 = 조사된 경쟁점 중 핑봇 기간평균 가동률이 있는 비율. 70% 미만이면
              "낮음"으로 표시합니다(원본 점포평가.gs의 최소커버율 0.70 기준 — 원본도 이 값으로 표본을
              거르지 않고 참고 신뢰도로만 씁니다).
            </p>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BreakdownCard title="데이터 완성도별 매장 수 (정식+조기)" rows={completenessCounts} labels={DATA_COMPLETENESS_LABELS} />
        <BreakdownCard title="경쟁점 조사상태별 매장 수 (정식+조기)" rows={competitorStatusCounts} labels={COMPETITOR_STATUS_LABELS} />
      </section>

      {!coreSummary.targetsMetAll && (
        <section className="rounded-xl border border-[var(--sl-warn)]/30 bg-[var(--sl-warn-soft)] p-4 text-sm leading-6 text-[#171310] dark:text-[#f2ede2]">
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
            <h2 className="text-base font-semibold text-[#171310] dark:text-[#f2ede2]">
              {COHORT_LABELS[cohort]} ({rows.length}곳)
            </h2>
            <div className="mt-2">
              <CohortTable rows={rows} />
            </div>
          </section>
        );
      })}
        </div>
      </details>
    </div>
  );
}
