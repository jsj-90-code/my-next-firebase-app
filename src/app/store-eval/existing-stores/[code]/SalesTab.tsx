"use client";

import { useEffect, useState } from "react";
import { listEvaluationSales } from "@/lib/storeEval/store";
import type { ExistingStoreMonthlySales } from "@/lib/storeEval/types";
import { SalesBreakdown } from "../SalesBreakdown";

export function SalesTab({ storeCode, openedAt }: { storeCode: string; openedAt: string | null }) {
  const [records, setRecords] = useState<ExistingStoreMonthlySales[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    listEvaluationSales([{ storeCode, openedAt }]).then(rows => {
      if (active) setRecords(rows);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "월매출을 불러오지 못했습니다.");
    });
    return () => { active = false; };
  }, [storeCode, openedAt, attempt]);

  if (error) return <div role="alert" className="app-card rounded-xl p-4 text-sm">
    <p>{error}</p>
    <button type="button" className="app-btn-outline mt-2 rounded-md px-3 py-2" onClick={() => { setError(null); setRecords(null); setAttempt(value => value + 1); }}>다시 불러오기</button>
  </div>;
  if (records == null) return <p role="status" className="text-sm text-[var(--sl-ink-soft)]">월별 매출을 불러오는 중...</p>;
  return <div className="app-card rounded-xl p-4"><SalesBreakdown sales={records} openedAt={openedAt} /></div>;
}
