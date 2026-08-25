"use client";

// 점포평가 시스템 대시보드. 인증은 상위 layout.tsx(AutoAuthGate)가 이미 처리하므로 여기서는
// 데이터만 불러와 요약 카드/표로 보여준다. 새 계산 로직은 만들지 않고 CandidateInput/
// EvaluationResult 필드를 그대로 표시만 한다.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { exportCandidatesToExcel } from "@/lib/storeEval/exportExcel";
import { formatDateTime, formatWon } from "@/lib/storeEval/format";
import { listCandidates, listEvaluationResults } from "@/lib/storeEval/store";
import type { CandidateInput, EvaluationResult, FinalJudgement } from "@/lib/storeEval/types";

// "13_신규후보지판정" 원본 문자열 그대로. completionStatus/finalJudgement 어느 쪽이든 이 값이면
// "입력 필요" 계열로 뭉쳐서 카운트한다(요구사항 원문 지시).
const INPUT_NEEDED_STATUSES = new Set<string>([
  "07 분석 필요",
  "09 입지평가 필요",
  "외부유입 확인 필요",
  "브랜드 확인 필요",
  "V62 계산 확인 필요",
]);

function isInputNeeded(result: EvaluationResult): boolean {
  return (
    (result.finalJudgement != null && INPUT_NEEDED_STATUSES.has(result.finalJudgement)) ||
    (result.completionStatus != null && INPUT_NEEDED_STATUSES.has(result.completionStatus))
  );
}

function judgementBadgeClass(judgement: FinalJudgement | null | undefined): string {
  if (judgement === "평가 완료") return "app-badge-ok";
  if (judgement === "포화 주의" || judgement === "입지 재검토") return "app-badge-warn";
  if (judgement === "V62 계산 확인 필요") return "app-badge-danger";
  return "app-badge-neutral";
}

