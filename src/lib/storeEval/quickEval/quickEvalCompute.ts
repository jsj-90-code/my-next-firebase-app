// 주소만 초기평가의 **계산 한 덩어리** — 화면(quick-eval/page.tsx)과 채팅 입지평가(MCP)가 같이 쓴다. (2026-09-29)
//
// 왜 떼어 냈나: 2026-09-29 사용자가 유료 API 대신 "각자 AI 요금제(ChatGPT·Claude) 채팅에서 입지평가"로 바꿨다.
// 채팅 쪽은 서버에서 계산해야 하는데, 화면 안에 있던 계산을 복사하면 두 곳이 조용히 갈라진다
// (CLAUDE.md "산식을 바꾸면 설명도 같이" 규칙의 뿌리와 같은 병). 그래서 **한 함수**로 두고 양쪽이 부른다.
//
// ⚠️ 순수 함수다 — Firestore를 읽지 않는다. 학습 자료는 부르는 쪽이 넘긴다(화면=클라이언트 SDK, 채팅=admin SDK).
// ⚠️ 이 파일을 옮기면서 **계산은 한 글자도 안 바꿨다**(page.tsx 2026-09-28 판 262~357줄 그대로).
import { evaluateCandidate } from "../evaluate";
import { defaultModelSettings } from "../settings";
import { labCandidateBreakdown, rangeFlagsFor, v62TrainingRange } from "../dualEstimate";
import { prepareExistingStoresForEvaluation } from "../existingStoreEvaluation";
import { floatingPatchFromSbiz, type SbizFloatingRadius } from "../floatingPopulationFromSbiz";
import type { SbizFloatingResult } from "./sbizFloating";
import type {
  Competitor, EvaluationResult, ExistingStore, ExistingStoreMonthlySales, LocationEvaluation, ModelSettings,
} from "../types";
import type { ResidentAges } from "../textbookModel";
import {
  buildQuickCandidate, buildQuickLocationEvaluation, blankCompetitorForTraining,
  type QuickEvalAssembly, type QuickEvalCollected, type QuickEvalPlanInput,
} from "./buildQuickCandidate";
import { withQuickEvalSettings } from "./quickEvalDefaults";
import { buildQuickEvalPeers, type QuickEvalPeerSummary } from "./quickEvalPeers";
import { QUICK_EVAL_ISOLATION, quickEvalFinalEstimate, type QuickEvalFinal } from "./quickEvalVerdict";
import { QUICK_EVAL_ENTRY_THRESHOLD_WON } from "./quickEvalDefaults";
import { findVerdictFlips, type VerdictFlip } from "../verdictSensitivity";

/** 자동수집 결과 중 계산이 읽는 부분(collect 라우트 응답·서버 수집 함수 결과 공통). */
export type QuickEvalComputePayload = QuickEvalCollected & {
  floatingByRadius?: Partial<Record<SbizFloatingRadius, SbizFloatingResult>>;
  isolation?: { pcBangs2km: number; truncated: boolean; residentAges2km: ResidentAges | null } | null;
};

/** 학습 자료 — 운영 컬렉션 그대로. */
export type QuickEvalTraining = {
  existingStores: ExistingStore[];
  settingsDoc: ModelSettings | null;
  trainingLocationEvaluations: LocationEvaluation[];
  trainingCompetitors: Competitor[];
  trainingQscScores: ReadonlyMap<string, number>;
  trainingSales: ExistingStoreMonthlySales[];
};

export type QuickEvalComputed = {
  built: QuickEvalAssembly;
  evaluated: EvaluationResult;
  settings: ModelSettings;
  quickLoc: LocationEvaluation | null;
  final: QuickEvalFinal;
  peers: QuickEvalPeerSummary;
  /** 2026-10-06 — 입지 점수 1점에 가능/불가가 뒤집히는 항목(verdictSensitivity.ts). 판정 값이 V62일 때만 잰다. */
  flips: VerdictFlip[];
};

