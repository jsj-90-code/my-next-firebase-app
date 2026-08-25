// 다우오피스 평가기록 보고서 텍스트 초안 - 컨텍스트 빌더.
// "이미 계산된" EvaluationResult/CandidateInput/Competitor 값만 요약한다. 손익계산 등 새로운
// 산식은 추가하지 않는다 — 2026-08-25 사용자 확인: "손익계산같은건 안들어갈거고 우리기준에서의
// 데이터를 뽑으면되는거야. 우리가 여기 평가한 기준에대한것들". AI(Gemini)는 이 텍스트만 보고
// 문장을 쓴다 - 웹검색도, 새 숫자 계산도 하지 않는다(daouReportAi.ts 참고).

import { formatNumber, formatPercent, formatScore, formatWon } from "./format";
import type { CandidateInput, Competitor, EvaluationResult } from "./types";

export type DaouReportContextCandidate = Pick<CandidateInput, "name" | "address" | "pop500m" | "floating500Avg">;
export type DaouReportContextCompetitor = Pick<Competitor, "name" | "distanceM" | "investigationStatus">;

export type DaouReportContextInput = {
  candidate: DaouReportContextCandidate;
  competitors: DaouReportContextCompetitor[];
  result: EvaluationResult;
};

export function buildDaouReportContext({ candidate, competitors, result }: DaouReportContextInput): string {
  const lines: string[] = [];

  lines.push(`[후보지] ${candidate.name || "(이름 없음)"} / ${candidate.address || "(주소 없음)"}`);

  lines.push(
    `[상권 데이터] 반경500m 거주인구 ${formatNumber(candidate.pop500m)}명, 반경500m 유동인구(평균) ${formatNumber(candidate.floating500Avg)}명, ` +
      `상권수요 ${formatNumber(result.marketDemand)}, 상권등급 ${result.marketGrade ?? "-"}, 상권성격 ${result.marketCharacter ?? "-"}`,
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

  lines.push(
    `[경쟁력 비교] 자사 경쟁력점수 ${formatScore(result.ownCompetitivenessScore)}, 경쟁점 평균 경쟁력점수 ${formatScore(result.competitorAvgCompetitiveness)}, ` +
      `경쟁력격차 ${formatScore(result.competitivenessGap)}(양수면 자사 우위), 경쟁IP ${formatNumber(result.competitorIp)}, ` +
      `IP당수요 ${formatScore(result.ipPerDemand)}(여유 기준 >15 / 포화 기준 <7)`,
  );

  lines.push(
    `[매출 예측] 예상 PC대수 ${formatNumber(result.expectedPcCount)}대, 시간당요금 ${formatWon(result.hourlyRate)}, ` +
      `V62 최종예상월매출 ${formatWon(result.v62Final)}(보수판단 ${formatWon(result.conservativeSales)} ~ 상한참고 ${formatWon(result.upperSales)})`,
  );

  if (result.expectedUtilization != null) {
    lines.push(
      `[참고] 실측기반 예상가동률 ${formatPercent(result.expectedUtilization)} — 경쟁점 실가동좌석을 기반으로 한 별도 계산 경로이며 ` +
        "미검증 참고 지표입니다(위 V62 매출과는 다른 산식). 근거가 필요할 때만 참고로만 언급하세요.",
    );
  }

  lines.push(`[판정] 입력완성도 ${result.completionStatus ?? "-"}, 최종운영판정 ${result.finalJudgement ?? "-"}`);

  return lines.join("\n");
}
