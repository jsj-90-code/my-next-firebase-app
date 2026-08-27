"use client";

// 신규후보지 최종결과 화면 - 카드형 분석 이미지(1차 초안).
// 2026-08-27: 사용자가 참고 이미지(다른 도구의 카드형 PC방 입지분석 리포트) 두 장을 보여주며
// "우리도 이런 이미지를 만들자"고 요청. 참고 이미지의 "카카오API 실시간 검증 로그"·손익(원가율·
// 회수기간) 섹션은 우리 시스템에 없는 데이터라 지어내지 않고 뺐다(사용자 확인: 원가율 44%는 우리
// 실제 수치가 아니라 다른 참고용 예시). 여기 나오는 숫자는 전부 EvaluationResult에 이미 계산돼
// 있는 값 그대로다 - 새 계산 없음.

import { formatNumber, formatPercent, formatScore, formatWon } from "@/lib/storeEval/format";
import { competitivenessLabel } from "@/lib/storeEval/reportContext";
import type { CandidateInput, Competitor, EvaluationResult } from "@/lib/storeEval/types";

// 2026-08-27: "경쟁력격차 1.63이면 처음 보는 사람은 감이 안 온다"는 지적 — 원점수 대신
// reportContext.ts가 이미 다우오피스 보고서용으로 쓰던 5단계 라벨(매우우위~매우열세, 08_계산기준
// demandCaptureTable 경계값 그대로 재사용)을 가져다 쓴다. 새 기준을 만들지 않고 기존 걸 재사용.
function marketDemandSourceHint(marketCharacter: EvaluationResult["marketCharacter"]): string | null {
  if (marketCharacter === "주거중심") return "거주인구 기반";
  if (marketCharacter === "번화가" || marketCharacter === "혼합") return "유동인구 기반";
  return null;
}

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

/**
 * 2026-08-27: "수요가 매출까지 어떻게 이어지는지 근거가 안 보인다"는 사용자 지적으로 추가.
 * AI 호출 없이 이미 계산돼 있는 값만 순서대로 이어 붙인다(reportContext.ts의 "[매출 예측]" 문장과
 * 같은 체인 — 상권수요 → 자사 확보 예상수요(경쟁력·PC대수 비중 반영) → PC대수×요금 → V62 최종매출).
 * 예상 가동률(실측기반 별도 경로)은 이 체인에 안 쓴다 — V62는 회귀모형이라 가동률이라는 중간
 * 단계 자체가 없다(reportContext.ts와 동일 원칙).
 */
function ReasoningChain({ result, hourlyRate, expectedPcCount }: { result: EvaluationResult; hourlyRate: number | null; expectedPcCount: number | null }) {
  const steps = [
    { label: "상권수요", value: result.marketDemand != null ? `${formatNumber(result.marketDemand)}명` : "-" },
    { label: "자사 확보 예상 수요", value: result.expectedOwnDemand != null ? `${formatNumber(result.expectedOwnDemand)}명` : "-", hint: "경쟁력·PC대수 비중 반영" },
    { label: "PC대수 × 시간당요금", value: `${formatNumber(expectedPcCount)}대 × ${formatWon(hourlyRate)}` },
  ];
  return (
    <div className="mt-4 rounded-xl border border-[#171310]/[0.08] p-3 dark:border-white/[0.08]">
      <p className="text-[10px] font-semibold text-[#8a8072]">매출 산정 근거</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {steps.map((step) => (
          <div key={step.label}>
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-[#5c5346] dark:text-[#c9bfae]">{step.label}</span>
              <span className="font-semibold text-[#171310] dark:text-[#f2ede2]">{step.value}</span>
            </div>
            {step.hint && <p className="text-[9px] text-[#8a8072]">{step.hint}</p>}
            <p className="mt-1 text-center text-[10px] text-[#8a8072]">↓</p>
          </div>
        ))}
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="font-semibold text-[#171310] dark:text-[#f2ede2]">V62 최종예상월매출</span>
          <span className="font-bold text-[#a4432c]">{formatWon(result.v62Final)}</span>
        </div>
      </div>
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
        {/* 2026-08-27 (2차): aaJudgement가 이제 V62(정식 계산) 기준이라 "데이터 재검토" 상태 자체가
            없어졌다 — AA경로(핑봇 실측) 기반이던 예전엔 경쟁점 실사가 부분적일 때 이 상태가 흔하게
            뜨면서 카드가 고장난 것처럼 보이는 문제가 있었는데, 근본 원인(AA경로 자체의 낮은 신뢰도,
            평균오차 52%)을 없애서 해결했다. */}
        {result.aaJudgement && (
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${gradeBadgeStyle(result.aaJudgement)}`}>
            {result.aaJudgement}
          </span>
        )}
      </div>

      <div className="mt-4 rounded-xl bg-[#171310] p-4 text-white dark:bg-[#f2ede2] dark:text-[#171310]">
        <p className="text-[10px] text-white/60 dark:text-[#171310]/60">V62 최종예상월매출</p>
        <p className="mt-1 text-2xl font-bold">{formatWon(result.v62Final)}</p>
        <p className="mt-1 text-[10px] text-white/60 dark:text-[#171310]/60">
          2,000만원 기준 {formatWon(result.aaBaselineRevenue)} · 상권등급 {result.marketGrade ?? "-"} · {result.marketCharacter ?? "-"}
        </p>
      </div>

      <ReasoningChain result={result} hourlyRate={candidate.hourlyRate} expectedPcCount={candidate.expectedPcCount} />

      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatTile
          label="상권수요"
          value={`${formatNumber(result.marketDemand)}명`}
          hint={marketDemandSourceHint(result.marketCharacter) ?? undefined}
        />
        <StatTile label="경쟁IP" value={formatNumber(result.competitorIp)} hint="경쟁점 시설·서비스 종합점수 합" />
        <StatTile label="IP당수요" value={formatScore(result.ipPerDemand)} hint="여유>15 / 포화<7" />
        <StatTile
          label="경쟁력격차"
          value={
            competitors.length === 0
              ? "비교 대상 없음"
              : `${formatScore(result.competitivenessGap)} (${competitivenessLabel(result.competitivenessGap) ?? "비교 불가"})`
          }
          hint="경쟁점 평균 대비, 1.0=동률"
        />
      </div>

      {/* 2026-08-27 (3차 수정) — "예상매출액(V62)이 이미 있는데 그걸 가동률로 환산하면 되지 않냐"는
          질문으로 발견: 기존 "예상 가동률"(expectedUtilization)은 경쟁점 실가동좌석(핑봇 실측) 기반의
          완전히 별개 경로라 V62 매출과 안 맞아떨어지는 경우가 있었다(경쟁점이 많은 상권은 주요
          경쟁점만 실사하는 게 정상 업무 프로세스라 이 경로가 원래 노이즈가 있음, 위 커밋들 참고).
          카드에는 그 대신 V62 최종예상월매출 자체를 거꾸로 풀어낸 v62ImpliedUtilization을 보여준다 -
          카드 맨 위에 이미 크게 나온 V62 숫자와 항상 정합적이라, "가동률이 왜 매출이랑 안 맞지"라는
          혼란이 구조적으로 없어진다. */}
      <div className="mt-4">
        <PercentBar
          label="V62 매출 기준 환산 가동률"
          value={result.v62ImpliedUtilization}
          hint="V62 최종예상월매출을 좌석 가동률로 환산한 값 (100% 초과 시 수요초과 신호)"
        />
      </div>

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
