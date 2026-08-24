// 상권자료 자동수집 파이프라인의 화면 상태값 — 4단계(신규후보지 상권자료 자동화) 전체에서
// 공유한다. 1단계에서는 "수집 전"/"자동수집 완료"/"수집 실패"만 실제로 쓰이고, 나머지 셋은
// 2~4단계(SGIS/소상공인365 반자동 업로드, AI평가 승인)에서 쓰인다.
export type MarketDataStatus =
  | "수집 전"
  | "자동수집 완료"
  | "원본자료 필요"
  | "사용자 확인 필요"
  | "수집 실패"
  | "검증 완료";

export type MarketDataGroupKey =
  | "geocode" // 주소/좌표
  | "adminDongReference" // 행정구역 참고자료(SGIS 행정동)
  | "demandPoints" // 경쟁점 외 수요거점(카카오 자동수집)
  | "competitors"; // PC방 경쟁점(카카오 자동수집분 포함)

export const MARKET_DATA_GROUP_LABELS: Record<MarketDataGroupKey, string> = {
  geocode: "주소/좌표",
  adminDongReference: "행정구역 참고자료",
  demandPoints: "주변 수요거점",
  competitors: "주변 경쟁점(PC방)",
};
