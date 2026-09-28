// 경쟁점 **조사표 초기값** — 인허가 자료(총게임기수·면적)로 PC 대수를 추정한다. (2026-09-28, 사용자 "이건 해봐도 되긴 할 듯")
//
// ── 어디에 쓰나 / 어디에 안 쓰나 ─────────────────────────────────────────────
// · 신규후보지 상권자료 수집(collect-market-data)이 **새로 만드는** 경쟁점 문서에 `permitHint`로 붙인다.
//   조사 칸(totalPcCount·appliedPcCount)은 건드리지 않는다 — 조사표에서 사람이 "인허가 값 넣기"를 눌러야 들어간다.
// · 기존 경쟁점 문서·기존점·주소만 초기평가는 **안 바뀐다**(사용자 확인 2026-09-28 "기존 데이터에 덮는 건 없고 신규후보지할 때만").
// · 되짚기에서 이 값을 적용대수로 쓰면 적중률이 안 오른다(V62가 경쟁IP에 둔감 — quick-eval-ceiling-automation).
//   그래서 **정확도 장치가 아니라 조사 시간을 줄이는 장치**다.
//
// ── 근거(2026-09-28, 기존점 경쟁점 168곳 대조) ────────────────────────────────
//   좌표 150m 안에서 이름 포함관계로 짝짓고(안 되면 25m 안 최근접), 영업중 기록을 우선했다 → 157곳 짝(이름 99·거리 58).
//   총게임기수(≥20) vs 실측 대수: r 0.80 · 비율 중앙 1.00 · 대수 오차 12.8%(전부 100대는 25.0%) · ±20% 안 72%.
//   면적÷2.67m² : r 0.53 · 23.8%. 게임기수 없을 때만 쓴다. 개업연도 vs 인테리어 점수 r 0.17 → 안 쓴다.
//   전국 영업중 기록 중 게임기수≥20은 35%뿐이지만 우리 경쟁점(도시 상가)에선 80%가 있었다.
// ⚠️ 색인(data/pcbang-permits-open.json)은 collectPcBangPermits → buildPcBangPermitIndex로 갱신한다. 자료 시각이 힌트 문구에 찍힌다.

import permitIndex from "./data/pcbang-permits-open.json";
import type { PcBangPermitHint } from "./types";

export type { PcBangPermitHint } from "./types";

/** 총게임기수를 대수로 믿는 최소값. 이 밑은 게임기 몇 대만 적은 기록이라 대수가 아니다(전국 중앙값 7대). */
export const PERMIT_MIN_GAME_COUNT = 20;
/** 게임기수가 없을 때 면적으로 대수를 추정하는 1대당 면적(m²) — 기존점 경쟁점 150곳 면적÷실측대수의 중앙값. */
export const PERMIT_AREA_PER_PC_M2 = 2.67;
/** 이름이 맞을 때 허용하는 거리 / 이름이 안 맞을 때 허용하는 거리(m). */
export const PERMIT_MATCH_NAME_M = 120;
export const PERMIT_MATCH_NEAR_M = 25;

type Row = [name: string, lat: number, lng: number, gameCount: number | null, areaM2: number | null, opened: string | null];
// JSON은 튜플 길이를 모르므로 unknown을 거쳐 우리 형으로 본다(buildPcBangPermitIndex.mjs가 6칸으로 쓴다).
const INDEX = permitIndex as unknown as { collectedAt: string | null; count: number; rows: Row[] };

/** 이름 정규화 — pc방·피씨·카페·공백·괄호·기호를 뺀다(핑봇 매칭과 같은 규칙). */
export function normalizePcBangName(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/pc방|피씨방|피시방|pc|피씨|피시|카페|cafe|게임|점|\s|\(.*?\)|[^0-9a-z가-힣]/g, "");
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, t = Math.PI / 180;
  const dLat = (bLat - aLat) * t, dLng = (bLng - aLng) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 0.002°(약 200m) 격자로 색인해 좌표 하나에 9칸만 본다. 모듈 로드 때 한 번 만든다.
