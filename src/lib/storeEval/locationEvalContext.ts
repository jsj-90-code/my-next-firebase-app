// 입지동선평가 AI 초안(3단계, ai-location-eval 라우트)에 줄 "지도 컨텍스트" 텍스트 요약을 만든다.
// 순수 함수 — Firestore/네트워크 호출은 하지 않는다(호출부가 이미 조회해온 데이터를 그대로 넘겨받는다).
// 여기서 만드는 텍스트는 AI 프롬프트 전용 참고자료일 뿐이다 — calc.ts는 이 파일을 참조하지 않고,
// 어떤 계산에도 쓰이지 않는다(types.ts에 이미 명시된 "calc.ts는 AdminDongReference/DemandPoint를
// 안 읽는다" 원칙과 동일선상).

import type { AdminDongReference, CandidateInput, Competitor, DemandPoint } from "./types";

// 이 파일이 실제로 읽는 필드만 좁혀서 별도로 정의한다 — 신규후보지(CandidateInput, 90여 필드)뿐
// 아니라 기존 매장 AI채점검증(4단계)에서도 이 함수를 그대로 쓰기 위함이다. CandidateInput은
// 구조적으로 이 타입을 만족하므로 기존 호출부는 변경 없이 그대로 동작한다.
export type LocationEvalContextCandidate = Pick<
  CandidateInput,
  | "name"
  | "address"
  | "roadAddress"
  | "floating500Avg"
  | "floating1kmAvg"
  | "employ500Total"
  | "employ1kmTotal"
  | "facility500Households"
  | "facility1kmHouseholds"
  | "licensedPcStores500m"
  | "licensedPcStores1km"
  | "facility500SubwayRiders"
  | "facility500HighSchool"
  | "facility500MiddleSchool"
  | "facility500ElementarySchool"
>;

const TOP_N = 8;

function fmt(n: number | null | undefined, unit = ""): string {
  return n == null ? "정보 없음" : `${n.toLocaleString("ko-KR")}${unit}`;
}

function competitorSummary(competitors: Competitor[]): string {
  const withDistance = competitors.filter((c): c is Competitor & { distanceM: number } => c.distanceM != null);
  const within500 = withDistance.filter((c) => c.distanceM <= 500).length;
  const within1km = withDistance.filter((c) => c.distanceM <= 1000).length;
  const sorted = [...withDistance].sort((a, b) => a.distanceM - b.distanceM).slice(0, TOP_N);
  const lines = sorted.map((c) => `- ${c.name} (${fmt(c.distanceM, "m")})`);
  return (
    `경쟁점(PC방): 500m 이내 ${within500}곳, 1km 이내 ${within1km}곳\n` +
    (lines.length ? `가까운 순 목록:\n${lines.join("\n")}` : "수집된 경쟁점 없음")
  );
}

function demandPointSummary(points: DemandPoint[]): string {
  if (!points.length) return "수집된 수요거점 없음";
  const byCategory = new Map<string, DemandPoint[]>();
  for (const p of points) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }
  const lines: string[] = [];
  for (const [category, list] of byCategory) {
    const sorted = [...list].sort((a, b) => a.distanceM - b.distanceM).slice(0, TOP_N);
    lines.push(`${category} (${list.length}건): ${sorted.map((p) => `${p.name}(${fmt(p.distanceM, "m")})`).join(", ")}`);
  }
  return lines.join("\n");
}

function adminDongSummary(ref: AdminDongReference | null): string {
  if (!ref) return "행정동 인구통계 없음(SGIS 미수집)";
  return (
    `${ref.admName}(${ref.year ?? "연도 미상"}년 기준) 총인구 ${fmt(ref.totalPopulation, "명")}` +
    ` (남 ${fmt(ref.malePopulation, "명")}, 여 ${fmt(ref.femalePopulation, "명")})`
  );
}

// 소상공인365/SGIS 반자동 업로드-추출로 채워지는 참고자료(계산에는 쓰이지 않음, CandidateInput
// 타입 주석 참고) — 값이 있는 항목만 골라 보여준다.
function marketDataSummary(candidate: LocationEvalContextCandidate): string {
  const lines: string[] = [];
  if (candidate.floating500Avg != null) lines.push(`유동인구 500m 일평균 ${fmt(candidate.floating500Avg, "명")}`);
  if (candidate.floating1kmAvg != null) lines.push(`유동인구 1km 일평균 ${fmt(candidate.floating1kmAvg, "명")}`);
  if (candidate.employ500Total != null) lines.push(`직장인구 500m ${fmt(candidate.employ500Total, "명")}`);
  if (candidate.employ1kmTotal != null) lines.push(`직장인구 1km ${fmt(candidate.employ1kmTotal, "명")}`);
  if (candidate.facility500Households != null) lines.push(`세대수 500m ${fmt(candidate.facility500Households, "세대")}`);
  if (candidate.facility1kmHouseholds != null) lines.push(`세대수 1km ${fmt(candidate.facility1kmHouseholds, "세대")}`);
  if (candidate.licensedPcStores500m != null) lines.push(`인허가 PC방업소수 500m ${fmt(candidate.licensedPcStores500m, "개")}`);
  if (candidate.licensedPcStores1km != null) lines.push(`인허가 PC방업소수 1km ${fmt(candidate.licensedPcStores1km, "개")}`);
  if (candidate.facility500SubwayRiders != null) lines.push(`지하철 승하차 500m ${fmt(candidate.facility500SubwayRiders, "명")}`);
  if (
    candidate.facility500HighSchool != null ||
    candidate.facility500MiddleSchool != null ||
    candidate.facility500ElementarySchool != null
  ) {
    lines.push(
      `학생수 500m 고${fmt(candidate.facility500HighSchool)}/중${fmt(candidate.facility500MiddleSchool)}/초${fmt(candidate.facility500ElementarySchool)}`,
    );
  }
  return lines.length ? lines.join("\n") : "소상공인365/SGIS 참고자료 없음(아직 미수집)";
}

export function buildLocationEvalContext(input: {
  candidate: LocationEvalContextCandidate;
  competitors: Competitor[];
  demandPoints: DemandPoint[];
  adminDongReference: AdminDongReference | null;
}): string {
  const { candidate, competitors, demandPoints, adminDongReference } = input;
  return [
    `후보지명: ${candidate.name}`,
    `주소: ${candidate.roadAddress ?? candidate.address}`,
    "",
    "[행정동 인구통계 (SGIS)]",
    adminDongSummary(adminDongReference),
    "",
    "[경쟁점/수요거점 (카카오 자동수집, 실측 좌표 기준)]",
    competitorSummary(competitors),
    demandPointSummary(demandPoints),
    "",
    "[상권 참고자료 (소상공인365/SGIS 반자동 추출)]",
    marketDataSummary(candidate),
  ].join("\n");
}
