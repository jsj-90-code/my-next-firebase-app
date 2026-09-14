// PDF 페이지 썸네일에서 "가방 선반 브라켓 표시 같은 것"이 있는 페이지를 짚어준다 (2026-09-14 신설).
//
// 왜 만들었나 — 브라켓 표시가 없는 페이지로 작업하는 일이 있었다. 처음에는 "보통 3페이지"라고
// 안내하려 했는데 **사용자가 본 PDF가 3건뿐**이라 일반화할 근거가 못 된다("PDF 어떻게 주냐에 따라
// 틀릴 수 있다"). 페이지 번호는 관례일 뿐이지만 **표시의 색은 도면 자체의 성질**이다. 그래서
// 번호로 찍어주지 않고 썸네일을 직접 보고 짚는다.
//
// ⚠️ 이건 **힌트지 판정이 아니다.** 고르는 건 사람이다. 빨간 로고·붉은 글씨 같은 것도 걸릴 수
// 있으므로 화면 문구도 "~일 수 있음" 수준으로만 말한다.

/** 브라켓 표시로 볼 만한 주황·빨강. 어두운 글씨(#8b0000류)나 살구색 배경은 빼려고 폭을 좁혔다. */
export function isBracketLikeColor(r: number, g: number, b: number): boolean {
  // 너무 어둡거나(검은 선) 너무 밝으면(종이·연한 배경) 제외.
  const max = Math.max(r, g, b);
  if (max < 110 || (r > 235 && g > 235 && b > 235)) return false;
  // 빨강이 다른 두 채널보다 뚜렷하게 높아야 한다 — 주황(r>g>b)과 빨강(r≫g,b)을 함께 잡는다.
  return r - g >= 45 && r - b >= 55 && g >= b - 25;
}

/**
 * RGBA 픽셀 배열에서 브라켓 같은 색의 비율(0~1). 썸네일 크기가 페이지마다 달라도 비교되도록
 * 개수가 아니라 비율로 돌려준다.
 */
export function bracketColorRatio(rgba: Uint8ClampedArray | number[]): number {
  const px = Math.floor(rgba.length / 4);
  if (px === 0) return 0;
  let hit = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    // 투명한 곳은 센다고 의미가 없다.
    if (rgba[i + 3] < 128) continue;
    if (isBracketLikeColor(rgba[i], rgba[i + 1], rgba[i + 2])) hit += 1;
  }
  return hit / px;
}

/**
 * 그 색이 "우연히 조금 있는" 수준을 넘어야 힌트를 띄운다. 도면은 대부분 흑백선이라
 * 실제 브라켓 표시가 있으면 이 정도는 넘는다. 값을 올리면 놓치고, 내리면 헛짚는다.
 */
export const BRACKET_HINT_MIN_RATIO = 0.0015;

/** 1등이 2등보다 이만큼은 진해야 "이 페이지"라고 짚는다. 비슷하면 안 짚는 게 낫다. */
export const BRACKET_HINT_MIN_LEAD = 1.8;

export type PageScore = { pageNumber: number; ratio: number };

/**
 * 짚을 페이지 하나. 조건을 못 넘으면 **null을 돌려주고 화면은 아무 표시도 하지 않는다** —
 * 애매할 때 아무 페이지나 가리키면 오히려 잘못 고르게 만든다.
 */
export function pickLikelyBracketPage(scores: PageScore[]): number | null {
  if (scores.length === 0) return null;
  const sorted = [...scores].sort((a, b) => b.ratio - a.ratio);
  const top = sorted[0];
  if (top.ratio < BRACKET_HINT_MIN_RATIO) return null;
  const second = sorted[1];
  if (second && second.ratio > 0 && top.ratio / second.ratio < BRACKET_HINT_MIN_LEAD) return null;
  return top.pageNumber;
}
