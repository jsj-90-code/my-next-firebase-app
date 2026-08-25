// 다우오피스 평가기록 보고서 텍스트 초안 - 컨텍스트 빌더.
// "이미 계산된" EvaluationResult/CandidateInput/Competitor 값만 요약한다. 손익계산 등 새로운
// 산식은 추가하지 않는다 — 2026-08-25 사용자 확인: "손익계산같은건 안들어갈거고 우리기준에서의
// 데이터를 뽑으면되는거야. 우리가 여기 평가한 기준에대한것들". AI(Gemini)는 이 텍스트만 보고
// 문장을 쓴다 - 웹검색도, 새 숫자 계산도 하지 않는다(daouReportAi.ts 참고).

import { formatNumber, formatPercent, formatScore, formatWon } from "./format";
import type { CandidateInput, Competitor, EvaluationResult } from "./types";

export type DaouReportContextCandidate = Pick<
  CandidateInput,
  | "name"
  | "address"
  | "pop500m"
  | "floating500Avg"
  | "facility500SubwayRiders"
  | "facility500Households"
  | "facility500HighSchool"
  | "facility500MiddleSchool"
  | "facility500ElementarySchool"
>;
export type DaouReportContextCompetitor = Pick<Competitor, "name" | "distanceM" | "investigationStatus">;

export type DaouReportContextInput = {
  candidate: DaouReportContextCandidate;
  competitors: DaouReportContextCompetitor[];
  result: EvaluationResult;
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
function competitivenessLabel(gap: number | null): string | null {
  if (gap == null) return null;
  if (gap >= 1.7) return "매우우위";
  if (gap >= 1.3) return "우위";
  if (gap >= 1.0) return "동등";
  if (gap >= 0.8) return "열세";
  return "매우열세";
}

export function buildDaouReportContext({ candidate, competitors, result }: DaouReportContextInput): string {
  const lines: string[] = [];

  // 2026-08-25 — [후보지] 줄은 AI가 상황을 파악하는 내부 참고용일 뿐, [상권] 섹션 문장에는
  // 주소/이름을 다시 쓰지 말라고 프롬프트에 별도 지시한다(다우오피스 게시글에 이미 주소가
  // 적혀 있어 중복이라는 지적, 2026-08-25).
  lines.push(`[후보지] ${candidate.name || "(이름 없음)"} / ${candidate.address || "(주소 없음)"}`);

  // 2026-08-25 — 상권등급(SS/S/A/B)은 다우오피스 보고서에 언급하지 않는다(사용자 확인).
  // 반경500m 지하철승하차/세대수/학생수(고+중+초)는 소상공인365에서 이미 뽑아둔 값인데 있을
  // 때만 "특이사항"으로 붙인다(0/null이면 노이즈만 되니 생략) - 상권 문장에 주소 대신 채울
  // 실질적인 내용을 달라는 요청(2026-08-25) 반영.
  const specialNotes: string[] = [];
  if (candidate.facility500SubwayRiders) {
    specialNotes.push(`지하철 승하차인구(500m) 약 ${formatNumber(candidate.facility500SubwayRiders)}명`);
  }
  if (candidate.facility500Households) {
    specialNotes.push(`세대수(500m) 약 ${formatNumber(candidate.facility500Households)}세대`);
  }
  const studentTotal =
    (candidate.facility500HighSchool ?? 0) + (candidate.facility500MiddleSchool ?? 0) + (candidate.facility500ElementarySchool ?? 0);
  if (studentTotal > 0) {
    specialNotes.push(`반경500m 학생수(초중고 합) 약 ${formatNumber(studentTotal)}명`);
  }

  lines.push(
    `[상권 데이터] 반경500m 거주인구 ${formatNumber(candidate.pop500m)}명, 반경500m 유동인구(평균) ${formatNumber(candidate.floating500Avg)}명, ` +
      `상권수요 ${formatNumber(result.marketDemand)}, 상권성격 ${result.marketCharacter ?? "-"}` +
      (specialNotes.length > 0 ? `, 특이사항: ${specialNotes.join(", ")}` : ""),
  );

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
        `, 경쟁IP ${formatNumber(result.competitorIp)}, IP당수요 ${formatScore(result.ipPerDemand)}(여유 기준 >15 / 포화 기준 <7)`,
    );
  } else {
    const label = competitivenessLabel(result.competitivenessGap);
    lines.push(
      `[경쟁력 비교] 자사 시설·서비스 경쟁력은 경쟁점 평균 대비 ${label ?? "비교 불가"} 수준` +
        (result.demandCaptureRate != null ? `, 예상 수요확보율 ${formatPercent(result.demandCaptureRate)}` : "") +
        `, 경쟁IP ${formatNumber(result.competitorIp)}, IP당수요 ${formatScore(result.ipPerDemand)}(여유 기준 >15 / 포화 기준 <7)`,
    );
  }

  // 2026-08-25 — 보수판단매출(85%)/상한참고매출(115%)은 V62 최종예상월매출에서 기계적으로 곱한
  // 참고 범위일 뿐 실제로 쓰는 값이 아니라서(사용자 확인), 보고서 문장에는 넣지 않는다. 여러
  // 숫자를 늘어놓으면 오히려 핵심 값(V62 최종예상월매출)이 흐려진다는 지적.
  //
  // 2026-08-25 — 종합 의견에 "수요 X명 중 Y명 확보 예상 → 그래서 매출은 Z원"이라는 산출근거를
  // 넣어달라는 요청. expectedOwnDemand(예측_자사수요 = 상권수요×점유율)는 V61 학습 특징치
  // (log(자사수요/PC))로 실제 V62 계산에 쓰이는 값이라 여기 넣는다 - 아래 [참고]의 예상
  // 수요확보율/가동률(경쟁점 실가동좌석 기반 별도 파이프라인, 실측기반 예상월매출 전용)과는
  // 다른 계산이다. V62는 회귀모형이라 "가동률" 같은 중간 퍼센트 단계 자체가 없어서, 그 가동률을
  // V62 근거인 것처럼 쓰면 안 된다(사용자 확인 - V62는 그대로 두고 근거는 수요만).
  lines.push(
    `[매출 예측] 상권수요 약 ${formatNumber(result.marketDemand)}명 중 경쟁력·PC대수 비중을 반영해 자사가 확보할 것으로 예상되는 ` +
      `수요는 약 ${formatNumber(result.expectedOwnDemand)}명, 예상 PC대수 ${formatNumber(result.expectedPcCount)}대, ` +
      `시간당요금 ${formatWon(result.hourlyRate)}, V62 최종예상월매출 ${formatWon(result.v62Final)}`,
  );

  if (result.expectedUtilization != null) {
    lines.push(
      `[참고] 실측기반 예상가동률 ${formatPercent(result.expectedUtilization)} — 경쟁점 실가동좌석을 기반으로 한 별도 계산 경로이며 ` +
        "미검증 참고 지표입니다(위 V62 매출과는 다른 산식, V62의 근거로 쓰지 마세요). 근거가 필요할 때만 참고로만 언급하세요.",
    );
  }

  lines.push(`[판정] 입력완성도 ${result.completionStatus ?? "-"}, 최종운영판정 ${result.finalJudgement ?? "-"}`);

  return lines.join("\n");
}