function JudgementBadge({ result }: { result: EvaluationResult | undefined }) {
  const label = result?.finalJudgement ?? (result ? "-" : "평가 대기");
  return <span className={`app-badge ${judgementBadgeClass(result?.finalJudgement)}`}>{label}</span>;
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "neutral" | "ok" | "warn" | "danger" }) {
  const toneTextClass = {
    neutral: "text-[#171310] dark:text-[#f2ede2]",
    ok: "text-[var(--sl-ok)]",
    warn: "text-[var(--sl-warn)]",
    danger: "text-[var(--sl-danger)]",
  }[tone];
  return (
    <div className="app-card relative overflow-hidden rounded-2xl p-4">
      <span className={`app-stripe-${tone} absolute inset-y-0 left-0 w-[3px]`} />
      <p className="text-xs font-medium text-[#8a8072]">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${toneTextClass}`}>{value.toLocaleString("ko-KR")}</p>
    </div>
  );
}

export default function StoreEvalDashboardPage() {
  const [candidates, setCandidates] = useState<CandidateInput[]>([]);
  const [results, setResults] = useState<EvaluationResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [candidateList, resultList] = await Promise.all([listCandidates(), listEvaluationResults()]);
        if (cancelled) return;
        setCandidates(candidateList);
        setResults(resultList);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "데이터를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const resultByCode = useMemo(() => new Map(results.map((result) => [result.candidateCode, result])), [results]);

  const stats = useMemo(() => {
    let completed = 0;
    let inputNeeded = 0;
    let saturationWarning = 0;
    let locationReview = 0;
    for (const result of results) {
      if (result.finalJudgement === "평가 완료") {
        completed++;
      } else if (result.finalJudgement === "포화 주의") {
        saturationWarning++;
      } else if (result.finalJudgement === "입지 재검토") {
        locationReview++;
      } else if (isInputNeeded(result)) {
        inputNeeded++;
      }
    }
    return { total: candidates.length, completed, inputNeeded, saturationWarning, locationReview };
  }, [candidates, results]);

  const recentResults = useMemo(
    () => [...results].sort((a, b) => b.calculatedAt - a.calculatedAt).slice(0, 10),
    [results],
  );

  async function handleExport() {
    setExporting(true);
    try {
      await exportCandidatesToExcel(candidates, results);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "엑셀 내보내기에 실패했습니다.");
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-[#8a8072]">불러오는 중...</div>;
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <h2 className="text-lg font-semibold">데이터를 불러오지 못했습니다</h2>
        <p className="mt-2 text-sm leading-6">{error}</p>
        <p className="mt-2 text-sm leading-6">
          Firebase/Firestore 설정(.env.local)이 올바른지, 또는 storeEvalCandidates/storeEvalResults 컬렉션 접근 권한이
          있는지 확인해주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="전체 후보지" value={stats.total} tone="neutral" />
        <StatCard label="평가 완료" value={stats.completed} tone="ok" />
        <StatCard label="입력 필요" value={stats.inputNeeded} tone="neutral" />
        <StatCard label="포화 주의" value={stats.saturationWarning} tone="warn" />
        <StatCard label="입지 재검토" value={stats.locationReview} tone="warn" />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">후보지 목록</h2>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || candidates.length === 0}
            className="app-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {exporting ? "내보내는 중..." : "엑셀로 내보내기"}
          </button>
        </div>

        {candidates.length === 0 ? (
          <div className="app-card rounded-2xl p-8 text-center text-sm text-[#8a8072]">
            등록된 후보지가 없습니다.{" "}
            <Link href="/store-eval/candidates" className="font-medium text-[#171310] underline dark:text-[#f2ede2]">
              신규후보지 등록하러 가기 →
            </Link>
          </div>
        ) : (
          <div className="app-card overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[#171310]/[0.08] text-xs text-[#8a8072] dark:border-white/[0.08]">
                <tr>
                  <th className="px-4 py-3 font-medium">후보지코드</th>
                  <th className="px-4 py-3 font-medium">이름</th>
                  <th className="px-4 py-3 font-medium">V62 최종예상월매출</th>
                  <th className="px-4 py-3 font-medium">85% 보수판단매출</th>
                  <th className="px-4 py-3 font-medium">최종운영판정</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#171310]/[0.06] dark:divide-white/[0.06]">
                {candidates.map((candidate) => {
                  const result = resultByCode.get(candidate.code);
                  return (
                    <tr key={candidate.code} className="app-row transition">
                      <td className="px-4 py-3 font-mono text-xs font-medium text-[#171310] dark:text-[#f2ede2]">
                        <Link href={`/store-eval/candidates/${candidate.code}`} className="hover:underline">
                          {candidate.code}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[#5c5346] dark:text-[#c9bfae]">{candidate.name}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-[#5c5346] dark:text-[#c9bfae]">{formatWon(result?.v62Final)}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-[#5c5346] dark:text-[#c9bfae]">{formatWon(result?.conservativeSales)}</td>
                      <td className="px-4 py-3">
                        <JudgementBadge result={result} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">최근 평가 목록</h2>
        {recentResults.length === 0 ? (
          <div className="app-card rounded-2xl p-8 text-center text-sm text-[#8a8072]">
            아직 계산된 평가 결과가 없습니다.
          </div>
        ) : (
          <div className="app-card overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[#171310]/[0.08] text-xs text-[#8a8072] dark:border-white/[0.08]">
                <tr>
                  <th className="px-4 py-3 font-medium">후보지</th>
                  <th className="px-4 py-3 font-medium">V62 최종예상월매출</th>
                  <th className="px-4 py-3 font-medium">최종운영판정</th>
                  <th className="px-4 py-3 font-medium">계산 시각</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#171310]/[0.06] dark:divide-white/[0.06]">
                {recentResults.map((result) => (
                  <tr key={result.candidateCode} className="app-row transition">
                    <td className="px-4 py-3">
                      <Link
                        href={`/store-eval/candidates/${result.candidateCode}?tab=result`}
                        className="font-medium text-[#171310] hover:underline dark:text-[#f2ede2]"
                      >
                        [{result.candidateCode}] {result.candidateName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-[#5c5346] dark:text-[#c9bfae]">{formatWon(result.v62Final)}</td>
                    <td className="px-4 py-3">
                      <JudgementBadge result={result} />
                    </td>
                    <td className="px-4 py-3 font-mono text-[#8a8072]">{formatDateTime(result.calculatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
