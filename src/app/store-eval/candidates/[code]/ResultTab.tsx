"use client";

// 탭4 최종결과 - "5. 최종평가 결과" 화면 요구사항.
// competitors + locationEvaluation + modelSettings(폴백 포함) + existingStores(referenceMarketDemand)를
// 모아 evaluateCandidate 한 번 호출 -> saveEvaluationResult로 스냅샷 저장 -> 화면 표시.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate, formatManwonRough, formatNumber, formatPercent, formatScore, formatWon } from "@/lib/storeEval/format";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import {
  convertCandidateToExistingStore,
  findExistingStoreByOriginCandidate,
  getCandidate,
  getLocationEvaluation,
  getModelSettings,
  listCompetitors,
  listExistingStores,
  listEvaluationSales,
  listAllLocationEvaluations,
  listAllCompetitors,
  saveEvaluationResult,
  saveCandidate,
  getModelAccuracySummary,
} from "@/lib/storeEval/store";
import { evaluateCandidate } from "@/lib/storeEval/evaluate";
import type { CandidateInput, Competitor, EvaluationResult, ExistingStore, FinalJudgement, LocationEvaluation, ModelAccuracySummary, ModelSettings, V61TrainedModelExplain } from "@/lib/storeEval/types";
import type { DaouReportDraft } from "@/lib/storeEval/daouReportAi";
import { readJsonOrText } from "@/lib/readJsonOrText";
import { storeEvaluationGrade } from "@/lib/storeEval/reportContext";
import { computePeerPosition } from "@/lib/storeEval/peerPosition";
import { summarizeDrivers } from "@/lib/storeEval/revenueDrivers";
import { collectReviewSignals, compareOwnVsRivalUtilization, RIVAL_UTILIZATION_WARN_RATIO, type ReviewSignal } from "@/lib/storeEval/reviewSignals";
import { sectionClass, sectionTitleClass, NumberField, TextAreaField } from "./formFields";
import { ReportCard } from "./ReportCard";
import { PriceScenarioPanel } from "@/components/storeEval/PriceScenarioPanel";

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

/**
 * 이 모형이 실제로 얼마나 맞는지를 예상매출 바로 밑에 보여준다.
 *
 * 값은 검증화면이 남겨둔 요약 문서(storeEvalSystemStatus/accuracy) 하나에서 온다 — 여기서
 * 검증을 다시 돌리면 Firestore 읽기가 800건쯤 더 들기 때문이다. 그래서 "언제 기준"인지도 함께
 * 보여준다(검증화면을 연 시점에 갱신된다).
 */
function ModelAccuracyNote({ accuracy, v62Final }: { accuracy: ModelAccuracySummary | null; v62Final: number | null }) {
  if (!accuracy || accuracy.sampleCount === 0) {
    return (
      <p className="mt-2 text-xs leading-5 text-[var(--sl-ink-soft)]">
        이 모형의 실측 정확도는 아직 기록되지 않았습니다 — 검증 화면을 한 번 열면 여기에 표시됩니다.
      </p>
    );
  }
  const mae = accuracy.meanAbsoluteErrorPct;
  const band = v62Final != null && mae != null
    ? `${formatWon(Math.round(v62Final * (1 - mae)))} ~ ${formatWon(Math.round(v62Final * (1 + mae)))}`
    : null;
  const when = formatDate(accuracy.updatedAt);
  return (
    <div className="app-card-sm mt-2 rounded-xl px-3 py-2 text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">
      <b className="text-[#171310] dark:text-[#f2ede2]">이 모형의 실측 정확도</b> — 기존 가맹점{" "}
      {accuracy.sampleCount}곳을 하나씩 빼고 예측해본 결과입니다({when} 기준).
      <br />
      평균 오차 {formatPercent(mae)} · 중앙값 {formatPercent(accuracy.medianAbsoluteErrorPct)} ·{" "}
      ±10% 안 {formatPercent(accuracy.within10PctRatio)} · ±20% 안 {formatPercent(accuracy.within20PctRatio)}
      {band && (
        <>
          <br />
          <b className="text-[#171310] dark:text-[#f2ede2]">평균 오차만큼 잡으면 {band}</b> 범위입니다.
          위 숫자 하나로만 보지 마세요.
        </>
      )}
      {accuracy.within15PctRatio != null && (
        <>
          <br />
          <span className="text-[var(--sl-ink-soft)]">
            아래 보수(85%)·상한(115%) 밴드는 고정값인데, 실측으로는 그 ±15% 안에{" "}
            {formatPercent(accuracy.within15PctRatio)}만 들어옵니다.
          </span>
        </>
      )}
    </div>
  );
}

function ResultCard({ label, value, emphasis, hint }: { label: string; value: string; emphasis?: boolean; hint?: string }) {
  return (
    <div className={`rounded-xl p-4 ${emphasis ? "bg-[#171310] text-white dark:bg-[#f2ede2] dark:text-[#171310]" : "app-card"}`}>
      <p className={`text-xs ${emphasis ? "text-white/60 dark:text-[#171310]/60" : "text-[var(--sl-ink-soft)]"}`}>{label}</p>
      <p className={`mt-1 font-semibold ${emphasis ? "text-2xl" : "text-lg"}`}>{value}</p>
      {hint && <p className={`mt-1 text-[11px] ${emphasis ? "text-white/60 dark:text-[#171310]/60" : "text-[var(--sl-ink-soft)]"}`}>{hint}</p>}
    </div>
  );
}

/**
 * 왜 이 매출인가 — 요인별 기여도 (2026-09-13 신설)
 *
 * 그동안 화면은 예상매출을 숫자 하나로만 보여줬다. "왜 5,800만원인가"에 답할 수단이 없어서,
 * 점포팀에 평가 결과를 설명할 때 근거를 댈 수가 없었다.
 *
 * 예측식이 `log(대당 이용시간) = 코호트평균 + Σ(표준화값 × 계수)` 꼴이라 **항 하나하나가 곧
 * "그 요인이 평균 대비 이용시간을 몇 배로 만들었는가"** 다. 이미 예측 과정에서 계산하던 값을
 * 꺼내 쓸 뿐이라 새 계산도, 산식 변경도 아니다(usageRevenue.ts usageDrivers 주석 참고).
 *
 * 표시는 **PC 이용시간 기준**이다. 먹거리는 별도 모형이고 오차가 더 커서(12.6%) 같이 섞지 않는다.
 */
