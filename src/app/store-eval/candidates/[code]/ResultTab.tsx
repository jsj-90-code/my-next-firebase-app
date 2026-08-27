"use client";

// 탭4 최종결과 - "5. 최종평가 결과" 화면 요구사항.
// competitors + locationEvaluation + modelSettings(폴백 포함) + existingStores(referenceMarketDemand)를
// 모아 evaluateCandidate 한 번 호출 -> saveEvaluationResult로 스냅샷 저장 -> 화면 표시.

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { useAuth } from "@/contexts/AuthContext";
import { formatNumber, formatPercent, formatScore, formatWon } from "@/lib/storeEval/format";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import {
  convertCandidateToExistingStore,
  findExistingStoreByOriginCandidate,
  getCandidate,
  getLocationEvaluation,
  getModelSettings,
  listCompetitors,
  listExistingStores,
  saveEvaluationResult,
} from "@/lib/storeEval/store";
import { evaluateCandidate } from "@/lib/storeEval/evaluate";
import type { CandidateInput, Competitor, EvaluationResult, FinalJudgement, ModelSettings, V61TrainedModelExplain } from "@/lib/storeEval/types";
import type { DaouReportDraft } from "@/lib/storeEval/daouReportAi";
import { sectionClass, sectionTitleClass } from "./formFields";
import { ReportCard } from "./ReportCard";

function judgementStyle(j: FinalJudgement | null): string {
  if (j === "평가 완료") return "app-badge-ok";
  if (j === "포화 주의" || j === "입지 재검토") return "app-badge-warn";
  if (j === "V62 계산 확인 필요") return "app-badge-danger";
  return "app-badge-neutral"; // 값 없음 또는 "~확인 필요"/"~분석 필요"류
}

// 2026-08-25 추가 — "최종운영판정" 한 배지가 "아직 입력/계산이 덜 끝났다"는 신호(원본 13_
// 신규후보지판정 T/U열 조건식이 그대로 이 문자열을 만든다, model-spec.md §"완료 상태" 참고)와
// "출점을 어떻게 판단해야 하는가"라는 신호를 둘 다 담고 있어서 헷갈릴 수 있다는 지적이 있었다.
// 값 자체(원본 시트 문자열)는 절대 안 바꾸고 — 원본과 다른 문자열을 쓰면 안 된다는 기존 원칙
// (docs/model-spec.md §6) — 어느 종류의 신호인지 배지 앞에 작게만 구분해서 보여준다.
const CALC_STATE_JUDGEMENTS: FinalJudgement[] = ["07 분석 필요", "09 입지평가 필요", "외부유입 확인 필요", "브랜드 확인 필요", "V62 계산 확인 필요"];
function judgementKind(j: FinalJudgement | null): "계산 상태" | "사업 판정" | null {
  if (j == null) return null;
  return CALC_STATE_JUDGEMENTS.includes(j) ? "계산 상태" : "사업 판정";
}

function ResultCard({ label, value, emphasis, hint }: { label: string; value: string; emphasis?: boolean; hint?: string }) {
  return (
    <div className={`rounded-xl p-4 ${emphasis ? "bg-[#171310] text-white dark:bg-[#f2ede2] dark:text-[#171310]" : "app-card"}`}>
      <p className={`text-xs ${emphasis ? "text-white/60 dark:text-[#171310]/60" : "text-[#8a8072]"}`}>{label}</p>
      <p className={`mt-1 font-semibold ${emphasis ? "text-2xl" : "text-lg"}`}>{value}</p>
      {hint && <p className={`mt-1 text-[11px] ${emphasis ? "text-white/60 dark:text-[#171310]/60" : "text-[#8a8072]"}`}>{hint}</p>}
    </div>
  );
}

