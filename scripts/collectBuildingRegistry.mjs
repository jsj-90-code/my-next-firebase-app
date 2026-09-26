// 건축물대장(국토교통부 건축HUB)에서 매장·경쟁점·후보지 건물의 승강기 수·층수·층별 용도를 받는다.
// 2026-09-26 — 엘리베이터 교차검증 1단계(사용자 지시). **읽기만 한다. Firestore에 쓰지 않는다.**
//
//   node scripts/collectBuildingRegistry.mjs            # 이어받기(받은 곳은 건너뜀)
//   node scripts/collectBuildingRegistry.mjs --fresh    # 처음부터
//
// 경로: 좌표 -> 카카오 coord2regioncode(법정동코드 10자리) + coord2address(지번 본번·부번·산 여부)
//       -> 건축HUB getBrTitleInfo(표제부: 승강기·층수) + getBrFlrOulnInfo(층별개요: 층마다 용도)
// 키: .env.local의 BUILDING_REGISTRY_API_KEY(data.go.kr 일반 인증키 Decoding) · KAKAO_REST_API_KEY
// 입력: .local-tools/validation-snapshot.json(좌표·사람이 넣은 층/엘리베이터) · 출력: .local-tools/building-registry.json
//
// ⚠️ 좌표가 도로 위에 찍히면 옆 번지 건물이 잡힌다. 그래서 여기선 **판정하지 않고 받은 그대로** 남긴다 —
//    대조·판정은 _buildingRegistryCheck(분석 단계)에서 한다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq < 0) continue;
  let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[t.slice(0, eq).trim()] ??= v;
}
const KEY = process.env.BUILDING_REGISTRY_API_KEY;
const KAKAO = process.env.KAKAO_REST_API_KEY;
if (!KEY || !KAKAO) {
  console.error(".env.local에 BUILDING_REGISTRY_API_KEY와 KAKAO_REST_API_KEY가 필요하다.");
  process.exit(1);
}

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const OUT = ".local-tools/building-registry.json";
const DELAY_MS = 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kakao(path, q) {
  const res = await fetch(`https://dapi.kakao.com/v2/local/geo/${path}.json?${new URLSearchParams(q)}`, {
    headers: { Authorization: `KakaoAK ${KAKAO}` },
  });
  if (!res.ok) throw new Error(`카카오 ${path} HTTP ${res.status}`);
  return res.json();
}

async function hub(op, lot) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const qs = new URLSearchParams({ serviceKey: KEY, ...lot, _type: "json", numOfRows: "100", pageNo: String(page) });
    // data.go.kr은 몰아 부르면 503·빈 응답을 섞어 준다(2026-09-26 첫 수집에서 287곳 중 55곳). 물러났다가 다시 부른다.
    let res, text;
    for (let attempt = 0; attempt < 5; attempt++) {
      res = await fetch(`https://apis.data.go.kr/1613000/BldRgstHubService/${op}?${qs}`);
      text = await res.text();
      if (res.ok && text.trim()) break;
      await sleep(1500 * (attempt + 1));
    }
    if (!res.ok) throw new Error(`건축HUB ${op} HTTP ${res.status}: ${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    const code = json?.response?.header?.resultCode;
    if (code !== "00") throw new Error(`건축HUB ${op} ${code} ${json?.response?.header?.resultMsg}`);
    const body = json.response.body;
    const items = body.items?.item ?? [];
    all.push(...(Array.isArray(items) ? items : [items]));
    if (all.length >= Number(body.totalCount ?? 0)) break;
    await sleep(DELAY_MS);
  }
  return all;
}

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const sites = [
  ...snap.existingStores.map((e) => ({ key: `E:${e.storeCode}`, kind: "existing", name: e.storeName, lat: e.lat, lng: e.lng, human: { floor: e.floor, groundLevel: e.groundLevel, hasElevator: e.hasElevator } })),
  ...snap.candidates.map((c) => ({ key: `N:${c.code}`, kind: "candidate", name: c.name, lat: c.lat, lng: c.lng, human: { floor: c.floor, groundLevel: c.groundLevel, hasElevator: c.hasElevator } })),
  ...snap.competitors.map((c) => ({ key: `C:${c.id}`, kind: "competitor", owner: c.candidateCode, name: c.name, lat: c.lat, lng: c.lng, human: { floor: c.floor, groundLevel: c.groundLevel, hasElevator: c.hasElevator } })),
];

const out = !process.argv.includes("--fresh") && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { collectedAt: null, sites: {} };
let done = 0, failed = 0;
for (const s of sites) {
  if (out.sites[s.key]?.ok) continue;
  if (s.lat == null || s.lng == null) {
    out.sites[s.key] = { ...s, ok: false, error: "좌표 없음" };
    continue;
  }
  try {
    const reg = await kakao("coord2regioncode", { x: s.lng, y: s.lat });
    const addr = await kakao("coord2address", { x: s.lng, y: s.lat });
    const b = reg.documents?.find((d) => d.region_type === "B");
    const a = addr.documents?.[0]?.address;
    if (!b || !a?.main_address_no) throw new Error("좌표에서 지번을 못 찾음(도로 위일 수 있음)");
    const lot = {
      sigunguCd: b.code.slice(0, 5),
      bjdongCd: b.code.slice(5, 10),
      platGbCd: a.mountain_yn === "Y" ? "1" : "0",
      bun: String(a.main_address_no).padStart(4, "0"),
      ji: String(a.sub_address_no || 0).padStart(4, "0"),
    };
    const titles = await hub("getBrTitleInfo", lot);
    await sleep(DELAY_MS);
    const floors = await hub("getBrFlrOulnInfo", lot);
    await sleep(DELAY_MS);
    out.sites[s.key] = {
      ...s,
      ok: true,
      jibun: a.address_name,
      road: addr.documents?.[0]?.road_address?.address_name ?? null,
      lot,
      titles: titles.map((t) => ({
        dongNm: (t.dongNm ?? "").trim(), bldNm: (t.bldNm ?? "").trim(), mainAtch: t.mainAtchGbCdNm, purpose: t.mainPurpsCdNm,
        grnd: t.grndFlrCnt, ugrnd: t.ugrndFlrCnt, rideElvt: t.rideUseElvtCnt, emgenElvt: t.emgenUseElvtCnt, useAprDay: t.useAprDay,
      })),
      floors: floors.map((f) => ({
        dongNm: (f.dongNm ?? "").trim(), mainAtch: f.mainAtchGbCdNm, gb: f.flrGbCdNm, no: f.flrNo, purpose: f.mainPurpsCdNm, etc: f.etcPurps,
      })),
    };
    done++;
  } catch (err) {
    out.sites[s.key] = { ...s, ok: false, error: err instanceof Error ? err.message : String(err) };
    failed++;
  }
  if ((done + failed) % 20 === 0) {
    out.collectedAt = new Date().toISOString();
    writeFileSync(OUT, JSON.stringify(out, null, 1));
    console.log(`진행 ${done + failed} (실패 ${failed})`);
  }
}
out.collectedAt = new Date().toISOString();
writeFileSync(OUT, JSON.stringify(out, null, 1));
const all = Object.values(out.sites);
console.log(`끝: 전체 ${all.length} · 성공 ${all.filter((x) => x.ok).length} · 실패 ${all.filter((x) => !x.ok).length}`);
