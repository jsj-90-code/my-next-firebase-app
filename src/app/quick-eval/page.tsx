"use client";

// 주소만 넣는 **초기평가** 화면. (2026-09-22 신설)
//
// ⚠️ **점포평가 시스템(/store-eval)과 완전히 분리된 독립 도구다** — 사용자 지시
//    ("링크를 완전히 분리해줘 v62웹에넣지말고"). 주소도 /quick-eval로 따로 있고, 점포평가
//    메뉴에도 안 걸린다. 입구는 홈 화면의 도구 카드다. 껍데기는 QuickEvalChrome.
//
// ── 쓰임 (2026-09-22 사용자) ──────────────────────────────────────────────
// *"점포개발자들이 점포평가 심사까지의 업무구간이 있으니까 이거 간략히 1차적으로 넘어가려는
//   상황"* · *"최대한 주소만 치고 조회하는 형태로 할 거야"*
// 그래서 화면은 **입력 한 줄 + 조회**가 중심이고, 설명은 전부 접어 뒀다(펼치면 나온다).
// 설명을 지우지 않고 접은 이유: 오차 범위와 무엇을 기본값으로 채웠는지를 아예 없애면
// 초기 추정이 정밀 평가로 오해된다(인계문 6-2·6-3).
//
// ── 무엇이 다른가 ─────────────────────────────────────────────────────────
// [신규후보지]는 사람이 경쟁점을 조사하고 입지를 평가해서 **결재 숫자**를 내는 화면이다.
// 이 화면은 주소 하나로 **후보를 줄 세우는** 화면이다. 산식은 똑같은 운영 V62를 부르고
// (evaluateCandidate 한 곳), 다른 건 입력 자료뿐이다 — 조사로만 알 수 있는 칸을 비워서
// 운영 V62에 이미 있는 기본값 장치가 채우게 둔다.
//
// ⚠️ **저장하지 않는다.** Firestore에 한 줄도 쓰지 않는다(사용자 확정 2026-09-22).
// ⚠️ 화면의 숫자는 전부 `quickEvalDefaults.ts`에서 읽어 그린다. 오차율·기본값을 여기에
//    글자로 박지 않는다(CLAUDE.md 규칙 — 계수가 바뀌면 화면이 조용히 거짓말을 한다).

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { readJsonOrText } from "@/lib/readJsonOrText";
import { formatManwonRough, formatPercent } from "@/lib/storeEval/format";
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
  OWN_FOOD_BRAND,
  QUICK_EVAL_FIELD_NOTES,
  QUICK_EVAL_RADII,
  QUICK_EVAL_USAGE_LIMIT,
} from "@/lib/storeEval/quickEval/quickEvalDefaults";
import type { EvaluationResult, GroundLevel, ModelSettings } from "@/lib/storeEval/types";

type CollectResponse = QuickEvalCollected & {
  collectedAt: number;
  pcBangQueryCount: number;
  locationDraft: { fields: Record<string, number | string | null>; rationale?: string } | null;
  errors: string[];
};

const GROUND_LEVELS: GroundLevel[] = ["지상", "지하"];

type Plan = {
  address: string;
  name: string;
  expectedPcCount: string;
  hourlyRate: string;
  floor: string;
  groundLevel: GroundLevel;
  hasElevator: "있음" | "없음" | "미정";
};

