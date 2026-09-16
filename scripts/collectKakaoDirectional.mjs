// 유동 방향 — 상권이 우리 기준 **어느 쪽에** 쏠려 있나 (2026-09-17).
//
// 사용자 항목: "상권 끝에있으면 접근성이 떨어지니까" + "유동방향좋긴한데 이거 너가 자료넣어줄수있어?"
//
// ── 카카오는 방향을 안 준다. 중심을 옮겨서 센다 ──────────────────────────
// 반경검색은 **원**이라 방위로 자를 수 없다. 대신 **중심을 옮긴 원**을 쓴다:
// 우리 매장에서 8방위로 STEP_M 떨어진 점을 잡고, 그 점을 중심으로 반경 RADIUS_M 안을 센다.
// 원끼리 겹치지만 상관없다 — 방향 가중치를 얻는 게 목적이라 겹침은 오히려 값을 매끄럽게 한다.
//
//   사방이 고르면        -> 우리가 상권 한가운데
//   한쪽만 유난히 많으면  -> 우리가 상권 끝이고 사람은 저쪽에 있다
//
// ⚠️ **documents가 아니라 meta.total_count를 읽는다.** 장소검색은 한 번에 45건까지만 주므로
//    문서를 세면 도심이 전부 45로 잘려 방향 차이가 사라진다. size=1로 부르고 개수만 읽는다.
//    (좌표를 받아 무게중심을 내는 방법도 있지만 그 45건 제한에 그대로 걸린다 — 가까운 45개만
//     오므로 무게중심이 우리 쪽으로 쏠려 편심이 과소평가된다. 그래서 개수 방식을 쓴다.)
//
// **운영 Firestore에 쓰지 않는다.** 결과는 로컬 파일로만 남긴다.
//
// 사용법:
//   node scripts/collectKakaoDirectional.mjs
//   KAKAO_LIMIT=2 node scripts/collectKakaoDirectional.mjs   (먼저 몇 곳만)
//
// 산출물: .local-tools/kakao-directional.json (운영 자료라 git 제외)

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SITES = ".local-tools/geocoded-sites.json";
const OUT = ".local-tools/kakao-directional.json";
const DELAY_MS = Number(process.env.KAKAO_DELAY_MS || 120);
const STEP_M = 300;     // 표본점을 얼마나 밀어낼지
const RADIUS_M = 300;   // 그 점에서 얼마나 볼지
const CATEGORIES = ["FD6", "CE7"]; // 음식점·카페 — "사람이 모여 노는 곳"

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
if (!KEY) { console.error("KAKAO_REST_API_KEY가 .env.local에 필요하다."); process.exit(1); }
if (!existsSync(SITES)) { console.error(`${SITES}가 없다. geocodeExistingStores.mjs 먼저.`); process.exit(1); }

// 8방위. 화면·로그에서 읽히도록 이름을 같이 둔다.
const DIRS = [
  { name: "북", deg: 0 }, { name: "북동", deg: 45 }, { name: "동", deg: 90 }, { name: "남동", deg: 135 },
  { name: "남", deg: 180 }, { name: "남서", deg: 225 }, { name: "서", deg: 270 }, { name: "북서", deg: 315 },
];

/** 위경도에서 방위각(도)·거리(m)만큼 민 점. 300m 수준이면 평면 근사로 충분하다. */
function offset(lat, lng, deg, meters) {
  const rad = (deg * Math.PI) / 180;
  const dNorth = meters * Math.cos(rad);
  const dEast = meters * Math.sin(rad);
  const dLat = dNorth / 111_320;
  const dLng = dEast / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function countNear(lat, lng, code, radiusM) {
  const params = new URLSearchParams({
    category_group_code: code, x: String(lng), y: String(lat), radius: String(radiusM), size: "1",
  });
  const url = `https://dapi.kakao.com/v2/local/search/category.json?${params}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KEY}` } });
    if (res.ok) {
      const json = await res.json();
      const n = json?.meta?.total_count;
      return Number.isFinite(Number(n)) ? Number(n) : null;
    }
    if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
    throw new Error(`카카오 요청 실패 (${res.status})`);
  }
  return null;
}

const raw = JSON.parse(readFileSync(SITES, "utf8"));
const sites = raw.sites ?? raw;
let keys = Object.keys(sites).filter((k) => Number.isFinite(Number(sites[k]?.lat)) && Number.isFinite(Number(sites[k]?.lng)));
const LIMIT = Number(process.env.KAKAO_LIMIT || 0);
if (LIMIT > 0) keys = keys.slice(0, LIMIT);

console.log(`${keys.length}곳 x 8방위 x 업종 ${CATEGORIES.length}종 = ${keys.length * 8 * CATEGORIES.length}회 호출`);
console.log(`표본점은 ${STEP_M}m 밀어내고 반경 ${RADIUS_M}m를 센다\n`);

const out = { collectedAt: new Date().toISOString(), stepM: STEP_M, radiusM: RADIUS_M, categories: CATEGORIES, dirs: DIRS, sites: {} };
let done = 0, failed = 0;
for (const key of keys) {
  const s = sites[key];
  const lat = Number(s.lat), lng = Number(s.lng);
  const rec = { name: s.name ?? null, lat, lng, byDir: {} };
  for (const d of DIRS) {
    const p = offset(lat, lng, d.deg, STEP_M);
    let total = 0, any = false;
    for (const c of CATEGORIES) {
      try {
        const n = await countNear(p.lat, p.lng, c, RADIUS_M);
        if (n != null) { total += n; any = true; }
      } catch { failed++; }
      await sleep(DELAY_MS);
    }
    rec.byDir[d.name] = any ? total : null;
  }
  // 편심도 = |Σ 방위벡터 x 개수| ÷ Σ개수. 0이면 사방이 고르다(중앙), 1이면 완전히 한쪽(끝).
  const vals = DIRS.map((d) => rec.byDir[d.name]).filter((v) => v != null);
  if (vals.length === DIRS.length) {
    let vx = 0, vy = 0, sum = 0;
    for (const d of DIRS) {
      const n = rec.byDir[d.name];
      const rad = (d.deg * Math.PI) / 180;
      vy += n * Math.cos(rad); vx += n * Math.sin(rad); sum += n;
    }
    rec.eccentricity = sum > 0 ? Math.hypot(vx, vy) / sum : null;
    rec.busiestDir = DIRS.reduce((a, b) => (rec.byDir[b.name] > rec.byDir[a.name] ? b : a)).name;
    rec.sum = sum;
  } else {
    rec.eccentricity = null; rec.busiestDir = null; rec.sum = null;
  }
  out.sites[key] = rec;
  done++;
  console.log(`${String(done).padStart(3)}/${keys.length}  ${(s.name ?? key).padEnd(14)} 편심도 ${rec.eccentricity == null ? "-" : rec.eccentricity.toFixed(3)} · 제일 붐비는 쪽 ${String(rec.busiestDir ?? "-").padStart(3)} · 합 ${rec.sum ?? "-"}`);
}

writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
console.log(`\n${OUT}에 ${done}곳 저장. 실패 호출 ${failed}회.`);
console.log(`편심도 0 = 사방이 고르다(상권 한가운데) · 1에 가까울수록 한쪽으로 쏠렸다(상권 끝)`);
