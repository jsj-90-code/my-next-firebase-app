import type { DemandPointCategory } from "./types";

// 카카오 반경검색으로 자동수집 가능한 수요거점 타깃 목록. collect-market-data 라우트(신규후보지
// 1단계)와 ai-validation-run 라우트(4단계, 기존 매장 검증)가 공유한다 — 두 곳이 서로 다른 목록을
// 쓰면 "같은 조건으로 비교"라는 검증의 전제가 깨진다.
export const DEMAND_POINT_TARGETS: (
  | { kind: "category"; code: string; category: DemandPointCategory; radiusM: number }
  | { kind: "keyword"; keyword: string; category: DemandPointCategory; radiusM: number }
)[] = [
  { kind: "category", code: "SW8", category: "지하철역", radiusM: 1000 },
  { kind: "keyword", keyword: "버스정류장", category: "버스정류장", radiusM: 500 },
  { kind: "category", code: "SC4", category: "학교", radiusM: 1000 },
  { kind: "keyword", keyword: "대학교", category: "대학", radiusM: 2000 },
  { kind: "keyword", keyword: "아파트", category: "아파트단지", radiusM: 1000 },
  { kind: "category", code: "MT1", category: "대형상업시설", radiusM: 1500 },
  { kind: "keyword", keyword: "백화점", category: "대형상업시설", radiusM: 2000 },
];
// 군부대/산업단지/관광유흥/먹자상권은 카카오 카테고리·키워드로 신뢰성 있게 자동수집하기 어려워
// 범위에서 제외했다 — AI 판단(웹검색) 단계에서 보완한다.

export const NEARBY_PC_RADIUS_M = 500;
