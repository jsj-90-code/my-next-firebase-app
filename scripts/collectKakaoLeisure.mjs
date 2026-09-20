// 반경 2km 안 **PC방 말고 갈 곳** 수집 (2026-09-20 밤)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// 사용자 가설(2026-09-20): *"문경은 시가 되게 작은 곳인데 PC 말고 애들이 갈 곳이 없는
// 거야. 놀 데가 없어. 그래서 PC방만 주구장창 간다."*
//
// 지금 수요식에는 **대체 여가시설이 한 글자도 안 들어간다.** 그래서 이 변수는
// 우리 산식·매출과 완전히 무관하다 — **순환이 없다.** 2026-09-20 밤에 '시장 공급'
// (경쟁점이 깐 PC 대수)으로 같은 얘기를 재려다 순환에 걸려 기각했는데
// (`_marketSupply.test.ts`), 그건 경쟁 PC가 예측 점유율의 분모라서였다.
// **PC방이 아니라 "PC방 말고 갈 곳"을 세면 그 문제가 없다.**
//
// ⚠️ 문제 매장을 설명하려고 만드는 자료가 아니다. **54곳 전부**에 같은 자료를 받는다.
//
// ── 무엇을 받나 ──────────────────────────────────────────────────────────
// 카카오에는 '여가시설' 업종코드가 없다(SC4=학교, CT1=문화시설까지만 있다).
// 그래서 **키워드로 받고 업종명(category_name)으로 거른다.**
//
//   노래방 · 당구장 · 볼링장 · 오락실 · 만화카페 · 영화관   + CT1(문화시설)
//
// 업종명을 그대로 저장해 두고 **거르는 일은 분석 쪽에서 한다** — 키워드 검색은
// 이름에 걸린 딴 업소도 물고 오기 때문이다(기존 수집기가 PC방에서 겪은 함정).
//
// ⚠️ 카카오 장소검색은 한 번에 15건·최대 3쪽(45건)이다. 45건에 걸리면 `truncated`로
//    표시한다. 그런 지점은 **개수를 하한으로만** 써야 한다.
//
// **운영 Firestore에 쓰지 않는다.** 로컬 파일로만 남긴다.
//
// 사용법:
//   KAKAO_LIMIT=2 node scripts/collectKakaoLeisure.mjs   # 먼저 두 곳만 시험(시간 재기)
//   node scripts/collectKakaoLeisure.mjs                 # 전체
//
// 산출물: .local-tools/kakao-leisure.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SITES = ".local-tools/geocoded-sites.json";
const OUT = ".local-tools/kakao-leisure.json";
const DELAY_MS = Number(process.env.KAKAO_DELAY_MS || 120);
const RADIUS = Number(process.env.KAKAO_RADIUS || 2000);

/** 키워드로 받을 것들. 업종명 거르기는 분석 쪽에서 한다. */
const KEYWORDS = ["노래방", "당구장", "볼링장", "오락실", "만화카페", "영화관"];
/** 업종코드로 받을 것 — CT1 문화시설(영화관·공연장·전시관 등). */
const CATEGORIES = ["CT1"];

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

/** 15건씩 최대 3쪽. total_count로 잘림을 판정한다. */
async function fetchAll(kind, value, lat, lng) {
  const docs = [];
  let total = null;
  for (let page = 1; page <= 3; page++) {
    const params = new URLSearchParams({
      x: String(lng), y: String(lat), radius: String(RADIUS),
      size: "15", page: String(page), sort: "distance",
    });
    let base;
    if (kind === "keyword") {
      params.set("query", value);
      base = "https://dapi.kakao.com/v2/local/search/keyword.json";
    } else {
      params.set("category_group_code", value);
      base = "https://dapi.kakao.com/v2/local/search/category.json";
    }
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

console.log(`좌표 있는 지점 ${keys.length}곳 · 반경 ${RADIUS}m`);
console.log(`키워드 ${KEYWORDS.join("·")} + 업종 ${CATEGORIES.join("·")}`);
console.log("업종명을 그대로 저장한다 — 거르는 일은 분석 쪽에서 한다.\n");

const out = { collectedAt: new Date().toISOString(), radiusM: RADIUS, keywords: KEYWORDS, categories: CATEGORIES, sites: {} };
let done = 0, failed = 0;
const t0 = Date.now();
for (const key of keys) {
  const s = sites[key];
  const lat = Number(s.lat), lng = Number(s.lng);
  const rec = { kind: s.kind ?? null, code: s.code ?? null, name: s.name ?? null, lat, lng, groups: {} };
  for (const kw of KEYWORDS) {
    try {
      rec.groups[kw] = await fetchAll("keyword", kw, lat, lng);
    } catch (e) {
      rec.groups[kw] = { total: null, docs: [], truncated: false, error: e.message };
      failed++;
      if (failed <= 3) console.error(`  ! ${s.name} ${kw} — ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  for (const cg of CATEGORIES) {
    try {
      rec.groups[cg] = await fetchAll("category", cg, lat, lng);
    } catch (e) {
      rec.groups[cg] = { total: null, docs: [], truncated: false, error: e.message };
      failed++;
    }
    await sleep(DELAY_MS);
  }
  out.sites[key] = rec;
  done++;
  const n = (g) => (rec.groups[g]?.docs ?? []).length;
  const tr = Object.values(rec.groups).some((g) => g?.truncated);
  console.log(
    `${String(done).padStart(3)}/${keys.length}  ${(s.name ?? key).padEnd(14)}` +
    KEYWORDS.map((k) => `${k} ${String(n(k)).padStart(2)}`).join(" · ") +
    ` · 문화 ${String(n("CT1")).padStart(2)}${tr ? "  ⚠️잘림" : ""}`,
  );
}

writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${OUT}에 ${done}곳 저장. 실패 호출 ${failed}회. ${secs}초 걸렸다.`);