const CELL = 500;
const cellKey = (lat: number, lng: number) => `${Math.floor(lat * CELL)}:${Math.floor(lng * CELL)}`;
let grid: Map<string, Row[]> | null = null;
function gridOf(): Map<string, Row[]> {
  if (grid) return grid;
  grid = new Map();
  for (const r of INDEX.rows) {
    const k = cellKey(r[1], r[2]);
    const list = grid.get(k);
    if (list) list.push(r); else grid.set(k, [r]);
  }
  return grid;
}

/** 대수 제안 규칙 — 순수 함수라 시험한다. */
export function suggestPcCountFromPermit(gameCount: number | null, areaM2: number | null): { count: number | null; how: "게임기수" | "면적" | null } {
  if (gameCount != null && gameCount >= PERMIT_MIN_GAME_COUNT) return { count: Math.round(gameCount), how: "게임기수" };
  if (areaM2 != null && areaM2 > 0) return { count: Math.round(areaM2 / PERMIT_AREA_PER_PC_M2), how: "면적" };
  return { count: null, how: null };
}

/** 색인 안에서 가장 그럴듯한 인허가 기록을 찾는다. 없으면 null — 지어내지 않는다. */
export function lookupPcBangPermit(
  place: { name: string; lat: number; lng: number },
  rows: Row[] | null = null,
): PcBangPermitHint | null {
  const nn = normalizePcBangName(place.name);
  const cand: { r: Row; d: number }[] = [];
  const source = rows ?? (() => {
    const g = gridOf();
    const la = Math.floor(place.lat * CELL), ln = Math.floor(place.lng * CELL);
    const out: Row[] = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = g.get(`${la + i}:${ln + j}`); if (l) out.push(...l); }
    return out;
  })();
  for (const r of source) {
    const d = haversineM(place.lat, place.lng, r[1], r[2]);
    if (d <= 150) cand.push({ r, d });
  }
  cand.sort((a, b) => a.d - b.d);
  const nameHit = cand.find((x) => {
    const np = normalizePcBangName(x.r[0]);
    return !!nn && !!np && (nn.includes(np) || np.includes(nn)) && x.d <= PERMIT_MATCH_NAME_M;
  });
  const hit = nameHit ?? cand.find((x) => x.d <= PERMIT_MATCH_NEAR_M) ?? null;
  if (!hit) return null;
  const [name, , , gameCount, areaM2, opened] = hit.r;
  const { count, how } = suggestPcCountFromPermit(gameCount, areaM2);
  const when = INDEX.collectedAt ? `${INDEX.collectedAt.slice(0, 7)} 자료` : "자료 시각 모름";
  const basis = how === "게임기수"
    ? `인허가 총게임기수 ${count}대 (${name}, ${Math.round(hit.d)}m, ${when})`
    : how === "면적"
      ? `인허가 면적 ${areaM2}m² ÷ ${PERMIT_AREA_PER_PC_M2} ≈ ${count}대 (${name}, ${Math.round(hit.d)}m, ${when}) — 게임기수 없음`
      : `인허가 기록은 있으나 게임기수·면적이 없음 (${name}, ${Math.round(hit.d)}m)`;
  return {
    source: "인허가", collectedAt: INDEX.collectedAt, name, distanceM: Math.round(hit.d),
    matchedBy: nameHit ? "name" : "distance", gameCount, areaM2, opened, suggestedPcCount: count, basis,
  };
}

/** 색인이 몇 건·언제 것인지 — 화면 문구용. */
export function describePermitIndex(): string {
  return `인허가 영업중 ${INDEX.count.toLocaleString("ko-KR")}건 · ${INDEX.collectedAt ? INDEX.collectedAt.slice(0, 10) : "시각 모름"} 자료`;
}
