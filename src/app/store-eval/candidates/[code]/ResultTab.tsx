"use client";

// 탭4 최종결과 - "5. 최종평가 결과" 화면 요구사항.
// competitors + locationEvaluation + modelSettings(폴백 포함) + existingStores(referenceMarketDemand)를
// 모아 evaluateCandidate 한 번 호출 -> saveEvaluationResult로 스냅샷 저장 -> 화면 표시.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { formatNumber, formatPercent, formatScore, formatWon } from "@/lib/storeEval/format";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import {
  convertCandidateToExistingStore,
  getCandidate,
  getExistingStore,
  getLocationEvaluation,
  getModelSettings,
  listCompetitors,
  listExistingStores,
  saveEvaluationResult,
} from "@/lib/storeEval/store";
import { evaluateCandidate } from "@/lib/storeEval/evaluate";
import type { EvaluationResult, FinalJudgement, ModelSettings } from "@/lib/storeEval/types";
import { sectionClass, sectionTitleClass } from "./formFields";

function judgementStyle(j: FinalJudgement | null): string {
  if (j === "평가 완료") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (j === "포화 주의" || j === "입지 재검토") return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  if (j === "V62 계산 확인 필요") return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300";
  if (j == null) return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"; // "~확인 필요"/"~분석 필요"류
}

