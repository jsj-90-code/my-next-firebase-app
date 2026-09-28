// 입지동선평가 AI 초안(3단계, ai-location-eval 라우트)에 줄 "지도 컨텍스트" 텍스트 요약을 만든다.
// 순수 함수 — Firestore/네트워크 호출은 하지 않는다(호출부가 이미 조회해온 데이터를 그대로 넘겨받는다).
// 여기서 만드는 텍스트는 AI 프롬프트 전용 참고자료일 뿐이다 — calc.ts는 이 파일을 참조하지 않고,
// 어떤 계산에도 쓰이지 않는다(types.ts에 이미 명시된 "calc.ts는 DemandPoint를 안 읽는다" 원칙과 동일선상).
//
// 2026-09-28 사용자 결정("지금 산식에 필요 없는 거면 다 같이 빼지"): 산식에 안 들어가고 후보지에만 있던 참고자료 —
// 직장인구(500m/1km)·지하철 승하차·실영업 PC방업소수(1km)·SGIS 행정동 인구통계 — 를 이 문맥에서도 뺐다.
// 후보지마다 있다 없다 하는 값이라 AI 판단이 그 유무에 따라 흔들리는 게 더 나빴다. 기존점 40곳엔 이 필드가 없어
// 앞으로도 산식으로 검증할 수 없다. 저장 필드·Firestore 문서는 그대로 두고 화면·문맥에서만 뺐다.

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
  | "operatingPcStores500m"
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

// 산식이 실제로 읽는 두 값(유동인구 500m·실영업 PC방업소수 500m)만 적는다 — 값이 있는 항목만.
function marketDataSummary(candidate: LocationEvalContextCandidate): string {
  const lines: string[] = [];
  if (candidate.floating500Avg != null) lines.push(`유동인구 500m 일평균 ${fmt(candidate.floating500Avg, "명")}`);
  if (candidate.operatingPcStores500m != null) lines.push(`실영업 PC방업소수 500m ${fmt(candidate.operatingPcStores500m, "개")}`);
  return lines.length ? lines.join("\n") : "상권 참고자료 없음(아직 미수집)";
}

export function buildLocationEvalContext(input: {
  candidate: LocationEvalContextCandidate;
  competitors: Competitor[];
  demandPoints: DemandPoint[];
  /** @deprecated 2026-09-28부터 안 읽는다(옛 호출부·하네스 호환용으로만 남김). */
  adminDongReference?: AdminDongReference | null;
}): string {
  const { candidate, competitors, demandPoints } = input;
  return [
    `후보지명: ${candidate.name}`,
    `주소: ${candidate.roadAddress ?? candidate.address}`,
    "",
    "[경쟁점/수요거점 (카카오 자동수집, 실측 좌표 기준)]",
    competitorSummary(competitors),
    demandPointSummary(demandPoints),
    "",
    "[상권 참고자료 (산식 입력값)]",
    marketDataSummary(candidate),
  ].join("\n");
}
