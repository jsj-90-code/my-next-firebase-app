"use client";

// 6. 기존 가맹점 검증 화면.
// 계산은 전부 src/lib/storeEval/calc.ts의 순수함수를 그대로 호출한다 - 이 파일에서 새로운
// 산식을 만들지 않는다 (요청사항). 이 화면이 하는 일은: Firestore에서 기존 가맹점 원본
// 데이터를 모아서 calc.ts가 요구하는 입력 형태로 가공하고, 계산 결과를 표/카드로 보여주는 것뿐이다.

import { useEffect, useState } from "react";
import {
  computeCumulativeAverageSales,
  computeValidationRow,
  summarizeValidation,
  type ValidationComputedRow,
  type ValidationInputRow,
  type ValidationSummaryResult,
} from "@/lib/storeEval/calc";
import { formatNumber, formatPercent, formatWon } from "@/lib/storeEval/format";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import {
  getLocationEvaluation,
  getModelSettings,
  listExistingStoreSales,
  listExistingStores,
} from "@/lib/storeEval/store";
import type { ExistingStore, InflowRestriction, ModelSettings } from "@/lib/storeEval/types";

type ExcludedBrandStore = ExistingStore & { brandType: string };

type ValidationPageData = {
  computedRows: ValidationComputedRow[];
  summary: ValidationSummaryResult;
  settings: ModelSettings;
  excludedManual: ExistingStore[];
  excludedNoV61: ExistingStore[];
  excludedBrand: ExcludedBrandStore[];
  noSalesCount: number;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; data: ValidationPageData };

async function loadValidationData(): Promise<ValidationPageData | null> {
  const [stores, settingsDoc] = await Promise.all([listExistingStores(), getModelSettings()]);
  if (stores.length === 0) return null;

  const settings: ModelSettings = settingsDoc ?? { ...defaultModelSettings(), updatedAt: 0, updatedBy: null };

  // 4. 본사 수동 제외(산식학습제외 플래그) - 06_검증대시보드 역할
  const excludedManual = stores.filter((s) => s.excludedFromModel);
  // 5. V61 예측값이 없는 점포도 계산 불가하므로 제외
  const remaining = stores.filter((s) => !s.excludedFromModel);
  const excludedNoV61 = remaining.filter((s) => s.v61Predicted == null);
  const candidates = remaining.filter((s) => s.v61Predicted != null);

  const details = await Promise.all(
    candidates.map(async (store) => {
      const [sales, loc] = await Promise.all([
        listExistingStoreSales(store.storeCode),
        getLocationEvaluation(store.storeCode),
      ]);
      const actualSales = computeCumulativeAverageSales(sales);
      const inflowRestriction: InflowRestriction | "미평가" = loc?.inflowRestriction ?? "미평가";
      const brandType: string = loc?.brandType ?? "확인필요";
      return { store, actualSales, inflowRestriction, brandType };
    }),
  );

  // 브랜드구분(09_입지동선평가!P열)이 설정의 브랜드필터와 다른 점포 - 매출 유무와 무관하게 안내 목록에 표시
  const excludedBrand: ExcludedBrandStore[] = details
    .filter((d) => d.brandType !== settings.brandFilter)
    .map((d) => ({ ...d.store, brandType: d.brandType }));

  // 2. 매출 데이터가 없으면 검증 대상에서 빠진다
  const withSales = details.filter((d) => d.actualSales != null);
  const noSalesCount = details.length - withSales.length;

  const inputRows: ValidationInputRow[] = withSales.map((d) => ({
    storeCode: d.store.storeCode,
    storeName: d.store.storeName,
    actualSales: d.actualSales as number,
    v61Predicted: d.store.v61Predicted as number,
    inflowRestriction: d.inflowRestriction,
    brandType: d.brandType,
  }));

  const computedRows = inputRows.map((row) => computeValidationRow(row, settings));
  const summary = summarizeValidation(computedRows, settings);

  return { computedRows, summary, settings, excludedManual, excludedNoV61, excludedBrand, noSalesCount };
}

function overallBadgeClass(status: ValidationSummaryResult["overallStatus"]): string {
  switch (status) {
    case "정식 적용 가능":
      return "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300";
    case "조건부 사용":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
    case "재보정 필요":
      return "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300";
  }
}

