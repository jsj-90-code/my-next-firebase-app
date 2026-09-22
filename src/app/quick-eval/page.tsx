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
  RIVAL_PC_COUNT_WHEN_UNSURVEYED,
  type QuickEvalAssembly,
  type QuickEvalCollected,
  type QuickEvalPlanInput,
} from "@/lib/storeEval/quickEval/buildQuickCandidate";
import {
  OWN_FOOD_BRAND,
  QUICK_EVAL_FIELD_NOTES,
  QUICK_EVAL_BACKTEST,
  QUICK_EVAL_RADII,
  QUICK_EVAL_USAGE_LIMIT,
} from "@/lib/storeEval/quickEval/quickEvalDefaults";
import {
  applyQuickEvalQscFloor,
  buildQuickEvalPeers,
  prepareQuickEvalTrainingStores,
  type QuickEvalPeerSummary,
} from "@/lib/storeEval/quickEval/quickEvalPeers";
// ⛔ 자동화 전용 산식(quickEvalOwnModel)은 **화면에서 뺐다**(사용자 2026-09-22). 적중률은 더
//    높았지만 상권을 못 봐서 후보지 줄 세우기를 못 한다. 산식과 측정 기록은 그 파일에 남아 있다.
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
  expectedPcCount: string;
  hourlyRate: string;
  floor: string;
  groundLevel: GroundLevel;
  hasElevator: "있음" | "없음" | "미정";
};

