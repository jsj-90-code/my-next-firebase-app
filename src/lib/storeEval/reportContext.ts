// 다우오피스 평가기록 보고서 텍스트 초안 - 컨텍스트 빌더.
// "이미 계산된" EvaluationResult/CandidateInput/Competitor/LocationEvaluation 값만 요약한다.
// 손익계산 등 새로운 산식은 추가하지 않는다 — 2026-08-25 사용자 확인: "손익계산같은건 안들어갈거고
// 우리기준에서의 데이터를 뽑으면되는거야. 우리가 여기 평가한 기준에대한것들". AI(Gemini)는 이
// 텍스트만 보고 문장을 쓴다 - 웹검색도, 새 숫자 계산도 하지 않는다(daouReportAi.ts 참고).
//
// 2026-09-13 전면 보강 — 사용자가 실제로 쓰는 평가기록 5건과 대조해보니, 생성물이 실제와 다른
// 가장 큰 이유가 프롬프트가 아니라 **여기서 재료를 안 넘기고 있던 것**이었다. 실제 문서에는
// 있는데 이 컨텍스트에 없던 것들:
//   - 입지동선평가의 정성 메모(지도판단메모·상권구조메모) → "산본역을 중심으로 상업·문화시설이
//     밀집한" 같은 지역 서술의 유일한 근거다. AI는 주소만으로 그 동네를 알 수 없다.
//   - 특수수요(specialDemandType/Intensity) → "야구 경기일에 일시적으로 집중되는 방문객" 서술
//   - 층수·엘리베이터 → "7층에 위치해 접근성과 가시성에 일부 제약" 서술
//   - 경쟁력 세부 점수 → "존 구성은 우위, 좌석 사양은 열위" 같은 구체적 비교
//   - V62가 전제하는 가동률 → 실제 문서의 [종합 의견]에 거의 항상 나오는 문장
//   - 선투자 프로모션 기준매출 → 실제 문서의 네 번째 섹션

import { formatManwon, formatManwonRough, formatNumber, formatPercent, formatScore } from "./format";
import type { CandidateInput, Competitor, EvaluationResult, LocationEvaluation } from "./types";

export type DaouReportContextCandidate = Pick<
  CandidateInput,
  | "name"
  | "address"
  | "pop500m"
  | "floating500Avg"
  | "facility500SubwayRiders"
  // 2026-09-13 추가 — 실제 문서가 입지 제약을 직접 언급한다("점포가 7층에 위치해 접근성과
  // 가시성에 일부 제약이 있음"). 층수는 경쟁력점수의 입지 항목으로 이미 계산에 쓰이고 있었는데
  // 보고서 쪽으로는 넘어가지 않아 AI가 알 방법이 없었다.
  | "floor"
  | "groundLevel"
  | "hasElevator"
  | "expectedPcCount"
>;
// 2026-09-13 — 핑봇 가동률과 전체대수를 추가한다. 실제 평가기록이 "123대 규모에서 약 30%의
// 가동률이 확인되어 기본적인 PC방 이용수요가 확보된 상권으로 판단됨"처럼 **경쟁점의 실측
// 가동현황**을 근거로 쓴다. 이건 우리 예측이 아니라 핑봇으로 직접 재 온 값이라 "증명된 자료만
// 쓴다"는 원칙(2026-09-13 사용자)에 부합한다 — 오차 52%짜리 AA경로 예상가동률과는 성격이 다르다.
export type DaouReportContextCompetitor = Pick<
  Competitor,
  "name" | "distanceM" | "investigationStatus" | "totalPcCount" | "pingbotUtilization"
>;
// 2026-09-13 추가 — 입지동선평가. 점수(1~5)보다 **메모 두 개가 핵심**이다. 상권의 성격을 사람이
// 직접 적어둔 유일한 자리이고, 실제 평가기록의 [상권] 섹션은 사실상 이 내용을 다듬은 것이다.
export type DaouReportContextLocation = Pick<
  LocationEvaluation,
  | "locationScore"
  | "visibilityScore"
  | "preemptionScore"
  | "mapMemo"
  | "marketStructureMemo"
  | "specialDemandType"
  | "specialDemandIntensity"
  | "inflowRestriction"
>;

