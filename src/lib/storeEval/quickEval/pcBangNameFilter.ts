// 카카오 PC방 목록에서 **PC방이 아닌 것**을 걸러낸다. (주소만 초기평가 도구 전용)
//
// ── 왜 이름 규칙인가 (2026-09-22 인계문 4절) ──────────────────────────────
// 카카오 키워드검색("PC방")은 이름에 걸린 딴 업소도 물고 온다. 성인PC방(오락기)·오락실이
// 섞이면 경쟁IP가 부풀려져 예상매출이 낮게 나온다.
//
// 인허가 짝으로 거르는 방법도 있었지만 **최근 개점한 진짜 PC방까지 뺀다** — 레드포스는
// 2024-11에 상가업소에 등재됐는데 인허가엔 아직 없다. 그래서 이름 규칙 쪽이 안전하다.
// 카카오 500m 밖 고유 상호 728개 중 26개(3.6%)가 이 규칙에 걸렸다.
//
// ⚠️ **이름 규칙이라 새 업태가 생기면 갱신해야 한다.** 규칙에 걸린 곳은 화면에 "제외됨"으로
//    이유까지 같이 보여준다 — 조용히 빼면 왜 3곳이 사라졌는지 아무도 모른다.
// ⚠️ 카카오는 **매장당 40건쯤에서 잘린다.** 그 문제는 이 파일이 아니라 kakaoPcBangs.ts의
//    격자분할 조회가 담당한다.

/** 인계문 4절 "성인PC방·오락실 거르기"의 규칙 그대로. 순서·항목을 바꾸면 결과가 달라진다. */
export const NON_PCBANG_NAME_PATTERN =
  /게임랜드|게임장|오락|성인|스크린|멀티방|다트|보드게임|만화|플스|VR|사격|당구|노래/;

export type PcBangNameVerdict = {
  /** 경쟁점으로 셀 것인가 */
  counted: boolean;
  /** 왜 뺐는지 — 화면과 AI 평가문에 그대로 싣는다. 센 경우 null */
  excludedReason: string | null;
};

/**
 * 카카오 장소 하나를 판정한다.
 *
 * 두 관문을 쓴다:
 *   1. 카카오 업종(category_name)에 "PC방"이 들어가는가 — `collectKakaoNeighborhood.mjs`가
 *      쓰는 것과 **같은 조건**이다(`realPc` 필터). 잣대를 둘로 만들지 않는다.
 *   2. 상호가 오락실·성인업태 이름 규칙에 걸리지 않는가.
 *
 * 업종 문자열이 아예 없으면(카카오가 안 줄 때) 1번은 통과시킨다 — 실체는 있는데 분류만
 * 비어 있는 경우까지 빼면 진짜 경쟁점을 놓친다. 대신 화면에 "업종 미확인"으로 표시한다.
 */
export function judgePcBangName(place: { name: string; categoryName?: string | null }): PcBangNameVerdict {
  const name = (place.name ?? "").trim();
  const category = (place.categoryName ?? "").trim();

  if (category && !category.includes("PC방")) {
    return { counted: false, excludedReason: `카카오 업종이 PC방이 아님(${category})` };
  }
  const hit = name.match(NON_PCBANG_NAME_PATTERN);
  if (hit) {
    return { counted: false, excludedReason: `상호에 "${hit[0]}"이 들어감(오락실·성인업태 규칙)` };
  }
  return { counted: true, excludedReason: null };
}

/** 업종 문자열이 비어 있어 "PC방"임을 카카오가 확인해 주지 않은 경우. 화면 경고용. */
export function hasUnknownCategory(place: { categoryName?: string | null }): boolean {
  return !(place.categoryName ?? "").trim();
}