const INITIAL_PLAN: Plan = {
  address: "",
  name: "",
  expectedPcCount: "",
  hourlyRate: "",
  floor: "",
  groundLevel: "지상",
  hasElevator: "미정",
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
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collected, setCollected] = useState<CollectResponse | null>(null);
  const [assembly, setAssembly] = useState<QuickEvalAssembly | null>(null);
  const [result, setResult] = useState<EvaluationResult | null>(null);
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
      // 먹거리는 자사 브랜드라 고정이다 — 입력칸이 없다(quickEvalDefaults.OWN_FOOD_BRAND).
      ownFoodBrand: OWN_FOOD_BRAND,
      // 예상 오픈월도 안 받는다 — 비우면 운영 V62가 "평가한 달의 다음 달"로 잡는다.
      plannedOpenMonth: null,
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
        body: JSON.stringify({ address: plan.address.trim(), name: planInput.name }),
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "평가에 실패했습니다.");
    } finally {
      setRunning(false);
      lock.current = false;
    }
  }, [plan.address, planInput, user]);

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
    <div className="space-y-5">
      {/* ── 입력: 주소가 중심이다 ── */}
      <section className="app-card rounded-2xl p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[260px] flex-1 block text-sm">
            <span className="text-[var(--sl-ink-soft)]">주소</span>
            <input
              className="app-input mt-1 w-full rounded-lg px-3 py-2"
              value={plan.address}
              onChange={(e) => setPlan((p) => ({ ...p, address: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") run();
              }}
              placeholder="도로명주소를 넣고 Enter"
              autoFocus
            />
          </label>
          <label className="block w-[110px] text-sm">
            <span className="text-[var(--sl-ink-soft)]">PC대수</span>
            <input
              className="app-input mt-1 w-full rounded-lg px-3 py-2 tabular-nums"
              inputMode="numeric"
              value={plan.expectedPcCount}
              onChange={(e) => setPlan((p) => ({ ...p, expectedPcCount: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") run();
              }}
            />
          </label>
          <label className="block w-[120px] text-sm">
            <span className="text-[var(--sl-ink-soft)]">시간당요금</span>
            <input
              className="app-input mt-1 w-full rounded-lg px-3 py-2 tabular-nums"
              inputMode="numeric"
              value={plan.hourlyRate}
              onChange={(e) => setPlan((p) => ({ ...p, hourlyRate: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") run();
              }}
            />
          </label>
          <button type="button" className="app-btn-primary rounded-xl px-5 py-2 text-sm" disabled={running} onClick={run}>
            {running ? "조회 중… (30초쯤)" : "조회"}
          </button>
        </div>

        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-[var(--sl-ink-soft)]">추가 입력 (층·엘리베이터·후보지명)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
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
              />
            </label>
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
              <span className="text-[var(--sl-ink-soft)]">후보지명</span>
              <input
                className="app-input mt-1 w-full rounded-lg px-3 py-2"
                value={plan.name}
                onChange={(e) => setPlan((p) => ({ ...p, name: e.target.value }))}
                placeholder="비우면 주소"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-[var(--sl-ink-soft)]">
            먹거리는 {OWN_FOOD_BRAND} 고정, 예상 오픈월은 안 받습니다(평가한 달의 다음 달로 잡습니다).
          </p>
        </details>

        <p className="mt-3 text-xs text-[var(--sl-ink-soft)]">
          초기 선별용입니다 — ±20% 안에 {formatPercent(headline.within20, 1)}(기존 가맹점{" "}
          {ADDRESS_ONLY_ACCURACY.sampleCount}곳으로 측정). 결재 숫자는{" "}
          <Link href="/store-eval/candidates" className="underline">
            점포평가 시스템
          </Link>
          에서 냅니다.
        </p>
        {error ? <p className="mt-3 text-sm text-[var(--sl-danger)]">{error}</p> : null}
      </section>

      {/* ── 결과 ── */}
      {result && assembly ? (
        <>
          <section className="app-card relative overflow-hidden rounded-2xl p-4">
            <span className="app-stripe-info absolute inset-y-0 left-0 w-[3px]" />
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p className="text-3xl font-bold tabular-nums text-[#171310] dark:text-[#f2ede2]">
                {formatManwonRough(result.v62Final)}
              </p>
              <p className="text-sm text-[var(--sl-ink-soft)]">
                ±20%로 보면{" "}
                <strong className="tabular-nums">
                  {result.v62Final == null ? "-" : formatManwonRough(result.v62Final * 0.8)} ~{" "}
                  {result.v62Final == null ? "-" : formatManwonRough(result.v62Final * 1.2)}
                </strong>
              </p>
              {result.finalJudgement ? <span className="app-badge app-badge-neutral">{result.finalJudgement}</span> : null}
            </div>
            <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
              {assembly.candidate.roadAddress ?? assembly.candidate.address}
            </p>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="상권수요" value={fmtInt(result.marketDemand)} />
              <Stat label="상권등급 / 성격" value={`${result.marketGrade ?? "-"} / ${result.marketCharacter ?? "-"}`} />
              <Stat label="경쟁IP" value={fmtInt(result.competitorIp)} />
              <Stat label="IP당수요" value={result.ipPerDemand == null ? "-" : result.ipPerDemand.toFixed(1)} />
              <Stat label="예상 가동률" value={formatPercent(result.expectedUtilization, 1)} />
              <Stat label="경쟁력격차" value={result.competitivenessGap == null ? "-" : result.competitivenessGap.toFixed(3)} />
              <Stat label="보수판단(85%)" value={formatManwonRough(result.conservativeSales)} />
              <Stat label="상한참고(115%)" value={formatManwonRough(result.upperSales)} />
            </div>
            {result.capacityCapped ? (
              <p className="mt-2 text-xs text-[var(--sl-warn)]">
                가동률 상한에 걸려 매출이 깎였습니다 — 수요가 대수보다 많다는 신호입니다.
              </p>
            ) : null}
          </section>

          {warnings.length ? (
            <section className="app-card rounded-2xl p-4">
              <h2 className="text-sm font-semibold text-[var(--sl-warn)]">모르고 낸 것</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--sl-ink-soft)]">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ── 경쟁점 목록 = 실제 업무 산출물 ── */}
          <section className="app-card rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
              경쟁점 {counted.length}곳{excluded.length ? ` (제외 ${excluded.length}곳)` : ""} · 반경{" "}
              {QUICK_EVAL_RADII.competitor}m
            </h2>
            <p className="mt-1 text-xs text-[var(--sl-ink-soft)]">
              카카오 기준입니다. PC 대수는 전부 미확인이라 기본값으로 계산됐습니다 — 이 목록이 맞는지 보는 게
              현장에서 할 일입니다.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
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
                          <span className="app-badge app-badge-ok">셈</span>
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
              <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">AI 평가문</h2>
              <button
                type="button"
                className="app-btn-outline rounded-xl px-4 py-2 text-sm"
                disabled={reviewing}
                onClick={requestReview}
              >
                {reviewing ? "쓰는 중…" : review ? "다시 쓰기" : "평가문 만들기"}
              </button>
            </div>
            {reviewError ? <p className="mt-3 text-sm text-[var(--sl-danger)]">{reviewError}</p> : null}
            {review ? (
              <>
                <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#171310] dark:text-[#f2ede2]">
                  {review}
                </pre>
                {reviewMeta ? (
                  <p className="mt-2 text-xs text-[var(--sl-ink-soft)]">
                    {reviewMeta.model}
                    {reviewMeta.usingFreeTierKey ? " (무료 티어 — 좌석배치도와 할당량 공유)" : " (전용 유료 키)"}
                  </p>
                ) : null}
              </>
            ) : null}
          </section>

          {/* ── 자동수집 수치: 필요할 때만 펼친다 ── */}
          <details className="app-card rounded-2xl p-4">
            <summary className="cursor-pointer text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
              자동수집한 자료 보기
            </summary>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={`주거인구 ${QUICK_EVAL_RADII.resident500}m`} value={fmtInt(assembly.candidate.pop500m)} />
              <Stat label={`주거인구 ${QUICK_EVAL_RADII.resident1km}m`} value={fmtInt(assembly.candidate.pop1km)} />
              <Stat label="1km 남 비율" value={formatPercent(assembly.candidate.male1kmRatio, 1)} />
              <Stat
                label="1km 10·20대"
                value={`${fmtInt(assembly.candidate.age1km_10_19)} · ${fmtInt(assembly.candidate.age1km_20_29)}`}
              />
              <Stat
                label={`유동인구 ${QUICK_EVAL_RADII.floating}m 일평균`}
                value={fmtInt(assembly.candidate.floating500Avg)}
              />
              <Stat
                label="유동 남/10대/20대"
                value={`${fmtInt(assembly.candidate.floating500Male)} · ${fmtInt(assembly.candidate.floating500_10s)} · ${fmtInt(assembly.candidate.floating500_20s)}`}
              />
              <Stat label="실영업 PC방 500m" value={fmtInt(assembly.candidate.operatingPcStores500m)} />
              <Stat
                label="좌표"
                value={`${assembly.candidate.lat?.toFixed(5)}, ${assembly.candidate.lng?.toFixed(5)}`}
              />
            </div>
            <p className="mt-3 text-xs text-[var(--sl-ink-soft)]">
              {collected?.sgis ? `주거인구 ${collected.sgis.baseYear}년 기준(SGIS)` : ""}
              {collected?.floating
                ? ` · 유동인구 최근 12개월 평균(소상공인365, 환산배율 ${collected.floating.scale.toFixed(3)})`
                : ""}
              {collected ? ` · 카카오 질의 ${collected.pcBangQueryCount}회` : ""}
              {` · 모형 ${result.v61ModelLabel}(학습표본 ${result.v61TrainingSampleCount}곳)`}
            </p>
          </details>
        </>
      ) : null}

      {/* ── 이 숫자를 얼마나 믿나 + 기본값 재고표: 접어 둔다(지우지는 않는다) ── */}
      <details className="app-card rounded-2xl p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
          이 숫자를 얼마나 믿나 · 무엇을 기본값으로 채웠나
        </summary>

        <p className="mt-3 text-xs text-[var(--sl-ink-soft)]">
          {ADDRESS_ONLY_ACCURACY.measuredAt} 기준 {ADDRESS_ONLY_ACCURACY.sampleLabel}으로 실제로 재 본 값입니다
          (<code className="text-[11px]">{ADDRESS_ONLY_ACCURACY.testFile}</code>).
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--sl-ink-soft)]">
                <th className="py-1 pr-3">조사 단계</th>
                <th className="py-1 pr-3 text-right">평균오차</th>
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
                    <td className="py-1 pr-3 text-right">{formatPercent(level.within10, 1)}</td>
                    <td className="py-1 text-right">{formatPercent(level.within20, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="mt-2 space-y-1 text-xs text-[var(--sl-ink-soft)]">
          <li>
            주소만 넣으면 평균오차가 정밀 평가의 {(headline.mape / precise.mape).toFixed(2)}배입니다(
            {formatPercent(precise.mape, 2)} → {formatPercent(headline.mape, 2)}).
          </li>
          <li>
            ⚠️ 위 측정은 <strong>기존 가맹점</strong>으로 잰 것이고 가시성을 표본 중앙값으로 고정해서 쟀습니다. 이
            화면은 가시성을 AI로 매기므로 조건이 완전히 같지 않습니다. 후보지는 경쟁점 자료가 더 부실해 실제로는
            이보다 나쁠 수 있습니다.
          </li>
          <li>⚠️ {QUICK_EVAL_USAGE_LIMIT}</li>
        </ul>

        <h3 className="mt-4 text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">자동 / 기본값 경계</h3>
        <ul className="mt-2 space-y-2 text-sm">
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
        <p className="mt-3 text-xs text-[var(--sl-ink-soft)]">
          이 화면은 아무것도 저장하지 않습니다 — 남기려면 화면을 캡처하거나 점포평가 시스템에 정식 등록하세요.
        </p>
      </details>
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
