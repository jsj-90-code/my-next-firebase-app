// 결재 전 "확인할 것" 신호 수집 (2026-09-13 신설)
//
// 왜 필요한가: 최종결과 화면의 경고가 곳곳에 흩어져 있었다 — 운영설정 누락 경고는 맨 위,
// 가동률 경고는 판정 배지 앞, 상한 적용은 매출 카드 안, 커플존 단위 의심은 경쟁점 탭. 결재
// 직전에 "빠뜨린 게 없나" 확인하려면 화면을 위아래로 훑어야 했다. 한곳에 모은다.
//
// 두 번째 목적은 **예측을 얼마나 믿을 수 있는지**를 드러내는 것이다. 경쟁점 9곳 중 3곳만
// 실사했다면 그 예측은 9곳을 다 조사한 것과 신뢰도가 다른데, 화면 어디에도 그 사실이 없었다.
//
// ⚠️ 여기서 새로운 판단을 하지 않는다. 이미 계산된 값과 입력 상태를 읽어 "확인이 필요한 상태인지"만
// 기계적으로 가린다. AI에게 판단을 맡기지 않는 이유와 같다 — 규칙이 신호를 찾고, 문장으로 풀어쓰는
// 일만 AI에게 준다(daouReportAi).

import type { CandidateInput, Competitor, EvaluationResult, LocationEvaluation } from "./types";

export type ReviewSignalLevel = "확인" | "주의" | "정보";

export type ReviewSignal = {
  level: ReviewSignalLevel;
  title: string;
  detail: string;
  /** 다우오피스 평가기록에 근거로 쓸 만한 신호인지. false면 내부 확인용으로만 쓴다. */
  forReport: boolean;
};

export type ReviewSignalInput = {
  result: EvaluationResult;
  candidate: Pick<CandidateInput, "lat" | "lng" | "expectedPcCount" | "hourlyRate" | "floor" | "groundLevel" | "hasElevator" | "operatingPcStores500m">;
  competitors: Competitor[];
  locationEvaluation: LocationEvaluation | null;
  /** 운영설정 문서가 없어 기본 계수로 계산했는지 */
  usedDefaultSettings: boolean;
};