function judgementBadgeClass(judgement: ValidationComputedRow["storeJudgement"]): string {
  switch (judgement) {
    case "양호":
      return "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300";
    case "주의":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
    case "재검토":
      return "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300";
    case "입지평가 필요":
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

function passBadge(passed: boolean) {
  return (
    <span
      className={`ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${
        passed
          ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
          : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
      }`}
    >
      {passed ? "통과" : "미달"}
    </span>
  );
}

function biasDisplay(bias: number) {
  if (bias > 0) return { label: "과대예측", cls: "text-red-600 dark:text-red-400" };
  if (bias < 0) return { label: "과소예측", cls: "text-blue-600 dark:text-blue-400" };
  return { label: "-", cls: "text-zinc-500 dark:text-zinc-400" };
}

function SummaryCard({
  title,
  value,
  passed,
  sub,
}: {
  title: string;
  value: string;
  passed?: boolean;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
      <p className="mt-1 flex items-baseline text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {value}
        {passed !== undefined && passBadge(passed)}
      </p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{sub}</p>}
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
        setState(data ? { status: "ready", data } : { status: "empty" });
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

  if (state.status === "empty") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">아직 등록된 기존 가맹점이 없습니다</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          매출DB 연동이 아직 안 되어 있습니다. 기존 가맹점 마스터(01_점포기본정보)와 월별 매출 데이터가
          Firestore에 들어오면 이 화면에 검증 결과가 표시됩니다.
        </p>
      </div>
    );
  }

  const { computedRows, summary, excludedManual, excludedNoV61, excludedBrand, noSalesCount } = state.data;
  const brandExcludedInSample = computedRows.filter((r) => r.usedInSample === "제외").length;

  const overPredicted = [...computedRows]
    .filter((r) => r.bias > 0)
    .sort((a, b) => b.bias - a.bias)
    .slice(0, 5);
  const underPredicted = [...computedRows]
    .filter((r) => r.bias < 0)
    .sort((a, b) => a.bias - b.bias)
    .slice(0, 5);

  const sortedRows = [...computedRows].sort((a, b) => a.storeCode.localeCompare(b.storeCode));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">6. 기존 가맹점 검증</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          운영 중인 가맹점의 실매출과 V61/V62 예측치를 비교해 모델 정확도를 검증합니다.
        </p>
      </div>

      {/* 상단 요약 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">전체 상태</span>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${overallBadgeClass(summary.overallStatus)}`}>
            {summary.overallStatus}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <SummaryCard
            title="표본 수"
            value={`${formatNumber(summary.sampleCount)}곳`}
            passed={summary.passed.sampleCount}
            sub={`외부유입 강함 표본 ${formatNumber(summary.strongInflowSampleCount)}곳`}
          />
          <SummaryCard title="평균절대오차" value={formatPercent(summary.meanAbsoluteError)} passed={summary.passed.meanAbsoluteError} />
          <SummaryCard title="중앙절대오차" value={formatPercent(summary.medianAbsoluteError)} passed={summary.passed.medianAbsoluteError} />
          <SummaryCard title="±10% 이내 비율" value={formatPercent(summary.within10PctRatio)} />
          <SummaryCard title="±20% 이내 비율" value={formatPercent(summary.within20PctRatio)} passed={summary.passed.within20PctRatio} />
          <SummaryCard title="최대오차" value={formatPercent(summary.maxError)} />
          <SummaryCard title="평균편향" value={formatPercent(summary.meanBias)} passed={summary.passed.meanBias} />
          <SummaryCard
            title="강함표본 통과여부"
            value={summary.passed.strongInflowSampleCount ? "충족" : "부족"}
            passed={summary.passed.strongInflowSampleCount}
          />
        </div>

        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {brandExcludedInSample > 0
            ? `${brandExcludedInSample}곳은 브랜드 확인 필요/리그PC방이라 검증 표본에서 제외되었습니다.`
            : "브랜드 구분 상 검증 표본에서 제외된 점포가 없습니다."}
        </p>
      </section>

      {/* 점포별 표 */}
      <section>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">점포별 검증 결과</h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">가맹점코드</th>
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">실제매출</th>
                <th className="px-3 py-2" title="재계산 불가 - 원본 값">
                  V61(참고)
                </th>
                <th className="px-3 py-2">외부유입제한</th>
                <th className="px-3 py-2">V62보정률</th>
                <th className="px-3 py-2">V62예측</th>
                <th className="px-3 py-2">절대오차</th>
                <th className="px-3 py-2">편향</th>
                <th className="px-3 py-2">점포판정</th>
                <th className="px-3 py-2">85%</th>
                <th className="px-3 py-2">115%</th>
                <th className="px-3 py-2">표본사용여부</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {sortedRows.map((row) => {
                const bias = biasDisplay(row.bias);
                return (
                  <tr key={row.storeCode} className="text-zinc-800 dark:text-zinc-200">
                    <td className="px-3 py-2 font-medium">{row.storeCode}</td>
                    <td className="px-3 py-2">{row.storeName}</td>
                    <td className="px-3 py-2">{formatWon(row.actualSales)}</td>
                    <td className="px-3 py-2" title="재계산 불가 - 원본 값">
                      {formatWon(row.v61Predicted)}
                    </td>
                    <td className="px-3 py-2">{row.inflowRestriction}</td>
                    <td className="px-3 py-2">{formatPercent(row.v62Rate)}</td>
                    <td className="px-3 py-2">{formatWon(row.v62Predicted)}</td>
                    <td className="px-3 py-2">{formatPercent(row.absoluteError)}</td>
                    <td className={`px-3 py-2 font-medium ${bias.cls}`}>
                      {formatPercent(row.bias)} ({bias.label})
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${judgementBadgeClass(row.storeJudgement)}`}>
                        {row.storeJudgement}
                      </span>
                    </td>
                    <td className="px-3 py-2">{formatWon(row.lowerBound85)}</td>
                    <td className="px-3 py-2">{formatWon(row.upperBound115)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.usedInSample === "사용"
                            ? "text-green-700 dark:text-green-400"
                            : "text-zinc-400 dark:text-zinc-500"
                        }
                      >
                        {row.usedInSample}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {sortedRows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
                    검증 가능한 점포가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 과대/과소 예측 상위 */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">과대예측 점포 (상위 5)</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {overPredicted.length === 0 && <li className="text-zinc-500 dark:text-zinc-400">없음</li>}
            {overPredicted.map((row) => (
              <li key={row.storeCode} className="flex justify-between gap-2">
                <span className="text-zinc-700 dark:text-zinc-300">
                  {row.storeCode} {row.storeName}
                </span>
                <span className="font-medium text-red-600 dark:text-red-400">{formatPercent(row.bias)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-400">과소예측 점포 (상위 5)</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {underPredicted.length === 0 && <li className="text-zinc-500 dark:text-zinc-400">없음</li>}
            {underPredicted.map((row) => (
              <li key={row.storeCode} className="flex justify-between gap-2">
                <span className="text-zinc-700 dark:text-zinc-300">
                  {row.storeCode} {row.storeName}
                </span>
                <span className="font-medium text-blue-600 dark:text-blue-400">{formatPercent(row.bias)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 검증에서 제외된 점포 */}
      <section>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">검증에서 제외된 점포</h2>
        <div className="mt-2 space-y-4">
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">본사 수동 제외 ({excludedManual.length}곳)</h3>
            {excludedManual.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">없음</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {excludedManual.map((s) => (
                  <li key={s.storeCode}>
                    <span className="font-medium">{s.storeCode} {s.storeName}</span> — {s.excludedReason ?? "사유 미입력"}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">V61 예측값 없음 ({excludedNoV61.length}곳)</h3>
            {excludedNoV61.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">없음</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {excludedNoV61.map((s) => (
                  <li key={s.storeCode}>
                    <span className="font-medium">{s.storeCode} {s.storeName}</span> — V61 예측값 없음
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              브랜드 확인 필요 / 리그PC방 ({excludedBrand.length}곳)
            </h3>
            {excludedBrand.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">없음</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                {excludedBrand.map((s) => (
                  <li key={s.storeCode}>
                    <span className="font-medium">{s.storeCode} {s.storeName}</span> — 브랜드구분: {s.brandType}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {noSalesCount > 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              그 외 {noSalesCount}곳은 매출 데이터가 아직 없어 검증 대상에서 빠졌습니다.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
