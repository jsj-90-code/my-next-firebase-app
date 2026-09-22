"use client";

// 주소만 넣는 **초기평가** 화면. (2026-09-22 신설)
//
// ⚠️ **점포평가 시스템(/store-eval)과 완전히 분리된 독립 도구다** — 사용자 지시
//    ("링크를 완전히 분리해줘 v62웹에넣지말고"). 주소도 /quick-eval로 따로 있고, 점포평가
//    메뉴에도 안 걸린다. 입구는 홈 화면의 도구 카드다. 껍데기는 QuickEvalChrome.
//
// ── 무엇이 다른가 ─────────────────────────────────────────────────────────
// [신규후보지]는 사람이 경쟁점을 조사하고 입지를 평가해서 **결재 숫자**를 내는 화면이다.
// 이 화면은 주소 하나로 **후보를 줄 세우는** 화면이다. 산식은 똑같은 운영 V62를 부르고
// (evaluateCandidate 한 곳), 다른 건 입력 자료뿐이다 — 조사로만 알 수 있는 칸을 비워서
// 운영 V62에 이미 있는 기본값 장치가 채우게 둔다.
//
// ⚠️ **저장하지 않는다.** Firestore에 한 줄도 쓰지 않는다(사용자 확정 2026-09-22).
//    후보지 코드도 QUICK-TEMP로 고정돼 운영 후보지(N001…)와 겹칠 수 없다.
// ⚠️ 화면의 숫자는 전부 `quickEvalDefaults.ts`에서 읽어 그린다. 오차율·기본값을 여기에
//    글자로 박지 않는다(CLAUDE.md 규칙 — 계수가 바뀌면 화면이 조용히 거짓말을 한다).

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { readJsonOrText } from "@/lib/readJsonOrText";
import { formatManwonRough, formatPercent, formatWon } from "@/lib/storeEval/format";
import { evaluateCandidate } from "@/lib/storeEval/evaluate";
import { defaultModelSettings } from "@/lib/storeEval/settings";
import {
  getModelSettings,
  listAllCompetitors,
  listAllLocationEvaluations,
  listEvaluationSales,
  listExistingStores,
  listQscScores,
} from "@/lib/storeEval/store";
import {
  buildQuickCandidate,
  buildQuickLocationEvaluation,
  type QuickEvalAssembly,
  type QuickEvalCollected,
  type QuickEvalPlanInput,
} from "@/lib/storeEval/quickEval/buildQuickCandidate";
import {
  ADDRESS_ONLY_ACCURACY,
  QUICK_EVAL_FIELD_NOTES,
  QUICK_EVAL_RADII,
  QUICK_EVAL_USAGE_LIMIT,
} from "@/lib/storeEval/quickEval/quickEvalDefaults";
import type { EvaluationResult, FoodBrand, GroundLevel, ModelSettings } from "@/lib/storeEval/types";

type CollectResponse = QuickEvalCollected & {
  collectedAt: number;
  pcBangQueryCount: number;
  locationDraft: { fields: Record<string, number | string | null>; rationale?: string } | null;
  errors: string[];
};

const FOOD_BRANDS: FoodBrand[] = [
  "쉐프앤클릭",
  "한끼의품격",
  "XOXO",
  "PC토랑",
  "비바쿡",
  "농심",
  "기타브랜드",
  "브랜드없음",
];
const GROUND_LEVELS: GroundLevel[] = ["지상", "지하"];

type Plan = {
  address: string;
  name: string;
  expectedPcCount: string;
  hourlyRate: string;
  floor: string;
  groundLevel: GroundLevel;
  hasElevator: "있음" | "없음" | "미정";
  ownFoodBrand: FoodBrand | "";
  plannedOpenMonth: string;
};

const INITIAL_PLAN: Plan = {
  address: "",
  name: "",
  expectedPcCount: "",
  hourlyRate: "",
  floor: "",
  groundLevel: "지상",
  hasElevator: "미정",
  ownFoodBrand: "",
  plannedOpenMonth: "",
};

function toNumberOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export default function QuickEvalPage() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<Plan>(INITIAL_PLAN);
  const [skipFloating, setSkipFloating] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collected, setCollected] = useState<CollectResponse | null>(null);
  const [assembly, setAssembly] = useState<QuickEvalAssembly | null>(null);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [settingsUsed, setSettingsUsed] = useState<ModelSettings | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [reviewMeta, setReviewMeta] = useState<{
    model: string;
    usingFreeTierKey: boolean;
    usage: { inputTokens: number | null; outputTokens: number | null };
  } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const lock = useRef(false);

  const headline = ADDRESS_ONLY_ACCURACY.levels[ADDRESS_ONLY_ACCURACY.headlineLevelIndex];
  const precise = ADDRESS_ONLY_ACCURACY.levels[0];

  const planInput = useMemo<QuickEvalPlanInput>(
    () => ({
      name: plan.name.trim() || plan.address.trim(),
      address: plan.address.trim(),
      expectedPcCount: toNumberOrNull(plan.expectedPcCount),
      hourlyRate: toNumberOrNull(plan.hourlyRate),
      floor: toNumberOrNull(plan.floor),
      groundLevel: plan.floor.trim() ? plan.groundLevel : null,
      hasElevator: plan.hasElevator === "미정" ? null : plan.hasElevator === "있음",
      ownFoodBrand: plan.ownFoodBrand || null,
      plannedOpenMonth: toNumberOrNull(plan.plannedOpenMonth),
    }),
    [plan],
  );

  const run = useCallback(async () => {
    if (lock.current) return;
    if (!plan.address.trim()) {
      setError("주소를 입력해주세요.");
      return;
    }
    lock.current = true;
    setRunning(true);
    setError(null);
    setCollected(null);
    setAssembly(null);
    setResult(null);
    setReview(null);
    setReviewMeta(null);
    setReviewError(null);
    try {
      // 1) 자동수집 — 좌표·주거인구·유동인구·경쟁점·입지평가 초안
      const token = await user?.getIdToken();
      const response = await fetch("/api/quick-eval/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ address: plan.address.trim(), name: planInput.name, skipFloating }),
      });
      // 외부 API를 여러 번 부르는 라우트라 타임아웃 시 HTML이 온다(readJsonOrText 주석 참고).
      const data = await readJsonOrText<CollectResponse>(response);
      if (!response.ok || data.error) throw new Error(data.error ?? "자동수집에 실패했습니다.");
      const payload = data as CollectResponse;
      setCollected(payload);

      // 2) V62 입력으로 조립
      const built = buildQuickCandidate(planInput, {
        geocode: payload.geocode,
        sgis: payload.sgis,
        floating: payload.floating,
        pcBangs: payload.pcBangs ?? [],
        pcBangsPossiblyTruncated: payload.pcBangsPossiblyTruncated ?? false,
      });
      setAssembly(built);

      // 3) 운영 V62 호출 — 기존 [최종결과] 탭과 **같은 배선**이다(ResultTab.run 참고).
      const [existingStores, settingsDoc, trainingLocationEvaluations, trainingCompetitors, trainingQscScores] =
        await Promise.all([
          listExistingStores(),
          getModelSettings(),
          listAllLocationEvaluations(),
          listAllCompetitors(),
          listQscScores(),
        ]);
      const trainingSales = await listEvaluationSales(existingStores);
      const settings: ModelSettings =
        settingsDoc ?? { ...defaultModelSettings(), updatedAt: Date.now(), updatedBy: null };
      const evaluated = evaluateCandidate({
        candidate: built.candidate,
        competitors: built.competitors,
        locationEvaluation: buildQuickLocationEvaluation(planInput, payload.locationDraft),
        settings,
        existingStores,
        trainingLocationEvaluations,
        trainingCompetitors,
        trainingSales,
        trainingQscScores,
      });
      setResult(evaluated);
      setSettingsUsed(settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "평가에 실패했습니다.");
    } finally {
      setRunning(false);
      lock.current = false;
    }
  }, [plan.address, planInput, skipFloating, user]);

  const requestReview = useCallback(async () => {
    if (!result || !assembly) return;
    setReviewing(true);
    setReviewError(null);
    try {
      const token = await user?.getIdToken();
      const response = await fetch("/api/quick-eval/ai-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          result,
          assembly,
          collectErrors: collected?.errors ?? [],
          locationDraftRationale: collected?.locationDraft?.rationale ?? null,
        }),
      });
      const data = await readJsonOrText<{
        review: string;
        model: string;
        usingFreeTierKey: boolean;
        usage: { inputTokens: number | null; outputTokens: number | null };
      }>(response);
      if (!response.ok || data.error) throw new Error(data.error ?? "AI 평가문 생성에 실패했습니다.");
      setReview(data.review ?? null);
      setReviewMeta(
        data.model
          ? {
              model: data.model,
              usingFreeTierKey: data.usingFreeTierKey ?? false,
              usage: data.usage ?? { inputTokens: null, outputTokens: null },
            }
          : null,
      );
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "AI 평가문 생성에 실패했습니다.");
    } finally {
      setReviewing(false);
    }
  }, [assembly, collected, result, user]);

  const counted = assembly?.competitorRows.filter((r) => r.counted) ?? [];
  const excluded = assembly?.competitorRows.filter((r) => !r.counted) ?? [];
  const warnings = [...(collected?.errors ?? []), ...(assembly?.missing ?? [])];

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-[#171310] dark:text-[#f2ede2]">주소만 초기평가</h1>
          <span className="app-badge app-badge-warn">초기 선별용</span>
        </div>
        <p className="text-sm text-[var(--sl-ink-soft)]">
          주소 하나로 상권자료를 자동수집해서 운영 V62 산식으로 예상매출을 냅니다. 경쟁점 대수·품질처럼
          현장을 봐야 아는 값은 비워 두고, 운영 V62에 이미 있는 기본값이 채웁니다.
        </p>
        <div className="app-notice text-sm">
          <strong>{QUICK_EVAL_USAGE_LIMIT}</strong>
          <div className="mt-2">
            결재용 정밀 평가는{" "}
            <Link href="/store-eval/candidates" className="underline">
              [신규후보지]
            </Link>
            에서 진행하세요.
          </div>
        </div>
      </header>

      {/* ── 측정된 오차 — quickEvalDefaults.ts에서 읽어 그린다 ── */}
      <section className="app-card rounded-2xl p-4">
        <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">이 숫자는 얼마나 맞나</h2>
        <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
          {ADDRESS_ONLY_ACCURACY.measuredAt} 기준 {ADDRESS_ONLY_ACCURACY.sampleLabel}으로 실제로 재 본 값입니다
          (<code className="text-[11px]">{ADDRESS_ONLY_ACCURACY.testFile}</code>).
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--sl-ink-soft)]">
                <th className="py-1 pr-3">조사 단계</th>
                <th className="py-1 pr-3 text-right">평균오차</th>
                <th className="py-1 pr-3 text-right">중앙값</th>
                <th className="py-1 pr-3 text-right">±10% 안</th>
                <th className="py-1 text-right">±20% 안</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {ADDRESS_ONLY_ACCURACY.levels.map((level, index) => {
                const isHere = index === ADDRESS_ONLY_ACCURACY.headlineLevelIndex;
                return (
                  <tr key={level.name} className={isHere ? "font-semibold" : ""}>
                    <td className="py-1 pr-3">
                      {level.name}
                      {isHere ? <span className="ml-1 app-badge app-badge-info">이 화면</span> : null}
                    </td>
                    <td className="py-1 pr-3 text-right">{formatPercent(level.mape, 2)}</td>
                    <td className="py-1 pr-3 text-right">{formatPercent(level.median, 2)}</td>
                    <td className="py-1 pr-3 text-right">{formatPercent(level.within10, 1)}</td>
                    <td className="py-1 text-right">{formatPercent(level.within20, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 space-y-1 text-xs text-[var(--sl-ink-soft)]">
          <li>
            주소만 넣으면 평균오차가 정밀 평가의 {(headline.mape / precise.mape).toFixed(2)}배({formatPercent(precise.mape, 2)} →{" "}
            {formatPercent(headline.mape, 2)})이고, {formatPercent(headline.within20, 1)}가 ±20% 안에 듭니다.
          </li>
          <li>
            ⚠️ 위 측정은 <strong>기존 가맹점</strong>으로 잰 것이고, 가시성을 표본 중앙값으로 고정해서 쟀습니다.
            이 화면은 가시성을 AI로 매기므로 조건이 완전히 같지는 않습니다.
          </li>
          <li>⚠️ 후보지는 경쟁점 자료가 더 부실해 실제로는 이보다 나쁠 수 있습니다.</li>
        </ul>
      </section>

      {/* ── 입력 ── */}
      <section className="app-card rounded-2xl p-4">
        <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">1. 주소와 기획값</h2>
        <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
          PC대수·시급·층은 조사값이 아니라 <strong>우리가 정하는 기획값</strong>이라 사람이 넣습니다. 비우면
          예상매출이 안 나옵니다.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2 block text-sm">
            <span className="text-[var(--sl-ink-soft)]">주소 *</span>
            <input
              className="app-input mt-1 w-full rounded-lg px-3 py-2"
              value={plan.address}
              onChange={(e) => setPlan((p) => ({ ...p, address: e.target.value }))}
              placeholder="예: 경기도 구리시 경춘로 100"
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--sl-ink-soft)]">후보지명 (비우면 주소)</span>
            <input
              className="app-input mt-1 w-full rounded-lg px-3 py-2"
              value={plan.name}
              onChange={(e) => setPlan((p) => ({ ...p, name: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--sl-ink-soft)]">예상 PC대수 *</span>
            <input
              className="app-input mt-1 w-full rounded-lg px-3 py-2 tabular-nums"
              inputMode="numeric"
              value={plan.expectedPcCount}
              onChange={(e) => setPlan((p) => ({ ...p, expectedPcCount: e.target.value }))}
              placeholder="예: 100"
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--sl-ink-soft)]">시간당 요금(원) *</span>
            <input
              className="app-input mt-1 w-full rounded-lg px-3 py-2 tabular-nums"
              inputMode="numeric"
              value={plan.hourlyRate}
              onChange={(e) => setPlan((p) => ({ ...p, hourlyRate: e.target.value }))}
              placeholder="예: 1300"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              <span className="text-[var(--sl-ink-soft)]">지상/지하</span>
              <select
                className="app-input mt-1 w-full rounded-lg px-3 py-2"
                value={plan.groundLevel}
                onChange={(e) => setPlan((p) => ({ ...p, groundLevel: e.target.value as GroundLevel }))}
              >
                {GROUND_LEVELS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-[var(--sl-ink-soft)]">층</span>
              <input
                className="app-input mt-1 w-full rounded-lg px-3 py-2 tabular-nums"
                inputMode="numeric"
                value={plan.floor}
                onChange={(e) => setPlan((p) => ({ ...p, floor: e.target.value }))}
                placeholder="예: 2"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-[var(--sl-ink-soft)]">엘리베이터</span>
            <select
              className="app-input mt-1 w-full rounded-lg px-3 py-2"
              value={plan.hasElevator}
              onChange={(e) => setPlan((p) => ({ ...p, hasElevator: e.target.value as Plan["hasElevator"] }))}
            >
              <option value="미정">미정</option>
              <option value="있음">있음</option>
              <option value="없음">없음</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-[var(--sl-ink-soft)]">먹거리 브랜드 (비우면 표준값)</span>
            <select
              className="app-input mt-1 w-full rounded-lg px-3 py-2"
              value={plan.ownFoodBrand}
              onChange={(e) => setPlan((p) => ({ ...p, ownFoodBrand: e.target.value as FoodBrand | "" }))}
            >
              <option value="">(미정)</option>
              {FOOD_BRANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-[var(--sl-ink-soft)]">예상 오픈월 (1~12)</span>
            <input
              className="app-input mt-1 w-full rounded-lg px-3 py-2 tabular-nums"
              inputMode="numeric"
              value={plan.plannedOpenMonth}
              onChange={(e) => setPlan((p) => ({ ...p, plannedOpenMonth: e.target.value }))}
              placeholder="예: 3"
            />
          </label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-[var(--sl-ink-soft)]">
          <input type="checkbox" checked={skipFloating} onChange={(e) => setSkipFloating(e.target.checked)} />
          유동인구 수집 건너뛰기 (빠르지만 수요가 낮게 나옵니다 — 급할 때만)
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="app-btn-primary rounded-xl px-4 py-2 text-sm" disabled={running} onClick={run}>
            {running ? "수집하고 계산하는 중… (30초쯤)" : "자동수집하고 계산"}
          </button>
          <span className="text-xs text-[var(--sl-ink-soft)]">
            반경 {QUICK_EVAL_RADII.competitor}m 경쟁점 · 주거인구 {QUICK_EVAL_RADII.resident1km}m · 유동인구{" "}
            {QUICK_EVAL_RADII.floating}m
          </span>
        </div>
        {error ? <p className="mt-3 text-sm text-[var(--sl-danger)]">{error}</p> : null}
      </section>

      {/* ── 결과 ── */}
      {result && assembly ? (
        <>
          <section className="app-card relative overflow-hidden rounded-2xl p-4">
            <span className="app-stripe-info absolute inset-y-0 left-0 w-[3px]" />
            <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">2. 예상매출 (초기 추정)</h2>
            <p className="mt-2 text-3xl font-bold tabular-nums text-[#171310] dark:text-[#f2ede2]">
              {formatManwonRough(result.v62Final)}
            </p>
            <p className="mt-1 text-sm text-[var(--sl-ink-soft)]">
              ±20% 구간으로 보면{" "}
              <strong className="tabular-nums">
                {result.v62Final == null ? "-" : formatManwonRough(result.v62Final * 0.8)} ~{" "}
                {result.v62Final == null ? "-" : formatManwonRough(result.v62Final * 1.2)}
              </strong>{" "}
              (이 구간에 {formatPercent(headline.within20, 1)}가 들어왔습니다)
            </p>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="보수판단(85%)" value={formatManwonRough(result.conservativeSales)} />
              <Stat label="상한참고(115%)" value={formatManwonRough(result.upperSales)} />
              <Stat label="상권수요" value={result.marketDemand == null ? "-" : result.marketDemand.toLocaleString("ko-KR")} />
              <Stat label="상권등급 / 성격" value={`${result.marketGrade ?? "-"} / ${result.marketCharacter ?? "-"}`} />
              <Stat label="경쟁IP" value={result.competitorIp == null ? "-" : result.competitorIp.toLocaleString("ko-KR")} />
              <Stat label="IP당수요" value={result.ipPerDemand == null ? "-" : result.ipPerDemand.toFixed(1)} />
              <Stat label="예상 가동률" value={formatPercent(result.expectedUtilization, 1)} />
              <Stat label="경쟁력격차" value={result.competitivenessGap == null ? "-" : result.competitivenessGap.toFixed(3)} />
            </div>
            <p className="mt-3 text-xs text-[var(--sl-ink-soft)]">
              판정 {result.finalJudgement ?? "-"} · 입력완성도 {result.completionStatus ?? "-"} · 모형{" "}
              {result.v61ModelLabel} (학습표본 {result.v61TrainingSampleCount}곳)
              {settingsUsed ? ` · 설정 ${settingsUsed.modelVersion}` : ""}
              {result.capacityCapped ? " · ⚠️ 가동률 상한에 걸려 매출이 깎였습니다(수요 > 대수 신호)" : ""}
            </p>
          </section>

          {warnings.length ? (
            <section className="app-card rounded-2xl p-4">
              <h2 className="text-sm font-semibold text-[var(--sl-warn)]">⚠️ 이 숫자를 낼 때 모르고 낸 것</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--sl-ink-soft)]">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ── 자동수집 내역 ── */}
          <section className="app-card rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">3. 자동수집한 자료</h2>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={`주거인구 ${QUICK_EVAL_RADII.resident500}m`} value={fmtInt(assembly.candidate.pop500m)} />
              <Stat label={`주거인구 ${QUICK_EVAL_RADII.resident1km}m`} value={fmtInt(assembly.candidate.pop1km)} />
              <Stat label="1km 남 비율" value={formatPercent(assembly.candidate.male1kmRatio, 1)} />
              <Stat
                label="1km 10·20대"
                value={`${fmtInt(assembly.candidate.age1km_10_19)} · ${fmtInt(assembly.candidate.age1km_20_29)}`}
              />
              <Stat label={`유동인구 ${QUICK_EVAL_RADII.floating}m 일평균`} value={fmtInt(assembly.candidate.floating500Avg)} />
              <Stat label="유동 남/10대/20대" value={`${fmtInt(assembly.candidate.floating500Male)} · ${fmtInt(assembly.candidate.floating500_10s)} · ${fmtInt(assembly.candidate.floating500_20s)}`} />
              <Stat label="실영업 PC방 500m" value={fmtInt(assembly.candidate.operatingPcStores500m)} />
              <Stat label="좌표" value={`${assembly.candidate.lat?.toFixed(5)}, ${assembly.candidate.lng?.toFixed(5)}`} />
            </div>
            <p className="mt-3 text-xs text-[var(--sl-ink-soft)]">
              {assembly.candidate.roadAddress ?? assembly.candidate.address}
              {collected?.sgis ? ` · 주거인구 ${collected.sgis.baseYear}년 기준(SGIS)` : ""}
              {collected?.floating ? ` · 유동인구 최근 12개월 평균(소상공인365, 환산배율 ${collected.floating.scale.toFixed(3)})` : ""}
              {collected ? ` · 카카오 질의 ${collected.pcBangQueryCount}회` : ""}
            </p>
          </section>

          {/* ── 경쟁점 목록 = 현장 확인용 ── */}
          <section className="app-card rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
              4. 경쟁점 후보 목록 ({counted.length}곳 셈 / {excluded.length}곳 제외)
            </h2>
            <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
              카카오 장소검색 기준입니다. <strong>PC 대수는 전부 미확인</strong>이라 기본값으로 계산됐습니다 — 이
              목록이 맞는지 확인하는 게 현장에서 할 일입니다.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--sl-ink-soft)]">
                    <th className="py-1 pr-3">상호</th>
                    <th className="py-1 pr-3 text-right">거리</th>
                    <th className="py-1 pr-3">업종</th>
                    <th className="py-1">판정</th>
                  </tr>
                </thead>
                <tbody>
                  {assembly.competitorRows.map((row) => (
                    <tr key={row.place.id} className={row.counted ? "" : "opacity-60"}>
                      <td className="py-1 pr-3">{row.place.name}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{row.place.distanceM}m</td>
                      <td className="py-1 pr-3 text-xs text-[var(--sl-ink-soft)]">
                        {row.place.categoryName ?? <span className="app-badge app-badge-warn">업종 미확인</span>}
                      </td>
                      <td className="py-1 text-xs">
                        {row.counted ? (
                          <span className="app-badge app-badge-ok">경쟁점으로 셈</span>
                        ) : (
                          <span className="text-[var(--sl-ink-soft)]">제외 — {row.excludedReason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {assembly.competitorRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-2 text-sm text-[var(--sl-ink-soft)]">
                        반경 {QUICK_EVAL_RADII.competitor}m 안에서 PC방을 찾지 못했습니다. 수집 실패가 아닌지 위
                        경고를 확인하세요.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── AI 평가문 ── */}
          <section className="app-card rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">5. AI 평가문</h2>
              <button
                type="button"
                className="app-btn-outline rounded-xl px-4 py-2 text-sm"
                disabled={reviewing}
                onClick={requestReview}
              >
                {reviewing ? "쓰는 중…" : review ? "다시 쓰기" : "AI 평가문 만들기"}
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
              버튼을 눌러야 돌아갑니다. 위 숫자를 그대로 인용하고 새 숫자를 만들지 않습니다. 평가문은 웹검색이
              필요 없어 <strong>Gemini 무료 티어</strong>로 돌아가지만, 좌석배치도 자동화와 할당량을 공유하니
              연달아 돌리지는 마세요.
            </p>
            {reviewError ? <p className="mt-3 text-sm text-[var(--sl-danger)]">{reviewError}</p> : null}
            {review ? (
              <>
                <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#171310] dark:text-[#f2ede2]">
                  {review}
                </pre>
                {reviewMeta ? (
                  <p className="mt-2 text-xs text-[var(--sl-ink-soft)]">
                    {reviewMeta.model}
                    {reviewMeta.usingFreeTierKey ? " (무료 티어 키 — 좌석배치도와 할당량 공유)" : " (전용 유료 키)"}
                    {reviewMeta.usage.inputTokens != null
                      ? ` · 토큰 입력 ${reviewMeta.usage.inputTokens.toLocaleString("ko-KR")}`
                      : ""}
                    {reviewMeta.usage.outputTokens != null
                      ? ` · 출력 ${reviewMeta.usage.outputTokens.toLocaleString("ko-KR")}`
                      : ""}
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
        </>
      ) : null}

      {/* ── 재고 표: 무엇이 자동이고 무엇이 기본값인가 ── */}
      <section className="app-card rounded-2xl p-4">
        <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
          무엇이 자동이고 무엇이 기본값인가
        </h2>
        <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
          기본값은 새로 고른 게 아니라 운영 V62가 이미 쓰는 값입니다. ★는 현장 조사가 필요한 항목입니다.
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {QUICK_EVAL_FIELD_NOTES.map((note) => (
            <li key={note.label} className="app-card-sm rounded-xl p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[#171310] dark:text-[#f2ede2]">{note.label}</span>
                <span className={`app-badge ${sourceBadgeClass(note.source)}`}>{note.source}</span>
                {note.needsFieldCheck ? <span className="app-badge app-badge-warn">★ 현장 확인</span> : null}
              </div>
              <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">{note.basis}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="pb-6 text-xs text-[var(--sl-ink-soft)]">
        이 화면은 아무것도 저장하지 않습니다 — 결과를 남기려면 화면을 캡처하거나 [신규후보지]에 정식으로
        등록하세요.
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="app-card-sm rounded-xl p-3">
      <p className="text-xs text-[var(--sl-ink-soft)]">{label}</p>
      <p className="mt-1 font-semibold tabular-nums text-[#171310] dark:text-[#f2ede2]">{value}</p>
    </div>
  );
}

function fmtInt(v: number | null | undefined): string {
  return v == null ? "-" : Math.round(v).toLocaleString("ko-KR");
}

function sourceBadgeClass(source: string): string {
  if (source === "자동수집") return "app-badge-ok";
  if (source === "AI 판정") return "app-badge-info";
  if (source === "사람이 입력") return "app-badge-neutral";
  return "app-badge-warn";
}

// formatWon은 지금 화면에서 안 쓰지만, 원 단위 상세 표시를 붙일 때 쓰려고 남겨둔다.
void formatWon;