export type DaouReportContextInput = {
  candidate: DaouReportContextCandidate;
  competitors: DaouReportContextCompetitor[];
  locationEvaluation?: DaouReportContextLocation | null;
  result: EvaluationResult;
  // 상품매출비율(기본 0.5) — 실제 문서가 "상품매출 비율 50% 기준 약 29%의 가동률"이라고 쓸 때의
  // 그 50%다. v62ImpliedUtilization이 이 비율을 전제로 역산된 값이라 함께 넘겨야 문장이 맞는다.
  productRatio?: number | null;
  // 2026-09-13 — 결재 전 확인 신호 중 **문서에 쓸 만한 것만**(forReport) 걸러서 넘긴다.
  // 실제 평가기록은 "다수의 경쟁점과 수요를 나눠야 하며", "요금 인하 등 적극적인 공동 대응이
  // 발생할 가능성이 있음"처럼 리스크를 직접 짚는다. 그 재료가 그동안 없었다.
  // ⚠️ 신호는 규칙(reviewSignals.ts)이 찾는다 — AI가 리스크를 지어내게 두지 않는다.
  riskNotes?: string[];
};

// 2026-08-25 — 경쟁력격차(computeCompetitivenessGap)는 자사점수÷경쟁점평균점수 "비율"이라
// 1.0이 동률 기준점이다(음수/양수 개념이 아님). 원점수(4.28 vs 2.53 같은 값)를 그대로 주면
// "다른 사람이 봤을 때 판단이 안 된다"는 지적(2026-08-25)이 있어 라벨로 바꿔서 준다 — 새 계산이
// 아니라 이미 있는 비율값을 사람이 읽기 쉬운 말로 바꾸는 것뿐이다.
// 2026-08-25 — "매우우위/우위/열세처럼 더 구체적으로 구분해달라"는 요청으로 3단계→5단계로 확장.
// 임의의 새 기준을 만들지 않고, 경쟁력격차가 실제로 쓰이는 demandCaptureTable(08_계산기준)의
// 기존 경계값(0.8/1.0/1.3/1.7)을 그대로 재사용한다 — 이 표가 이미 "이 정도 격차면 확보율이
// 이만큼 오른다"고 구분해둔 지점이라 자의적이지 않다. settings에서 이 표를 바꾸면 이 라벨
// 경계는 자동으로 따라가지 않는다(화면표시 전용 하드코딩) — 표가 바뀌면 같이 검토 필요.
export function competitivenessLabel(gap: number | null): string | null {
  if (gap == null) return null;
  if (gap >= 1.7) return "매우우위";
  if (gap >= 1.3) return "우위";
  if (gap >= 1.0) return "동등";
  if (gap >= 0.8) return "열세";
  return "매우열세";
}

/**
 * 점포평가 등급 (2026-09-13 사용자 확정 규칙)
 *
 * 실제 평가기록 맨 윗줄의 "점포평가 : MAA" 가 이것이다. 두 축을 붙여 만든다.
 *   앞자리 M — 상권성격이 "번화가"일 때만 붙인다(아니면 아예 안 붙임)
 *   뒷자리   — 선투자 프로모션 어느 기준까지 충족하는지
 *              AA : 2,000만원 기준매출 이상   (= 1억원 선투자 기준)
 *              A+ : 1,500만원 기준매출 이상
 *              A  : 1,000만원 기준매출 이상
 *
 * 기준매출은 "오픈월부터 10개월 순수익 N만원"을 내려면 필요한 월매출이므로, 기준이 높을수록
 * 요구 매출도 높다(2,000만원 기준 > 1,500만원 기준 > 1,000만원 기준). 그래서 높은 쪽부터 검사한다.
 *
 * **AI에게 맡기지 않고 코드가 확정한다.** 이 한 줄이 결재 문서의 결론이라, 모델이 그럴듯하게
 * 지어내면 잘못된 등급이 그대로 올라간다. 셋 다 미달이면 null을 반환하고 화면이 "직접 입력"으로
 * 표시한다 — 그 경우의 등급명은 정해진 바가 없어 임의로 만들지 않는다.
 */
