// 2km 경쟁점 — 평가창에 맞춰 영업 비중을 매긴다 (2026-09-22 밤 채택)
//
// ── 무엇을 하나 ───────────────────────────────────────────────────────────
// `data/rival2km.json`에는 지점마다 "500m 밖 ~ 2km 안에 실제로 있는 PC방"과 그 인허가
// 날짜가 들어 있다(`scripts/buildRival2kmSnapshot.mjs`가 만든다). 여기서는 매장의
// **평가창**에 맞춰 각 경쟁점이 그 기간에 몇 달이나 영업했는지를 매긴다.
//
// ── 왜 500m 밖만인가 ──────────────────────────────────────────────────────
// 500m 안은 **사람이 조사한 공식 경쟁점 DB**가 이미 센다. 같은 가게를 두 번 세면 안 된다.
// 그래서 이 자료는 500m 밖만 담는다(생성기에서 걸러 둔다).
//
// ── ⚠️ 대수는 여기서 안 정한다 ────────────────────────────────────────────
// 인허가에도 지도에도 **PC 대수가 없다**. 운영과 같은 미조사 기본대수를 산식이 쓴다.
// 2026-09-22에 하루 종일 파고도 못 풀었다 — 우리 매장은 규격형이라 면적→대수를 못 재고
// (R²=0.064), 조사 경쟁점은 61대 이상만 있어 소형 구간이 외삽이며, 인허가 총게임기수는
// 작은 값이 가짜다(사용자 확인). 자세한 건 `docs/handoff-20260922-night.md`.
//
// ── 성적 (기존점 40곳 · 가동률 기준 · 2026-09-22) ─────────────────────────
//   안 셀 때   MAE 7.72%p · 최악 24.07%p · 편향 +3.28%p · ±5%p 15/40 · 퍼짐 1.76배 · 잘림 3곳
//   셀 때      MAE 6.26%p · 최악 17.68%p · 편향 -0.63%p · ±5%p 19/40 · 퍼짐 1.46배 · 잘림 0곳
// 여섯 지표가 전부 좋아지고 **고른 계수가 하나도 없다**. 근거와 기각한 대안들은
// `_rival2kmJoin.test.ts`에 있다.
import raw from "./data/rival2km.json";

export type Rival2kmRecord = {
  name: string | null;
  lat: number;
  lng: number;
  distanceM: number;
  /** 인허가에서 찾은 상호. 짝을 못 찾았으면 null이다. */
  permitName: string | null;
  open: string | null;
  close: string | null;
  restFrom: string | null;
  restTo: string | null;
};

type Rival2kmFile = {
  builtAt: string;
  source: Record<string, string>;
  officialRadiusM: number;
  outerRadiusM: number;
  sites: Record<string, { code: string | null; name: string | null; rivals: Rival2kmRecord[] }>;
};

const FILE = raw as unknown as Rival2kmFile;

/** 이 자료가 언제 만들어졌나 — 화면이 그대로 보여 준다(낡으면 티가 나야 한다). */
export const RIVAL_2KM_BUILT_AT = FILE.builtAt;
export const RIVAL_2KM_SOURCE = FILE.source;
export const RIVAL_2KM_OFFICIAL_RADIUS_M = FILE.officialRadiusM;
export const RIVAL_2KM_OUTER_RADIUS_M = FILE.outerRadiusM;

/**
 * 평가창 12달 중 이 경쟁점이 영업한 달의 비중(0~1).
 *
 * · 창 중간에 닫았으면 그동안은 실제로 경쟁했으므로 **그만큼만** 센다. 켜고 끄는 이분법이 아니다.
 * · 인허가 짝이 없으면(시점을 모르면) **1을 준다 — 세는 쪽이다.**
 *   자료가 없다고 경쟁점을 빼면 그게 편향이 된다(빼는 쪽이 아니라 세는 쪽이 보수적이다).
 * · 인허가일자가 없으면 창 시작 전부터 있었다고 본다. 같은 이유다.
 * · 휴업 구간은 영업하지 않은 달로 뺀다.
 *
 * `months`는 "YYYY-MM" 배열이다(`evaluationMonths`). 달 안의 날짜까지는 따지지 않는다 —
 * 자료의 자가 달 단위다.
 */
export function operatingShareInWindow(r: Rival2kmRecord, months: readonly string[]): number {
  if (!months.length) return 0;
  if (!r.permitName) return 1;                       // 시점을 모른다 -> 뺀다가 아니라 센다
  const open = r.open ? r.open.slice(0, 7) : "0000-00";
  const close = r.close ? r.close.slice(0, 7) : null;
  const rf = r.restFrom ? r.restFrom.slice(0, 7) : null;
  const rt = r.restTo ? r.restTo.slice(0, 7) : null;
  let n = 0;
  for (const m of months) {
    if (m < open) continue;                          // 아직 안 열었다
    if (close && m > close) continue;                // 이미 닫았다
    if (rf && m >= rf && (!rt || m <= rt)) continue; // 휴업 중
    n++;
  }
  return n / months.length;
}

/** 지점 열쇠 — 수집기가 쓰는 것과 같다. */
export const existingSiteKey = (storeCode: string) => `existing:${storeCode}`;
export const candidateSiteKey = (candidateCode: string) => `candidate:${candidateCode}`;