function ResultCard({ label, value, emphasis, hint }: { label: string; value: string; emphasis?: boolean; hint?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 ${emphasis ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-white dark:bg-zinc-950"}`}>
      <p className={`text-xs ${emphasis ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400"}`}>{label}</p>
      <p className={`mt-1 font-semibold ${emphasis ? "text-2xl" : "text-lg"}`}>{value}</p>
      {hint && <p className={`mt-1 text-[11px] ${emphasis ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-400"}`}>{hint}</p>}
    </div>
  );
}

export function ResultTab({ candidateCode }: { candidateCode: string }) {
  const { user } = useAuth();
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [settingsUsed, setSettingsUsed] = useState<ModelSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alreadyExisting, setAlreadyExisting] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertMessage, setConvertMessage] = useState<string | null>(null);

  useEffect(() => {
    getExistingStore(candidateCode).then((s) => setAlreadyExisting(s != null));
  }, [candidateCode]);

  async function handleConvert() {
    setConverting(true);
    setConvertMessage(null);
    try {
      const [candidate, competitors, locationEvaluation] = await Promise.all([
        getCandidate(candidateCode),
        listCompetitors(candidateCode),
        getLocationEvaluation(candidateCode),
      ]);
      if (!candidate) throw new Error("후보지 기본정보를 찾을 수 없습니다.");
      await convertCandidateToExistingStore({ candidate, competitors, locationEvaluation, actor: user?.email ?? null });
      setAlreadyExisting(true);
      setConvertMessage("기존 가맹점으로 전환했습니다. [기존 가맹점 관리] 화면에서 오픈일·월매출을 이어서 입력해주세요.");
    } catch (err) {
      setConvertMessage(err instanceof Error ? err.message : "전환 중 오류가 발생했습니다.");
    } finally {
      setConverting(false);
    }
  }

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const candidate = await getCandidate(candidateCode);
      if (!candidate) {
        throw new Error("후보지 기본정보가 없습니다. [기본정보] 탭에서 먼저 저장해주세요.");
      }
      const [competitors, locationEvaluation, existingStores, modelSettingsDoc] = await Promise.all([
        listCompetitors(candidateCode),
        getLocationEvaluation(candidateCode),
        listExistingStores(),
        getModelSettings(),
      ]);
      const settings: ModelSettings = modelSettingsDoc ?? { ...defaultModelSettings(), updatedAt: Date.now(), updatedBy: null };
      const existingMarketDemands = existingStores
        .map((s) => s.referenceMarketDemand)
        .filter((v): v is number => v != null);

      const evaluated = evaluateCandidate({ candidate, competitors, locationEvaluation, settings, existingMarketDemands, existingStores });
      await saveEvaluationResult(evaluated, user?.email ?? null);
      setResult(evaluated);
      setSettingsUsed(settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "최종결과를 계산하지 못했습니다.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateCode]);

  useEffect(() => {
    run();
  }, [run]);

  if (loading) return <p className="text-sm text-zinc-500 dark:text-zinc-400">계산 중...</p>;

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>
        <button
          type="button"
          onClick={run}
          className="w-fit rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (!result || !settingsUsed) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">최종평가 결과</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">모델버전 {result.modelVersion} 기준 계산 결과입니다.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={run}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            다시 계산
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            인쇄 / PDF 저장
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        {alreadyExisting ? (
          <span className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            이미 기존 가맹점으로 전환됨 — [기존 가맹점 관리] 화면에서 관리하세요.
          </span>
        ) : (
          <button
            type="button"
            disabled={converting}
            onClick={handleConvert}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
          >
            {converting ? "전환 중..." : "오픈 확정 → 기존 가맹점으로 전환"}
          </button>
        )}
        {convertMessage && <p className="text-xs text-zinc-600 dark:text-zinc-400">{convertMessage}</p>}
      </div>

      <div className="flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${judgementStyle(result.finalJudgement)}`}>
          최종운영판정: {result.finalJudgement ?? "-"}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">입력완성도: {result.completionStatus ?? "-"}</span>
      </div>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitleClass}>매출 예측 — V61/V62 (인구·이용률 기반)</h3>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              result.v61IsFallback
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            }`}
          >
            {result.v61ModelLabel} · 학습표본 {result.v61TrainingSampleCount}곳
          </span>
        </div>
        {result.v61IsFallback && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            학습표본이 최소 기준({settingsUsed.v61Training.minSampleCount}곳)에 못 미쳐 임시 폴백 회귀식을 썼습니다. 실제 후보지 판단에
            그대로 쓰지 말고, 기존 가맹점 학습 데이터가 채워진 뒤 다시 계산해주세요.
          </p>
        )}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ResultCard label="V61 기본예측" value={formatWon(result.v61Baseline)} hint={result.v61ModelLabel} />
          <ResultCard label="V62 보정률" value={formatPercent(result.v62Rate)} />
          <ResultCard label="V62 최종예상월매출" value={formatWon(result.v62Final)} emphasis />
          <ResultCard label="보수판단매출 (85%)" value={formatWon(result.conservativeSales)} />
          <ResultCard label="상한참고매출 (115%)" value={formatWon(result.upperSales)} />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>실측기반 예상월매출 — 경쟁점 실가동좌석 기반 (V61과 별개 경로)</h3>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ResultCard
            label="경쟁점 실가동좌석"
            value={result.competitorOccupiedSeats != null ? formatNumber(result.competitorOccupiedSeats) : "산출불가"}
            hint={
              result.competitorOccupiedSeatsCoverage
                ? `실측 ${result.competitorOccupiedSeatsCoverage.measured} · 미조사추정 ${result.competitorOccupiedSeatsCoverage.assumedLowThreat} · 값누락 ${result.competitorOccupiedSeatsCoverage.missingData}`
                : undefined
            }
          />
          <ResultCard label="예상 수요확보율" value={formatPercent(result.demandCaptureRate)} />
          <ResultCard label="신규수요 증가율" value={formatPercent(result.newDemandGrowthRate)} />
          <ResultCard label="예상 평균가동좌석" value={formatNumber(result.expectedOccupiedSeats)} />
          <ResultCard
            label="예상 가동률"
            value={formatPercent(result.expectedUtilization)}
            hint={result.measuredForecastNeedsReview ? "최대검토가동률 초과 — 데이터 재검토 필요" : undefined}
          />
          <ResultCard label="예상 대당 일매출" value={formatWon(result.expectedDailyRevenuePerPc)} />
          <ResultCard label="실측기반 예상월매출" value={formatWon(result.measuredForecastMonthlyRevenue)} emphasis />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>AA 기준매출 판정</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          예상 오픈월부터 10개월간 &ldquo;순수익 2,000만원 대당 일매출목표&rdquo; 평균과 실측기반 예상월매출을 비교합니다.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ResultCard label="AA 기준매출" value={formatWon(result.aaBaselineRevenue)} />
          <ResultCard
            label="자동평가"
            value={result.aaJudgement ?? "-"}
            hint={result.aaJudgement === "AA" ? "기준 이상" : result.aaJudgement === "AA 미달" ? "기준 미달" : undefined}
          />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>상권 / 경쟁 지표</h3>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ResultCard label="상권수요" value={formatNumber(result.marketDemand)} />
          <ResultCard label="상권등급" value={result.marketGrade ?? "-"} />
          <ResultCard label="상권성격" value={result.marketCharacter ?? "-"} />
          <ResultCard label="경쟁IP" value={formatNumber(result.competitorIp)} />
          <ResultCard label="IP당수요" value={formatScore(result.ipPerDemand)} hint="여유 >15 / 포화 <7 (08_계산기준)" />
          <ResultCard label="경쟁력격차" value={formatScore(result.competitivenessGap)} />
        </div>
      </section>

      <details className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950 print:hidden">
        <summary className="cursor-pointer font-medium text-zinc-700 dark:text-zinc-300">적용된 산식과 계수 보기</summary>
        <div className="mt-4 flex flex-col gap-4 text-xs leading-6 text-zinc-600 dark:text-zinc-400">
          <div>
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">§4.1 V61 기본예측(폴백 회귀식)</p>
            <p>
              자사수요_per_PC = (상권수요 × 경쟁력격차) / (예상PC대수 × 경쟁력격차 + 경쟁IP)
              <br />
              선형값 = {settingsUsed.v61Fallback.intercept.toLocaleString("ko-KR")} + {settingsUsed.v61Fallback.hourlyRateCoef.toLocaleString("ko-KR")} × 시간당요금 +{" "}
              {settingsUsed.v61Fallback.demandPerPcCoef.toLocaleString("ko-KR")} × 자사수요_per_PC + {settingsUsed.v61Fallback.competitivenessCoef.toLocaleString("ko-KR")} × 자사_경쟁력점수
              <br />
              V61(폴백) = 예상PC대수 × MAX(0, 선형값)
            </p>
            <p className="mt-1 text-[11px] text-zinc-400">
              07_신규후보지!BW(예측_월매출)에 Apps Script 계산값이 있으면 그 값을 우선 사용해야 하지만, 웹 구현에서는 항상 이 폴백식만
              사용합니다(v61IsFallback = true). docs/data-issues.md #1 참고.
            </p>
          </div>

          <div>
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">§4 V62 보정 계수 (12_운영판정 O/P열)</p>
            <p>
              외부유입제한 없음 {formatPercent(settingsUsed.inflowAdjustment.없음)} / 보통 {formatPercent(settingsUsed.inflowAdjustment.보통)} / 강함{" "}
              {formatPercent(settingsUsed.inflowAdjustment.강함)}
              <br />
              V62 최종예상월매출 = ROUND(V61 × (1 + 보정률), 0)
              <br />
              보수판단매출 = V62 × {settingsUsed.lowerBoundFactor} / 상한참고매출 = V62 × {settingsUsed.upperBoundFactor}
            </p>
          </div>

          <div>
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">§6 13_신규후보지판정 T/U열 로직 (원본 문자열 그대로)</p>
            <p>
              입력완성도: V61 없음→&ldquo;07 분석 필요&rdquo; / 입지동선점수 없음→&ldquo;09 입지평가 필요&rdquo; / 외부유입제한 없음→&ldquo;외부유입 확인
              필요&rdquo; / 브랜드구분≠{settingsUsed.brandFilter}→&ldquo;브랜드 확인 필요&rdquo; / 그 외→&ldquo;완료&rdquo;
              <br />
              최종운영판정: 입력완성도≠완료→입력완성도값 그대로 / V62 없음→&ldquo;V62 계산 확인 필요&rdquo; / IP당수요&lt;{settingsUsed.saturationThreshold}
              →&ldquo;포화 주의&rdquo; / 외부유입제한=강함→&ldquo;입지 재검토&rdquo; / 그 외→&ldquo;평가 완료&rdquo;
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
