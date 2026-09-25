"use client";

import Link from "next/link";
import { useState } from "react";
import type { ValidationStoreRow } from "@/lib/storeEval/calc";
import { formatPercent, formatWon } from "@/lib/storeEval/format";

function errorPercent(predicted: number | undefined, actual: number | undefined) {
  if (predicted == null || actual == null || actual <= 0) return "-";
  const error = predicted / actual - 1;
  return `${error > 0 ? "+" : ""}${formatPercent(error)}`;
}

export function RevenueComparisonTable({ rows }: { rows: ValidationStoreRow[] }) {
  const [search, setSearch] = useState("");
  const visible = rows.filter(row => `${row.storeName} ${row.storeCode}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="app-card space-y-3 rounded-xl p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">PC·상품 예측액과 실제액 비교</h2>
      <input aria-label="매출 비교 매장 검색" value={search} onChange={event => setSearch(event.target.value)} placeholder="매장명·코드 검색" className="app-input px-3 py-1.5 text-sm" />
    </div>
    <p className="text-xs leading-5 text-[var(--sl-ink-soft)]">
      금액은 월평균입니다. 예측은 위 검증과 동일하게 대상 점포를 학습에서 제외한 값입니다(학습 제외 매장은 참고용).
      실제액은 오픈월을 제외한 1~12개월 자료 중 기존 모형과 같은 평균을 사용합니다: 2개월차 이후 우선, 없으면 1개월차.
      현재월은 제외합니다. 오차는 (예측−실제)÷실제이며 +는 과대, −는 과소 예측입니다.
    </p>
    <div className="overflow-x-auto">
      {/* 2026-09-25 사용자 요청 — 매장당 두 줄(PC/상품)을 한 줄로. PC·상품을 열 묶음으로 나란히 둔다. */}
      <table className="w-full min-w-[980px] text-right text-sm tabular-nums">
        <caption className="sr-only">매장별 PC·상품 예측·실제 월평균과 상품 비중</caption>
        <thead className="app-card-sm text-xs text-[var(--sl-ink-soft)]">
          <tr>
            <th scope="col" rowSpan={2} className="whitespace-nowrap px-3 py-2 text-left">매장</th>
            <th scope="colgroup" colSpan={3} className="whitespace-nowrap border-l border-[#171310]/10 px-3 pt-2 text-center dark:border-white/10">PC</th>
            <th scope="colgroup" colSpan={3} className="whitespace-nowrap border-l border-[#171310]/10 px-3 pt-2 text-center dark:border-white/10">상품</th>
            <th scope="colgroup" colSpan={2} className="whitespace-nowrap border-l border-[#171310]/10 px-3 pt-2 text-center dark:border-white/10">상품 비중</th>
          </tr>
          <tr>{["예측", "실제", "오차", "예측", "실제", "오차", "예측", "실제"].map((label, i) => <th scope="col" key={i} className={`whitespace-nowrap px-3 pb-2 ${i % 3 === 0 && i < 7 ? "border-l border-[#171310]/10 dark:border-white/10" : ""}`}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {visible.map(row => {
            const predicted = row.revenueBreakdown;
            const actual = row.actualRevenueBreakdown;
            const actualTotal = actual ? actual.pcRevenueAvg + actual.productRevenueAvg : 0;
            const sep = "border-l border-[#171310]/10 dark:border-white/10";
            return <tr key={row.storeCode} className="border-t border-[#171310]/10 dark:border-white/10">
              <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">
                <Link href={`/store-eval/existing-stores/${row.storeCode}?tab=sales`} className="underline">{row.storeName}</Link>
                {!row.includedInCoreAccuracy && <span className="ml-1.5 text-xs font-normal text-[var(--sl-ink-soft)]" title={row.exclusionReason ?? "검증 제외"}>참고용</span>}
              </th>
              <td className={`whitespace-nowrap px-3 py-2 ${sep}`}>{formatWon(predicted?.pcRevenue)}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatWon(actual?.pcRevenueAvg)}</td>
              <td className="whitespace-nowrap px-3 py-2">{errorPercent(predicted?.pcRevenue, actual?.pcRevenueAvg)}</td>
              <td className={`whitespace-nowrap px-3 py-2 font-semibold ${sep}`}>{formatWon(predicted?.productRevenue)}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatWon(actual?.productRevenueAvg)}</td>
              <td className="whitespace-nowrap px-3 py-2">{errorPercent(predicted?.productRevenue, actual?.productRevenueAvg)}</td>
              <td className={`whitespace-nowrap px-3 py-2 font-medium ${sep}`}>{formatPercent(predicted && predicted.monthlyRevenue > 0 ? predicted.productRevenue / predicted.monthlyRevenue : null)}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatPercent(actual && actualTotal > 0 ? actual.productRevenueAvg / actualTotal : null)}</td>
            </tr>;
          })}
          {!visible.length && <tr><td colSpan={9} className="py-6 text-center">일치하는 매장이 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="text-xs text-[var(--sl-ink-soft)]">금액 구성 누락 또는 검증 총액과 평균 기간이 일치하지 않으면 실제 구성은 ‘-’로 표시합니다. 실제 0원일 때 오차율은 표시하지 않습니다.</p>
  </section>;
}
