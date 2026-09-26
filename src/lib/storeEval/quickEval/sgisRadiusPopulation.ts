// SGIS 생활권역 통계지도에서 **반경별 주거인구**를 받는다. (주소만 초기평가 도구 전용 · 서버)
//
// `scripts/collectSgisResidentPopulation.mjs`와 **같은 경로·같은 기준연도**다. 그 스크립트로
// 운영 52곳을 다시 받아 손입력값과 대조한 결과가 중앙 차이 0.0%, 51곳 중 34곳이 1% 이내였다
// (`scripts/writeResidentPopulationToFirestore.mjs` 머리 주석). 그래서 이 경로로 받은 값은
// 학습자료와 같은 자로 잰 값이다.
//
// ⚠️ 좌표를 경위도로 넣으면 **에러가 아니라 빈 결과**가 온다. 반드시 EPSG:5179로 변환한다.
// ⚠️ SGIS는 실패해도 HTTP 200을 준다 — errCd로만 성공을 안다.
// ⚠️ 연령 9구간(age_1_cnt~age_9_cnt)이 우리 age1km_0_9~age1km_80plus와 1:1로 대응하고 합이
//    tot_ppltn_cnt와 정확히 일치한다(N001로 대조 확인). 그 대응을 여기서 바꾸지 마라.

import { SGIS_BASE_YEAR } from "./quickEvalDefaults";
import { to5179 } from "./tm";

const AUTH_URL = "https://sgisapi.mods.go.kr/OpenAPI3/auth/authentication.json";
const STATS_URL = "https://sgis.mods.go.kr/ServiceAPI/OpenAPI3/catchmentArea/serviceAreaStatistics.json";

export type SgisRadiusStats = {
  radiusM: number;
  totalPopulation: number | null;
  malePopulation: number | null;
  femalePopulation: number | null;
  /** 연령 9구간 — 우리 필드 순서(0_9, 10_19, ... 80plus) */
  ageBands: (number | null)[];
  /** 조회면적(㎡). 원 면적과 크게 다르면 반경이 제대로 안 먹은 것이다 */
  areaSizeM2: number | null;
  /** 원 면적 대비 오차(0.05면 5%). 크면 그 값은 "그 반경"이 아니다 */
  areaOffRatio: number | null;
};

const AGE_KEYS = [
  "age_1_cnt",
  "age_2_cnt",
  "age_3_cnt",
  "age_4_cnt",
  "age_5_cnt",
  "age_6_cnt",
  "age_7_cnt",
  "age_8_cnt",
  "age_9_cnt",
] as const;

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getAccessToken(): Promise<string> {
  const serviceId = process.env.SGIS_SERVICE_ID;
  const securityKey = process.env.SGIS_SECURITY_KEY;
  if (!serviceId || !securityKey) throw new Error("SGIS_SERVICE_ID / SGIS_SECURITY_KEY가 설정되지 않았습니다.");
  const url = `${AUTH_URL}?consumer_key=${encodeURIComponent(serviceId)}&consumer_secret=${encodeURIComponent(securityKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = (await res.json()) as { errCd?: number | string; errMsg?: string; result?: { accessToken?: string } };
  if (String(body.errCd) !== "0" || !body.result?.accessToken) {
    throw new Error(`SGIS 인증 실패 errCd=${body.errCd} ${body.errMsg ?? ""}`);
  }
  return body.result.accessToken;
}

async function fetchRadius(token: string, tm: { x: number; y: number }, radiusM: number): Promise<SgisRadiusStats> {
  const params = new URLSearchParams({
    accessToken: token,
    area: `POINT(${tm.x} ${tm.y})`,
    radius: String(radiusM),
    srvAreaType: "2", // 1=임의 폴리곤, 2=반경
    workGb: "all",
    classDeg: "1",
    base_year: SGIS_BASE_YEAR,
    copr_base_year: SGIS_BASE_YEAR,
  });
  const res = await fetch(STATS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`SGIS HTTP ${res.status}`);
  const body = (await res.json()) as {
    errCd?: number | string;
    errMsg?: string;
    result?: { pops?: Record<string, unknown>[]; areaSize?: { area_size?: unknown }[] };
  };
  if (String(body.errCd) !== "0") throw new Error(`SGIS errCd=${body.errCd} ${body.errMsg ?? ""}`);
  const pops = body.result?.pops?.[0] ?? null;
  const areaSizeM2 = num(body.result?.areaSize?.[0]?.area_size);
  const expected = Math.PI * radiusM * radiusM;
  // 2026-09-26 — **성공 응답(errCd 0)인데 인구 칸이 비면 0명이다.** 사람이 안 사는 반경(포천 이동 장암리 500m,
  // 면적은 정상으로 옴)에서 SGIS는 0 대신 빈 값을 준다. 그걸 null로 두면 "수집 실패"로 읽혀 상권수요가 안 나오고
  // V62가 멈춰 주소만 화면이 "판정 불가"를 냈다. 실패(errCd≠0·HTTP 오류)는 위에서 이미 throw한다.
  const zero = (v: unknown) => num(v) ?? 0;
  return {
    radiusM,
    totalPopulation: zero(pops?.tot_ppltn_cnt),
    malePopulation: zero(pops?.man_cnt),
    femalePopulation: zero(pops?.woman_cnt),
    ageBands: AGE_KEYS.map((k) => zero(pops?.[k])),
    areaSizeM2,
    areaOffRatio: areaSizeM2 != null && areaSizeM2 > 0 ? Math.abs(areaSizeM2 - expected) / expected : null,
  };
}

/** 한 지점의 여러 반경을 순서대로 받는다. 토큰은 한 번만 받는다. */
export async function collectSgisRadiusPopulation(
  origin: { lat: number; lng: number },
  radii: number[],
): Promise<{ baseYear: string; byRadius: Record<number, SgisRadiusStats> }> {
  const token = await getAccessToken();
  const tm = to5179(origin.lng, origin.lat);
  const byRadius: Record<number, SgisRadiusStats> = {};
  for (const r of radii) {
    byRadius[r] = await fetchRadius(token, tm, r);
  }
  return { baseYear: SGIS_BASE_YEAR, byRadius };
}