// 2026-08-25 추가 — "적용된 산식과 계수 보기"가 학습표본 부족 때만 쓰는 폴백 회귀식만 설명하고
// 있었는데, 2026-08-20부터 학습표본이 충분하면(현재 대부분) 이 학습모형을 우선 쓰도록 바뀐 뒤에도
// 그대로 방치돼 있었다 - "지금 실제로 쓴 산식"과 화면 설명이 어긋나 있었다는 뜻. 사용자가 "예상
// 매출이 어떻게 나온건지 이해가 안 된다"고 확인해서, 실제 계산에 쓰인 숫자를 그대로 따라가며
// 보여주는 단계별 표로 바꾼다(evaluate.ts가 predictEmpiricalRevenue의 중간값을 그대로 넘겨준 것 -
// 새 계산 없음).
// 순서가 evaluate.ts의 featureLabels(["시간당요금", "자사수요/PC대수", "경쟁력점수"])와 반드시
// 일치해야 한다 - 표시 단위(원/명/점)를 요인별로 다르게 포맷하기 위한 것뿐, 값 자체는 그대로다.
const FEATURE_REAL_VALUE_FORMATTERS = [
  (v: number) => formatWon(v),
  (v: number) => `${formatScore(v, 1)}명`,
  (v: number) => `${formatScore(v, 2)}점`,
];