export function storeEvaluationGrade(
  result: Pick<EvaluationResult, "marketCharacter" | "v62Final" | "aaBaselineRevenue" | "aaBaselineRevenue1500" | "aaBaselineRevenue1000">,
): string | null {
  const revenue = result.v62Final;
  if (revenue == null) return null;

  const tier =
    result.aaBaselineRevenue != null && revenue >= result.aaBaselineRevenue
      ? "AA"
      : result.aaBaselineRevenue1500 != null && revenue >= result.aaBaselineRevenue1500
        ? "A+"
        : result.aaBaselineRevenue1000 != null && revenue >= result.aaBaselineRevenue1000
          ? "A"
          : null;
  if (tier == null) return null;

  return result.marketCharacter === "번화가" ? `M${tier}` : tier;
}

/** 1~5점 항목을 사람이 읽는 말로. 실제 문서가 "제약이 있음"/"우위" 같은 말로 쓰는 자리라 숫자만
 *  주면 AI가 "가시성 2점"처럼 내부 점수를 그대로 노출한다(평가기록에 쓰면 안 되는 표현). */
function scoreWord(score: number | null | undefined): string | null {
  if (score == null) return null;
  if (score >= 5) return "매우 양호";
  if (score >= 4) return "양호";
  if (score === 3) return "보통";
  if (score === 2) return "다소 불리";
  return "불리";
}

