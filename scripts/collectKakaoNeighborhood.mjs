// 반경 2km 안의 PC방·학교 분포 수집 (2026-09-19)
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// 사용자 관찰(2026-09-19):
//   양주덕정점 — *"주변 반경 300미터 정도에 있는 PC방이 반경 2키로에 있는 전부다. 그 2키로가
//   죽은 상권이 아니라 다 상권이 형성되어 있고 초중고가 다 있다. 경쟁점이 없는 이유는
//   학교정화구역 때문에 PC방 입점이 불가해서다."*
//
//   문경시청점 — *"점촌고등학교, 문경여자중학교, 점촌중학교 이런 곳에서 최단거리 PC방이
//   우리 문경시청점이랑 크라우드PC방이 거리 차이가 얼마 안 난다. 우리 매장이랑 크라우드는
//   멀리 있는데(1.5km), 고객 입장에서는 저기로 가나 우리로 가나 이동경로가 똑같다."*
//
// 두 관찰이 같은 말을 한다 — **경쟁을 매장↔매장 거리로 세면 안 되고, 손님이 있는 자리에서
// 봐야 한다.** 지금 산식은 자사 500m 안 경쟁 PC를 합칠 뿐이라 둘 다 못 본다.
//
// ⚠️ 이건 "문제 매장 두 곳을 설명하려고" 만드는 자료가 아니다(사용자 경고: *"여기 매장이
//    문제가 있으니 그 문제를 찾기 위한 결과맞추기일 수도 있으니 잘 검토해봐라"*).
//    그래서 **38곳 전부**에 대해 같은 자료를 받는다. 두 곳에서만 되는 얘기면 기각이다.
//
// ── 무엇을 받나 ──────────────────────────────────────────────────────────
//   1. 반경 2km 안 PC방 — 좌표·거리·이름 (최대 45곳) + 잘림 여부(total_count)
//   2. 반경 2km 안 학교 — 좌표·거리·이름 (카카오 업종코드 SC4, 최대 45곳)
//
// 개수만이 아니라 **좌표**를 받는 이유: "학교에서 본 거리"를 나중에 계산해야 하기 때문이다.
// 개수만 있으면 문경 관찰을 아예 못 잰다.
//
// ⚠️ 카카오 장소검색은 한 번에 15건 · 최대 3쪽(45건)까지만 준다. 45건에 걸리면
//    `truncated: true`로 표시한다 — 그런 지점은 "2km 안이 촘촘하다"는 것만 믿고
//    낱개 좌표는 불완전하다고 보아야 한다.
//
// **운영 Firestore에 쓰지 않는다.** 결과는 로컬 파일로만 남긴다.
//
// 사용법:
//   node scripts/collectKakaoNeighborhood.mjs
//   KAKAO_LIMIT=2 node scripts/collectKakaoNeighborhood.mjs   # 먼저 두 곳만 시험
//
// 산출물: .local-tools/kakao-neighborhood.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SITES = ".local-tools/geocoded-sites.json";
const OUT = ".local-tools/kakao-neighborhood.json";
const DELAY_MS = Number(process.env.KAKAO_DELAY_MS || 120);
const RADIUS = Number(process.env.KAKAO_RADIUS || 2000);

function loadEnvLocal() {
  let text;
  try {
    text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = v;
  }
}
loadEnvLocal();

const KEY = process.env.KAKAO_REST_API_KEY;
if (!KEY) {
  console.error("KAKAO_REST_API_KEY가 .env.local에 필요하다.");
  process.exit(1);
}
if (!existsSync(SITES)) {
  console.error(`${SITES}가 없다. 먼저 node scripts/geocodeExistingStores.mjs를 돌려라.`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KEY}` } });
    if (res.ok) return res.json();
    if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
    const text = await res.text().catch(() => "");
    throw new Error(`카카오 요청 실패 (${res.status}): ${text.slice(0, 200)}`);
  }
  return null;
}

/** 15건씩 최대 3쪽까지 긁어서 낱개를 모은다. total_count로 잘림을 판정한다. */
async function fetchAll(kind, lat, lng) {
  const docs = [];
  let total = null;
  for (let page = 1; page <= 3; page++) {
    const params = new URLSearchParams({
      x: String(lng), y: String(lat), radius: String(RADIUS),
      size: "15", page: String(page), sort: "distance",
    });
    if (kind === "pc") params.set("query", "PC방");
    else params.set("category_group_code", "SC4");
    const base = kind === "pc"
      ? "https://dapi.kakao.com/v2/local/search/keyword.json"
      : "https://dapi.kakao.com/v2/local/search/category.json";
    const json = await call(`${base}?${params}`);
    if (!json) break;
    total = Number(json?.meta?.total_count ?? total);
    for (const d of json?.documents ?? []) {
      docs.push({
        name: d.place_name ?? null,
        category: d.category_name ?? null,
        lat: Number(d.y), lng: Number(d.x),
        distanceM: d.distance != null && d.distance !== "" ? Number(d.distance) : null,
        address: d.road_address_name || d.address_name || null,
      });
    }
    if (json?.meta?.is_end) break;
    await sleep(DELAY_MS);
  }
  return { total, docs, truncated: total != null && total > docs.length };
}

const raw = JSON.parse(readFileSync(SITES, "utf8"));
const sites = raw.sites ?? raw;
let keys = Object.keys(sites).filter((k) => {
  const s = sites[k];
  return Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lng));
});
const LIMIT = Number(process.env.KAKAO_LIMIT || 0);
if (LIMIT > 0) keys = keys.slice(0, LIMIT);

console.log(`좌표 있는 지점 ${keys.length}곳 · 반경 ${RADIUS}m · PC방(키워드) + 학교(SC4)`);
console.log(`낱개 좌표까지 받는다 — "학교에서 본 거리"를 계산하려면 개수만으로는 안 된다.\n`);

const out = { collectedAt: new Date().toISOString(), radiusM: RADIUS, sites: {} };
let done = 0, failed = 0;
for (const key of keys) {
  const s = sites[key];
  const lat = Number(s.lat), lng = Number(s.lng);
  const rec = { kind: s.kind ?? null, code: s.code ?? null, name: s.name ?? null, lat, lng };
  for (const [kind, field] of [["pc", "pcRooms"], ["school", "schools"]]) {
    try {
      rec[field] = await fetchAll(kind, lat, lng);
    } catch (e) {
      rec[field] = { total: null, docs: [], truncated: false, error: e.message };
      failed++;
      if (failed <= 3) console.error(`  ! ${s.name} ${kind} — ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  out.sites[key] = rec;
  done++;
  const pc = rec.pcRooms ?? {}, sc = rec.schools ?? {};
  // PC방 중 진짜 PC방 업종만(키워드 검색은 이름에 걸린 딴 업소도 물고 온다)
  const realPc = (pc.docs ?? []).filter((d) => (d.category ?? "").includes("PC방"));
  const near = realPc.filter((d) => (d.distanceM ?? 9e9) <= 500).length;
  console.log(`${String(done).padStart(3)}/${keys.length}  ${(s.name ?? key).padEnd(14)}` +
    ` PC방 2km ${String(realPc.length).padStart(3)}곳 (500m 안 ${String(near).padStart(2)}곳)` +
    `${pc.truncated ? " ⚠️잘림" : ""}  ·  학교 ${String((sc.docs ?? []).length).padStart(2)}곳`);
}

writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
console.log(`\n${OUT}에 ${done}곳 저장. 실패 호출 ${failed}회.`);
