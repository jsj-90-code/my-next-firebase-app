// 카카오 Local API 서버 클라이언트 — 주소↔좌표 변환, 카테고리/키워드 장소검색.
// REST API 키는 서버 전용 환경변수(KAKAO_REST_API_KEY)로만 읽는다(NEXT_PUBLIC_ 접두사 없음 —
// 프론트엔드에 노출하지 않는다). 지도 렌더링용 JS SDK 공개키(NEXT_PUBLIC_KAKAO_MAP_JS_KEY)는
// 이 파일과 무관하며 클라이언트 컴포넌트에서 별도로 쓴다(카카오 콘솔에서 도메인 제한을 걸어
// 발급하는 게 정상 — REST 키와 성격이 다르다).

const KAKAO_LOCAL_BASE = "https://dapi.kakao.com/v2/local";

/** 카카오가 문자열로 주는 좌표를 숫자로. 값이 없거나 빈 문자열이면 null이다 —
 * Number("")는 0이라, 그냥 Number()로 바꾸면 좌표 누락이 "위도 0, 경도 0"(기니만 앞바다)이 된다. */
function toCoord(value: unknown): number | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function getKakaoRestKey(): string | null {
  return process.env.KAKAO_REST_API_KEY || null;
}

type KakaoLocalResponse<TDocument> = {
  documents?: TDocument[];
  meta?: { is_end?: boolean };
};

type KakaoAddressDocument = {
  x?: string;
  y?: string;
  address?: { address_name?: string | null } | null;
  road_address?: { address_name?: string | null; building_name?: string | null } | null;
};

type KakaoPlaceDocument = {
  id?: string;
  place_name?: string;
  category_group_code?: string;
  x?: string;
  y?: string;
  distance?: string;
};

async function kakaoGet<TDocument>(
  path: string,
  params: Record<string, string>,
): Promise<KakaoLocalResponse<TDocument>> {
  const key = getKakaoRestKey();
  if (!key) throw new Error("KAKAO_REST_API_KEY가 설정되지 않았습니다.");
  const url = `${KAKAO_LOCAL_BASE}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`카카오 API 요청 실패 (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as KakaoLocalResponse<TDocument>;
}

export type GeocodeResult = {
  roadAddress: string | null;
  jibunAddress: string | null;
  lat: number;
  lng: number;
  buildingName: string | null;
};

async function geocodeAddressExact(trimmed: string): Promise<GeocodeResult | null> {
  const data = await kakaoGet<KakaoAddressDocument>("/search/address.json", { query: trimmed });
  const doc = data?.documents?.[0];
  if (!doc) return null;
  const road = doc.road_address;
  const jibun = doc.address;
  const lat = toCoord(doc.y);
  const lng = toCoord(doc.x);
  // 좌표가 없는 결과는 "찾았다"고 하면 안 된다 — NaN이나 0,0 좌표가 후보지에 저장되면 이후
  // 거리·수요 계산이 조용히 망가진다. 못 찾은 것으로 처리해서 사용자가 직접 지정하게 한다.
  if (lat == null || lng == null) return null;
  return {
    roadAddress: road?.address_name ?? null,
    jibunAddress: jibun?.address_name ?? null,
    lat,
    lng,
    buildingName: road?.building_name || null,
  };
}

/**
 * 주소 → 좌표. 매칭되는 결과가 없으면 null을 반환한다 — 추정 좌표를 만들어내지 않는다.
 * 지번/도로명 주소 모두 지원(카카오 주소검색 API 자체 동작).
 *
 * 2026-08-25 확인 — 카카오 주소검색은 건물 뒤에 붙는 상세정보가 "221호"처럼 단일 호수면 문제
 * 없지만, "221~223호"(범위)나 "403,404호"(나열)처럼 복수 호실을 표기하면 매칭에 실패한다
 * (실제 기존 매장 주소로 재현·확인함). 그래서 원본 그대로 먼저 시도하고, 실패하면 첫 번째
 * 쉼표 앞부분(건물 단위 주소)만으로 한 번 더 시도한다 — 좌표를 지어내는 게 아니라 카카오가
 * 이해 못 하는 상세정보만 떼어내고 같은 건물 주소로 재요청하는 것뿐이다.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;
  const exact = await geocodeAddressExact(trimmed);
  if (exact) return exact;
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx === -1) return null;
  const base = trimmed.slice(0, commaIdx).trim();
  if (!base) return null;
  return geocodeAddressExact(base);
}

export type KakaoPlace = {
  id: string; // 카카오 장소 id (중복 제거 키)
  name: string;
  categoryGroupCode: string | null;
  lat: number;
  lng: number;
  distanceM: number | null; // 카카오가 반경검색 시 계산해주는 직선거리(요청에 x/y/radius를 줬을 때만 채워짐)
};

function parsePlaceDocuments(data: KakaoLocalResponse<KakaoPlaceDocument>): KakaoPlace[] {
  const docs = data?.documents ?? [];
  const places: KakaoPlace[] = [];
  for (const d of docs) {
    // 2026-09-11 — 예전엔 Number(d.y)를 그대로 담아서, 좌표가 빠진 문서가 오면 lat/lng이 NaN인
    // 경쟁점이 그대로 저장됐다(Firestore는 NaN을 받는다). 그러면 거리계산이 전부 NaN이 되고
    // 화면엔 빈칸으로만 보인다 — 값을 지어내지 말고 그 문서를 빼는 게 맞다.
    const lat = toCoord(d.y);
    const lng = toCoord(d.x);
    if (lat == null || lng == null) continue;
    // id는 중복제거 키다. 없으면 "undefined"라는 문자열이 키가 돼 서로 다른 장소가 뭉개진다.
    if (d.id == null || String(d.id) === "") continue;
    const distanceRaw = toCoord(d.distance);
    places.push({
      id: String(d.id),
      name: String(d.place_name ?? ""),
      categoryGroupCode: d.category_group_code || null,
      lat,
      lng,
      // 같은 건물이면 카카오가 "0"을 준다 — 예전 `d.distance ? ...` 는 이걸 null로 버렸다.
      distanceM: distanceRaw,
    });
  }
  return places;
}

/** 카테고리 그룹 코드(SC4=학교, SW8=지하철역 등) 기반 반경검색. 최대 3페이지(45건)까지 모은다. */
export async function searchByCategory(lat: number, lng: number, categoryGroupCode: string, radiusM: number): Promise<KakaoPlace[]> {
  const results: KakaoPlace[] = [];
  for (let page = 1; page <= 3; page++) {
    const data = await kakaoGet<KakaoPlaceDocument>("/search/category.json", {
      category_group_code: categoryGroupCode,
      x: String(lng),
      y: String(lat),
      radius: String(Math.min(radiusM, 20000)),
      page: String(page),
      size: "15",
    });
    results.push(...parsePlaceDocuments(data));
    if (data?.meta?.is_end !== false) break;
  }
  return results;
}

/** 키워드(PC방, 아파트, 대학 등) 기반 반경검색 — 고정 카테고리 코드가 없는 유형에 쓴다. */
export async function searchByKeyword(lat: number, lng: number, keyword: string, radiusM: number): Promise<KakaoPlace[]> {
  const results: KakaoPlace[] = [];
  for (let page = 1; page <= 3; page++) {
    const data = await kakaoGet<KakaoPlaceDocument>("/search/keyword.json", {
      query: keyword,
      x: String(lng),
      y: String(lat),
      radius: String(Math.min(radiusM, 20000)),
      page: String(page),
      size: "15",
    });
    results.push(...parsePlaceDocuments(data));
    if (data?.meta?.is_end !== false) break;
  }
  return results;
}