export function buildDaouReportContext({
  candidate,
  competitors,
  locationEvaluation,
  result,
  productRatio,
  riskNotes,
}: DaouReportContextInput): string {
  const lines: string[] = [];

  // 2026-08-25 — [후보지] 줄은 AI가 상황을 파악하는 내부 참고용이다.
  // 2026-09-13 정정 — 예전에는 "이름·주소를 문장에 절대 쓰지 말라"고 금지했는데, 실제 평가기록은
  // 오히려 "산본역을 중심으로", "창원 상남동 중심 번화가에 위치하여"처럼 **지명을 적극적으로
  // 쓴다**. 금지 대상은 지명이 아니라 게시글에 이미 있는 전체 주소 반복이다(프롬프트에서 구분).
  lines.push(`[후보지] ${candidate.name || "(이름 없음)"} / ${candidate.address || "(주소 없음)"}`);

  // 2026-09-13 추가 — 점포 입지 조건. 실제 문서가 "7층에 위치해 접근성과 가시성에 일부 제약이
  // 있음"이라고 직접 짚는 자리다.
  const siteFacts: string[] = [];
  if (candidate.floor != null) {
    siteFacts.push(`${candidate.groundLevel === "지하" ? "지하" : ""}${candidate.floor}층`);
  }
  if (candidate.hasElevator != null) siteFacts.push(candidate.hasElevator ? "엘리베이터 있음" : "엘리베이터 없음");
  if (siteFacts.length > 0) lines.push(`[점포 조건] ${siteFacts.join(", ")}`);

  // 2026-08-25 — 상권등급(SS/S/A/B)은 다우오피스 보고서에 언급하지 않는다(사용자 확인).
  // 반경500m 지하철승하차는 소상공인365에서 이미 뽑아둔 값인데 있을 때만 "특이사항"으로 붙인다
  // (0/null이면 노이즈만 되니 생략). 세대수/학생수는 2026-08-27에 필드 자체를 없앴다.
  const specialNotes: string[] = [];
  if (candidate.facility500SubwayRiders) {
    specialNotes.push(`지하철 승하차인구(500m) 약 ${formatNumber(candidate.facility500SubwayRiders)}명`);
  }

  lines.push(
    `[상권 데이터] 반경500m 거주인구 ${formatNumber(candidate.pop500m)}명, 반경500m 유동인구(평균) ${formatNumber(candidate.floating500Avg)}명, ` +
      `상권수요 ${formatNumber(result.marketDemand)}, 상권성격 ${result.marketCharacter ?? "-"}` +
      (specialNotes.length > 0 ? `, 특이사항: ${specialNotes.join(", ")}` : ""),
  );

  // 2026-09-13 추가 — 입지동선평가. **메모 두 개가 [상권] 섹션의 핵심 재료다.** 이게 없으면 AI가
  // 쓸 수 있는 건 인구 숫자 나열뿐이고, 실제 문서와 가장 크게 벌어지던 지점이 여기였다.
  if (locationEvaluation) {
    const loc = locationEvaluation;
    if (loc.marketStructureMemo?.trim()) {
      lines.push(`[상권구조 메모(평가자 작성)] ${loc.marketStructureMemo.trim()}`);
    }
    if (loc.mapMemo?.trim()) {
      lines.push(`[지도판단 메모(평가자 작성)] ${loc.mapMemo.trim()}`);
    }
    const locScores: string[] = [];
    const positionWord = scoreWord(loc.locationScore);
    const visibilityWord = scoreWord(loc.visibilityScore);
    const preemptionWord = scoreWord(loc.preemptionScore);
    if (positionWord) locScores.push(`상권 내 위치·동선 ${positionWord}`);
    if (visibilityWord) locScores.push(`접근성·가시성 ${visibilityWord}`);
    if (preemptionWord) locScores.push(`경쟁점의 자리 선점 정도 ${preemptionWord}`);
    if (locScores.length > 0) lines.push(`[입지 평가] ${locScores.join(", ")}`);

    // 특수수요 — 실제 문서의 "야구 경기일에 일시적으로 집중되는 방문객이 상당 부분 포함됐을
    // 가능성" 서술이 이 항목에서 나온다. 유동인구를 그대로 믿으면 안 된다는 단서다.
    // ⚠️ "없음"도 유효한 선택지 문자열이다 — 그냥 truthy 검사를 하면 AI에게 "[특수수요] 없음"이
    // 넘어가 평가기록에 "없음 수요에 의존한다"는 식의 이상한 문장이 나온다(2026-09-13 발견).
    if (loc.specialDemandType && loc.specialDemandType !== "없음") {
      lines.push(
        `[특수수요] ${loc.specialDemandType}${loc.specialDemandIntensity ? ` (강도: ${loc.specialDemandIntensity})` : ""}` +
          ` — 이런 수요는 특정 요일·행사일에만 몰릴 수 있어 조사된 유동인구 전체를 상시 PC방 이용수요로 보기 어려울 수 있음.`,
      );
    }
    if (loc.inflowRestriction) lines.push(`[외부유입제한] ${loc.inflowRestriction}`);
  }

  const investigated = competitors.filter((c) => c.investigationStatus !== "경쟁점없음");
  if (investigated.length === 0) {
    lines.push("[경쟁점] 조사된 경쟁점 없음.");
  } else {
    const list = investigated
      .map((c) => `${c.name || "(이름 없음)"}(${c.distanceM != null ? `${formatNumber(c.distanceM)}m` : "거리 미상"})`)
      .join(", ");
    lines.push(`[경쟁점] 총 ${investigated.length}곳 — ${list}`);
  }

  // 2026-08-25 — 경쟁점이 0곳이면 computeCompetitivenessGap이 1.0(원본 08_계산기준 정의상
  // "경쟁점 없으면 1.0")을 반환하는데, 이건 실측 동률이 아니라 "비교 대상 자체가 없다"는
  // 뜻이다. 이 상태에서 competitivenessLabel을 그대로 적용하면 "경쟁점 평균 대비 동등"이라고
  // 나와서 위 [경쟁점] 줄("조사된 경쟁점 없음")과 모순돼 보인다 - 경쟁점이 없을 때는
  // 우위/동등/열세 라벨 자체를 붙이지 않는다(사용자 질문으로 발견, 2026-08-25).
  if (investigated.length === 0) {
    lines.push(
      `[경쟁력 비교] 비교할 경쟁점이 없어 경쟁력 비교 대상 없음` +
        (result.demandCaptureRate != null
          ? `, 예상 수요확보율 ${formatPercent(result.demandCaptureRate)}(경쟁점 없음일 때의 원본 기준값)`
          : "") +
        `, 경쟁점 공급 규모 ${formatNumber(result.competitorIp)}, 공급 대비 수요 ${formatScore(result.ipPerDemand)}(15 이상 여유 / 7 미만 포화)`,
    );
  } else {
    const label = competitivenessLabel(result.competitivenessGap);
    lines.push(
      `[경쟁력 비교] 자사 시설·서비스 경쟁력은 경쟁점 평균 대비 ${label ?? "비교 불가"} 수준` +
        (result.demandCaptureRate != null ? `, 예상 수요확보율 ${formatPercent(result.demandCaptureRate)}` : "") +
        `, 경쟁점 공급 규모 ${formatNumber(result.competitorIp)}, 공급 대비 수요 ${formatScore(result.ipPerDemand)}(15 이상 여유 / 7 미만 포화)`,
    );
    // 2026-09-13 추가 — 실제 문서는 "존 구성 측면에서는 우위 확보가 가능하나, 좌석 사양 및 진입
    // 편의에서는 열위 요소가 있음"처럼 **어느 항목이 우위이고 어느 항목이 열위인지**를 짚는다.
    // 총점 하나만 주면 그런 문장을 쓸 수 없어서 구성요소를 같이 넘긴다(새 계산 아님 — 이미
    // 경쟁력점수를 만들 때 쓴 값 그대로다).
    const parts: string[] = [];
    // EvaluationResult가 들고 있는 건 입지동선종합점수와 경쟁력 총점 두 계통뿐이다(하드웨어·존
    // 구성 같은 세부 구성요소는 CandidateComputed 쪽이라 여기로 넘어오지 않는다). 있는 것만 준다.
    const locationWord = scoreWord(result.locationScore);
    if (locationWord) parts.push(`입지동선 종합 ${locationWord}`);
    if (result.ownCompetitivenessScore != null && result.competitorAvgCompetitiveness != null) {
      parts.push(
        `종합 경쟁력점수 자사 ${formatScore(result.ownCompetitivenessScore)}점 vs 경쟁점 평균 ${formatScore(result.competitorAvgCompetitiveness)}점(5점 만점)`,
      );
    }
    if (parts.length > 0) lines.push(`[경쟁력 세부] ${parts.join(", ")}`);
  }

  // 2026-08-25 — 보수판단매출(85%)/상한참고매출(115%)은 V62 최종예상월매출에서 기계적으로 곱한
  // 참고 범위일 뿐 실제로 쓰는 값이 아니라서(사용자 확인), 보고서 문장에는 넣지 않는다.
  //
  // 2026-09-13 — 금액을 원 단위로 주던 것을 만원 단위 완성 표현으로 바꿨다. 실제 문서는
  // "58,280,450원"이라고 쓰지 않고 "약 5,800만원"이라고 쓴다. 반올림을 AI에게 맡기면 자릿수를
  // 틀리므로 여기서 미리 만들어 넘긴다.
  lines.push(
    `[매출 예측] 상권수요 약 ${formatNumber(result.marketDemand)}명 중 자사가 확보할 것으로 예상되는 수요 약 ` +
      `${formatNumber(result.expectedOwnDemand)}명, 예상 PC대수 ${formatNumber(result.expectedPcCount)}대, ` +
      `시간당요금 ${formatNumber(result.hourlyRate)}원, 예상 월매출 약 ${formatManwonRough(result.v62Final)}`,
  );

  // 2026-09-13 추가 — **이 줄이 이번 수정의 핵심이다.** 실제 평가기록의 [종합 의견]은 거의 항상
  // "N대·시간당 X원·상품매출 비율 50% 기준 약 Y%의 가동률이 필요함"으로 끝난다. 예전 프롬프트는
  // 오히려 "V62는 회귀모형이라 가동률 같은 중간 단계가 없으니 지어내지 마라"고 **금지**하고
  // 있었는데, 2026-09-11에 v62ImpliedUtilization(V62 최종예상월매출을 같은 공식으로 거꾸로 풀어낸
  // 가동률)이 생기면서 이제 지어내지 않고도 쓸 수 있게 됐다. 금지를 풀고 정식 재료로 넘긴다.
  if (result.v62ImpliedUtilization != null) {
    const ratioText = productRatio != null ? `상품매출 비율 ${formatPercent(productRatio, 0)} 기준 ` : "";
    lines.push(
      `[필요 가동률] ${formatNumber(result.expectedPcCount)}대·시간당 이용요금 ${formatNumber(result.hourlyRate)}원·${ratioText}` +
        `위 예상 월매출을 달성하려면 약 ${formatPercent(result.v62ImpliedUtilization, 0)}의 가동률이 필요함 ` +
        `(위 예상 월매출을 거꾸로 풀어낸 값이므로 지어낸 수치가 아님 — 종합 의견에 반드시 포함할 것).`,
    );
  }

  // 2026-09-13 추가 — 선투자 프로모션 섹션의 재료. 사용자 확인(2026-09-13): 실제 문서가 말하는
  // "1억원 선투자 프로모션에 필요한 평균 월매출"이 곧 화면의 "2,000만원 기준매출"(aaBaselineRevenue,
  // 오픈월부터 10개월 순수익 2,000만원 기준)이다. 예시의 숫자와도 맞는다 — 100대 5,646만원,
  // 95대 5,364만원으로 대수에 비례하고, 오픈월이 다르면 값이 달라지는 것도 "10개월 평균" 정의와 일치.
  if (result.aaBaselineRevenue != null && result.v62Final != null) {
    const diff = result.v62Final - result.aaBaselineRevenue;
    const over = diff >= 0;
    lines.push(
      `[선투자 프로모션] ${formatNumber(result.expectedPcCount)}대 기준 1억원 선투자 프로모션 적용에 필요한 평균 월매출 약 ` +
        `${formatManwon(result.aaBaselineRevenue)}, 예상 월매출은 이를 약 ${formatManwon(Math.abs(diff))} ` +
        `${over ? "상회" : "하회"} → 기준상 프로모션 적용 ${over ? "가능" : "불가"} 수준.`,
    );
  }

  if (result.revenueBreakdown) {
    lines.push(
      `[요금 반영 근거] 예상 PC 이용시간 ${formatNumber(Math.round(result.revenueBreakdown.pcHours))}시간 × 시간당요금 ${formatNumber(result.hourlyRate)}원 = PC매출 약 ${formatManwon(result.revenueBreakdown.pcRevenue)}, ` +
        `별도 예측 먹거리 매출 약 ${formatManwon(result.revenueBreakdown.productRevenue)}를 합산. 학습 이용시간은 과거 PC매출과 현재 등록 요금으로 추정하며 할인으로 인한 고객 증가는 가정하지 않음.`,
    );
  }
  // 2026-09-13 — 예전엔 여기서 AA경로(실측기반 예상가동률)를 참고로 넘겼는데 **뺐다.** 그 경로는
  // 평균오차 52%로 확인된 미검증 예측이라(calc.ts judgeAaGrade 주석), 결재 문서에 쓸 근거가 되지
  // 못한다. "증명되고 사실확인이 된 자료만 넣어 객관적으로 판단하게 하자"는 사용자 방침(2026-09-13)에
  // 따라 재료 단계에서 아예 제거한다 — 프롬프트로 "쓰지 마세요"라고 막는 것보다 확실하다.
  //
  // 대신 경쟁점의 **핑봇 실측 가동률**을 넘긴다. 이건 예측이 아니라 직접 재 온 값이다.
  const measuredCompetitors = investigated.filter((c) => c.pingbotUtilization != null);
  if (measuredCompetitors.length > 0) {
    lines.push(
      `[경쟁점 실측 가동현황] ` +
        measuredCompetitors
          .map(
            (c) =>
              `${c.name || "(이름 없음)"}${c.totalPcCount != null ? ` ${formatNumber(c.totalPcCount)}대` : ""} 가동률 ${formatPercent(c.pingbotUtilization)}`,
          )
          .join(", ") +
        ` — 핑봇으로 직접 측정한 실측값(우리 예측이 아님). 상권에 실제 이용수요가 얼마나 있는지의 근거로 쓸 수 있음.`,
    );
  }

  lines.push(`[판정] 입력완성도 ${result.completionStatus ?? "-"}, 최종운영판정 ${result.finalJudgement ?? "-"}`);

  // 2026-09-13 — 규칙이 찾아낸 리스크 신호. 실제 평가기록이 "다수의 경쟁점과 수요를 나눠야 하며",
  // "요금 인하 등 공동 대응 가능성"처럼 리스크를 직접 짚는데 그 재료가 없었다. 지어내라는 게
  // 아니라 **여기 적힌 것만** 쓰라는 뜻으로 넘긴다.
  if (riskNotes && riskNotes.length > 0) {
    lines.push(`[확인된 리스크] ${riskNotes.join(" / ")} — 이 항목들은 규칙으로 확인된 사실이므로 [경쟁]이나 [종합 의견]에 자연스럽게 녹여 쓸 것(없는 리스크를 새로 지어내지는 말 것).`);
  }

  return lines.join("\n");
}
