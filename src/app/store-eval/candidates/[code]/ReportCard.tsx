"use client";

// 신규후보지 최종결과 화면 - 카드형 분석 이미지(1차 초안).
// 2026-08-27: 사용자가 참고 이미지(다른 도구의 카드형 PC방 입지분석 리포트) 두 장을 보여주며
// "우리도 이런 이미지를 만들자"고 요청. 참고 이미지의 "카카오API 실시간 검증 로그"·손익(원가율·
// 회수기간) 섹션은 우리 시스템에 없는 데이터라 지어내지 않고 뺐다(사용자 확인: 원가율 44%는 우리
// 실제 수치가 아니라 다른 참고용 예시). 여기 나오는 숫자는 전부 EvaluationResult에 이미 계산돼
// 있는 값 그대로다 - 새 계산 없음.

import { formatDate, formatManwon, formatManwonRough, formatNumber, formatPercent, formatScore, formatWon } from "@/lib/storeEval/format";
import { competitivenessLabel, storeEvaluationGrade } from "@/lib/storeEval/reportContext";
import type { CandidateInput, Competitor, EvaluationResult, ModelAccuracySummary } from "@/lib/storeEval/types";

// 2026-08-27: "경쟁력격차 1.63이면 처음 보는 사람은 감이 안 온다"는 지적 — 원점수 대신
// reportContext.ts가 이미 다우오피스 보고서용으로 쓰던 5단계 라벨(매우우위~매우열세, 08_계산기준
// demandCaptureTable 경계값 그대로 재사용)을 가져다 쓴다. 새 기준을 만들지 않고 기존 걸 재사용.
function marketDemandSourceHint(marketCharacter: EvaluationResult["marketCharacter"]): string | null {
  if (marketCharacter === "주거중심") return "거주인구 기반";
  if (marketCharacter === "번화가" || marketCharacter === "혼합") return "유동인구 기반";
  return null;
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
        <div className="h-full rounded-full bg-[var(--sl-gold-ink)]" style={{ width: `${pct ?? 0}%` }} />
      </div>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--sl-ink-soft)]">{hint}</p>}
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
    { label: "PC대수 · 시간당요금", value: `${formatNumber(expectedPcCount)}대 · ${formatWon(hourlyRate)}` },
  ];
  return (
    <div className="mt-4 rounded-xl border border-[#171310]/[0.08] p-3 dark:border-white/[0.08]">
      {/* 2026-09-13 — 제목이 "매출 산정 근거"라 화살표 체인이 곱셈 과정처럼 읽혔다. V62는 기존
          가맹점 실적으로 학습한 회귀모형이라 이 값들을 곱해서 매출이 나오는 게 아니다 — 여기
          나열된 건 "예측에 들어간 값"이지 계산 단계가 아니다. 제목과 마지막 연결을 그렇게 고쳤다. */}
      <p className="text-[10px] font-semibold text-[var(--sl-ink-soft)]">예측에 들어간 값</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {steps.map((step) => (
          <div key={step.label}>
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-[#5c5346] dark:text-[#c9bfae]">{step.label}</span>
              <span className="font-semibold text-[#171310] dark:text-[#f2ede2]">{step.value}</span>
            </div>
            {step.hint && <p className="text-[9px] text-[var(--sl-ink-soft)]">{step.hint}</p>}
          </div>
        ))}
        <p className="mt-0.5 text-center text-[9px] text-[var(--sl-ink-soft)]">
          ↓ 기존 가맹점 실적으로 학습한 예측모형
        </p>
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="font-semibold text-[#171310] dark:text-[#f2ede2]">예상 월매출</span>
          <span className="font-bold text-[var(--sl-gold-ink)]">약 {formatManwonRough(result.v62Final)}</span>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-[#171310]/[0.04] p-2.5 dark:bg-white/[0.06]">
      <p className="text-[10px] text-[var(--sl-ink-soft)]">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">{value}</p>
      {hint && <p className="mt-0.5 text-[9px] text-[var(--sl-ink-soft)]">{hint}</p>}
    </div>
  );
}

export function ReportCard({
  result,
  candidate,
  competitors,
  summarySection,
  accuracy,
  productRatio,
}: {
  result: EvaluationResult;
  candidate: Pick<CandidateInput, "name" | "address" | "expectedPcCount" | "hourlyRate" | "judgedRevenue" | "judgedReason">;
  competitors: Competitor[];
  summarySection?: string | null;
  // 2026-09-13 — 이 카드는 밖으로 내보내는 이미지다. "이 예측이 얼마나 맞는지"가 같이 없으면
  // 숫자만 단정적으로 보인다. 검증화면이 남긴 요약 1건을 받아 한 줄로 덧붙인다.
  accuracy?: ModelAccuracySummary | null;
  // 환산 가동률이 전제하는 상품매출 비율(회사 기준 50%). 전제를 밝히지 않으면 읽는 사람이
  // 다른 기준으로 오해한다 — 평가기록 문구와 같은 방식으로 명시한다.
  productRatio?: number | null;
}) {
  const investigated = competitors.filter((c) => c.investigationStatus !== "경쟁점없음");
  const topCompetitors = [...investigated]
    .filter((c) => c.distanceM != null)
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
    .slice(0, 3);
  const grade = storeEvaluationGrade(result);

  return (
    <div
      id="report-card"
      className="w-[420px] rounded-2xl border border-[#171310]/[0.08] bg-[#fbf7ee] p-5 text-[#171310] dark:border-white/[0.08] dark:bg-[#171310] dark:text-[#f2ede2]"
    >
      {/* 2026-09-13 — 평가일자를 넣었다. 이미지로 내보내 공유하는 물건인데 언제 만든 건지가
          없으면 나중에 어느 시점 값인지 알 수 없다(기준매출은 평가 시점에 따라 달라지기도 한다). */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] tracking-wide text-[var(--sl-ink-soft)]">ISENS 점포평가</p>
          <h3 className="mt-0.5 text-lg font-bold">{candidate.name}</h3>
          <p className="mt-0.5 text-xs text-[var(--sl-ink-soft)]">{candidate.address}</p>
        </div>
        <div className="shrink-0 text-right">
          {/* 실제 평가기록의 첫 줄이 이 등급이다. 카드에도 같은 값을 실어 문서와 어긋나지 않게 한다. */}
          {grade && (
            <p className="rounded-md bg-[var(--sl-gold-ink)] px-2 py-0.5 text-[11px] font-bold text-white">{grade}</p>
          )}
          <p className="mt-1 text-[9px] text-[var(--sl-ink-soft)]">{formatDate(result.calculatedAt)} 기준</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-[#171310] p-4 text-white dark:bg-[#f2ede2] dark:text-[#171310]">
        <p className="text-[10px] text-white/60 dark:text-[#171310]/60">예상 월매출</p>
        {/* 2026-09-13 — 원 단위("58,280,450원")에서 만원 단위로 바꿨다. 420px 카드에서 자릿수가
            길어 읽기 어려웠고, 실제 평가기록도 "약 5,800만원"으로 쓴다. 회귀 예측값이라 만원
            단위까지 주장할 정밀도가 없기도 하다(100만원 단위로 끊는 formatManwonRough). */}
        <p className="mt-1 text-2xl font-bold">약 {formatManwonRough(result.v62Final)}</p>
        <p className="mt-1 text-[10px] text-white/60 dark:text-[#171310]/60">
          {/* 2026-09-13 — 상권등급(SS/S/A/B)을 뺐다. 이 카드는 점포팀 등 다른 팀이 보는 물건인데
              그 등급 체계는 이 시스템 안에서만 쓰는 내부 지표라 밖에서는 읽히지 않는다. 상권성격
              (번화가/혼합/주거중심)은 말 그대로라 남긴다. */}
          선투자 2,000만원 기준 {formatManwon(result.aaBaselineRevenue)} · {result.marketCharacter ?? "-"} 상권
        </p>
        {accuracy && accuracy.sampleCount > 0 && accuracy.meanAbsoluteErrorPct != null && (
          <p className="mt-1 text-[10px] text-white/60 dark:text-[#171310]/60">
            기존 가맹점 {accuracy.sampleCount}곳 실적으로 검증한 평균오차 {formatPercent(accuracy.meanAbsoluteErrorPct)} ·{" "}
            {formatManwonRough(result.v62Final != null ? result.v62Final * (1 - accuracy.meanAbsoluteErrorPct) : null)}~
            {formatManwonRough(result.v62Final != null ? result.v62Final * (1 + accuracy.meanAbsoluteErrorPct) : null)} 범위
          </p>
        )}
        {result.capacityCapped && (
          <p className="mt-1 text-[10px] text-amber-300 dark:text-amber-700">
            가동률 물리적 상한 적용됨(원래 예측 약 {formatManwonRough(result.v62FinalBeforeCap)})
          </p>
        )}
      </div>

      {/* 2026-09-13 — 담당자가 판단 매출을 적어둔 후보지만 함께 보여준다. 산식과 사람의 판단을
          나란히 두는 게 이 기능의 취지라(types.ts judgedRevenue), 카드에서도 같이 보이는 게 맞다. */}
      {candidate.judgedRevenue != null && (
        <div className="mt-2 rounded-xl border border-[var(--sl-gold-ink)]/40 p-3">
          <div className="flex items-baseline justify-between">
            <p className="text-[10px] font-semibold text-[var(--sl-ink-soft)]">담당자 판단 매출</p>
            <p className="text-sm font-bold text-[var(--sl-gold-ink)]">약 {formatManwonRough(candidate.judgedRevenue)}</p>
          </div>
          {candidate.judgedReason && <p className="mt-1 text-[10px] leading-relaxed text-[#5c5346] dark:text-[#c9bfae]">{candidate.judgedReason}</p>}
        </div>
      )}

      <ReasoningChain result={result} hourlyRate={candidate.hourlyRate} expectedPcCount={candidate.expectedPcCount} />

      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatTile
          label="상권수요"
          value={`${formatNumber(result.marketDemand)}명`}
          hint={marketDemandSourceHint(result.marketCharacter) ?? undefined}
        />
        {/* 2026-09-13 — 내부 지표명(경쟁IP·IP당수요·경쟁력격차)과 원점수를 뺐다. 이 카드는 점포팀
            등 다른 팀이 보는 물건이라 "경쟁IP 320", "경쟁력격차 1.63" 같은 값은 읽히지 않는다.
            뜻이 그대로 드러나는 말과 이미 있던 5단계 라벨로 바꾼다(값 자체는 같은 계산). */}
        <StatTile label="경쟁점 공급 규모" value={formatNumber(result.competitorIp)} hint="주변 경쟁점의 시설·규모를 합산한 값" />
        <StatTile
          label="공급 대비 수요"
          value={formatScore(result.ipPerDemand)}
          hint="클수록 여유 (15 이상 여유 · 7 미만 포화)"
        />
        <StatTile
          label="자사 경쟁력"
          value={
            investigated.length === 0
              ? "비교 대상 없음"
              : (competitivenessLabel(result.competitivenessGap) ?? "비교 불가")
          }
          hint="경쟁점 평균과 비교한 시설·서비스 수준"
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
        {/* 2026-09-13 — 전제(상품매출 비율)를 밝힌다. 이 값은 "총매출 중 절반이 PC매출"이라는
            회사 기준을 깔고 역산한 것이라, 전제를 안 적으면 읽는 사람이 다른 기준으로 오해한다.
            실제 평가기록도 "상품매출 비율 50% 기준 약 29%의 가동률이 필요함"으로 쓴다. */}
        <PercentBar
          label="이 매출이 나오려면 필요한 가동률"
          value={result.v62ImpliedUtilization}
          hint={`상품매출 비율 ${productRatio != null ? formatPercent(productRatio, 0) : "50%"} 기준으로 환산 (100% 초과 시 수요초과 신호)`}
        />
      </div>

      {/* 2026-08-27 (3차) — 카드 상단의 "2,000만원 이상" 같은 등급 배지를 빼고, 이 매장의 실제
          선투자 프로모션 기준매출 원화 값을 아래쪽에 보여달라는 요청(사용자 확인) — 추상적인
          등급 라벨 대신 세 기준선 실제 금액과 이 매장의 V62가 어디에 해당하는지를 함께 보여준다. */}
      {result.aaJudgement && result.aaJudgement !== "오픈월 입력 필요" && result.aaJudgement !== "실측자료 부족" && (
        <div className="mt-4">
          <p className="text-[10px] font-semibold text-[var(--sl-ink-soft)]">선투자 프로모션 기준매출</p>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {(
              [
                { tier: "2,000만원 이상" as const, amount: result.aaBaselineRevenue },
                { tier: "1,500만원 이상" as const, amount: result.aaBaselineRevenue1500 },
                { tier: "1,000만원 이상" as const, amount: result.aaBaselineRevenue1000 },
              ]
            ).map(({ tier, amount }) => {
              const achieved =
                result.aaJudgement === tier ||
                (result.aaJudgement === "2,000만원 이상" && tier !== "2,000만원 이상") ||
                (result.aaJudgement === "1,500만원 이상" && tier === "1,000만원 이상");
              return (
                <div
                  key={tier}
                  className={`rounded-lg p-2 text-center ${achieved ? "bg-[#2f6b4f] text-white" : "bg-[#171310]/[0.04] text-[var(--sl-ink-soft)] dark:bg-white/[0.06]"}`}
                >
                  <p className="text-[9px] opacity-80">{tier.replace(" 이상", "")}</p>
                  <p className="mt-0.5 text-[11px] font-semibold">{formatWon(amount)}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-[9px] text-[var(--sl-ink-soft)]">
            {result.aaJudgement === "1,000만원 미달" ? "1,000만원 기준 미달" : `${result.aaJudgement} 달성`} · 출점 판단과는 별개 판정
          </p>
        </div>
      )}

      {topCompetitors.length > 0 && (
        <div className="mt-4">
          {/* 2026-09-13 — 가까운 3곳만 싣는데 제목이 "인근 경쟁점"뿐이라 그게 전부인 것처럼
              보였다(12곳인 상권도 있다). 총 몇 곳 중 몇 곳인지 밝힌다. */}
          <p className="text-[10px] font-semibold text-[var(--sl-ink-soft)]">
            인근 경쟁점 {investigated.length > topCompetitors.length ? `(총 ${investigated.length}곳 중 가까운 ${topCompetitors.length}곳)` : `(총 ${investigated.length}곳)`}
          </p>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {topCompetitors.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-[#171310]/[0.04] px-2.5 py-1.5 text-[11px] dark:bg-white/[0.06]">
                <span className="font-medium">{c.name}</span>
                <span className="text-[var(--sl-ink-soft)]">
                  {c.distanceM != null ? `${formatNumber(c.distanceM)}m` : "-"} · {c.investigationStatus}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {summarySection && (
        <div className="mt-4 rounded-lg bg-[#171310]/[0.04] p-3 text-[11px] leading-relaxed dark:bg-white/[0.06]">
          <p className="text-[10px] font-semibold text-[var(--sl-ink-soft)]">종합 의견</p>
          <p className="mt-1">{summarySection}</p>
        </div>
      )}

      <p className="mt-4 text-right text-[9px] text-[var(--sl-ink-soft)]">
        {candidate.hourlyRate ? `시간당 ${formatWon(candidate.hourlyRate)}` : ""}
        {candidate.expectedPcCount ? ` · 예상 PC ${candidate.expectedPcCount}대` : ""}
      </p>
    </div>
  );
}
