// 카카오 Local API 서버 클라이언트 — 주소↔좌표 변환, 카테고리/키워드 장소검색.
// REST API 키는 서버 전용 환경변수(KAKAO_REST_API_KEY)로만 읽는다(NEXT_PUBLIC_ 접두사 없음 —
// 프론트엔드에 노출하지 않는다). 지도 렌더링용 JS SDK 공개키(NEXT_PUBLIC_KAKAO_MAP_JS_KEY)는
// 이 파일과 무관하며 클라이언트 컴포넌트에서 별도로 쓴다(카카오 콘솔에서 도메인 제한을 걸어
// 발급하는 게 정상 — REST 키와 성격이 다르다).

const KAKAO_LOCAL_BASE = "https://dapi.kakao.com/v2/local";

function getKakaoRestKey(): string | null {
  return process.env.KAKAO_REST_API_KEY || null;
}

async function kakaoGet(path: string, params: Record<string, string>): Promise<any> {
  const key = getKakaoRestKey();
  if (!key) throw new Error("KAKAO_REST_API_KEY가 설정되지 않았습니다.");
  const url = `${KAKAO_LOCAL_BASE}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`카카오 API 요청 실패 (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

export type GeocodeResult = {
  roadAddress: string | null;
  jibunAddress: string | null;
  lat: number;
  lng: number;
  buildingName: string | null;
};

async function geocodeAddressExact(trimmed: string): Promise<GeocodeResult | null> {
  const data = await kakaoGet("/search/address.json", { query: trimmed });
  const doc = data?.documents?.[0];
  if (!doc) return null;
  const road = doc.road_address;
  const jibun = doc.address;
  return {
    roadAddress: road?.address_name ?? null,
    jibunAddress: jibun?.address_name ?? null,
    lat: Number(doc.y),
    lng: Number(doc.x),
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

function parsePlaceDocuments(data: any): KakaoPlace[] {
  const docs = data?.documents ?? [];
  return docs.map((d: any) => ({
    id: String(d.id),
    name: String(d.place_name ?? ""),
    categoryGroupCode: d.category_group_code || null,
    lat: Number(d.y),
    lng: Number(d.x),
    distanceM: d.distance ? Number(d.distance) : null,
  }));
}

/** 카테고리 그룹 코드(SC4=학교, SW8=지하철역 등) 기반 반경검색. 최대 3페이지(45건)까지 모은다. */
export async function searchByCategory(lat: number, lng: number, categoryGroupCode: string, radiusM: number): Promise<KakaoPlace[]> {
  const results: KakaoPlace[] = [];
  for (let page = 1; page <= 3; page++) {
    const data = await kakaoGet("/search/category.json", {
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
    const data = await kakaoGet("/search/keyword.json", {
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