export function collectReviewSignals({
  result,
  candidate,
  competitors,
  locationEvaluation,
  usedDefaultSettings,
}: ReviewSignalInput): ReviewSignal[] {
  const signals: ReviewSignal[] = [];
  const investigated = competitors.filter((c) => c.investigationStatus !== "경쟁점없음");

  // ---- 계산 전제가 흔들리는 경우 (가장 먼저 봐야 한다) ----
  if (usedDefaultSettings) {
    signals.push({
      level: "확인",
      title: "운영설정이 저장돼 있지 않습니다",
      detail: "기본 계수로 계산된 값이라 공식 수치로 쓰면 안 됩니다. 설정 화면에서 저장한 뒤 다시 계산해주세요.",
      forReport: false,
    });
  }
  if (result.v61IsFallback) {
    signals.push({
      level: "확인",
      title: "학습표본이 모자라 임시 계산식을 썼습니다",
      detail: "정식 학습모형이 아니라 폴백 회귀식으로 계산된 예측입니다. 신뢰도가 평소보다 낮습니다.",
      forReport: false,
    });
  }
  if (result.capacityCapped) {
    signals.push({
      level: "주의",
      title: "물리적 상한에 걸려 예측값이 깎였습니다",
      detail: "원래 예측이 좌석으로 낼 수 있는 한계를 넘어 상한선까지 낮췄습니다. 계획 PC대수가 상권 규모에 비해 적지 않은지 확인해주세요.",
      forReport: false,
    });
  }

  // ---- 조사가 얼마나 됐는지 (예측 신뢰도에 직결) ----
  if (investigated.length === 0) {
    if ((candidate.operatingPcStores500m ?? 0) > 0) {
      // 반경 500m에 실영업 PC방이 있다고 입력해놓고 경쟁점을 하나도 안 넣은 상태.
      signals.push({
        level: "확인",
        title: `반경 500m에 PC방 ${candidate.operatingPcStores500m}곳이 있다고 입력됐는데 경쟁점이 등록되지 않았습니다`,
        detail: "경쟁점이 없는 것으로 계산되어 예상매출이 실제보다 높게 나올 수 있습니다.",
        forReport: false,
      });
    } else {
      signals.push({
        level: "정보",
        title: "조사된 경쟁점이 없습니다",
        detail: "경쟁 없음을 전제로 계산된 결과입니다.",
        forReport: true,
      });
    }
  } else {
    const measured = investigated.filter((c) => c.pingbotUtilization != null).length;
    if (measured === 0) {
      signals.push({
        level: "주의",
        title: `경쟁점 ${investigated.length}곳 모두 실측 가동률이 없습니다`,
        detail: "핑봇 실측이 있으면 상권의 실제 이용수요를 근거로 확인할 수 있습니다.",
        forReport: false,
      });
    } else if (measured < investigated.length) {
      signals.push({
        level: "정보",
        title: `경쟁점 ${investigated.length}곳 중 ${measured}곳만 실측 가동률이 있습니다`,
        detail: "나머지는 대체값으로 계산됐습니다. 주요 경쟁점 위주로 실사하는 것은 정상 업무 절차라 문제는 아닙니다.",
        forReport: false,
      });
    }
    // 경쟁 밀도 — 평가기록의 "상권 내 PC방 밀도가 매우 높고" 서술에 해당한다.
    if (investigated.length >= 8) {
      signals.push({
        level: "주의",
        title: `경쟁점이 ${investigated.length}곳으로 밀도가 높습니다`,
        detail: "다수의 경쟁점과 수요를 나눠야 합니다.",
        forReport: true,
      });
    }
  }

  // ---- 요금 경쟁 리스크 — 실제 평가기록이 짚는 항목이다 ----
  const rivalRates = investigated
    .map((c) => c.hourlyRateConverted)
    .filter((r): r is number => r != null && r > 0);
  if (candidate.hourlyRate != null && rivalRates.length > 0) {
    const rivalAvg = rivalRates.reduce((s, r) => s + r, 0) / rivalRates.length;
    if (candidate.hourlyRate > rivalAvg * 1.15) {
      signals.push({
        level: "주의",
        title: "계획 요금이 경쟁점 평균보다 높습니다",
        detail: `자사 ${candidate.hourlyRate.toLocaleString("ko-KR")}원 vs 경쟁점 평균 ${Math.round(rivalAvg).toLocaleString("ko-KR")}원. 요금 경쟁이 벌어지면 수요 확보가 예상보다 어려울 수 있습니다.`,
        forReport: true,
      });
    }
  }

  // ---- 입지 제약 — "7층에 위치해 접근성과 가시성에 일부 제약" 서술의 근거 ----
  if (candidate.floor != null && candidate.groundLevel !== "지하" && candidate.floor >= 5) {
    signals.push({
      level: "정보",
      title: `점포가 ${candidate.floor}층으로 높습니다`,
      detail: candidate.hasElevator === false
        ? "엘리베이터가 없어 접근성·가시성 제약이 큽니다."
        : "접근성과 가시성에 일부 제약이 있을 수 있습니다.",
      forReport: true,
    });
  }
  if (candidate.lat == null || candidate.lng == null) {
    signals.push({
      level: "확인",
      title: "좌표가 없습니다",
      detail: "반경 500m·1km 분석이 주소 기준으로 검증되지 않은 상태입니다. 기본정보 탭에서 주소 검색을 실행해주세요.",
      forReport: false,
    });
  }

  // ---- 특수수요 의존 — "야구 경기일에 일시적으로 집중되는 방문객" 서술의 근거 ----
  // ⚠️ "없음"은 null이 아니라 **유효한 선택지 문자열**이다(SpecialDemandType). truthy 검사만
  // 하면 특수수요가 없는 후보지에 "특수수요(없음)에 기대고 있습니다"라는 엉뚱한 경고가 뜬다 —
  // 2026-09-13 실데이터 9곳에 돌려보다 3곳에서 실제로 발견했다.
  if (locationEvaluation?.specialDemandType && locationEvaluation.specialDemandType !== "없음") {
    signals.push({
      level: "주의",
      title: `특수수요(${locationEvaluation.specialDemandType})에 기대고 있습니다`,
      detail: "특정 요일·행사일에만 몰리는 수요라면 조사된 유동인구 전체를 상시 이용수요로 보기 어렵습니다.",
      forReport: true,
    });
  }
  if (locationEvaluation == null) {
    signals.push({
      level: "확인",
      title: "입지동선평가가 입력되지 않았습니다",
      detail: "층수·엘리베이터 폴백으로만 입지를 계산했습니다. 입지동선평가 탭을 채우면 정확해집니다.",
      forReport: false,
    });
  }

  // ---- 예측 가동률이 경쟁점 실측보다 크게 높은 경우 ----
  // (화면에 이미 같은 경고가 있지만, 결재 전 체크리스트에도 모아둔다)
  const rivalSeats = result.competitorOccupiedSeats;
  const rivalIp = result.competitorIp;
  if (result.v62ImpliedUtilization != null && rivalSeats != null && rivalIp && rivalIp > 0) {
    const rivalUtil = rivalSeats / rivalIp;
    if (rivalUtil > 0 && result.v62ImpliedUtilization >= rivalUtil * 1.2) {
      signals.push({
        level: "주의",
        title: "우리 예상 가동률이 경쟁점 실측보다 많이 높습니다",
        detail: `경쟁점 ${(rivalUtil * 100).toFixed(1)}% vs 우리 예상 ${(result.v62ImpliedUtilization * 100).toFixed(1)}%. 경쟁점 실사값과 자사 계획 대수를 확인해주세요.`,
        forReport: false,
      });
    }
  }

  return signals;
}
