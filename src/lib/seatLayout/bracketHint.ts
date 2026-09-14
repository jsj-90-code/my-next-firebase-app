// PDF 페이지 썸네일에서 "가방 선반 브라켓 표시"가 있는 페이지를 짚어준다 (2026-09-14 신설).
//
// 왜 만들었나 — 브라켓 표시가 없는 페이지로 작업하는 일이 있었다. 처음에는 "보통 3페이지"라고
// 안내하려 했는데 **사용자가 본 PDF가 3건뿐**이라 일반화할 근거가 못 된다("PDF 어떻게 주냐에 따라
// 틀릴 수 있다"). 페이지 번호는 주는 쪽의 관례일 뿐이지만 **표시의 색은 도면 자체의 성질**이다.
//
// ⚠️ **첫 판은 실패했다. 실제 도면으로 재서 고쳤다.**
//
// 처음에는 "주황·빨강"을 통째로 셌는데 실제 도면에서는 **아무 페이지도 못 짚었다**. 이유는
// 실측으로 드러났다 — **빨강은 모든 페이지에 있다**(치수선·주석·제목). 평택소사벌점 PDF 10장
// 전부가 붉은 계열 0.68~4.34%였고, 1등과 2등 차이가 1.14배뿐이라 조건을 못 넘었다.
//
// 페이지를 가르는 건 **순수 빨강이 아니라 주황**이었다. 붉은 계열 중 g/r이 0.30~0.40인 띠만
// 세면 브라켓 페이지가 확연히 뜬다(실측, 앱과 같은 260px 썸네일 기준):
//
//   | PDF | 브라켓 페이지 | 2등 | 배수 |
//   |---|---:|---:|---:|
//   | 26.07.27 평택소사벌점 (10장) | 3페이지 **1.61%** | 0.34% | 4.7배 |
//   | 26.06.23 광주첨단점 (11장)   | 3페이지 **0.65%** | 0.22% | 2.9배 |
//
// 재현: `node .local-tools/verify-bracket-rule.mjs` (git 제외, 로컬 도면 필요).
//
// ⚠️ **이건 힌트지 판정이 아니다.** 고르는 건 사람이다. 표본이 실제 도면 2건뿐이라 다른 형식의
// PDF에서는 못 짚을 수 있다 — 그때는 **조용히 아무 말도 안 한다**(잘못 짚는 것보다 낫다).

/**
 * 브라켓 표시로 볼 만한 **주황**. 순수 빨강(g/r≈0)은 일부러 뺀다 — 도면 전체에 깔려 있어서
 * 세면 모든 페이지가 비슷해진다(위 주석의 실패 참고).
 */
export function isBracketLikeColor(r: number, g: number, b: number): boolean {
  // 붉은 계열 먼저 — 너무 어두운 글씨·그림자와 파랑/초록 계열을 뺀다.
  if (r < 100 || r - b < 60 || r - g < 20) return false;
  // 그중 주황 띠만. 아래는 순수 빨강(주석·치수선), 위는 살구/노랑 계열이라 뺀다.
  const orangeness = g / r;
  return orangeness >= 0.3 && orangeness < 0.4;
}

/**
 * RGBA 픽셀 배열에서 브라켓 같은 색의 비율(0~1). 썸네일 크기가 페이지마다 달라도 비교되도록
 * 개수가 아니라 비율로 돌려준다.
 */
export function bracketColorRatio(rgba: Uint8ClampedArray | number[]): number {
  const px = Math.floor(rgba.length / 4);
  if (px === 0) return 0;
  let hit = 0;
  let opaque = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    // 투명한 곳은 분모에서도 뺀다 — 여백이 많은 페이지가 유리해지면 안 된다.
    if (rgba[i + 3] < 128) continue;
    opaque += 1;
    if (isBracketLikeColor(rgba[i], rgba[i + 1], rgba[i + 2])) hit += 1;
  }
  return opaque === 0 ? 0 : hit / opaque;
}

/**
 * 이 아래면 짚지 않는다. **실측으로 정한 값이다** — 브라켓 페이지는 0.65%·1.61%였고, 브라켓이
 * 없는 페이지 중 가장 높은 것이 0.34%였다. 그 사이를 넉넉히 갈랐다.
 * 올리면 놓치고(=침묵, 손해 없음), 내리면 헛짚는다(=엉뚱한 페이지를 고르게 함). 그래서 높게 잡았다.
 */
export const BRACKET_HINT_MIN_RATIO = 0.004;

/** 1등이 2등보다 이만큼은 진해야 짚는다. 실측 최소가 2.94배였다. */
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