const INITIAL_PLAN: Plan = {
  address: "",
  expectedPcCount: "",
  hourlyRate: "",
  floor: "",
  groundLevel: "지상",
  // 엘리베이터는 **"있음"이 기본**이다(사용자 지시 2026-09-23). "미정"은 고를 수는 있지만
  // 처음부터 놓지 않는다 — 후보 건물은 대개 엘리베이터가 있어서 매번 바꿔 주는 게 일이었다.
  // ⚠️ 이 값은 V62 금액 계산에 안 들어가고 **AI 접근가시성 판정에만** 사실로 넘어간다
  //    (quickEvalDefaults의 재고표 "자사 층·지상지하·엘리베이터" 항목).
  hasElevator: "있음",
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
  const [peers, setPeers] = useState<QuickEvalPeerSummary | null>(null);
  const lock = useRef(false);

  const planInput = useMemo<QuickEvalPlanInput>(
    () => ({
      // 후보지명 칸을 없앴다 — 주소가 곧 이름이다(사용자 지시 2026-09-22).
      name: plan.address.trim(),
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

  /**
   * AI 평가문을 받아온다.
   *
   * ⚠️ 상태(result/assembly)가 아니라 **인자로** 받는다 — 조회가 끝난 직후 같은 함수 안에서
   *    바로 부르려면 setState가 반영되기를 기다릴 수 없기 때문이다(사용자 요청: 조회 누르면
   *    AI 평가가 같이 나오게).
   */
  const runReview = useCallback(
    async (args: {
      result: EvaluationResult;
      assembly: QuickEvalAssembly;
      collectErrors: string[];
      locationDraftRationale: string | null;
      peers: QuickEvalPeerSummary | null;
    }) => {
      setReviewing(true);
      setReviewError(null);
      try {
        const token = await user?.getIdToken();
        const response = await fetch("/api/quick-eval/ai-review", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(args),
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
    },
    [user],
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
    setPeers(null);
    try {
      // 1) 자동수집 — 좌표·주거인구·유동인구·경쟁점·입지평가 초안
      const token = await user?.getIdToken();
      const response = await fetch("/api/quick-eval/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          address: plan.address.trim(),
          name: planInput.name,
          // 층·엘리베이터는 **AI 입지평가에 넘겨야** 접근가시성에 반영된다(2026-09-22).
          // 안 넘기면 AI가 층수를 모른 채 매기고, 입력한 층수가 결과를 못 움직인다.
          floor: planInput.floor,
          groundLevel: planInput.groundLevel,
          hasElevator: planInput.hasElevator,
        }),
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
        // ⭐ 송도점·동탄북광장점을 **이 화면에서만** 학습에 넣는다(사용자 2026-09-22).
        //    Firestore의 excludedFromModel은 안 건드린다 — 풀면 결재 숫자가 움직인다.
        existingStores: prepareQuickEvalTrainingStores(existingStores),
        trainingLocationEvaluations,
        // ⭐⭐ 학습 경쟁점은 **실측 그대로** 쓴다 (2026-09-22 밤 3차에 방향을 바꿨다).
        //
        // 그날 낮에는 여기서 `blankCompetitorForTraining`으로 학습 쪽도 비웠다. 후보지가
        // 기본값인데 학습만 실측이면 비대칭이라는 이유였고, 그 방향도 맞긴 했다(1.461 -> 1.211).
        // 그런데 비대칭을 없애는 길은 둘이고, **정보를 버리는 쪽을 골랐던 게 반쪽**이었다.
        // 후보지 쪽을 실측 대표값으로 **채우는** 쪽이 모든 지표에서 이긴다
        // (`_quickEvalBias.test.ts`, 기존점 38곳 되짚기):
        //
        //   학습 비움 + 후보지 비움(그날 낮)   MAPE 23.14% · ±20% 47.37% · 배율 1.140
        //   학습 실측 + 후보지 대표값(지금)    MAPE 20.23% · ±20% 71.05% · 배율 1.105
        //
        // 당연한 결과다 — 기존점 경쟁점은 사람이 **실제로 조사한 값**이다. 그걸 버리면 매장끼리
        // 구별하는 정보가 같이 사라진다. 후보지 쪽은 `RIVAL_TYPICAL_WHEN_UNSURVEYED`로 채운다.
        // ⛔ 다시 `blankCompetitorForTraining`을 끼우지 마라.
        trainingCompetitors,
        trainingSales,
        // 동탄북광장점은 QSC 기록이 없어 관리가 '가맹점 평균'으로 들어간다 — 관리 불량이
        // 전달되지 않는다. 사용자 지시로 **가맹점 최저점**을 이 화면에서만 채운다.
        trainingQscScores: applyQuickEvalQscFloor(trainingQscScores),
      });
      setResult(evaluated);

      // 4) 가맹점 실적 비교표 — AI가 **자체 매출 판단**의 근거로 쓴다(사용자 요청 2026-09-22:
      //    "우리 가맹점 데이터 어떠한 부분을 봤을 때 예상 매출 어느정도 예상한다").
      //    화면이 이미 기존점을 불러왔으니 여기서 만든다 — 서버가 Firestore를 또 읽지 않는다.
      const peerSummary = buildQuickEvalPeers(existingStores, evaluated.marketDemand);
      setPeers(peerSummary);

      // 5) AI 평가문을 **바로** 띄운다. 조회 한 번으로 평가까지 나오게 하라는 지시였다.
      //    무료 티어라 비용은 안 들지만 좌석배치도와 할당량을 공유하므로, 실패해도 위 결과는 남는다.
      await runReview({
        result: evaluated,
        assembly: built,
        collectErrors: payload.errors ?? [],
        locationDraftRationale: payload.locationDraft?.rationale ?? null,
        peers: peerSummary,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "평가에 실패했습니다.");
    } finally {
      setRunning(false);
      lock.current = false;
    }
  }, [plan.address, planInput, runReview, user]);


  /** [다시 쓰기] 버튼 — 화면에 떠 있는 결과로 다시 부른다. */
  const requestReview = useCallback(async () => {
    if (!result || !assembly) return;
    await runReview({
      result,
      assembly,
      collectErrors: collected?.errors ?? [],
      locationDraftRationale: collected?.locationDraft?.rationale ?? null,
      peers,
    });
  }, [assembly, collected, peers, result, runReview]);

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
            <span className="text-[var(--sl-ink-soft)]">기본요금</span>
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
          <label className="block w-[92px] text-sm">
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
          <label className="block w-[72px] text-sm">
            <span className="text-[var(--sl-ink-soft)]">층</span>
            <input
              className="app-input mt-1 w-full rounded-lg px-3 py-2 tabular-nums"
              inputMode="numeric"
              value={plan.floor}
              onChange={(e) => setPlan((p) => ({ ...p, floor: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") run();
              }}
            />
          </label>
          <label className="block w-[96px] text-sm">
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
          <button type="button" className="app-btn-primary rounded-xl px-5 py-2 text-sm" disabled={running} onClick={run}>
            {running ? "조회 중… (30초쯤)" : "조회"}
          </button>
        </div>

        {/* ⚠️ 입력칸은 이 한 줄이 전부다(사용자 지시 2026-09-22). 접이식 "추가 입력"을 다시
            만들지 마라 — 후보지명 칸을 없애고 주소를 이름으로 쓴다. */}
        {/* ⚠️ 2026-09-22 밤 — 여기 있던 안내문 둘(층·엘리베이터 설명 / 되짚기 오차 설명)을
            사용자 지시로 지웠다: *"조회했을떄 이런 문구뜨는데, 쓸때 없는내용빼라"* ·
            *"이거는 삭제해도될듯"*. 조회 화면 머리를 깨끗하게 두라는 뜻이다.
            ⚠️ **다시 붙이지 마라.** 두 내용 다 사라진 게 아니라 아래 접이식
            ("이 숫자를 얼마나 믿나")으로 옮겼다 — 층수 0.0%는 재고표의 항목 설명에,
            되짚기 성적은 그 접이식 첫 줄들에 있다. 도구가 실제보다 얼마나 높게 나오는지는
            어딘가에 반드시 남아 있어야 한다(2026-09-23에 L0~L3 사다리를 빼면서 그 자리를
            되짚기 값만 남기도록 정리했다). */}
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
            <p className="mt-2 text-xs text-[var(--sl-ink-soft)]">위 금액은 V62 산식값입니다.</p>

            {/* ⛔ 자동화 전용 산식(PC대수+시급 회귀)은 **화면에서 뺐다**(사용자 2026-09-22:
                "작은값은 없어도될것같은데?"). 적중률은 그쪽이 높았지만(18.27% vs 27.79%)
                **상권을 못 봐서** 후보지를 같은 대수·요금으로 잡으면 전부 같은 값이 나온다 —
                이 도구의 핵심인 줄 세우기를 못 한다. 그래서 금액은 V62 하나만 보여준다.
                산식 자체와 측정 기록은 `quickEvalOwnModel.ts`에 남겨 뒀다(다시 쓸 일이 있으면
                이 블록을 되살리면 된다). 지우지 않은 이유: 오늘 측정 결과의 근거다. */}
          </section>

          {/* ── AI 자체 평가 — 조회하면 자동으로 나온다 ── */}
          <section className="app-card relative overflow-hidden rounded-2xl p-4">
            <span className="app-stripe-neutral absolute inset-y-0 left-0 w-[3px]" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">AI 상권평가</h2>
              <button
                type="button"
                className="app-btn-outline rounded-xl px-4 py-1.5 text-xs"
                disabled={reviewing}
                onClick={requestReview}
              >
                {reviewing ? "쓰는 중…" : "다시 쓰기"}
              </button>
            </div>
            {reviewing && !review ? (
              <p className="mt-3 text-sm text-[var(--sl-ink-soft)]">
                상권 성격·장단점과 가맹점 실적 비교를 쓰고 있습니다… (10~20초)
              </p>
            ) : null}
            {reviewError ? <p className="mt-3 text-sm text-[var(--sl-danger)]">{reviewError}</p> : null}
            {review ? (
              <>
                <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#171310] dark:text-[#f2ede2]">
                  {review}
                </pre>
                <p className="mt-2 text-xs text-[var(--sl-ink-soft)]">
                  AI가 가맹점 실적표와 대 보고 스스로 판단한 것이라 위 산식값과 다를 수 있습니다 — 다른 이유는
                  평가문 안에 적혀 있습니다.
                  {reviewMeta
                    ? ` · ${reviewMeta.model}${reviewMeta.usingFreeTierKey ? " (무료 티어 — 좌석배치도와 할당량 공유)" : ""}`
                    : ""}
                </p>
              </>
            ) : null}
          </section>

          {/* ── AI가 근거로 쓴 가맹점 실적표 — 사람도 같은 걸 볼 수 있게 ── */}
          {peers && peers.nearest.length ? (
            <details className="app-card rounded-2xl p-4">
              <summary className="cursor-pointer text-sm font-semibold text-[#171310] dark:text-[#f2ede2]">
                AI가 비교한 가맹점 {peers.nearest.length}곳 보기 (실적 있는 {peers.totalCount}곳 중)
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--sl-ink-soft)]">
                      <th className="py-1 pr-3">매장</th>
                      <th className="py-1 pr-3">개점</th>
                      <th className="py-1 pr-3 text-right">상권수요</th>
                      <th className="py-1 pr-3 text-right">경쟁IP</th>
                      <th className="py-1 pr-3 text-right">대수</th>
                      <th className="py-1 pr-3 text-right">기본요금</th>
                      <th className="py-1 text-right">실제월매출</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {peers.nearest.map((peer) => (
                      <tr key={peer.storeName}>
                        <td className="py-1 pr-3">{peer.storeName}</td>
                        <td className="py-1 pr-3 text-xs text-[var(--sl-ink-soft)]">{peer.openedAt ?? "-"}</td>
                        <td className="py-1 pr-3 text-right">
                          {fmtInt(peer.marketDemand)}
                          {peer.demandRatio != null ? (
                            <span className="ml-1 text-xs text-[var(--sl-ink-soft)]">
                              ({peer.demandRatio.toFixed(2)}배)
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1 pr-3 text-right">{fmtInt(peer.competitorIp)}</td>
                        <td className="py-1 pr-3 text-right">{fmtInt(peer.pcCount)}</td>
                        <td className="py-1 pr-3 text-right">{fmtInt(peer.hourlyRate)}</td>
                        <td className="py-1 text-right">{formatManwonRough(peer.actualMonthlyRevenueAvg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-[var(--sl-ink-soft)]">
                상권수요가 이 후보지와 가까운 순입니다. ⚠️ 개점 시점이 다르면 기본요금·이용시간이 달라
                같은 대수라도 매출이 달라집니다 — 개점일을 같이 보세요.
              </p>
            </details>
          ) : null}

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
              카카오 기준입니다. PC 대수는 전부 미확인이라 실측 경쟁점의 평균{" "}
              {RIVAL_PC_COUNT_WHEN_UNSURVEYED}대로 계산됐습니다 — 이 목록이 맞는지 보는 게 현장에서 할 일입니다.
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

        {/* ⚠️ 2026-09-23 사용자 지시 — L0~L3 조사단계 사다리를 화면에서 **뺐다**.
            ("L0 L1 L2 L3 이거 구분 사용자에게 알려줄필요있나? 현 산식에 대한 정보만
            주면될것같은데" · "주소만넣으면평균오차가 어쩌구 (…) 필요없는멘트인듯")
            그 표는 **검증 배선**(자사는 각 매장 실측)으로 잰 다른 조건이라 이 화면의 성적이
            아니었고, 하필 L3(13.40%)가 실제 성적보다 좋아 보여 화면이 도구를 과대평가했다.
            측정 자체는 `ADDRESS_ONLY_ACCURACY`에 그대로 남아 있다 — 화면에서만 뺐다
            (L1>L2 역전이 "반만 채우지 마라"의 근거라 상수를 버리면 안 된다).
            ⛔ 화면에 다시 붙이지 마라. 여기에는 **이 도구를 되짚어 잰 값**만 적는다. */}
        <ul className="mt-3 space-y-1 text-xs text-[var(--sl-ink-soft)]">
          <li>
            {QUICK_EVAL_BACKTEST.measuredAt} 기준, 기존 가맹점 {QUICK_EVAL_BACKTEST.sampleCount}곳을
            후보지인 척(자기 자신은 학습에서 빼고) 이 화면과 같은 배선으로 돌려 실제 매출과 견줬습니다
            (<code className="text-[11px]">{QUICK_EVAL_BACKTEST.testFile}</code>).
          </li>
          <li>
            평균오차 <strong>{formatPercent(QUICK_EVAL_BACKTEST.mape, 2)}</strong> · ±20% 안{" "}
            <strong>{formatPercent(QUICK_EVAL_BACKTEST.within20, 1)}</strong> · 실제보다{" "}
            <strong>{((QUICK_EVAL_BACKTEST.medianRatio - 1) * 100).toFixed(0)}%쯤 높게</strong> 나옵니다(
            {QUICK_EVAL_BACKTEST.overCount}/{QUICK_EVAL_BACKTEST.sampleCount}곳).
          </li>
          <li>
            수준을 맞춘 뒤 남는 <strong>줄 세우기 오차</strong>는{" "}
            {formatPercent(QUICK_EVAL_BACKTEST.leveledMape, 2)}입니다(정밀 평가는{" "}
            {formatPercent(QUICK_EVAL_BACKTEST.preciseLeveledMape, 2)}). 금액 수준보다 <strong>순서</strong>가 이
            도구의 쓸모입니다.
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