function V61TrainedModelExplainSection({ explain, v61Baseline }: { explain: V61TrainedModelExplain; v61Baseline: number | null }) {
  const rows = explain.featureLabels.map((label, i) => ({
    label,
    realValue: explain.featureRealValues[i],
    formattedRealValue: (FEATURE_REAL_VALUE_FORMATTERS[i] ?? ((v: number) => formatScore(v, 2)))(explain.featureRealValues[i]),
    modelValue: explain.featureModelValues[i],
    isLogTransformed: explain.featureRealValues[i] !== explain.featureModelValues[i],
    mean: explain.featureMeans[i],
    sd: explain.featureSds[i],
    z: explain.featureZValues[i],
    coef: explain.coefficients[i],
    contribution: explain.featureZValues[i] * explain.coefficients[i],
  }));
  const contributionSum = rows.reduce((s, r) => s + r.contribution, 0);
  const ridgePerPc = Math.exp(explain.logPerPc);

  return (
    <div>
      <p className="font-semibold text-[#171310] dark:text-[#f2ede2]">§4.1 V61 기본예측(학습모형)</p>
      <p className="mt-1">
        기존 가맹점 {explain.sampleCount}곳의 실제 매출 데이터로 학습한 통계모형(비음수 릿지회귀)입니다. 이 후보지의 조건 3가지를 넣으면
        아래 표처럼 계산됩니다.
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-[#171310]/[0.08] text-left text-[#8a8072] dark:border-white/[0.08]">
              <th className="py-1 pr-2">요인</th>
              <th className="py-1 pr-2">이 후보지 값</th>
              <th className="py-1 pr-2">학습평균</th>
              <th className="py-1 pr-2">학습표준편차</th>
              <th className="py-1 pr-2">표준화값(z)</th>
              <th className="py-1 pr-2">학습된 가중치</th>
              <th className="py-1">기여도(z×가중치)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-[#171310]/[0.06] dark:border-white/[0.06]">
                <td className="py-1 pr-2 font-medium text-[#5c5346] dark:text-[#c9bfae]">
                  {r.label}
                  {r.isLogTransformed && <span className="ml-1 text-[#8a8072]">(로그값 기준)</span>}
                </td>
                <td className="py-1 pr-2">
                  {r.formattedRealValue}
                  {r.isLogTransformed && <span className="ml-1 text-[#8a8072]">→ log {formatScore(r.modelValue, 3)}</span>}
                </td>
                <td className="py-1 pr-2">{formatScore(r.mean, 3)}</td>
                <td className="py-1 pr-2">{formatScore(r.sd, 3)}</td>
                <td className="py-1 pr-2">{formatScore(r.z, 3)}</td>
                <td className="py-1 pr-2">{formatScore(r.coef, 3)}</td>
                <td className="py-1">{formatScore(r.contribution, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2">
        기여도 합계 {formatScore(contributionSum, 3)} + 학습평균(로그 대당월매출) {formatScore(explain.yMean, 3)} = 로그 대당월매출{" "}
        {formatScore(explain.logPerPc, 3)}
        <br />
        exp({formatScore(explain.logPerPc, 3)}) = 회귀예측 대당월매출 {formatWon(ridgePerPc)} × 예상PC대수 {formatNumber(explain.pcCount)}대 ={" "}
        <b>회귀예측매출 {formatWon(explain.ridgeRevenue)}</b>
        <br />
        기준모형(학습표본 대당월매출 중앙값) {formatWon(explain.perPcMedian)} × 예상PC대수 {formatNumber(explain.pcCount)}대 ={" "}
        <b>기준모형매출 {formatWon(explain.baselineRevenue)}</b>
        <br />
        V61 기본예측 = 회귀예측매출×{formatPercent(explain.ridgeWeight, 0)} + 기준모형매출×{formatPercent(explain.baselineWeight, 0)} ={" "}
        <b>{formatWon(v61Baseline)}</b>
      </p>
      <p className="mt-1 text-[11px] text-[#8a8072]">
        학습된 가중치(계수)는 항상 0 이상입니다(비음수 릿지회귀) — 세 조건 중 어느 것도 매출을 깎는 방향으로 작용하지 않고, 학습평균보다
        낫다는 요인만 매출을 끌어올립니다. 학습표본이 바뀌면(가맹점 추가·갱신) 평균·표준편차·가중치도 같이 바뀝니다.
      </p>
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
  // 2026-08-25 수정 — 실제 가맹점코드는 후보지코드(N001 등)와 다른 정식 코드다(계약 확정 후
  // 부여). 예전엔 기본값을 후보지코드로 채워둬서, 사용자가 그대로 두고 전환하면 정식 코드가
  // 아닌 후보지코드가 그대로 가맹점코드로 저장되는 사고가 날 수 있었다 — 빈칸으로 시작해서
  // 사용자가 반드시 직접 입력하게 한다.
  const [newStoreCode, setNewStoreCode] = useState("");
  const [existingStoreCodes, setExistingStoreCodes] = useState<Set<string>>(new Set());

  // 다우오피스 평가기록 보고서 초안 - candidate/competitors는 원래 run() 안에서 계산만 하고
  // 버렸는데, 보고서 컨텍스트를 만들려면 화면에 떠 있는 것과 같은 값이 필요해 여기 같이 담아둔다.
  const [candidateForReport, setCandidateForReport] = useState<CandidateInput | null>(null);
  const [competitorsForReport, setCompetitorsForReport] = useState<Competitor[]>([]);
  const [reportDraft, setReportDraft] = useState<DaouReportDraft | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 분석 카드 이미지(1차 초안, 2026-08-27) - 위에서 이미 계산·표시 중인 값만 그대로 옮겨 담는다.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardExporting, setCardExporting] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  async function handleExportCardImage() {
    const node = cardRef.current;
    if (!node) return;
    setCardExporting(true);
    setCardError(null);
    try {
      const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: undefined });
      const link = document.createElement("a");
      link.download = `${candidateCode}_분석카드.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "이미지 저장 중 오류가 발생했습니다.");
    } finally {
      setCardExporting(false);
    }
  }

  useEffect(() => {
    // 전환 후에는 storeCode가 candidateCode와 달라질 수 있으므로, 문서ID 직접 조회가 아니라
    // originCandidateCode 역조회로 "이미 전환됐는지"를 판정한다(2026-08-22부터).
    findExistingStoreByOriginCandidate(candidateCode).then((s) => setAlreadyExisting(s != null));
  }, [candidateCode]);

  async function handleConvert() {
    const storeCode = newStoreCode.trim();
    if (!storeCode) {
      setConvertMessage("가맹점코드를 입력해주세요.");
      return;
    }
    if (/^N\d+$/i.test(storeCode)) {
      setConvertMessage("후보지코드(N으로 시작) 형식입니다 — 계약 확정 후 부여되는 정식 가맹점코드를 입력해주세요.");
      return;
    }
    if (existingStoreCodes.has(storeCode)) {
      setConvertMessage(`이미 존재하는 가맹점코드입니다(${storeCode}) — 다른 코드를 입력하거나 오타를 확인해주세요.`);
      return;
    }
    if (!window.confirm(`가맹점코드 "${storeCode}"로 기존 가맹점 전환을 진행할까요? 전환 후에는 되돌릴 수 없습니다.`)) {
      return;
    }
    setConverting(true);
    setConvertMessage(null);
    try {
      const [candidate, competitors, locationEvaluation] = await Promise.all([
        getCandidate(candidateCode),
        listCompetitors(candidateCode),
        getLocationEvaluation(candidateCode),
      ]);
      if (!candidate) throw new Error("후보지 기본정보를 찾을 수 없습니다.");
      // 지금 화면에 떠 있는 예측값(result)을 그대로 넘겨 스냅샷으로 동결한다 - 이후 모델이
      // 바뀌어도 "그때 이 숫자를 보고 전환했다"는 기록은 다시 계산되지 않는다.
      await convertCandidateToExistingStore({
        candidate,
        competitors,
        locationEvaluation,
        evaluationResult: result,
        storeCode,
        actor: user?.email ?? null,
      });
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
      setExistingStoreCodes(new Set(existingStores.map((s) => s.storeCode)));

      const evaluated = evaluateCandidate({ candidate, competitors, locationEvaluation, settings, existingStores });
      await saveEvaluationResult(evaluated, user?.email ?? null);
      setResult(evaluated);
      setSettingsUsed(settings);
      setCandidateForReport(candidate);
      setCompetitorsForReport(competitors);
      setReportDraft(null);
      setReportError(null);
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

  // 다우오피스에 기입할 보고서 텍스트 초안 - AI(Gemini)가 자연스럽게 문장을 쓰게 한다(요청사항,
  // 2026-08-25). 다우오피스 자체에 자동 기입하지 않는다 — 사람이 검토 후 복사해서 직접 붙여넣는다.
  async function handleGenerateReport() {
    if (!result || !candidateForReport) return;
    setReportLoading(true);
    setReportError(null);
    try {
      const token = await user?.getIdToken();
      const response = await fetch("/api/store-eval/generate-daou-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          candidate: {
            name: candidateForReport.name,
            address: candidateForReport.address,
            pop500m: candidateForReport.pop500m,
            floating500Avg: candidateForReport.floating500Avg,
            facility500SubwayRiders: candidateForReport.facility500SubwayRiders,
          },
          competitors: competitorsForReport.map((c) => ({
            name: c.name,
            distanceM: c.distanceM,
            investigationStatus: c.investigationStatus,
          })),
          result,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "보고서 초안 생성에 실패했습니다.");
      setReportDraft(data);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "보고서 초안 생성 중 오류가 발생했습니다.");
    } finally {
      setReportLoading(false);
    }
  }

  function handleCopy(key: string, text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
      })
      .catch(() => setReportError("클립보드 복사에 실패했습니다. 직접 선택해서 복사해주세요."));
  }

  if (loading) return <p className="text-sm text-[#8a8072]">계산 중...</p>;

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <p className="app-badge app-badge-danger w-full justify-start px-3 py-2 text-sm">{error}</p>
        <button
          type="button"
          onClick={run}
          className="app-btn-outline w-fit rounded-lg px-4 py-2 text-sm"
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
          <h2 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">최종평가 결과</h2>
          <p className="mt-1 text-sm text-[#8a8072]">모델버전 {result.modelVersion} 기준 계산 결과입니다.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={run}
            className="app-btn-outline rounded-lg px-4 py-2 text-sm"
          >
            다시 계산
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="app-btn-primary rounded-lg px-4 py-2 text-sm"
          >
            인쇄 / PDF 저장
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        {alreadyExisting ? (
          <span className="app-card-sm rounded-lg px-3 py-2 text-xs text-[#5c5346] dark:text-[#c9bfae]">
            이미 기존 가맹점으로 전환됨 — [기존 가맹점 관리] 화면에서 관리하세요.
          </span>
        ) : (
          <>
            <label className="flex items-center gap-2 text-xs text-[#5c5346] dark:text-[#c9bfae]">
              실제 가맹점코드
              <input
                type="text"
                value={newStoreCode}
                onChange={(e) => setNewStoreCode(e.target.value)}
                placeholder="예: 20260703437"
                className="app-input w-40 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={converting}
              onClick={handleConvert}
              className="rounded-lg border border-[var(--sl-ok)]/30 bg-[var(--sl-ok-soft)] px-4 py-2 text-sm font-medium text-[var(--sl-ok)] hover:brightness-95 disabled:opacity-50"
            >
              {converting ? "전환 중..." : "오픈 확정 → 기존 가맹점으로 전환"}
            </button>
          </>
        )}
        {convertMessage && <p className="text-xs text-[#5c5346] dark:text-[#c9bfae]">{convertMessage}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className={`app-badge text-sm ${judgementStyle(result.finalJudgement)}`}>
          {judgementKind(result.finalJudgement) && (
            <span className="mr-1.5 text-[10px] font-normal opacity-70">[{judgementKind(result.finalJudgement)}]</span>
          )}
          최종운영판정: {result.finalJudgement ?? "-"}
        </span>
        <span className="text-xs text-[#8a8072]">입력완성도: {result.completionStatus ?? "-"}</span>
      </div>
      <p className="text-xs text-[#8a8072]">
        [계산 상태]는 아직 입력·계산이 덜 끝났다는 뜻이고, [사업 판정]이 떠야 실제 출점 판단에 참고할 수 있는 결과입니다.
      </p>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitleClass}>매출 예측 (V62)</h3>
          <span
            className={`app-badge text-xs ${result.v61IsFallback ? "app-badge-warn" : "app-badge-ok"}`}
          >
            {result.v61ModelLabel} · 학습표본 {result.v61TrainingSampleCount}곳
          </span>
        </div>
        {result.v61IsFallback && (
          <p className="app-badge app-badge-warn mt-2 w-full justify-start px-3 py-2 text-xs leading-5">
            학습표본이 최소 기준({settingsUsed.v61Training.minSampleCount}곳)에 못 미쳐 임시 폴백 회귀식을 썼습니다. 실제 후보지 판단에
            그대로 쓰지 말고, 기존 가맹점 학습 데이터가 채워진 뒤 다시 계산해주세요.
          </p>
        )}
        {/* 2026-08-25 — V61 기본예측/V62 보정률/보수판단/상한참고를 V62 최종예상월매출과 나란히
            큰 카드로 늘어놓으면 실제로 쓰는 값(V62 최종예상월매출)이 어느 건지 헷갈린다는 지적
            (사용자 확인: "저 데이터를 쓰질 않으니까... 값 여러개 보여주면 오히려 혼동옴"). 완전히
            숨기면 나중에 V62 값이 이상해 보일 때 V61과 비교해서 원인을 못 찾게 되므로, 지우지
            않고 접이식으로만 옮긴다. */}
        <div className="mt-4">
          <ResultCard label="V62 최종예상월매출" value={formatWon(result.v62Final)} emphasis />
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-[#8a8072] hover:text-[#171310] dark:hover:text-[#f2ede2]">
            세부 계산값 보기 (V61 기본예측 · V62 보정률 · 보수/상한 참고범위)
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ResultCard label="V61 기본예측" value={formatWon(result.v61Baseline)} hint={result.v61ModelLabel} />
            <ResultCard label="V62 보정률" value={formatPercent(result.v62Rate)} />
            <ResultCard label="보수판단매출 (85%)" value={formatWon(result.conservativeSales)} />
            <ResultCard label="상한참고매출 (115%)" value={formatWon(result.upperSales)} />
          </div>
        </details>
      </section>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitleClass}>실측기반 예상월매출 — 경쟁점 실가동좌석 기반 (V61/V62와 별개 경로, 참고용)</h3>
          <span className="app-badge app-badge-warn text-xs">미검증 참고 지표</span>
        </div>
        {/* 이 경로(13_신규후보지판정 AA열)는 원본 시트에도 존재 목적을 설명하는 근거가 없고,
            V61/V62처럼 기존 가맹점 리브-원-아웃 검증을 거친 적이 없다(docs/data-issues.md
            2026-08-21 참고). 그래서 V62와 달리 emphasis 카드로 강조하지 않고, 항상 미검증
            경고를 띄운다 — 가동률 초과일 때만 경고하면 "평소엔 믿을만하다"는 오해를 주기 때문.
            2026-08-27: measuredForecastNeedsReview("데이터 재검토 필요" 배지/문구)는 ReportCard에서
            이미 뺐다 — 경쟁점 많은 상권은 주요 경쟁점만 실사하는 게 정상 업무 프로세스라 예상
            가동률이 검토기준을 넘는 게 흔한 정상 상태이지, "재검토가 필요한 문제"가 아니기
            때문이다(사용자 확인, ReportCard.tsx 커밋 12c8896/이후 배지 제거 참고). 여기 ResultTab도
            같은 이유로 경고성 문구 대신 담백한 방법론 설명으로 통일한다. */}
        <p className="app-badge app-badge-warn mt-2 w-full justify-start px-3 py-2 text-xs leading-5">
          이 값은 V61/V62처럼 기존 가맹점 실제매출로 검증된 적이 없는 별도 계산입니다(경쟁점 실가동좌석을 우리 매장 좌석점유로
          환산하는 방식). 출점 판단은 위 &ldquo;V62 최종예상월매출&rdquo;을 기준으로 하고, 이 값은 참고로만 봐주세요.
          {result.measuredForecastNeedsReview &&
            " 예상 가동률이 계획한 PC대수를 넘는데, 경쟁점이 많은 상권은 주요 경쟁점 위주로만 실사하는 게 정상 업무 프로세스라(전수조사 아님) 흔히 나오는 결과입니다 — 데이터가 잘못됐다는 뜻은 아닙니다."}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ResultCard
            label="경쟁점 실가동좌석"
            value={result.competitorOccupiedSeats != null ? formatNumber(result.competitorOccupiedSeats) : "산출불가"}
            hint={
              result.competitorOccupiedSeatsCoverage
                ? `핑봇실측 ${result.competitorOccupiedSeatsCoverage.measured} · 현장방문만(참고,미반영) ${result.competitorOccupiedSeatsCoverage.realtimeSnapshotOnly} · 미조사추정 ${result.competitorOccupiedSeatsCoverage.assumedLowThreat} · 오픈예정(측정불가) ${result.competitorOccupiedSeatsCoverage.notYetOpen} · 값누락 ${result.competitorOccupiedSeatsCoverage.missingData}`
                : undefined
            }
          />
          <ResultCard label="예상 수요확보율" value={formatPercent(result.demandCaptureRate)} />
          <ResultCard label="신규수요 증가율" value={formatPercent(result.newDemandGrowthRate)} />
          <ResultCard label="예상 평균가동좌석" value={formatNumber(result.expectedOccupiedSeats)} />
          <ResultCard
            label="예상 가동률"
            value={formatPercent(result.expectedUtilization)}
            hint={result.measuredForecastNeedsReview ? "주요 경쟁점 위주 실측 기준 추정치로, 실제보다 높게 나올 수 있음" : undefined}
          />
          <ResultCard label="예상 대당 일매출" value={formatWon(result.expectedDailyRevenuePerPc)} />
          <ResultCard label="실측기반 예상월매출 (참고용, 미검증)" value={formatWon(result.measuredForecastMonthlyRevenue)} />
        </div>
      </section>

      <section className={sectionClass}>
        <h3 className={sectionTitleClass}>선투자 프로모션 기준매출 판정 (참고용)</h3>
        <p className="mt-1 text-xs text-[#8a8072]">
          예상 오픈월부터 10개월간 &ldquo;순수익 2,000/1,500/1,000만원 대당 일매출목표&rdquo; 평균과 위 V62 최종예상월매출을
          비교하는 3단계 등급 판정입니다(1,500만원은 2,000/1,000만원 실측표의 월별 평균). PC대수는 100대 상한이
          적용됩니다(100대 초과여도 100대 기준으로 계산). 선투자 프로모션 대상 판단용이라 최종운영판정과는 별개이고,
          출점 여부 결정에는 쓰지 않습니다.
          {/* 2026-08-27 (2차): 원래 여기 비교 대상은 미검증 AA경로(핑봇 실측)였는데, 평균오차 52%로
              확인돼 V62(정식 계산) 기준으로 바꿨다 — calc.ts judgeAaGrade 주석 참고. */}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ResultCard label="2,000만원 기준매출" value={formatWon(result.aaBaselineRevenue)} />
          <ResultCard label="1,500만원 기준매출" value={formatWon(result.aaBaselineRevenue1500)} />
          <ResultCard label="1,000만원 기준매출" value={formatWon(result.aaBaselineRevenue1000)} />
          <ResultCard
            label="자동평가"
            value={result.aaJudgement ?? "-"}
            hint={
              result.aaJudgement === "1,000만원 미달"
                ? "1,000만원 기준 미달"
                : result.aaJudgement?.endsWith("이상")
                  ? "해당 기준 이상 달성"
                  : undefined
            }
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

      <section className={`${sectionClass} print:hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className={sectionTitleClass}>다우오피스 평가기록 초안</h3>
            <p className="mt-1 text-xs text-[#8a8072]">
              위 계산 결과만 근거로 AI(Gemini)가 [상권]/[경쟁]/[종합 의견] 문장을 씁니다. 다우오피스에 자동으로 기입하지 않으니,
              내용을 검토·수정한 뒤 직접 복사해서 붙여넣어주세요. 손익계산(투자비·회수기간 등)은 포함하지 않습니다.
            </p>
          </div>
          <button
            type="button"
            disabled={reportLoading}
            onClick={handleGenerateReport}
            className="app-btn-outline rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {reportLoading ? "생성 중..." : reportDraft ? "다시 생성" : "AI 초안 생성"}
          </button>
        </div>

        {reportError && (
          <p className="app-badge app-badge-danger mt-3 w-full justify-start px-3 py-2 text-xs">{reportError}</p>
        )}

        {reportDraft && (
          <div className="mt-4 flex flex-col gap-3">
            {(
              [
                { key: "market", label: "상권", text: reportDraft.marketSection },
                { key: "competition", label: "경쟁", text: reportDraft.competitionSection },
                { key: "summary", label: "종합 의견", text: reportDraft.summarySection },
              ] as const
            ).map((section) => (
              <div key={section.key} className="app-card-sm rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[#8a8072]">[{section.label}]</p>
                  <button
                    type="button"
                    onClick={() => handleCopy(section.key, section.text)}
                    className="app-btn-outline rounded-md px-2 py-0.5 text-[11px]"
                  >
                    {copiedKey === section.key ? "복사됨" : "복사"}
                  </button>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[#171310] dark:text-[#f2ede2]">{section.text}</p>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                handleCopy(
                  "all",
                  `[상권] ${reportDraft.marketSection}\n[경쟁] ${reportDraft.competitionSection}\n[종합 의견] ${reportDraft.summarySection}`,
                )
              }
              className="app-btn-primary w-fit rounded-lg px-4 py-2 text-sm"
            >
              {copiedKey === "all" ? "전체 복사됨" : "전체 복사"}
            </button>
          </div>
        )}
      </section>

      <section className={`${sectionClass} print:hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className={sectionTitleClass}>분석 카드 이미지 (1차 초안)</h3>
            <p className="mt-1 text-xs text-[#8a8072]">
              위에 이미 계산된 값(V62 최종예상월매출·상권/경쟁 지표·인근 경쟁점)만으로 만든 요약 카드입니다. 손익(원가·회수기간)은
              아직 우리 시스템에 없는 데이터라 포함하지 않았습니다.
            </p>
          </div>
          <button
            type="button"
            disabled={cardExporting}
            onClick={handleExportCardImage}
            className="app-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {cardExporting ? "저장 중..." : "PNG로 저장"}
          </button>
        </div>
        {cardError && <p className="app-badge app-badge-danger mt-3 w-full justify-start px-3 py-2 text-xs">{cardError}</p>}
        <div className="mt-4 overflow-x-auto">
          <div ref={cardRef} className="inline-block">
            <ReportCard
              result={result}
              candidate={{
                name: candidateForReport?.name ?? result.candidateName,
                address: candidateForReport?.address ?? result.address,
                expectedPcCount: candidateForReport?.expectedPcCount ?? result.expectedPcCount,
                hourlyRate: candidateForReport?.hourlyRate ?? result.hourlyRate,
              }}
              competitors={competitorsForReport}
              summarySection={reportDraft?.summarySection}
            />
          </div>
        </div>
      </section>

      <details className="app-card rounded-2xl p-4 text-sm print:hidden">
        <summary className="cursor-pointer font-medium text-[#5c5346] dark:text-[#c9bfae]">적용된 산식과 계수 보기</summary>
        <div className="mt-4 flex flex-col gap-4 text-xs leading-6 text-[#5c5346] dark:text-[#c9bfae]">
          {result.v61IsFallback ? (
            <div>
              <p className="font-semibold text-[#171310] dark:text-[#f2ede2]">§4.1 V61 기본예측(폴백 회귀식)</p>
              <p>
                자사수요_per_PC = (상권수요 × 경쟁력격차) / (예상PC대수 × 경쟁력격차 + 경쟁IP)
                <br />
                선형값 = {settingsUsed.v61Fallback.intercept.toLocaleString("ko-KR")} + {settingsUsed.v61Fallback.hourlyRateCoef.toLocaleString("ko-KR")} × 시간당요금 +{" "}
                {settingsUsed.v61Fallback.demandPerPcCoef.toLocaleString("ko-KR")} × 자사수요_per_PC + {settingsUsed.v61Fallback.competitivenessCoef.toLocaleString("ko-KR")} × 자사_경쟁력점수
                <br />
                V61(폴백) = 예상PC대수 × MAX(0, 선형값)
              </p>
              <p className="mt-1 text-[11px] text-[#8a8072]">
                기존 가맹점 학습표본이 최소 기준({settingsUsed.v61Training.minSampleCount}곳)에 못 미쳐, 아래 학습모형 대신 사람이 미리
                정해둔 이 임시 근사식을 씁니다. docs/data-issues.md #1 참고.
              </p>
            </div>
          ) : result.v61TrainedModelExplain ? (
            <V61TrainedModelExplainSection explain={result.v61TrainedModelExplain} v61Baseline={result.v61Baseline} />
          ) : null}

          <div>
            <p className="font-semibold text-[#171310] dark:text-[#f2ede2]">§4 V62 보정 계수 (12_운영판정 O/P열)</p>
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
            <p className="font-semibold text-[#171310] dark:text-[#f2ede2]">§6 13_신규후보지판정 T/U열 로직 (원본 문자열 그대로)</p>
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
