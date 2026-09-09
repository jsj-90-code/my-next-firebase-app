"use client";

import { useState } from "react";
import { formatPercent, formatWon } from "@/lib/storeEval/format";
import { salesBreakdown, summarizeSales } from "@/lib/storeEval/salesBreakdown";
import type { ExistingStoreMonthlySales } from "@/lib/storeEval/types";

export function SalesBreakdown({ sales }: { sales: ExistingStoreMonthlySales[] }) {
  const [year, setYear] = useState("all");
  const [currentMonth] = useState(() => new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit",
  }).format(new Date()));
  const years = [...new Set(sales.map(row => row.yearMonth.slice(0, 4)))].sort().reverse();
  const rows = sales.filter(row => year === "all" || row.yearMonth.startsWith(`${year}-`))
    .slice().sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  const summary = summarizeSales(rows, currentMonth);
  return (
    <section className="mt-3 space-y-3" aria-label="PC·상품 상세매출">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">PC·상품 상세매출</h3>
        <label className="flex items-center gap-2 text-xs">
          조회 연도
          <select value={year} onChange={event => setYear(event.target.value)} className="app-input px-2 py-1">
            <option value="all">전체 기간</option>
            {years.map(value => <option key={value} value={value}>{value}년</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          ["월평균 PC매출", formatWon(summary.pcAvg)],
          ["월평균 상품매출", formatWon(summary.productAvg)],
          ["월평균 총매출", formatWon(summary.totalAvg)],
          ["기간 상품 비중", formatPercent(summary.productShare)],
        ].map(([label, value]) => (
          <div key={label} className="app-card-sm rounded-lg p-3">
            <p className="text-xs text-[#8a8072]">{label}</p>
            <p className="mt-1 font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-[#8a8072]">
        선택 기간 중 PC·상품 금액이 모두 있는 지난 {summary.count}개월 기준입니다. 현재월·미래월·금액 누락월은 요약에서 제외합니다.
        상품 비중은 상품매출 ÷ 총매출이며, 기간 비중은 합산 금액 기준입니다. 평가용 오픈 초기 평균과 조회 기간이 다를 수 있습니다.
      </p>
      <div className="max-h-[32rem] overflow-auto rounded-lg border border-[#171310]/10 dark:border-white/10">
        <table className="w-full min-w-[640px] text-right text-xs tabular-nums">
          <caption className="sr-only">월별 PC매출, 상품매출, 총매출 및 상품 비중</caption>
          <thead className="app-card-sm sticky top-0">
            <tr>{["연월", "PC매출", "상품매출", "총매출", "상품 비중"].map(label => <th key={label} scope="col" className="whitespace-nowrap px-3 py-2">{label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[#171310]/10 dark:divide-white/10">
            {rows.map(row => {
              const values = salesBreakdown(row);
              return <tr key={row.yearMonth}>
                <th scope="row" className="whitespace-nowrap px-3 py-2 font-normal">{row.yearMonth}{row.yearMonth >= currentMonth ? " (미완료)" : ""}</th>
                <td className="px-3 py-2">{formatWon(values.pc)}</td>
                <td className="px-3 py-2">{formatWon(values.product)}</td>
                <td className="px-3 py-2 font-medium">{formatWon(values.total)}</td>
                <td className="px-3 py-2">{formatPercent(values.productShare)}</td>
              </tr>;
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-[#8a8072]">조회 기간의 매출 기록이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[#8a8072]">매출DB에서 동기화한 월별 금액과 웹에서 입력한 기록을 표시합니다. 금액 누락 또는 총매출 0원의 비중은 ‘-’로 표시합니다.</p>
    </section>
  );
}
