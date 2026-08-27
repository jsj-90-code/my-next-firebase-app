"use client";

// 신규후보지 최종결과 화면 - 카드형 분석 이미지(1차 초안).
// 2026-08-27: 사용자가 참고 이미지(다른 도구의 카드형 PC방 입지분석 리포트) 두 장을 보여주며
// "우리도 이런 이미지를 만들자"고 요청. 참고 이미지의 "카카오API 실시간 검증 로그"·손익(원가율·
// 회수기간) 섹션은 우리 시스템에 없는 데이터라 지어내지 않고 뺐다(사용자 확인: 원가율 44%는 우리
// 실제 수치가 아니라 다른 참고용 예시). 여기 나오는 숫자는 전부 EvaluationResult에 이미 계산돼
// 있는 값 그대로다 - 새 계산 없음.

import { formatNumber, formatPercent, formatScore, formatWon } from "@/lib/storeEval/format";
import type { CandidateInput, Competitor, EvaluationResult } from "@/lib/storeEval/types";

function gradeBadgeStyle(judgement: EvaluationResult["aaJudgement"]): string {
  if (judgement === "2,000만원 이상") return "bg-[#2f6b4f] text-white";
  if (judgement === "1,500만원 이상" || judgement === "1,000만원 이상") return "bg-[#a4823c] text-white";
  if (judgement === "1,000만원 미달") return "bg-[#a4432c] text-white";
  return "bg-[#8a8072] text-white";
}

function PercentBar({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  const pct = value == null ? null : Math.min(100, Math.max(0, value * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-[#5c5346] dark:text-[#c9bfae]">{label}</span>
        <span className="font-semibold text-[#171310] dark:text-[#f2ede2]">{formatPercent(value)}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#171310]/[0.08] dark:bg-white/[0.12]">
        <div className="h-full rounded-full bg-[#a4432c]" style={{ width: `${pct ?? 0}%` }} />
      </div>
      {hint && <p className="mt-0.5 text-[10px] text-[#8a8072]">{hint}</p>}
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-[#171310]/[0.04] p-2.5 dark:bg-white/[0.06]">
      <p className="text-[10px] text-[#8a8072]">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">{value}</p>
      {hint && <p className="mt-0.5 text-[9px] text-[#8a8072]">{hint}</p>}
    </div>
  );
}

export function ReportCard({
  result,
  candidate,
  competitors,
  summarySection,
}: {
  result: EvaluationResult;
  candidate: Pick<CandidateInput, "name" | "address" | "expectedPcCount" | "hourlyRate">;
  competitors: Competitor[];
  summarySection?: string | null;
}) {
  const topCompetitors = [...competitors]
    .filter((c) => c.distanceM != null)
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
    .slice(0, 3);

  return (
    <div
      id="report-card"
      className="w-[420px] rounded-2xl border border-[#171310]/[0.08] bg-[#fbf7ee] p-5 text-[#171310] dark:border-white/[0.08] dark:bg-[#171310] dark:text-[#f2ede2]"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] tracking-wide text-[#8a8072]">ISENS 점포평가 · V62</p>
          <h3 className="mt-0.5 text-lg font-bold">{candidate.name}</h3>
          <p className="mt-0.5 text-xs text-[#8a8072]">{candidate.address}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${gradeBadgeStyle(result.aaJudgement)}`}>
          {result.aaJudgement ?? "-"}
        </span>
      </div>

      <div className="mt-4 rounded-xl bg-[#171310] p-4 text-white dark:bg-[#f2ede2] dark:text-[#171310]">
        <p className="text-[10px] text-white/60 dark:text-[#171310]/60">V62 최종예상월매출</p>
        <p className="mt-1 text-2xl font-bold">{formatWon(result.v62Final)}</p>
        <p className="mt-1 text-[10px] text-white/60 dark:text-[#171310]/60">
          2,000만원 기준 {formatWon(result.aaBaselineRevenue)} · 상권등급 {result.marketGrade ?? "-"} · {result.marketCharacter ?? "-"}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatTile label="상권수요" value={formatNumber(result.marketDemand)} />
        <StatTile label="경쟁IP" value={formatNumber(result.competitorIp)} />
        <StatTile label="IP당수요" value={formatScore(result.ipPerDemand)} hint="여유>15 / 포화<7" />
        <StatTile label="경쟁력격차" value={formatScore(result.competitivenessGap)} />
      </div>

      {/* 2026-08-27: 사용자가 실사용(외부 공유용) 중 발견 — 경쟁점 핑봇_가동률이 일부만 입력돼
          있으면 예상 가동률이 100%를 훌쩍 넘어(예: 110%) 카드만 봐서는 앱이 고장난 것처럼 보인다.
          이미 계산돼 있는 measuredForecastNeedsReview(가동률이 검토기준 초과)를 그대로 반영해,
          이럴 때는 수치 대신 "데이터 재검토 필요" 안내로 바꾼다 - 숫자를 지어내거나 억지로
          100%로 잘라 보여주지 않고, 아직 공유하기엔 자료가 부족하다는 사실 자체를 보여준다. */}
      {result.measuredForecastNeedsReview ? (
        <div className="mt-4 rounded-lg border border-[var(--sl-warn)]/30 bg-[var(--sl-warn-soft)] p-3 text-[11px] text-[var(--sl-warn)]">
          <p className="font-semibold">⚠ 수요확보율/가동률 데이터 재검토 필요</p>
          <p className="mt-1 text-[10px] leading-relaxed">
            경쟁점 실측자료(핑봇_가동률)가 일부만 입력돼 있어 예상 가동률이 비정상적으로 높게 나옵니다. 경쟁점 탭에서
            나머지 핑봇_가동률을 채운 뒤 다시 계산해주세요.
          </p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <PercentBar label="예상 수요확보율" value={result.demandCaptureRate} />
          <PercentBar label="예상 가동률" value={result.expectedUtilization} hint="100% 초과 시 수요초과 신호" />
        </div>
      )}

      {topCompetitors.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-semibold text-[#8a8072]">인근 경쟁점</p>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {topCompetitors.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-[#171310]/[0.04] px-2.5 py-1.5 text-[11px] dark:bg-white/[0.06]">
                <span className="font-medium">{c.name}</span>
                <span className="text-[#8a8072]">
                  {c.distanceM != null ? `${formatNumber(c.distanceM)}m` : "-"} · {c.investigationStatus}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {summarySection && (
        <div className="mt-4 rounded-lg bg-[#171310]/[0.04] p-3 text-[11px] leading-relaxed dark:bg-white/[0.06]">
          <p className="text-[10px] font-semibold text-[#8a8072]">종합 의견</p>
          <p className="mt-1">{summarySection}</p>
        </div>
      )}

      <p className="mt-4 text-right text-[9px] text-[#8a8072]">
        {candidate.hourlyRate ? `시간당 ${formatWon(candidate.hourlyRate)}` : ""}
        {candidate.expectedPcCount ? ` · 예상 PC ${candidate.expectedPcCount}대` : ""}
      </p>
    </div>
  );
}
