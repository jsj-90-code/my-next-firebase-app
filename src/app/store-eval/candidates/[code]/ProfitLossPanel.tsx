"use client";

// 2026-10-16 사용자: "점포평가할 때 손익 계산까지 함께" — 예상월매출마다(담당자 판단·V62·실험실) 순손익을 나란히 보인다.
// 계산은 profitLoss.ts, 표준값은 settings.profitLoss(기존점 14곳 중앙) — 여기선 글자로 숫자를 박지 않고 그 값을 읽어 그린다.
import { computeProfitLoss, type ProfitLossLine } from "@/lib/storeEval/profitLoss";
import { formatManwon, formatPercent } from "@/lib/storeEval/format";
import type { ProfitLossSettings } from "@/lib/storeEval/types";

type Estimate = { label: string; revenue: number | null | undefined };

export function ProfitLossPanel({ estimates, pcCount, monthlyRent, monthlyMaintenanceFee, settings }: {
  estimates: Estimate[];
  pcCount: number | null | undefined;
  monthlyRent: number | null | undefined;
  monthlyMaintenanceFee: number | null | undefined;
  settings: ProfitLossSettings;
}) {
  const valid = estimates.filter((e): e is { label: string; revenue: number } => e.revenue != null && Number.isFinite(e.revenue) && e.revenue > 0);
  if (valid.length === 0 || !pcCount) return null;
  const pls = valid.map((e) => ({ ...e, pl: computeProfitLoss({ revenue: e.revenue, pcCount, monthlyRent, monthlyMaintenanceFee, settings }) }));
  const first = pls[0].pl;
  const groups: { title: string; pick: (p: typeof first) => ProfitLossLine[] }[] = [
    { title: "매출원가", pick: (p) => p.costOfSales },
    { title: "고정비", pick: (p) => p.fixedCosts },
    { title: "변동비", pick: (p) => p.variableCosts },
  ];
  const cell = "px-2 py-1 text-right tabular-nums";

  return (
    <div className="app-card mt-3 rounded-xl p-4">
      <p className="text-sm font-semibold">예상 손익 (월, 부가세 별도)</p>
      {first.rentMissing && (
        <p className="app-notice app-badge-warn mt-2 w-full justify-start px-3 py-2 text-xs leading-5">
          임대료가 입력되지 않아 0으로 계산했습니다 — 순손익이 실제보다 높게 나옵니다. [기본정보] 탭의 월 임대료·관리비를 채워 주세요(다우 심사글 값).
        </p>
      )}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {pls.map(({ label, pl }) => (
          <div key={label} className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
            <p className="text-xs text-[var(--sl-ink-soft)]">{label} 기준 순손익</p>
            <p className="mt-1 text-lg font-semibold">{formatManwon(pl.netProfit)}</p>
            <p className="text-xs text-[var(--sl-ink-soft)]">매출 {formatManwon(pl.sales)} · 순익률 {formatPercent(pl.netMargin)}</p>
          </div>
        ))}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--sl-ink-soft)]">항목별 보기</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10">
                <th className="px-2 py-1 text-left">항목</th>
                {pls.map(({ label }) => <th key={label} className={cell}>{label}</th>)}
                <th className="px-2 py-1 text-left">기준</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="px-2 py-1 font-semibold">매출</td>{pls.map(({ label, pl }) => <td key={label} className={`${cell} font-semibold`}>{formatManwon(pl.sales)}</td>)}<td className="px-2 py-1 text-[var(--sl-ink-soft)]">예상월매출 ÷ {settings.vatDivisor}</td></tr>
              <tr><td className="px-2 py-1 pl-4">PC / 상품</td>{pls.map(({ label, pl }) => <td key={label} className={cell}>{formatManwon(pl.pcSales)} / {formatManwon(pl.productSales)}</td>)}<td className="px-2 py-1 text-[var(--sl-ink-soft)]">상품 비중 {formatPercent(settings.productSalesShare, 0)}</td></tr>
              {groups.map((g) => (
                <GroupRows key={g.title} title={g.title} rows={pls.map(({ label, pl }) => ({ label, lines: g.pick(pl), laborFloorApplied: pl.laborFloorApplied }))} cell={cell} />
              ))}
              <tr className="border-t border-black/10 dark:border-white/10"><td className="px-2 py-1 font-semibold">순손익</td>{pls.map(({ label, pl }) => <td key={label} className={`${cell} font-semibold`}>{formatManwon(pl.netProfit)} ({formatPercent(pl.netMargin)})</td>)}<td /></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--sl-ink-soft)]">
          임대료·관리비는 후보지 입력값, 나머지는 기존 가맹점 14곳(재경 운영수익 양식 한 달 치, 2026-10-16 반영)의 중앙값이고 [설정]에서 바꿉니다.
          유료게임비 비율은 실측이 아니라 그 양식이 쓰는 공식값이고, 투자비 회수(감가상각)·이자는 빠져 있습니다.
        </p>
      </details>
    </div>
  );
}

function GroupRows({ title, rows, cell }: { title: string; rows: { label: string; lines: ProfitLossLine[]; laborFloorApplied: boolean }[]; cell: string }) {
  const lines = rows[0].lines;
  return (
    <>
      <tr className="border-t border-black/10 dark:border-white/10">
        <td className="px-2 py-1 font-semibold">{title}</td>
        {rows.map((r) => <td key={r.label} className={`${cell} font-semibold`}>{formatManwon(r.lines.reduce((s, l) => s + l.amount, 0))}</td>)}
        <td />
      </tr>
      {lines.map((line, i) => (
        <tr key={line.key}>
          <td className="px-2 py-1 pl-4">{line.label}</td>
          {rows.map((r) => <td key={r.label} className={cell}>{formatManwon(r.lines[i].amount)}{line.key === "labor" && r.laborFloorApplied ? " (하한)" : ""}</td>)}
          <td className="px-2 py-1 text-[var(--sl-ink-soft)]">{line.basis}</td>
        </tr>
      ))}
    </>
  );
}
