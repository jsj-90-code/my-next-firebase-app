"use client";

// 경쟁점 가동률 목록 + 등록 — 2026-10-06 신설.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createPingStore, listPingStores } from "@/lib/pingMonitor/clientStore";
import {
  BLOCKED_SUSPECT_SAMPLES,
  SAMPLE_INTERVAL_MINUTES,
  denominator,
  formatPct,
  kstDaysAgo,
  rangeUtilization,
  storeStatus,
  type PingStore,
} from "@/lib/pingMonitor/summary";
import { StoreForm } from "./StoreForm";

const TONE: Record<string, string> = {
  ok: "app-badge-ok",
  warn: "app-badge-warn",
  danger: "app-badge-danger",
  neutral: "app-badge-neutral",
};

export default function PingMonitorPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [stores, setStores] = useState<PingStore[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listPingStores()
      .then((rows) => !cancelled && setStores(rows))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "목록을 불러오지 못했습니다."));
    return () => {
      cancelled = true;
    };
  }, [user]);

  const today = kstDaysAgo(0);
  const from7 = kstDaysAgo(6);
  const from30 = kstDaysAgo(29);
  const intervalText = SAMPLE_INTERVAL_MINUTES % 60 === 0 ? `${SAMPLE_INTERVAL_MINUTES / 60}시간` : `${SAMPLE_INTERVAL_MINUTES}분`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">경쟁점 가동률</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--sl-ink-soft)]">
            {intervalText}마다 등록된 IP대역의 PC에 연결을 시도해, 대답한 PC 수 ÷ 대수를 기록합니다. 기록은 기한 없이 쌓이고, 상세 화면에서 기간을 골라 볼 수 있습니다.
            {` `}
            {BLOCKED_SUSPECT_SAMPLES}번 넘게 재는 동안 한 대도 대답하지 않으면 &ldquo;측정 불가 의심&rdquo;(PC가 바깥 확인을 막아 둔 매장)으로 따로 표시합니다.
          </p>
        </div>
        <button type="button" className="app-btn-primary rounded-lg px-4 py-2 text-sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "닫기" : "+ 경쟁점 등록"}
        </button>
      </div>

      {showForm && (
        <section className="app-card rounded-2xl p-4">
          <h2 className="mb-3 text-sm font-semibold">새 경쟁점</h2>
          <StoreForm
            submitLabel="등록하고 측정 시작"
            onSubmit={async (input) => {
              const id = await createPingStore(input, user?.email ?? null);
              router.push(`/ping-monitor/${id}`);
            }}
          />
        </section>
      )}

      {error && <p role="alert" className="app-notice app-badge-danger px-3 py-2 text-sm">{error}</p>}
      {stores == null && !error && <p className="text-sm text-[var(--sl-ink-soft)]">불러오는 중...</p>}
      {stores != null && stores.length === 0 && (
        <p className="app-card-sm rounded-xl p-4 text-sm text-[var(--sl-ink-soft)]">아직 등록된 경쟁점이 없습니다. 오른쪽 위 &ldquo;경쟁점 등록&rdquo;으로 시작하세요.</p>
      )}

      {stores != null && stores.length > 0 && (
        <div className="app-card overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[var(--sl-hairline)] text-left text-xs text-[var(--sl-ink-soft)]">
                <th className="px-3 py-2 font-medium">상호</th>
                <th className="px-3 py-2 text-right font-medium">대수</th>
                <th className="px-3 py-2 text-right font-medium">최근 측정</th>
                <th className="px-3 py-2 text-right font-medium">오늘</th>
                <th className="px-3 py-2 text-right font-medium">최근 7일</th>
                <th className="px-3 py-2 text-right font-medium">최근 30일</th>
                <th className="px-3 py-2 text-right font-medium">전체</th>
                <th className="px-3 py-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => {
                const status = storeStatus(s);
                const all = rangeUtilization(s.days, null, null);
                return (
                  <tr key={s.id} className="border-b border-[var(--sl-hairline)] last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                    <td className="px-3 py-2">
                      <Link href={`/ping-monitor/${s.id}`} className="font-medium text-[#171310] hover:underline dark:text-[#f2ede2]">
                        {s.name}
                      </Link>
                      <div className="text-xs text-[var(--sl-ink-soft)]">
                        {[s.address, s.memo].filter(Boolean).join(" · ") || s.ipRanges}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{denominator(s)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">
                      {s.lastSample ? (
                        <>
                          {s.lastSample.alive}/{s.lastSample.total}
                          <div className="text-[var(--sl-ink-soft)]">
                            {s.lastSample.date.slice(5)} {s.lastSample.hour}시
                          </div>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPct(rangeUtilization(s.days, today, today).util)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatPct(rangeUtilization(s.days, from7, today).util)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPct(rangeUtilization(s.days, from30, today).util)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPct(all.util)}
                      <div className="text-xs text-[var(--sl-ink-soft)]">{all.samples}회</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`app-badge ${TONE[status.tone]}`}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