function RevenueDriverBreakdown({ drivers }: { drivers: { labels: string[]; contributions: number[] } | null | undefined }) {
  // 2026-09-13 — 변환 계산은 revenueDrivers.ts로 옮겼다. 화면 안에 있으면 테스트할 수단이 없어
  // 라벨-값이 어긋나는 경로를 막았는지 확인할 방법이 없었다.
  const summary = summarizeDrivers(drivers);
  if (!summary) return null;
  const { rows, maxAbs } = summary;

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-medium text-[var(--sl-ink-soft)] hover:text-[#171310] dark:hover:text-[#f2ede2]">
        왜 이 매출인가 — 요인별 영향 보기
      </summary>
      <div className="mt-3 flex flex-col gap-2">
        <p className="text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">
          기존 가맹점 <b className="text-[#171310] dark:text-[#f2ede2]">평균적인 매장과 견줬을 때</b>, 이 후보지의 조건이 PC
          이용시간을 얼마나 끌어올리고 내렸는지입니다. 먹거리는 별도 계산이라 여기 포함하지 않았습니다.
        </p>
        {rows.map((r) => {
          const positive = r.pct > 0;
          return (
            <div key={r.label}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-[#5c5346] dark:text-[#c9bfae]">{r.label}</span>
                <span className={`font-semibold ${positive ? "text-[var(--sl-ok)]" : "text-[var(--sl-warn)]"}`}>
                  {positive ? "+" : ""}{formatPercent(r.pct)}
                </span>
              </div>
              {/* 가운데를 0으로 두고 좌우로 뻗는 막대 — 올린 요인과 내린 요인이 한눈에 갈린다. */}
              <div className="mt-1 flex h-1.5 items-center">
                <div className="flex h-full w-1/2 justify-end">
                  {!positive && (
                    <div className="h-full rounded-l-full bg-[var(--sl-warn)]" style={{ width: `${(Math.abs(r.pct) / maxAbs) * 100}%` }} />
                  )}
                </div>
                <div className="h-full w-px bg-[#171310]/20 dark:bg-white/20" />
                <div className="flex h-full w-1/2">
                  {positive && (
                    <div className="h-full rounded-r-full bg-[var(--sl-ok)]" style={{ width: `${(r.pct / maxAbs) * 100}%` }} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <p className="text-[11px] leading-4 text-[var(--sl-ink-soft)]">
          각 수치는 그 요인 하나만 놓고 본 영향이고, 실제 예측은 이것들이 함께 곱해져 나옵니다. 더하기로 맞아떨어지지 않는 게 정상입니다.
        </p>
      </div>
    </details>
  );
}

/** 결재 전 확인할 것 (2026-09-13 신설). 신호 수집은 reviewSignals.ts가 하고 여기서는 표시만 한다. */
function ReviewSignalList({ signals }: { signals: ReviewSignal[] }) {
  if (signals.length === 0) {
    return (
      <p className="app-notice app-badge-ok w-full text-xs">
        결재 전 확인할 것 — <b>따로 짚이는 항목이 없습니다.</b> 입력과 계산 전제가 모두 정상입니다.
      </p>
    );
  }
  const badgeFor = (level: ReviewSignal["level"]) =>
    level === "확인" ? "app-badge-danger" : level === "주의" ? "app-badge-warn" : "app-badge-info";
  // 확인 → 주의 → 정보 순으로. 먼저 고쳐야 하는 것이 위로 온다.
  const order: ReviewSignal["level"][] = ["확인", "주의", "정보"];
  const sorted = [...signals].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  const mustFix = sorted.filter((s) => s.level === "확인").length;

  return (
    <section className={sectionClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionTitleClass}>결재 전 확인할 것 ({signals.length}건)</h3>
        {mustFix > 0 && <span className="app-badge app-badge-danger text-xs">먼저 처리할 것 {mustFix}건</span>}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {sorted.map((s, i) => (
          <div key={`${s.title}-${i}`} className="flex gap-2">
            <span className={`app-badge ${badgeFor(s.level)} h-fit shrink-0 text-[11px]`}>{s.level}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#171310] dark:text-[#f2ede2]">{s.title}</p>
              <p className="text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">{s.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * 기존 가맹점 분포에서의 위치 (2026-09-13 신설)
 *
 * 예상매출을 숫자 하나로만 보여주면 "5,800만원"이 좋은 건지 나쁜 건지 알 수가 없다. 기존
 * 가맹점의 **실제** 매출은 이미 이 화면까지 로드돼 있는데(모형 학습용) 화면에서는 버리고 있었다.
 * 새로 읽는 것 없이 분포에서의 자리만 보여준다.
 *
 * 비교군은 **모형이 학습에 쓰는 기준과 같게** 맞춘다 — 블랙라벨·산식학습 제외 아님·실제매출 있음.
 * 기준이 다르면 "38곳 검증"이라고 적힌 정확도 수치와 모수가 어긋나 혼란만 준다.
 */
function PeerPositionNote({ stores, result, expectedPcCount }: { stores: ExistingStore[]; result: EvaluationResult; expectedPcCount: number | null }) {
  const forecast = result.v62Final;
  // 2026-09-13 — 계산은 peerPosition.ts로 옮겼다. 화면 안에 있으면 테스트할 방법이 없어
  // 경계 조건(동률·짝수 중앙값·규모 허용폭)이 맞는지 확인할 수가 없었다.
  const position = computePeerPosition(stores, forecast, expectedPcCount);
  if (position == null || forecast == null) return null;
  const { peerCount, rank, median, sameSizeAvg, sameSizeCount } = position;

  return (
    <div className="app-card-sm mt-2 rounded-xl px-3 py-2 text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">
      <b className="text-[#171310] dark:text-[#f2ede2]">기존 가맹점과 견줘보면</b> — 실제로 영업 중인{" "}
      {peerCount}곳의 매출과 나란히 놓으면 이 예측값은{" "}
      <b className="text-[#171310] dark:text-[#f2ede2]">{peerCount}곳 중 {rank}번째</b> 수준입니다
      (기존점 중앙값 {formatManwonRough(median)}).
      {sameSizeAvg != null && (
        <>
          <br />
          비슷한 규모({expectedPcCount}대 ±15대) {sameSizeCount}곳의 실제 평균은{" "}
          <b className="text-[#171310] dark:text-[#f2ede2]">{formatManwonRough(sameSizeAvg)}</b>입니다
          {forecast > sameSizeAvg ? " — 이 후보지는 그보다 높게 예측됐습니다." : forecast < sameSizeAvg ? " — 이 후보지는 그보다 낮게 예측됐습니다." : "."}
        </>
      )}
      <br />
      <span className="text-[var(--sl-ink-soft)]">
        기존점은 실제 매출, 이 후보지는 예측값이라 성격이 다릅니다. 순위는 대략의 눈대중으로만 보세요.
      </span>
    </div>
  );
}

/**
 * 담당자 판단 매출 (2026-09-13 신설)
 *
 * 사용자 지적: "예측 매출액 조정을 못 하니까 그게 좀 굉장히 찝찝하구만" — 현장 감각으로 "이건
 * 높다/낮다"를 알아도 반영할 데가 없었다.
 *
 * 그렇다고 **V62 예측값 자체를 고치게 만들지는 않았다.** 예측값을 손으로 고치면 그 값으로 재는
 * 적중률(MAPE 9.88%)이 아무 의미가 없어지기 때문이다 — 사람이 맞춘 값을 사람이 채점하는 꼴이다.
 * 대신 산식 결과는 그대로 두고 판단을 **나란히** 적어둔다. 셋 다 이득이다.
 *   1. 산식이 오염되지 않아 적중률 검증이 그대로 유지된다
 *   2. 현장 판단이 버려지지 않고 근거와 함께 남는다
 *   3. 개점 후 실제 매출이 나오면 "산식이 맞았나, 사람이 맞았나"를 데이터로 알 수 있다 —
 *      사람이 계통적으로 더 맞는다면 그 차이가 곧 산식 개선의 단서다(표본 38곳에서 산식 개선이
 *      막혀 있는 상황을 우회하는 길, docs/backlog.md B-1)
 *
 * 전환 시점 값은 store.ts가 predictedAtConversion에 함께 동결한다.
 */
function JudgedRevenuePanel({
  candidateCode,
  initial,
  v62Final,
  actor,
  onSaved,
}: {
  candidateCode: string;
  initial: CandidateInput;
  v62Final: number | null;
  actor: string | null;
  onSaved: (saved: CandidateInput) => void;
}) {
  const [revenue, setRevenue] = useState<number | null>(initial.judgedRevenue ?? null);
  const [reason, setReason] = useState<string>(initial.judgedReason ?? "");
  // 마지막으로 Firestore에 저장된 값 — 입력칸과 비교해 "저장 안 된 변경이 있는지"를 판단한다.
  const [saved, setSaved] = useState<{ revenue: number | null; reason: string; at: number | null; by: string | null }>({
    revenue: initial.judgedRevenue ?? null,
    reason: initial.judgedReason ?? "",
    at: initial.judgedAt ?? null,
    by: initial.judgedBy ?? null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedReason = reason.trim();
  const dirty = revenue !== saved.revenue || trimmedReason !== saved.reason.trim();
  const gapRatio = revenue != null && v62Final != null && v62Final !== 0 ? (revenue - v62Final) / v62Final : null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // 결과 탭이 들고 있는 후보지 값은 "계산을 시작한 시점"의 스냅샷이다. 그 사이 기본정보
      // 탭에서 다른 항목을 고쳤을 수 있으므로, 저장 직전에 최신 문서를 다시 읽어 판단값 네 칸만
      // 갈아끼운다(saveCandidate가 문서 전체를 덮어쓰기 때문에 이렇게 안 하면 남의 수정이 날아간다).
      const latest = await getCandidate(candidateCode);
      if (!latest) throw new Error("후보지를 찾지 못했습니다. 화면을 새로고침해주세요.");
      const hasJudgement = revenue != null || trimmedReason !== "";
      const now = Date.now();
      const next: CandidateInput = {
        ...latest,
        judgedRevenue: revenue,
        judgedReason: trimmedReason === "" ? null : trimmedReason,
        // 둘 다 비우면 "판단을 지웠다"는 뜻이라 적은 사람·시각도 같이 지운다.
        judgedAt: hasJudgement ? now : null,
        judgedBy: hasJudgement ? actor : null,
      };
      await saveCandidate(next, actor);
      setSaved({ revenue: next.judgedRevenue, reason: next.judgedReason ?? "", at: next.judgedAt, by: next.judgedBy });
      onSaved(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "판단 매출을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={sectionClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionTitleClass}>담당자 판단 매출 (선택 입력)</h3>
        <span className="app-badge app-badge-neutral text-xs">산식에 반영되지 않음</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-[#5c5346] dark:text-[#c9bfae]">
        위 V62 예상매출을 보고 <b className="text-[#171310] dark:text-[#f2ede2]">현장 감각으로는 다르게 본다</b>면 여기에
        적어두세요. <b className="text-[#171310] dark:text-[#f2ede2]">위 예상매출은 바뀌지 않습니다</b> — 산식은 그대로 두고
        판단만 나란히 기록합니다. 예측값을 직접 고치면 이 모형이 얼마나 맞는지 잴 수 없게 되기 때문입니다.
        <br />
        나중에 이 매장이 문을 열고 실제 매출이 나오면,{" "}
        <b className="text-[#171310] dark:text-[#f2ede2]">산식과 담당자 중 누가 더 잘 맞혔는지</b> 비교할 수 있습니다.
        비워두셔도 됩니다.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <NumberField
          label="담당자 판단 월매출"
          value={revenue}
          onChange={setRevenue}
          step={100000}
          hint={
            revenue != null
              ? `${formatWon(revenue)} — 원 단위로 입력합니다`
              : "원 단위로 입력합니다 (예: 4,500만원이면 45000000)"
          }
        />
        <TextAreaField
          label="그렇게 본 근거"
          value={reason}
          onChange={setReason}
          rows={3}
          hint="한 줄이면 충분합니다. 나중에 누가 맞았는지 볼 때 이 메모가 가장 중요합니다."
        />
      </div>
      {gapRatio != null && (
        <p className="mt-3 text-sm leading-6">
          V62 예상매출 {formatWon(v62Final)} 대비{" "}
          <b className={gapRatio >= 0 ? "text-[var(--sl-ok)]" : "text-[var(--sl-warn)]"}>
            {gapRatio >= 0 ? "+" : ""}
            {formatPercent(gapRatio)} ({gapRatio >= 0 ? "+" : "-"}
            {formatWon(Math.abs((revenue ?? 0) - (v62Final ?? 0)))})
          </b>{" "}
          {gapRatio >= 0 ? "높게" : "낮게"}보셨습니다.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="app-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? "저장 중..." : "판단 저장"}
        </button>
        {dirty && !saving && <span className="text-xs text-[var(--sl-warn)]">저장하지 않은 변경이 있습니다</span>}
        {!dirty && saved.at != null && (
          <span className="text-xs text-[var(--sl-ink-soft)]">
            {formatDate(saved.at)} 저장됨{saved.by ? ` · ${saved.by}` : ""}
          </span>
        )}
        {!dirty && saved.at == null && saved.revenue == null && (
          <span className="text-xs text-[var(--sl-ink-soft)]">아직 적힌 판단이 없습니다</span>
        )}
      </div>
      {error && <p className="app-notice app-badge-danger mt-3 w-full justify-start px-3 py-2 text-xs">{error}</p>}
    </section>
  );
}

// 2026-08-25 추가 — "적용된 산식과 계수 보기"가 학습표본 부족 때만 쓰는 폴백 회귀식만 설명하고
// 있었는데, 2026-08-20부터 학습표본이 충분하면(현재 대부분) 이 학습모형을 우선 쓰도록 바뀐 뒤에도
// 그대로 방치돼 있었다 - "지금 실제로 쓴 산식"과 화면 설명이 어긋나 있었다는 뜻. 사용자가 "예상
// 매출이 어떻게 나온건지 이해가 안 된다"고 확인해서, 실제 계산에 쓰인 숫자를 그대로 따라가며
// 보여주는 단계별 표로 바꾼다(evaluate.ts가 predictEmpiricalRevenue의 중간값을 그대로 넘겨준 것 -
// 새 계산 없음).
// 순서가 evaluate.ts의 featureLabels(["시간당요금", "IP당수요(상권수요/(자사PC+경쟁IP))", "경쟁력점수", "경쟁력점수×경쟁력격차"])와
// 반드시 일치해야 한다 - 표시 단위(원/명/점/배)를 요인별로 다르게 포맷하기 위한 것뿐, 값 자체는 그대로다.
// 2026-08-30 — "자사수요/PC대수"(점유율 적용값) 대신 "상권수요/PC대수"(점유율 적용 전)로 변경.
// 2026-09-03 — 다시 "IP당수요"(상권수요를 자사PC+경쟁IP로 나눈 값)로 변경. 단위는 그대로 "명"이다
// (PC 1대가 감당해야 할 수요 인원수라는 의미는 같고, 분모에 경쟁점 PC가 더해진 것뿐).
// 2026-09-02(4차) — 경쟁IP/PC대수 피처를 뺐다가(competitorIp와 marketDemand 상관 0.69로 중복
// 정보였음) 사업 판단으로 "경쟁력점수×경쟁력격차" 상호작용항을 4번째로 재도입(empiricalFeaturesFor
// 주석 참고). 4번째 실제값은 상호작용항 자체가 아니라 이해하기 쉬운 "경쟁력격차"(자사/경쟁점 배율)를
// 보여준다.
const FEATURE_REAL_VALUE_FORMATTERS = [
  (v: number) => formatWon(v),
  (v: number) => `${formatScore(v, 1)}명`,
  (v: number) => `${formatScore(v, 2)}점`,
  (v: number) => `${formatScore(v, 2)}배`,
  // 2026-09-03 — 5번째 피처(배후수요형 특수상권 더미)는 0/1이라 숫자보다 예/아니오가 읽기 쉽다.
  (v: number) => (v >= 0.5 ? "해당" : "해당없음"),
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
        기존 가맹점 {explain.sampleCount}곳의 실제 매출 데이터로 학습한 통계모형(비음수 릿지회귀)입니다. 이 후보지의 조건 {explain.featureLabels.length}가지를 넣으면
        아래 표처럼 계산됩니다.
        {explain.featureLabels.length === 6 && " 학습할 때 실제 매출에서 외부유입 제한의 차감을 분리하고, 최종 V62에서 해당 후보지의 제한을 적용합니다."}
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-[#171310]/[0.08] text-left text-[var(--sl-ink-soft)] dark:border-white/[0.08]">
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
                  {r.isLogTransformed && <span className="ml-1 text-[var(--sl-ink-soft)]">(로그값 기준)</span>}
                </td>
                <td className="py-1 pr-2">
                  {r.formattedRealValue}
                  {r.isLogTransformed && <span className="ml-1 text-[var(--sl-ink-soft)]">→ log {formatScore(r.modelValue, 3)}</span>}
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
      <p className="mt-1 text-[11px] text-[var(--sl-ink-soft)]">
        학습된 가중치(계수)는 항상 0 이상입니다(비음수 릿지회귀). 각 입력이 학습평균보다 높으면 예측을 올리고, 낮으면 내리는 방향으로 작용합니다.
        학습표본이 바뀌면(가맹점 추가·갱신) 평균·표준편차·가중치도 같이 바뀝니다.
      </p>
    </div>
  );
}

export function ResultTab({ candidateCode }: { candidateCode: string }) {
  const { user } = useAuth();
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [settingsUsed, setSettingsUsed] = useState<ModelSettings | null>(null);
  // 운영설정 문서(storeEvalSettings/current)가 아예 없으면 기본 계수로 계산된다. 숫자는
  // 똑같이 그럴듯하게 나오므로, 표시하지 않으면 사용자가 알 방법이 없다.
  const [usedDefaultSettings, setUsedDefaultSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const requestKey = useMemo(() => ({ candidateCode }), [candidateCode]);
  const [completedRequest, setCompletedRequest] = useState<typeof requestKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alreadyExisting, setAlreadyExisting] = useState(false);
  // 전환 여부 조회가 실패한 상태. false로 두면 "아직 전환 안 됨"과 구분이 안 돼서
  // 이미 전환된 후보지를 한 번 더 전환할 수 있다 — 모르는 상태를 따로 들고 있는다.
  const [existingCheckFailed, setExistingCheckFailed] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertMessage, setConvertMessage] = useState<string | null>(null);
  // 2026-08-25 수정 — 실제 가맹점코드는 후보지코드(N001 등)와 다른 정식 코드다(계약 확정 후
  // 부여). 예전엔 기본값을 후보지코드로 채워둬서, 사용자가 그대로 두고 전환하면 정식 코드가
  // 아닌 후보지코드가 그대로 가맹점코드로 저장되는 사고가 날 수 있었다 — 빈칸으로 시작해서
  // 사용자가 반드시 직접 입력하게 한다.
  const [newStoreCode, setNewStoreCode] = useState("");
  const [existingStoreCodes, setExistingStoreCodes] = useState<Set<string>>(new Set());
  // 2026-09-13 — 예상매출 숫자 하나만으로는 "이게 좋은 건지" 알 수 없다는 문제. 기존 가맹점
  // 실제 매출은 이미 여기까지 로드돼 있는데(학습용) 화면에서 버리고 있었다. 분포에서의 위치를
  // 보여주려고 보관한다 — 새로 읽는 건 없다.
  const [peerStores, setPeerStores] = useState<ExistingStore[]>([]);
  // 검증화면이 남겨둔 모형 실측 정확도 요약 1건. 없으면(아직 검증화면을 안 열었으면) null이고
  // 화면에는 안내만 뜬다. 읽기 1건이라 후보지 화면 비용에 사실상 영향이 없다.
  const [accuracy, setAccuracy] = useState<ModelAccuracySummary | null>(null);
  useEffect(() => {
    getModelAccuracySummary().then(setAccuracy).catch(() => setAccuracy(null));
  }, []);
  const runSequence = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  // 다우오피스 평가기록 보고서 초안 - candidate/competitors는 원래 run() 안에서 계산만 하고
  // 버렸는데, 보고서 컨텍스트를 만들려면 화면에 떠 있는 것과 같은 값이 필요해 여기 같이 담아둔다.
  const [candidateForReport, setCandidateForReport] = useState<CandidateInput | null>(null);
  const [competitorsForReport, setCompetitorsForReport] = useState<Competitor[]>([]);
  // 2026-09-13 — 입지동선평가도 보고서 컨텍스트로 넘긴다. 평가자가 직접 쓴 상권구조/지도판단
  // 메모가 [상권] 섹션의 가장 중요한 근거인데(reportContext 주석), 그동안 run() 안에서 계산에만
  // 쓰고 버려서 AI에게 전달된 적이 없었다.
  const [locationForReport, setLocationForReport] = useState<LocationEvaluation | null>(null);
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
    // 2026-09-11 — .catch()가 없었다. 조회가 실패하면 alreadyExisting이 false로 남아
    // 이미 전환된 후보지에도 전환 버튼이 그대로 보인다(중복 전환은 되돌릴 수 없다).
    findExistingStoreByOriginCandidate(candidateCode)
      .then((s) => {
        setAlreadyExisting(s != null);
        setExistingCheckFailed(false);
      })
      .catch(() => setExistingCheckFailed(true));
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
    // 목록 조회가 실패했었다면 여기서 한 번 더 확인한다. 그래도 실패하면 진행하지 않는다 —
    // 전환은 되돌릴 수 없어서, 모르는 채로 진행하는 것보다 막는 쪽이 낫다.
    if (existingCheckFailed) {
      try {
        const already = await findExistingStoreByOriginCandidate(candidateCode);
        setExistingCheckFailed(false);
        setAlreadyExisting(already != null);
        if (already != null) {
          setConvertMessage("이미 기존 가맹점으로 전환된 후보지입니다 — [기존 가맹점 관리] 화면에서 확인하세요.");
          return;
        }
      } catch {
        setConvertMessage("전환 여부를 확인하지 못했습니다 — 중복 전환을 막기 위해 진행하지 않았습니다. 네트워크 확인 후 새로고침하고 다시 시도해주세요.");
        return;
      }
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
    const sequence = ++runSequence.current;
    return getCandidate(candidateCode).then(async (candidate) => {
      if (!candidate) {
        throw new Error("후보지 기본정보가 없습니다. [기본정보] 탭에서 먼저 저장해주세요.");
      }
      const [existingStores, modelSettingsDoc, trainingLocationEvaluations, trainingCompetitors] = await Promise.all([
        listExistingStores(),
        getModelSettings(),
        listAllLocationEvaluations(),
        listAllCompetitors(),
      ]);
      const trainingSales = await listEvaluationSales(existingStores);
      const competitors = trainingCompetitors.filter((competitor) => competitor.candidateCode === candidateCode);
      const locationEvaluation = trainingLocationEvaluations.find((location) => location.candidateCode === candidateCode) ?? null;
      const settings: ModelSettings = modelSettingsDoc ?? { ...defaultModelSettings(), updatedAt: Date.now(), updatedBy: null };
      if (sequence !== runSequence.current) return;
      setUsedDefaultSettings(modelSettingsDoc == null);
      setExistingStoreCodes(new Set(existingStores.map((s) => s.storeCode)));
      setPeerStores(existingStores);

      const evaluated = evaluateCandidate({ candidate, competitors, locationEvaluation, settings, existingStores, trainingLocationEvaluations, trainingCompetitors, trainingSales });
      // 저장은 실행 순서대로 직렬화한다. 이전 실행이 이미 저장을 시작한 뒤 새 실행이
      // 들어오더라도 새 결과가 항상 마지막에 저장되어 Firestore 최종값이 뒤집히지 않는다.
      const saveTask = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (sequence !== runSequence.current) return false;
          await saveEvaluationResult(evaluated, user?.email ?? null);
          return true;
        });
      saveQueue.current = saveTask.then(() => undefined, () => undefined);
      const saved = await saveTask;
      if (!saved) return;
      if (sequence !== runSequence.current) return;
      setResult(evaluated);
      setSettingsUsed(settings);
      setCandidateForReport(candidate);
      setCompetitorsForReport(competitors);
      setLocationForReport(locationEvaluation);
      setReportDraft(null);
      setReportError(null);
      setError(null);
      setCompletedRequest(requestKey);
      setLoading(false);
    }).catch((err: unknown) => {
      if (sequence === runSequence.current) {
        setError(err instanceof Error ? err.message : "최종결과를 계산하지 못했습니다.");
        setCompletedRequest(requestKey);
        setLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateCode, requestKey]);

  function handleRecalculate() {
    setLoading(true);
    setError(null);
    void run();
  }

  useEffect(() => {
    // 숫자 스냅샷이 아니라 공유 카운터를 잡아 수동 재계산까지 함께 무효화한다.
    const sequenceCounter = runSequence;
    run();
    return () => {
      sequenceCounter.current++;
    };
  }, [run]);

  // 다우오피스에 기입할 보고서 텍스트 초안 - AI(Gemini)가 자연스럽게 문장을 쓰게 한다(요청사항,
  // 2026-08-25). 다우오피스 자체에 자동 기입하지 않는다 — 사람이 검토 후 복사해서 직접 붙여넣는다.
  async function handleGenerateReport() {
    if (!result || !candidateForReport) return;
    // 화면에 띄우는 체크리스트와 같은 규칙으로 신호를 모으되, 문서에 쓸 만한 것만 걸러 넘긴다.
    const reportRiskNotes = collectReviewSignals({
      result,
      candidate: candidateForReport,
      competitors: competitorsForReport,
      locationEvaluation: locationForReport,
      usedDefaultSettings,
    })
      .filter((s) => s.forReport)
      .map((s) => `${s.title} (${s.detail})`);
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
            // 2026-09-13 추가 — 실제 평가기록이 "7층에 위치해 접근성과 가시성에 일부 제약이 있음"
            // 처럼 입지 조건을 직접 짚는다.
            floor: candidateForReport.floor,
            groundLevel: candidateForReport.groundLevel,
            hasElevator: candidateForReport.hasElevator,
            expectedPcCount: candidateForReport.expectedPcCount,
          },
          competitors: competitorsForReport.map((c) => ({
            name: c.name,
            distanceM: c.distanceM,
            investigationStatus: c.investigationStatus,
            // 2026-09-13 — 핑봇 실측 가동률은 우리 예측이 아니라 직접 재 온 값이라 평가기록의
            // 근거로 쓸 수 있다(reportContext 주석 참고).
            totalPcCount: c.totalPcCount,
            pingbotUtilization: c.pingbotUtilization,
          })),
          // 2026-09-13 추가 — 평가자가 직접 쓴 메모가 [상권] 섹션의 핵심 근거다.
          locationEvaluation: locationForReport
            ? {
                locationScore: locationForReport.locationScore,
                visibilityScore: locationForReport.visibilityScore,
                preemptionScore: locationForReport.preemptionScore,
                mapMemo: locationForReport.mapMemo,
                marketStructureMemo: locationForReport.marketStructureMemo,
                specialDemandType: locationForReport.specialDemandType,
                specialDemandIntensity: locationForReport.specialDemandIntensity,
                inflowRestriction: locationForReport.inflowRestriction,
              }
            : null,
          // "상품매출 비율 50% 기준 약 29%의 가동률" 문장의 그 50%. v62ImpliedUtilization이 이
          // 비율을 전제로 역산된 값이라 함께 넘겨야 문장이 맞는다.
          productRatio: settingsUsed?.measuredForecastProductRatio ?? null,
          // 2026-09-13 — 규칙이 찾아낸 리스크 중 **문서에 쓸 만한 것만** 넘긴다(forReport). 내부
          // 확인용 신호(운영설정 누락·좌표 없음 등)는 결재 문서에 들어갈 내용이 아니다.
          riskNotes: reportRiskNotes,
          result,
        }),
      });
      // AI 호출이라 게이트웨이 타임아웃 시 HTML이 돌아온다. response.json()이면 그때
      // 진짜 원인 대신 파싱 에러가 뜬다(readJsonOrText 주석 참고).
      const data = await readJsonOrText<DaouReportDraft>(response);
      if (!response.ok) throw new Error(data.error ?? "보고서 초안 생성에 실패했습니다.");
      setReportDraft(data as DaouReportDraft);
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

  if (loading || completedRequest !== requestKey) return <p className="text-sm text-[var(--sl-ink-soft)]">계산 중...</p>;

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <p className="app-notice app-badge-danger w-full justify-start px-3 py-2 text-sm">{error}</p>
        <button
          type="button"
          onClick={handleRecalculate}
          className="app-btn-outline w-fit rounded-lg px-4 py-2 text-sm"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (!result || !settingsUsed) return null;

  // 점포평가 등급 — 계산으로 확정한다(AI에게 맡기지 않는 이유는 아래 초안 섹션 주석 참고).
  const reportGrade = storeEvaluationGrade(result);

  // 결재 전 확인 신호 — 규칙으로만 모은다(reviewSignals.ts). 후보지 값이 아직 로드되지 않았으면
  // 입력 기반 신호는 건너뛰고 계산 결과 기반 신호만 나온다.
  const reviewSignals = candidateForReport
    ? collectReviewSignals({
        result,
        candidate: candidateForReport,
        competitors: competitorsForReport,
        locationEvaluation: locationForReport,
        usedDefaultSettings,
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-lg font-semibold text-[#171310] dark:text-[#f2ede2]">최종평가 결과</h2>
          <p className="mt-1 text-sm text-[var(--sl-ink-soft)]">모델버전 {result.modelVersion} 기준 계산 결과입니다.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRecalculate}
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

      {usedDefaultSettings && (
        <p className="app-notice app-badge-warn w-full justify-start px-3 py-2 text-sm">
          운영설정이 저장돼 있지 않아 <strong>기본 계수</strong>로 계산했습니다. 아래 예상매출은 운영 기준값이
          아닙니다 — [운영 설정] 화면에서 저장한 뒤 다시 확인하세요.
        </p>
      )}

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
        {existingCheckFailed && (
          <span className="app-badge app-badge-warn px-3 py-2 text-xs">
            전환 여부를 확인하지 못했습니다 — 이미 전환된 후보지일 수 있습니다. 새로고침 후 다시 확인하세요.
          </span>
        )}
        {convertMessage && <p className="text-xs text-[#5c5346] dark:text-[#c9bfae]">{convertMessage}</p>}
      </div>

      {(() => {
        // 2026-09-11 사용자 지적(호구포역) — 경쟁이 하나 늘어나는데 기존 사업자보다 가동률이
        // 크게 높게 나오면 확인이 필요하다. 경쟁점 평균 가동률은 이미 계산된 두 값으로 낸다
        // (실가동좌석 ÷ 경쟁IP). 산식은 건드리지 않고 **짚어주기만** 한다.
        // 2026-09-13 — 계산을 reviewSignals.ts로 통합했다. 결재 전 체크리스트에도 같은 경고가
        // 뜨는데 규칙이 두 벌이면 한쪽만 고쳐져 어긋난다(오늘 normalizePercentLike에서 같은
        // 실수를 겪었다). 임계값도 그쪽 상수 하나만 쓴다.
        const utilization = compareOwnVsRivalUtilization(result);
        if (!utilization || utilization.ratio < RIVAL_UTILIZATION_WARN_RATIO) return null;
        const { ours, rivals, ratio } = utilization;
        return (
          <p className="app-notice app-badge-warn w-full justify-start px-3 py-2 text-sm leading-6">
            이 상권 경쟁점은 실측 가동률이 <strong>{formatPercent(rivals)}</strong>인데, 우리 예상은{" "}
            <strong>{formatPercent(ours)}</strong>입니다({ratio.toFixed(2)}배).{" "}
            <strong>우리가 들어가면 경쟁이 하나 늘어나는데 기존 경쟁점보다 더 높게 차는 셈</strong>이라,
            경쟁점 실사값(PC대수·가동률)과 자사 계획 PC대수를 한 번 확인해주세요.
            경쟁점이 실제로 많이 약하면 나올 수 있는 값이라 <strong>틀렸다는 뜻은 아닙니다.</strong>
          </p>
        );
      })()}

      <div className="flex flex-wrap items-center gap-3">
        <span className={`app-badge text-sm ${judgementStyle(result.finalJudgement)}`}>
          {judgementKind(result.finalJudgement) && (
            <span className="mr-1.5 text-[10px] font-normal opacity-70">[{judgementKind(result.finalJudgement)}]</span>
          )}
          최종운영판정: {result.finalJudgement ?? "-"}
        </span>
        <span className="text-xs text-[var(--sl-ink-soft)]">입력완성도: {result.completionStatus ?? "-"}</span>
      </div>
      <p className="text-xs text-[var(--sl-ink-soft)]">
        [계산 상태]는 아직 입력·계산이 덜 끝났다는 뜻이고, [사업 판정]이 떠야 실제 출점 판단에 참고할 수 있는 결과입니다.
      </p>

      {/* 2026-09-13 — 결재 전 체크리스트. 경고가 화면 곳곳에 흩어져 있어(운영설정은 맨 위, 가동률은
          판정 앞, 상한은 매출 카드 안) 빠뜨리기 쉬웠다. 규칙으로 신호를 모아 한 자리에 세운다 —
          여기서 새로운 판단을 하지는 않는다(reviewSignals.ts 주석 참고). */}
      <ReviewSignalList signals={reviewSignals} />

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
          <p className="app-notice app-badge-warn mt-2 w-full justify-start px-3 py-2 text-xs leading-5">
            {result.modelVersion.endsWith("-usage-v1")
              ? "PC·먹거리 학습자료 또는 후보지 필수 입력이 부족해 매출을 계산하지 못했습니다. 요금·입지평가·기존점 월별 매출을 확인해주세요."
              : `학습표본이 최소 기준(${settingsUsed.v61Training.minSampleCount}곳)에 못 미쳐 임시 폴백 회귀식을 썼습니다.`}
          </p>
        )}
        {/* 2026-08-25 — V61 기본예측/V62 보정률/보수판단/상한참고를 V62 최종예상월매출과 나란히
            큰 카드로 늘어놓으면 실제로 쓰는 값(V62 최종예상월매출)이 어느 건지 헷갈린다는 지적
            (사용자 확인: "저 데이터를 쓰질 않으니까... 값 여러개 보여주면 오히려 혼동옴"). 완전히
            숨기면 나중에 V62 값이 이상해 보일 때 V61과 비교해서 원인을 못 찾게 되므로, 지우지
            않고 접이식으로만 옮긴다. */}
        <div className="mt-4">
          <ResultCard label="V62 최종예상월매출" value={formatWon(result.v62Final)} emphasis />
          {/* 2026-09-11 — V62가 **전제하는** 가동률. 아래 "예상 가동률"은 참고용 AA경로 값이라
              (호구포역 24.5%) 출점 판단 기준인 V62의 전제(40.3%)와 다르다. 사용자가 "경쟁점이
              30%인데 우리가 40%는 말이 안 된다"고 지적했을 때 그 40%가 화면 어디에도 없었다. */}
          <ResultCard
            label="V62가 전제하는 가동률"
            value={formatPercent(result.v62ImpliedUtilization)}
            hint="이 예상매출이 나오려면 좌석이 이만큼 차 있어야 한다는 뜻입니다"
          />
        </div>
        {/* 2026-09-10 — 이 화면은 예상매출을 숫자 하나로만 보여줘서, 이 모형이 실제로 얼마나
            맞는지 알 수 없었다. 검증화면이 남겨둔 요약 1건을 읽어 함께 보여준다(계산을 다시
            돌리지 않으므로 Firestore 읽기는 1건뿐이다). 요약이 아직 없으면 안내만 띄운다. */}
        <ModelAccuracyNote accuracy={accuracy} v62Final={result.v62Final} />
        <PeerPositionNote stores={peerStores} result={result} expectedPcCount={candidateForReport?.expectedPcCount ?? result.expectedPcCount} />
        <RevenueDriverBreakdown drivers={result.revenueBreakdown?.usageDrivers} />
        {result.revenueBreakdown && <p className="mt-2 text-sm leading-6">
          PC {formatWon(result.revenueBreakdown.pcRevenue)} + 상품(먹거리) {formatWon(result.revenueBreakdown.productRevenue)}
          {result.revenueBreakdown.monthlyRevenue > 0 && <>
            <br />총매출 중 상품 비중 {formatPercent(result.revenueBreakdown.productRevenue / result.revenueBreakdown.monthlyRevenue)}
          </>}
          <br />예상 PC 이용시간 {formatNumber(Math.round(result.revenueBreakdown.pcHours))}시간 × 시간당 {formatWon(result.hourlyRate)}
        </p>}
        <PriceScenarioPanel baselines={[{id:candidateCode,label:candidateForReport?.name ?? candidateCode,revenue:result.v62Final,hourlyRate:result.hourlyRate,pcRevenue:result.revenueBreakdown?.pcRevenue,productRevenue:result.revenueBreakdown?.productRevenue}]} productRatio={settingsUsed.measuredForecastProductRatio} />
        {result.capacityCapped && (
          <p className="app-notice app-badge-warn mt-2 w-full justify-start px-3 py-2 text-xs leading-5">
            가동률 물리적 상한({formatPercent(settingsUsed.v62MaxUtilizationRate)})에 걸려 예측값을 조정했습니다. 원래 예측은{" "}
            {formatWon(result.v62FinalBeforeCap)}였습니다. PC 이용시간을 좌석대수 × 720시간 × 설정 가동률 이내로 제한합니다.
          </p>
        )}
        {result.competitorOverflowRevenueBonus > 0 && (
          <p className="app-notice mt-2 w-full justify-start px-3 py-2 text-xs leading-5">
            경쟁점이 자기 물리적 상한을 넘겨 못 받는 수요 일부가 자사로 재배분됐습니다 (+
            {formatWon(result.competitorOverflowRevenueBonus)}, 고객 1명 월평균 방문 {settingsUsed.customerVisitsPerMonth}회·1회
            {settingsUsed.customerSessionHours}시간 기준).
          </p>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--sl-ink-soft)] hover:text-[#171310] dark:hover:text-[#f2ede2]">
            세부 계산값 보기 (V61 기본예측 · V62 보정률 · 보수/상한 참고범위)
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ResultCard label="V61 기본예측" value={formatWon(result.v61Baseline)} hint={result.v61ModelLabel} />
            <ResultCard label="V62 보정률" value={formatPercent(result.v62Rate)} />
            {/* 2026-09-10 — "보수판단"이라는 이름 때문에 통계적 하한으로 오해할 수 있어 설명을 붙였다.
                이 둘은 설정값(lowerBoundFactor/upperBoundFactor)을 곱한 고정 밴드이지 실측 신뢰구간이
                아니다. 실제 이 모형이 얼마나 맞는지는 검증 화면에서 확인해야 한다. */}
            <ResultCard label="보수판단매출 (85%)" value={formatWon(result.conservativeSales)}
              hint="예측값 × 85% 고정 밴드 (실측 신뢰구간 아님)" />
            <ResultCard label="상한참고매출 (115%)" value={formatWon(result.upperSales)}
              hint="예측값 × 115% 고정 밴드 (실측 신뢰구간 아님)" />
            {result.capacityCapped && <ResultCard label="가동률 상한 적용 전 원래 예측" value={formatWon(result.v62FinalBeforeCap)} />}
            {/* 2026-09-11 — V62가 **전제하는** 가동률을 여기서 보여준다. 예전엔 화면에
                "예상 가동률"이 하나 있었는데 그건 참고용 AA경로 값이라(호구포역 기준 24.5%)
                출점 판단 기준인 V62의 전제(40.3%)와 달랐다. 사용자가 "경쟁점이 30%인데
                우리가 40%는 말이 안 된다"고 지적했을 때, 그 40%가 화면 어디에도 없었다. */}
            <ResultCard
              label="V62가 전제하는 가동률"
              value={formatPercent(result.v62ImpliedUtilization)}
              hint="이 예상매출이 나오려면 좌석이 이만큼 차 있어야 한다는 뜻입니다"
            />
            {result.competitorOverflowRevenueBonus > 0 && (
              <ResultCard label="경쟁점 초과수요 재배분 보너스" value={formatWon(result.competitorOverflowRevenueBonus)} />
            )}
          </div>
        </details>
      </section>

      {/* 2026-09-13 — 예상매출 바로 아래에 둔다. 숫자를 보고 "이건 현장 감각과 다르다"고 느끼는
          그 자리에서 바로 적을 수 있어야 실제로 쓰이기 때문이다. 후보지 값이 로드되기 전에는
          저장할 대상이 없으므로 렌더하지 않는다. */}
      {candidateForReport && (
        <JudgedRevenuePanel
          key={candidateForReport.code}
          candidateCode={candidateCode}
          initial={candidateForReport}
          v62Final={result.v62Final}
          actor={user?.email ?? null}
          onSaved={(savedCandidate) => setCandidateForReport(savedCandidate)}
        />
      )}

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
        <p className="app-notice app-badge-warn mt-2 w-full justify-start px-3 py-2 text-xs leading-5">
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
        <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
          <strong>평가한 달의 다음 달에 오픈한다고 보고</strong>, 그 <strong>다음 달부터 10개월간</strong> &ldquo;순수익
          2,000/1,500/1,000만원 대당 일매출목표&rdquo; 평균과 위 V62 최종예상월매출을 비교하는 3단계 등급
          판정입니다(1,500만원은 2,000/1,000만원 실측표의 월별 평균). PC대수는 100대 상한이 적용됩니다(100대 초과여도
          100대 기준으로 계산). 선투자 프로모션 대상 판단용이라 최종운영판정과는 별개이고, 출점 여부 결정에는 쓰지 않습니다.
          {/* 2026-09-13 — 오픈월을 사람이 찍던 것을 "평가월+1"로 통일하고, 계산 구간도 오픈 첫 달을
              빼고 그 다음 달부터 세도록 바꿨다(사용자 확정). 달이 바뀌면 같은 후보지라도 기준매출이
              달라지는 게 정상이다 — calc.ts resolveBaselineOpenMonth 주석 참고. */}
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
            <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
              위 계산 결과와 입지동선평가 메모를 근거로 AI(Gemini)가 [상권]/[경쟁]/[종합 의견]/[선투자 프로모션] 문장을 씁니다.
              맨 위 <strong>점포평가 등급은 AI가 아니라 계산으로 확정</strong>합니다. 다우오피스에 자동으로 기입하지 않으니,
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
          <p className="app-notice app-badge-danger mt-3 w-full justify-start px-3 py-2 text-xs">{reportError}</p>
        )}

        {reportDraft && (
          <div className="mt-4 flex flex-col gap-3">
            {/* 2026-09-13 — 실제 평가기록은 맨 윗줄이 "점포평가 : MAA"다. 이 등급만은 AI가 아니라
                코드가 확정한다(storeEvaluationGrade) — 결재 문서의 결론이라 모델이 그럴듯하게
                지어내면 잘못된 등급이 그대로 올라간다. 규칙: 번화가면 앞에 M, 뒤는 선투자
                프로모션 충족 기준(2,000만원→AA / 1,500만원→A+ / 1,000만원→A). */}
            <div className="app-card-sm rounded-xl p-3">
              <p className="text-xs font-semibold text-[var(--sl-ink-soft)]">점포평가 등급</p>
              {reportGrade ? (
                <p className="mt-1 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">점포평가 : {reportGrade}</p>
              ) : (
                <p className="mt-1 text-sm text-[var(--sl-ink-soft)]">
                  점포평가 : <span className="text-[var(--sl-warn)]">해당 없음</span> — 예상 월매출이 1,000만원 기준매출에도
                  못 미쳐 자동 판정 대상이 아닙니다. 직접 판단해서 적어주세요.
                </p>
              )}
            </div>
            {(
              [
                { key: "market", label: "상권", text: reportDraft.marketSection },
                { key: "competition", label: "경쟁", text: reportDraft.competitionSection },
                { key: "summary", label: "종합 의견", text: reportDraft.summarySection },
                // 선투자 기준매출이 안 나온 후보지는 AI가 빈 문자열을 주므로 그때는 칸 자체를 숨긴다.
                ...(reportDraft.promotionSection?.trim()
                  ? ([{ key: "promotion", label: "선투자 프로모션", text: reportDraft.promotionSection }] as const)
                  : []),
              ] as const
            ).map((section) => (
              <div key={section.key} className="app-card-sm rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[var(--sl-ink-soft)]">[{section.label}]</p>
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
                  // 다우오피스에 그대로 붙여넣는 전체 텍스트 — 실제 문서 형식대로 등급 줄이 맨 위에
                  // 오고 섹션 사이는 한 줄 띄운다. 등급이 자동 판정되지 않았으면 사람이 채우도록
                  // 빈칸으로 남긴다(틀린 등급을 넣는 것보다 낫다).
                  [
                    `점포평가 : ${reportGrade ?? ""}`,
                    "",
                    `[상권] ${reportDraft.marketSection}`,
                    "",
                    `[경쟁] ${reportDraft.competitionSection}`,
                    "",
                    `[종합 의견] ${reportDraft.summarySection}`,
                    ...(reportDraft.promotionSection?.trim() ? ["", `[선투자 프로모션] ${reportDraft.promotionSection}`] : []),
                  ].join("\n"),
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
            <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
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
        {cardError && <p className="app-notice app-badge-danger mt-3 w-full justify-start px-3 py-2 text-xs">{cardError}</p>}
        <div className="mt-4 overflow-x-auto">
          <div ref={cardRef} className="inline-block">
            <ReportCard
              result={result}
              candidate={{
                name: candidateForReport?.name ?? result.candidateName,
                address: candidateForReport?.address ?? result.address,
                expectedPcCount: candidateForReport?.expectedPcCount ?? result.expectedPcCount,
                hourlyRate: candidateForReport?.hourlyRate ?? result.hourlyRate,
                judgedRevenue: candidateForReport?.judgedRevenue ?? null,
                judgedReason: candidateForReport?.judgedReason ?? null,
              }}
              competitors={competitorsForReport}
              summarySection={reportDraft?.summarySection}
              accuracy={accuracy}
              productRatio={settingsUsed.measuredForecastProductRatio}
            />
          </div>
        </div>
      </section>

      <details className="app-card rounded-2xl p-4 text-sm print:hidden">
        <summary className="cursor-pointer font-medium text-[#5c5346] dark:text-[#c9bfae]">적용된 산식과 계수 보기</summary>
        <div className="mt-4 flex flex-col gap-4 text-xs leading-6 text-[#5c5346] dark:text-[#c9bfae]">
          {result.modelVersion.endsWith("-usage-v1") ? (
            <div>
              <p className="font-semibold">요금 반영 산식</p>
              <p>PC매출 = 예상 PC 이용시간 × 시간당요금. 먹거리 매출을 별도로 예측해 합산합니다.
                외부유입 보정과 경쟁점 초과수요를 이용시간에 반영한 뒤 좌석 가동률 상한을 적용합니다.</p>
              <p>학습 이용시간은 과거 PC매출을 현재 등록 요금으로 나눈 추정값입니다. 요금 변경에 따른 고객 증감은 별도 가정하지 않습니다.</p>
            </div>
          ) : result.v61IsFallback ? (
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
              <p className="mt-1 text-[11px] text-[var(--sl-ink-soft)]">
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
              {result.revenueBreakdown ? "최종예상월매출 = 보정·상한 적용 PC매출 + 보정된 먹거리 매출" : "V62 최종예상월매출 = ROUND(V61 × (1 + 보정률), 0)"}
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