export function computeQuickEval(args: {
  planInput: QuickEvalPlanInput;
  payload: QuickEvalComputePayload;
  locationDraft: { fields: Record<string, number | string | null> } | null;
  training: QuickEvalTraining;
}): QuickEvalComputed {
  const { planInput, payload, locationDraft, training } = args;
  const { existingStores, settingsDoc, trainingLocationEvaluations, trainingCompetitors, trainingQscScores, trainingSales } = training;

  // 1) V62 입력으로 조립
  const built = buildQuickCandidate(planInput, {
    geocode: payload.geocode,
    sgis: payload.sgis,
    floating: payload.floating,
    pcBangs: payload.pcBangs ?? [],
    pcBangsPossiblyTruncated: payload.pcBangsPossiblyTruncated ?? false,
  });

  // 2) 운영 V62 — 기존 [최종결과] 탭과 같은 배선. 이 도구만 상권수요 천장을 켠다(QUICK_EVAL_DEMAND_CEILING).
  const settings: ModelSettings = withQuickEvalSettings(
    settingsDoc ?? { ...defaultModelSettings(), updatedAt: Date.now(), updatedBy: null },
  );
  const quickLoc = buildQuickLocationEvaluation(planInput, locationDraft);
  const evalArgs = {
    candidate: built.candidate,
    competitors: built.competitors,
    settings,
    existingStores,
    trainingLocationEvaluations,
    // ⛔ 학습 경쟁점은 비운다(2026-09-23 되돌림 — 이유는 page.tsx 옛 주석·_quickEvalBias.test.ts).
    trainingCompetitors: trainingCompetitors.map(blankCompetitorForTraining),
    trainingSales,
    trainingQscScores,
  };
  const evaluated = evaluateCandidate({ ...evalArgs, locationEvaluation: quickLoc });

  // 3) 판정 값 — 실험실(인구로 쌓은 수요)을 같이 내고 규칙으로 고른다(quickEvalVerdict). 실험실이 실패해도 V62로 판정.
  let labRevenue: number | null = null;
  let flags: ReturnType<typeof rangeFlagsFor> = [];
  const isolatedAges = payload.isolation?.pcBangs2km === 0 ? payload.isolation.residentAges2km : null;
  try {
    const prepared = prepareExistingStoresForEvaluation(existingStores, trainingCompetitors, trainingLocationEvaluations, settings);
    const range = v62TrainingRange(prepared);
    flags = range ? rangeFlagsFor(evaluated, range) : [];
    labRevenue = labCandidateBreakdown({
      candidate: { ...built.candidate, ...floatingPatchFromSbiz(payload.floatingByRadius ?? {}).patch },
      preparedStores: prepared, rawStores: existingStores,
      competitors: [...trainingCompetitors, ...built.competitors],
      locations: quickLoc ? [...trainingLocationEvaluations, quickLoc] : trainingLocationEvaluations,
      sales: trainingSales, settings,
      extras: isolatedAges
        ? {
            residentRadiusByCode: new Map([[built.candidate.code, QUICK_EVAL_ISOLATION.residentRadiusM]]),
            residentRingsByCode: new Map([[built.candidate.code, { [QUICK_EVAL_ISOLATION.residentRadiusM]: isolatedAges }]]),
          }
        : undefined,
    })?.monthlyRevenue ?? null;
  } catch {
    labRevenue = null;
  }
  const final = quickEvalFinalEstimate(evaluated.v62Final, labRevenue, flags, { isolated: isolatedAges != null });

  // 4) 가맹점 실적 비교표
  const peers = buildQuickEvalPeers(existingStores, evaluated.marketDemand);

  // 5) 판정 흔들림 — 실험실로 판정한 자리는 입지 점수가 판정 값에 안 들어가므로 재지 않는다.
  const flips = final.source === "V62"
    ? findVerdictFlips(quickLoc, final.value, QUICK_EVAL_ENTRY_THRESHOLD_WON, (changed) => evaluateCandidate({ ...evalArgs, locationEvaluation: changed }).v62Final)
    : [];

  return { built, evaluated, settings, quickLoc, final, peers, flips };
}
