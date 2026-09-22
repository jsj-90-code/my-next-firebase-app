// 카카오 장소검색으로 반경 안 PC방을 **빠짐없이** 모은다. (주소만 초기평가 도구 전용 · 서버)
//
// ── 왜 카카오인가 (2026-09-22 인계문 4절, 사용자 확인) ────────────────────
// 실체 판정 순위는 **카카오 > 소상공인 상가업소 > 인허가**다. 상가업소도 인허가도 폐업을
// 못 따라온다 — 구리돌다리 자동목록 10곳 중 7곳이 폐업 추정이었고 카카오엔 하나도 없었다.
// 사용자가 실제 경쟁점으로 꼽은 4곳은 카카오에 전부 있었다. 500m 채점에서도 카카오는
// 사람이 조사한 실재 273건 중 270건(99%)을 맞혔다.
//
// ── ⚠️ 카카오의 약점 — 40건 상한 ─────────────────────────────────────────
// 키워드검색은 한 질의당 최대 45건(3쪽×15)에서 잘린다. 조밀한 도시 매장이 **덜 세어지고**,
// 그게 하필 경쟁을 과소평가하는 방향이다. 인계문이 "격자로 쪼개 조회하면 우회된다 —
// 아직 안 해 봤다. 자동화 도구를 만들면 여기부터 손보는 게 값이 크다"고 지목한 자리다.
//
// 그래서 여기서 **잘리면 쪼갠다**: 원 하나로 부르고, 카카오가 "더 있다"고 하면 중심 + 6방위
// 부채로 나눠 각각 다시 부른 뒤 장소 id로 합친다. 재귀 깊이는 2단계로 제한한다(질의 수가
// 1 -> 7 -> 49로 늘어나므로). 각 하위 원은 상위 반경의 0.6배이고 중심을 0.55배만큼 밀어
// 서로 겹치게 둔다 — 겹침은 중복 제거로 지워지지만 틈은 지워지지 않는다.
//
// ⚠️ 이 모듈은 **서버에서만** 부른다(KAKAO_REST_API_KEY가 필요하다).

const KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const PAGE_SIZE = 15;
const MAX_PAGES = 3; // 카카오 키워드검색 상한
const SPLIT_DEPTH_LIMIT = 2;
const EARTH_R = 6378137;

export type KakaoPcBangPlace = {
  id: string;
  name: string;
  categoryName: string | null;
  address: string | null;
  lat: number;
  lng: number;
  /** 후보지 좌표 기준 직선거리(m). 카카오가 준 distance가 아니라 우리가 다시 잰다 —
   *  격자분할하면 카카오의 distance는 하위 원 중심 기준이라 뜻이 달라진다. */
  distanceM: number;
};

export type KakaoPcBangResult = {
  places: KakaoPcBangPlace[];
  /** 카카오에 던진 질의 수 — 격자분할이 실제로 몇 번 일어났나 */
  queryCount: number;
  /** 끝까지 잘린 구역이 남았는가. true면 목록이 완전하지 않을 수 있다(화면에 경고) */
  possiblyTruncated: boolean;
};

type KakaoDoc = {
  id?: string;
  place_name?: string;
  category_name?: string;
  road_address_name?: string;
  address_name?: string;
  x?: string;
  y?: string;
};

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 중심에서 방위 bearing(도)으로 distM만큼 밀어낸 점. 격자분할용. */
function offsetPoint(center: { lat: number; lng: number }, bearingDeg: number, distM: number) {
  const dLat = (distM * Math.cos((bearingDeg * Math.PI) / 180)) / EARTH_R;
  const dLng =
    (distM * Math.sin((bearingDeg * Math.PI) / 180)) / (EARTH_R * Math.cos((center.lat * Math.PI) / 180));
  return { lat: center.lat + (dLat * 180) / Math.PI, lng: center.lng + (dLng * 180) / Math.PI };
}

async function queryOnce(
  apiKey: string,
  center: { lat: number; lng: number },
  radiusM: number,
): Promise<{ docs: KakaoDoc[]; truncated: boolean }> {
  const docs: KakaoDoc[] = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      query: "PC방",
      x: String(center.lng),
      y: String(center.lat),
      radius: String(Math.round(radiusM)),
      page: String(page),
      size: String(PAGE_SIZE),
      sort: "distance",
    });
    const res = await fetch(`${KAKAO_KEYWORD_URL}?${params}`, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`카카오 장소검색 HTTP ${res.status}`);
    const json = (await res.json()) as { documents?: KakaoDoc[]; meta?: { is_end?: boolean; pageable_count?: number } };
    docs.push(...(json.documents ?? []));
    if (json.meta?.is_end !== false) break;
    // 3쪽을 다 읽었는데도 끝이 아니면 잘린 것이다 — 쪼개야 한다.
    if (page === MAX_PAGES) truncated = true;
  }
  return { docs, truncated };
}

/**
 * 반경 안 PC방을 모은다. 잘리면 격자로 쪼개 다시 부른다.
 *
 * ⚠️ 여기서는 **거르지 않는다.** 오락실·성인업태 판정은 `pcBangNameFilter.ts`가 하고,
 *    화면이 "제외됨"으로 이유까지 보여준다. 수집 단계에서 조용히 빼면 왜 사라졌는지 모른다.
 */
export async function collectKakaoPcBangs(
  origin: { lat: number; lng: number },
  radiusM: number,
): Promise<KakaoPcBangResult> {
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) throw new Error("KAKAO_REST_API_KEY가 설정되지 않았습니다.");

  const byId = new Map<string, KakaoPcBangPlace>();
  let queryCount = 0;
  let possiblyTruncated = false;

  const visit = async (center: { lat: number; lng: number }, radius: number, depth: number): Promise<void> => {
    queryCount++;
    const { docs, truncated } = await queryOnce(apiKey, center, radius);
    for (const d of docs) {
      const id = d.id == null ? "" : String(d.id);
      const lat = Number(d.y);
      const lng = Number(d.x);
      // 좌표나 id가 없는 문서는 지어내지 말고 버린다(kakao.ts가 겪은 NaN 함정과 같은 이유).
      if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const distanceM = Math.round(haversineM(origin, { lat, lng }));
      // 하위 원이 상위 반경 밖으로 삐져나가므로 최종 반경으로 다시 자른다.
      if (distanceM > radiusM) continue;
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: String(d.place_name ?? "").trim(),
          categoryName: d.category_name?.trim() || null,
          address: (d.road_address_name || d.address_name || "").trim() || null,
          lat,
          lng,
          distanceM,
        });
      }
    }
    if (!truncated) return;
    if (depth >= SPLIT_DEPTH_LIMIT) {
      possiblyTruncated = true;
      return;
    }
    const childRadius = radius * 0.6;
    const childShift = radius * 0.55;
    await visit(center, childRadius, depth + 1);
    for (const bearing of [0, 60, 120, 180, 240, 300]) {
      await visit(offsetPoint(center, bearing, childShift), childRadius, depth + 1);
    }
  };

  await visit(origin, radiusM, 0);

  const places = [...byId.values()].sort((a, b) => a.distanceM - b.distanceM);
  return { places, queryCount, possiblyTruncated };
}