/** 그 지점의 500m 밖 경쟁점 원본. 자료가 없으면 빈 배열(조용히 0을 주는 게 아니라 없는 것이다). */
export function rival2kmRecords(siteKey: string): Rival2kmRecord[] {
  return FILE.sites[siteKey]?.rivals ?? [];
}

/** 자료가 아예 없는 지점인가 — 화면이 "이 매장은 2km를 못 셌다"고 말할 수 있어야 한다. */
export function hasRival2km(siteKey: string): boolean {
  return FILE.sites[siteKey] != null;
}

export type Rival2kmApplied = {
  name: string | null;
  distanceM: number;
  /** 평가창 영업 비중을 곱하기 **전**의 대수 몫 — 부르는 쪽이 기본대수를 곱한다. */
  share: number;
};

/**
 * 산식에 넣을 형태로 추린다. 영업 비중이 0인 경쟁점(평가창에 없던 곳)은 빠진다.
 *
 * ⚠️ 후보지는 **평가창이 없다**(아직 개점 전). 그때는 months를 빈 배열로 주지 말고
 *    `candidateRival2km`를 써라 — "지금 영업 중"이 맞는 값이다.
 */
export function rival2kmForWindow(siteKey: string, months: readonly string[]): Rival2kmApplied[] {
  return rival2kmRecords(siteKey)
    .map((r) => ({ name: r.name, distanceM: r.distanceM, share: operatingShareInWindow(r, months) }))
    .filter((r) => r.share > 0);
}

/**
 * 후보지용 — 평가창이 없으므로 **지금 영업 중인 곳만** 센다.
 * 개점 시점의 경쟁 환경이 그것이기 때문이다. 인허가 짝이 없으면(시점을 몰라도) 센다.
 */
export function candidateRival2km(siteKey: string): Rival2kmApplied[] {
  return rival2kmRecords(siteKey)
    .filter((r) => !r.close)
    .map((r) => ({ name: r.name, distanceM: r.distanceM, share: 1 }));
}

// ── 새 후보지의 2km 경쟁점 — Firestore 문서 (2026-09-28) ─────────────────────
//
// 이 파일의 JSON은 스크립트로 만들어 커밋하는 코드 자료라, 새 후보지를 등록하면 사람이 스크립트를 돌리기 전까지
// 2km 경쟁점이 통째로 빠진 채 계산됐다(김포라베니체점: 7,985만 → 자료 넣자 6,849만). 사용자 2026-09-28
// "등록할 때 실험실 산식이 같이 안 뜨는 게 불편" → 상권자료 수집 라우트가 카카오 2km 목록을 이 문서에 저장하고,
// JSON에 없는 후보지만 이 문서로 대신한다. **JSON에 있는 지점(기존점 40곳·옛 후보지)은 그대로 JSON**이라
// 자사 성적은 한 자리도 안 움직인다. 후보지는 평가창이 없어 인허가 시점이 필요 없고 "지금 영업 중"(카카오 실체)만 세면 된다.
export const CANDIDATE_RIVAL_2KM_COLLECTION = "storeEvalCandidateRival2km";

export type CandidateRival2kmDoc = {
  candidateCode: string;
  collectedAt: number;
  radiusM: number;
  /** 카카오 목록이 끝까지 잘렸으면 true — 화면이 "완전하지 않을 수 있다"고 말할 수 있어야 한다. */
  possiblyTruncated: boolean;
  rivals: { name: string; lat: number; lng: number; distanceM: number; sourcePlaceId: string }[];
};

/** 문서 → 산식 형태. 500m 안은 사람이 조사한 경쟁점 DB가 이미 세므로 뺀다(JSON과 같은 규칙, officialRadiusM). */
export function candidateRival2kmFromDoc(doc: CandidateRival2kmDoc): Rival2kmApplied[] {
  return doc.rivals
    .filter((r) => r.distanceM > RIVAL_2KM_OFFICIAL_RADIUS_M && r.distanceM <= RIVAL_2KM_OUTER_RADIUS_M)
    .map((r) => ({ name: r.name, distanceM: r.distanceM, share: 1 }));
}

/**
 * 후보지 한 곳의 2km 경쟁점 — JSON(코드 자료)이 있으면 그것, 없으면 Firestore 문서(등록 때 자동 수집).
 * 둘 다 없으면 빈 배열이고 그건 "0곳"이 아니라 "못 셌다"다(화면이 구분해 적는다).
 */
export function candidateRival2kmWithFallback(candidateCode: string, byCode?: Map<string, Rival2kmApplied[]>): Rival2kmApplied[] {
  const key = candidateSiteKey(candidateCode);
  if (hasRival2km(key)) return candidateRival2km(key);
  return byCode?.get(candidateCode) ?? [];
}

/** 500m 밖~2km 경쟁점 수 — 자료가 아예 없으면 null("못 셌다"), 있으면 0 이상. "2km 안 PC방 0곳" 판정(주거 상권 반경 검토)에 쓴다. */
export function candidateRival2kmCount(candidateCode: string, byCode?: Map<string, Rival2kmApplied[]>): number | null {
  const key = candidateSiteKey(candidateCode);
  if (hasRival2km(key)) return candidateRival2km(key).length;
  const v = byCode?.get(candidateCode);
  return v ? v.length : null;
}
