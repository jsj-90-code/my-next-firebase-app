// AI 입지평가에 줄 자료에 **물건 정보(층·엘리베이터)**를 덧붙인다. (주소만 초기평가 전용 · 순수함수)
//
// ── 왜 필요했나 (2026-09-22, 사용자 지적 "층수는 입력해도 되지 않을까") ────
// 두 가지가 동시에 비어 있었다:
//
//   1. `computeOwnLocationScore`는 **입지평가가 있으면 그걸 쓰고, 없을 때만** 층수+엘리베이터로
//      폴백한다(calc.ts). 이 도구는 AI 입지평가를 항상 돌리므로 층수가 계산에 안 들어갔다.
//   2. `buildLocationEvalContext`(운영 공용)가 주는 자료에 **층수가 없다.** 그래서 AI도 2층인지
//      1층인지 모르는 채로 접근가시성을 매기고 있었다.
//
// => 층수를 넣어도 예상매출이 안 바뀌는 상태였다. 그걸 고친다: 층·엘리베이터를 AI에게 사실로
//    넘겨서 **가시성·선점 판단에 반영**되게 한다. 그러면 층수 입력이 실제로 결과를 움직인다.
//
// ⚠️ 운영 공용 함수(`locationEvalContext.ts`)를 고치지 않는다 — 그걸 건드리면 신규후보지·기존점
//    AI 채점의 입력이 같이 바뀐다. 여기서 **뒤에 덧붙이는 방식**만 쓴다.
// ⚠️ 모르는 값은 "모름"으로 적는다. 비워 두면 AI가 1층으로 가정해 후하게 매길 수 있다.

import type { GroundLevel } from "../types";

export type QuickEvalSiteFacts = {
  floor: number | null;
  groundLevel: GroundLevel | null;
  hasElevator: boolean | null;
};

/** 사람이 읽는 한 줄로. AI에게도 이 문장 그대로 간다. */
export function describeSiteFacts(facts: QuickEvalSiteFacts): string {
  const floorText =
    facts.floor == null ? "층수 모름" : `${facts.groundLevel ?? "지상"} ${facts.floor}층`;
  const elevatorText =
    facts.hasElevator == null ? "엘리베이터 모름" : facts.hasElevator ? "엘리베이터 있음" : "엘리베이터 없음";
  return `${floorText} · ${elevatorText}`;
}

/**
 * 운영 공용 컨텍스트 뒤에 물건 정보 블록을 붙인다.
 *
 * 층수가 접근가시성(간판·입구·계단)에 직결된다는 걸 AI에게 분명히 말해 준다 — 사실만 주고
 * 판단은 AI가 하게 두되, **모르면 모른다고 적어** 후하게 가정하지 않게 한다.
 */
export function appendSiteFactsToContext(baseContext: string, facts: QuickEvalSiteFacts): string {
  const lines = [
    baseContext,
    "",
    "[후보지 물건 정보 — 접근가시성 판단에 반드시 반영할 것]",
    describeSiteFacts(facts),
  ];
  if (facts.floor == null) {
    lines.push(
      "⚠️ 층수가 확인되지 않았다. 1층으로 가정하지 말고, 층수를 모른다는 전제에서 접근가시성을 보수적으로 매겨라.",
    );
  } else if (facts.floor >= 2 || facts.groundLevel === "지하") {
    lines.push(
      "⚠️ 1층이 아니다. 간판 노출과 진입 동선(계단·엘리베이터)이 1층보다 불리하다는 점을 접근가시성에 반영하라.",
    );
  }
  // ⭐ 2026-09-23 저녁 — 외부유입제한 "강함" 기준(사용자 승인, 광명 범안로 1059 건).
  //    운영 공용 지시문엔 강함의 기준이 없어서 AI가 "역세권과 떨어져 있다"만으로 강함을 줬다.
  //    강함은 매출 −20%(settings.inflowAdjustment)라 이것 하나로 1,000만원이 움직인다. 사람 평가
  //    54곳 중 강함은 3곳(구미산동·전대상대·인천서창)뿐이다. ⚠️ 이 도구 전용 — 공용 지시문은 안 고친다.
  lines.push(
    "",
    "[외부유입제한 판정 기준 — 반드시 지킬 것]",
    "- '강함'은 산업단지·군부대 안쪽, 큰 도로·하천·철길로 끊긴 고립 단지처럼 **바깥 동네 손님이 사실상 못 오는 곳**에만 준다.",
    "- 역에서 멀다, 주거 위주 상권이다, 대단지 배후 상권이다 — 이것만으로는 '강함'이 아니다('보통' 또는 '없음').",
    "- 확신이 없으면 '보통'으로 둔다.",
  );
  return lines.join("\n");
}
