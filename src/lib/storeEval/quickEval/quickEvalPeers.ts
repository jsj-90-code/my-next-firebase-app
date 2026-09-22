// AI가 **우리 가맹점 실적과 대 보고** 스스로 매출을 가늠할 수 있게 비교표를 만든다.
// (주소만 초기평가 도구 전용 · **순수 함수**)
//
// ── 왜 (2026-09-22 사용자) ────────────────────────────────────────────────
// *"우리 가맹점 데이터 어떠한 부분을 봤을 때 예상 매출 어느정도 예상한다 이런 AI 자체평가.
//   예상매출이 꼭 산식에 맞아야 한다는 건 아님, 평가에 따라서 매출값 다르게 나와도 됨"*
//
// 그러려면 AI에게 **실적이 있는 실제 매장들**을 줘야 한다. 숫자 없이 "어느 정도 예상"을
// 쓰라고 하면 그게 바로 지어낸 값이 된다. 그래서 상권수요가 가까운 매장들을 골라
// 상권수요·경쟁IP·대수·시급·실매출·대당매출을 그대로 싣는다.
//
// ⚠️ 여기서 예측을 하지 않는다. 고르고 줄 세우기만 한다 — 판단은 AI가, 산식은 V62가 한다.
// ⚠️ 값은 Firestore에 저장된 기존점 필드를 **그대로** 쓴다(재계산하지 않는다). 그래서 산식이
//    쓰는 값과 미세하게 다를 수 있고, 프롬프트에 그렇게 적는다.
// ⚠️ 학습제외 매장과 실매출 없는 매장은 뺀다 — 비교 대상이 아니다.

import { LAB_ONLY_INCLUDED_STORE_CODES } from "../labInput";
import type { ExistingStore } from "../types";

/**
 * 이 도구가 **학습·비교에 쓰는 매장인가** (2026-09-22 사용자: *"송도 동탄은 둘 다 넣어줘라"*).
 *
 * `excludedFromModel`이 켜진 매장 둘(송도점·동탄북광장점)을 이 도구에서는 포함한다.
 * ⚠️ **운영 Firestore는 안 건드린다.** 그 플래그를 풀면 운영 V62 학습 표본까지 바뀌어
 *    결재 숫자가 움직인다(2026-09-21 실측: MAPE 8.83 -> 9.79%, 후보지 매출 −0.5~−3.9%.
 *    그때 사용자가 "실험실에만 넣자"로 되돌렸다 — `scripts/writeSampleInclusion.mjs`).
 *    그래서 실험실이 쓰는 것과 **같은 목록**으로, 이 도구 안에서만 포함한다.
 */
export function isUsableForQuickEval(s: ExistingStore): boolean {
  if (s.brandType !== "블랙라벨") return false;
  if ((s.actualMonthlyRevenueAvg ?? 0) <= 0) return false;
  return !s.excludedFromModel || LAB_ONLY_INCLUDED_STORE_CODES.has(s.storeCode);
}

export type QuickEvalPeer = {
  storeName: string;
  openedAt: string | null;
  marketDemand: number | null;
  competitorIp: number | null;
  pcCount: number | null;
  hourlyRate: number | null;
  actualMonthlyRevenueAvg: number;
  /** 대당 월매출 — 매장 규모를 걷어낸 비교값. 이게 있어야 대수가 다른 매장끼리 비교된다 */
  revenuePerPc: number | null;
  /** 후보지 상권수요와 얼마나 가까운가(배수). 1.0이면 같다 */
  demandRatio: number | null;
};

export type QuickEvalPeerSummary = {
  /** 비교 대상이 된 전체 매장 수 */
  totalCount: number;
  /** 상권수요가 가까운 순으로 고른 매장들 */
  nearest: QuickEvalPeer[];
  /** 전체 중앙값 — "우리 가맹점 평균이 이렇다"의 기준선 */
  medians: {
    marketDemand: number | null;
    pcCount: number | null;
    hourlyRate: number | null;
    actualMonthlyRevenueAvg: number | null;
    revenuePerPc: number | null;
  };
  /** 고른 매장들의 대당매출 범위 — AI가 이 안에서 가늠하게 하는 근거 */
  nearestRevenuePerPc: { min: number | null; median: number | null; max: number | null };
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * 비교 대상 고르기.
 *
 * 조건은 V62 학습표본과 같은 뜻으로 맞춘다 — 블랙라벨 · 산식학습제외 아님 · 실매출 있음.
 * 다른 브랜드나 학습제외 매장을 섞으면 "우리 가맹점은 이렇다"가 흐려진다.
 */
export function buildQuickEvalPeers(
  stores: ExistingStore[],
  candidateMarketDemand: number | null,
  nearestCount = 8,
): QuickEvalPeerSummary {
  const usable = stores.filter(isUsableForQuickEval);

  const toPeer = (s: ExistingStore): QuickEvalPeer => {
    const revenue = s.actualMonthlyRevenueAvg as number;
    const pc = s.evaluationPcCount ?? s.pcCount;
    return {
      storeName: s.storeName,
      openedAt: s.openedAt,
      marketDemand: s.marketDemand,
      competitorIp: s.competitorIp,
      pcCount: pc,
      hourlyRate: s.hourlyRate,
      actualMonthlyRevenueAvg: revenue,
      revenuePerPc: pc && pc > 0 ? Math.round(revenue / pc) : null,
      demandRatio:
        candidateMarketDemand != null && candidateMarketDemand > 0 && s.marketDemand != null
          ? s.marketDemand / candidateMarketDemand
          : null,
    };
  };

  const peers = usable.map(toPeer);

  // 상권수요가 가까운 순. 후보지 수요를 모르면(수집 실패) 매출 높은 순으로 대신 보여준다 —
  // 그 경우 "가까운 매장"이라는 말을 쓸 수 없으므로 프롬프트에서도 그렇게 말한다.
  const nearest =
    candidateMarketDemand != null && candidateMarketDemand > 0
      ? [...peers]
          .filter((p) => p.marketDemand != null)
          .sort(
            (a, b) =>
              Math.abs(Math.log((a.marketDemand as number) / candidateMarketDemand)) -
              Math.abs(Math.log((b.marketDemand as number) / candidateMarketDemand)),
          )
          .slice(0, nearestCount)
      : [...peers].sort((a, b) => b.actualMonthlyRevenueAvg - a.actualMonthlyRevenueAvg).slice(0, nearestCount);

  const perPc = nearest.map((p) => p.revenuePerPc).filter((v): v is number => v != null);

  return {
    totalCount: peers.length,
    nearest,
    medians: {
      marketDemand: median(peers.map((p) => p.marketDemand).filter((v): v is number => v != null)),
      pcCount: median(peers.map((p) => p.pcCount).filter((v): v is number => v != null)),
      hourlyRate: median(peers.map((p) => p.hourlyRate).filter((v): v is number => v != null)),
      actualMonthlyRevenueAvg: median(peers.map((p) => p.actualMonthlyRevenueAvg)),
      revenuePerPc: median(peers.map((p) => p.revenuePerPc).filter((v): v is number => v != null)),
    },
    nearestRevenuePerPc: {
      min: perPc.length ? Math.min(...perPc) : null,
      median: median(perPc),
      max: perPc.length ? Math.max(...perPc) : null,
    },
  };
}
