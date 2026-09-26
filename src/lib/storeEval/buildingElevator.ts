// 건축물대장(국토교통부 건축HUB 표제부)으로 **경쟁점 건물에 엘리베이터가 있는지** 판정한다. (서버 전용 · 2026-09-26)
//
// 왜 경쟁점만: 자사 엘리베이터는 사용자가 안다. 경쟁점은 지도로 못 보니 사람이 대부분 "있음"을 기본값으로 적어 왔다
// (사용자 확인). 그 추측 대신 공공자료 근거로 채운다. 대조 전문은 docs/releases/2026-09-26-building-registry.md.
//
// 규칙(283곳 대조로 정함): 주건축물 전부 승강기 ≥ 1대 **또는** 지상 6층 이상 → 있음(true). 그 밖은 **판정 안 함(null)**.
//   · "없음"은 절대 주지 않는다 — 대장의 "승강기 0"은 기록 누락이 많다(일산탄현 10층·하남덕풍 8층이 0대).
//   · 6층 이상은 건축법상 승강기 설치 대상이라 대장이 0이어도 있음으로 본다.
//   · 이 규칙의 "있음"은 사람 값과 기존점 92%·경쟁점 97% 일치.
// ⚠️ 층은 채우지 않는다 — 층별개요 용도는 허가 당시 것이라 기존점에서도 73%만 맞았다.
// ⚠️ 층이 빈 경쟁점은 엘리베이터가 계산에 안 쓰인다(computeLocationScoreFromFacts). 사람이 층을 넣는 순간부터 쓰인다.

const KAKAO = "https://dapi.kakao.com/v2/local/geo";
const HUB = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo";

export type BuildingElevatorResult = {
  hasElevator: true | null;
  /** 사람이 볼 근거 한 줄 — 예: "건축물대장 부천 중동 1146-4 · 지상 5층 · 승강기 1대" */
  basis: string;
};

type Title = { mainAtchGbCdNm?: string; grndFlrCnt?: number; rideUseElvtCnt?: number; emgenUseElvtCnt?: number };

/** 표제부 목록 → 판정. 순수 함수라 시험한다. */
export function judgeElevator(titles: Title[], jibun: string): BuildingElevatorResult {
  const mains = titles.filter((t) => t.mainAtchGbCdNm !== "부속건축물");
  if (!mains.length) return { hasElevator: null, basis: `건축물대장 표제부 없음(${jibun})` };
  const counts = mains.map((t) => (t.rideUseElvtCnt ?? 0) + (t.emgenUseElvtCnt ?? 0));
  const maxGround = Math.max(0, ...mains.map((t) => t.grndFlrCnt ?? 0));
  const allHave = counts.every((c) => c > 0);
  const basis = `건축물대장 ${jibun} · 지상 ${maxGround}층 · 승강기 ${counts.join("/")}대`;
  if (allHave) return { hasElevator: true, basis };
  if (maxGround >= 6) return { hasElevator: true, basis: `${basis}(6층 이상이라 있음으로 봄)` };
  return { hasElevator: null, basis: `${basis} — 판정 안 함(대장 0대는 누락일 수 있음)` };
}

async function kakaoGeo(path: string, lat: number, lng: number) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) throw new Error("KAKAO_REST_API_KEY가 없습니다.");
  const res = await fetch(`${KAKAO}/${path}.json?${new URLSearchParams({ x: String(lng), y: String(lat) })}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`카카오 ${path} HTTP ${res.status}`);
  return res.json();
}

/** 좌표 한 점의 건물 엘리베이터 판정. 키가 없거나 실패하면 throw — 부르는 쪽이 조용히 null로 둔다. */
export async function lookupBuildingElevator(point: { lat: number; lng: number }): Promise<BuildingElevatorResult> {
  const key = process.env.BUILDING_REGISTRY_API_KEY;
  if (!key) throw new Error("BUILDING_REGISTRY_API_KEY가 없습니다.");
  const [reg, addr] = await Promise.all([kakaoGeo("coord2regioncode", point.lat, point.lng), kakaoGeo("coord2address", point.lat, point.lng)]);
  const b = (reg.documents as { region_type: string; code: string }[] | undefined)?.find((d) => d.region_type === "B");
  const a = addr.documents?.[0]?.address as { address_name: string; main_address_no: string; sub_address_no: string; mountain_yn: string } | undefined;
  if (!b || !a?.main_address_no) return { hasElevator: null, basis: "좌표에서 지번을 못 찾음(도로 위일 수 있음)" };
  const qs = new URLSearchParams({
    serviceKey: key,
    sigunguCd: b.code.slice(0, 5),
    bjdongCd: b.code.slice(5, 10),
    platGbCd: a.mountain_yn === "Y" ? "1" : "0",
    bun: String(a.main_address_no).padStart(4, "0"),
    ji: String(a.sub_address_no || 0).padStart(4, "0"),
    _type: "json",
    numOfRows: "100",
    pageNo: "1",
  });
  // data.go.kr은 몰아 부르면 503·빈 응답을 섞어 준다(2026-09-26 수집 287곳 중 55곳). 두 번까지 다시 부른다.
  let text = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${HUB}?${qs}`, { signal: AbortSignal.timeout(15000) });
    text = await res.text();
    if (res.ok && text.trim()) break;
    if (attempt === 2) throw new Error(`건축물대장 HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  const json = JSON.parse(text);
  if (json?.response?.header?.resultCode !== "00") throw new Error(`건축물대장 ${json?.response?.header?.resultMsg ?? "응답 이상"}`);
  const items = json.response.body?.items?.item ?? [];
  return judgeElevator(Array.isArray(items) ? items : [items], a.address_name);
}
