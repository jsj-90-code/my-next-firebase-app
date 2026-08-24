// SGIS(통계지리정보서비스) Open API 서버 클라이언트.
//
// 중요: SGIS 공식 API는 행정구역(시도/시군구/읍면동) 단위 통계만 제공한다 — 반경(500m/1km)
// 기반 인구조회 API는 없다(2026-08-24 조사 확인, "생활권역 통계지도"는 지도 위 시각화 도구일
// 뿐 데이터 API가 아니다). 그래서 이 파일이 반환하는 값은 전부 "행정구역 참고자료"이며,
// pop500m/pop1km/age1km_* 같은 V62 반경 입력값으로 절대 쓰지 않는다 — 그 값들은 여전히 사람이
// SGIS 생활권역 통계지도에서 직접 조회해 입력(또는 2단계에서 업로드-추출)한다.
//
// 인증키는 서버 전용 환경변수(SGIS_SERVICE_ID/SGIS_SECURITY_KEY)로만 읽는다.

const SGIS_BASE = "https://sgisapi.kostat.go.kr/OpenAPI3";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function fetchNewAccessToken(): Promise<{ accessToken: string; expiresAt: number }> {
  const serviceId = process.env.SGIS_SERVICE_ID;
  const securityKey = process.env.SGIS_SECURITY_KEY;
  if (!serviceId || !securityKey) throw new Error("SGIS_SERVICE_ID/SGIS_SECURITY_KEY가 설정되지 않았습니다.");

  const url = `${SGIS_BASE}/auth/authentication.json?${new URLSearchParams({
    consumer_key: serviceId,
    consumer_secret: securityKey,
  }).toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SGIS 인증 요청 실패 (${res.status})`);
  const data = await res.json();
  const accessToken = data?.result?.accessToken;
  if (!accessToken) throw new Error(`SGIS 인증 응답에 accessToken이 없습니다: ${JSON.stringify(data).slice(0, 200)}`);

  // 응답에 만료시각(accessTimeout, epoch ms로 추정)이 있으면 그걸 쓰고, 없으면 "4시간 만료"
  // 공식 문서 기준으로 안전마진을 둔 3.5시간 뒤로 잡는다(실제 응답 형태는 실키 발급 후 재확인 필요).
  const timeoutRaw = Number(data?.result?.accessTimeout);
  const expiresAt = Number.isFinite(timeoutRaw) && timeoutRaw > Date.now() ? timeoutRaw : Date.now() + 3.5 * 60 * 60 * 1000;
  return { accessToken, expiresAt };
}

export async function getSgisAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.accessToken;
  cachedToken = await fetchNewAccessToken();
  return cachedToken.accessToken;
}

export type AdminDongLookup = {
  admCd: string;
  admName: string;
};

/** 주소 문자열 → SGIS 자체 행정구역코드(adm_cd). Kakao 좌표역변환 코드체계와 섞이지 않도록
 * SGIS 지오코딩 API를 그대로 쓴다(같은 값 체계라야 population API가 바로 받아준다). */
export async function geocodeToAdminDong(address: string): Promise<AdminDongLookup | null> {
  const token = await getSgisAccessToken();
  const url = `${SGIS_BASE}/addr/geocode.json?${new URLSearchParams({
    accessToken: token,
    address: address.trim(),
  }).toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SGIS 지오코딩 요청 실패 (${res.status})`);
  const data = await res.json();
  const first = data?.result?.resultdata?.[0];
  if (!first?.adm_cd) return null;
  return { admCd: String(first.adm_cd), admName: String(first.full_addr ?? first.adm_nm ?? "") };
}

export type AdminDongPopulation = {
  totalPopulation: number | null;
  malePopulation: number | null;
  femalePopulation: number | null;
  year: number | null;
};

/** 행정구역코드 기준 인구 통계(행정구역 참고자료 전용 — V62 계산에 쓰지 않음). */
export async function fetchAdminDongPopulation(admCd: string, year?: number): Promise<AdminDongPopulation> {
  const token = await getSgisAccessToken();
  const requestYear = year ?? new Date().getFullYear() - 1; // 최신 확정연도가 보통 작년 통계
  const url = `${SGIS_BASE}/stats/population.json?${new URLSearchParams({
    accessToken: token,
    year: String(requestYear),
    adm_cd: admCd,
    low_search: "0",
  }).toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SGIS 인구통계 요청 실패 (${res.status})`);
  const data = await res.json();
  const first = data?.result?.[0];
  if (!first) return { totalPopulation: null, malePopulation: null, femalePopulation: null, year: null };
  return {
    totalPopulation: first.tot_ppltn != null ? Number(first.tot_ppltn) : null,
    // 남녀 인구는 이 "주요지표" 엔드포인트엔 없을 수 있다(성별/연령 세부는 별도 API) — 없으면
    // 지어내지 않고 null로 남긴다.
    malePopulation: first.male_ppltn != null ? Number(first.male_ppltn) : null,
    femalePopulation: first.female_ppltn != null ? Number(first.female_ppltn) : null,
    year: requestYear,
  };
}
