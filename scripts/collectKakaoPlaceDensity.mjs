// 카카오 업소 밀도 수집 — "상권 중심이냐 끝이냐"를 유동인구와 **다른 출처로** 재기 위한 자료.
//
// 사용자 방향(2026-09-17): "카카오API지금 활성화되어있으니까 이런걸로 교차검증하면어떨까"
//
// ── 왜 필요한가 ──────────────────────────────────────────────────────────
// 상권 중심도를 유동인구(소상공인365) 고리 분포로 재려 한다. 그런데 그 정의가 맞는지는
// **같은 자료로는 확인할 수 없다.** 카카오 업소 밀도는 완전히 다른 출처라 교차검증이 된다.
// 두 방식이 같은 답을 내면 정의가 맞는 것이고, 갈리면 정의를 다시 세워야 한다.
//
// ── 핵심: documents가 아니라 meta.total_count를 쓴다 ─────────────────────
// 카카오 장소검색은 한 번에 최대 45건까지만 돌려준다. 도심 음식점은 45개를 우습게 넘으므로
// **문서를 세면 전부 45로 잘려 변별력이 사라진다.** 우리가 필요한 건 개수뿐이니
// `size=1`로 부르고 `meta.total_count`만 읽는다. 잘림 없이 진짜 개수가 나온다.
//
// ⚠️ 주차장(PK6)은 일부러 뺐다. 등록된 주차장 시설만 잡히고 "무료로 댈 데가 있나"는 API에
//    없다(사용자 지적). 게다가 표본에 소도시가 4곳뿐이라(주거 1km 인구 최저 18,786명)
//    검정 자체가 안 된다. 참고용으로 같이 받아는 두되 산식에는 쓰지 않는다.
//
// **운영 Firestore에 쓰지 않는다.** 결과는 로컬 파일로만 남긴다.
//
// 사용법:
//   node scripts/collectKakaoPlaceDensity.mjs
//
// 산출물: .local-tools/kakao-place-density.json (운영 자료라 git 제외)

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SITES = ".local-tools/geocoded-sites.json";
const OUT = ".local-tools/kakao-place-density.json";
const DELAY_MS = Number(process.env.KAKAO_DELAY_MS || 120);

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

// 상권 중심도를 이루는 업종. "사람이 모여 노는 곳"을 세는 게 목적이라 생활밀착 3종을 쓴다.
const CATEGORIES = [
  { code: "FD6", label: "음식점" },
  { code: "CE7", label: "카페" },
  { code: "CS2", label: "편의점" },
  { code: "PK6", label: "주차장(참고용, 산식에 안 씀)" },
];
const RADII = [100, 200, 300, 500, 1000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 개수만 필요하므로 size=1로 부르고 meta.total_count를 읽는다. 45건 잘림을 피한다. */
async function countNear(lat, lng, code, radiusM) {
  const params = new URLSearchParams({
    category_group_code: code,
    x: String(lng),
    y: String(lat),
    radius: String(radiusM),
    size: "1",
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
    const text = await res.text().catch(() => "");
    throw new Error(`카카오 요청 실패 (${res.status}): ${text.slice(0, 200)}`);
  }
  return null;
}

const raw = JSON.parse(readFileSync(SITES, "utf8"));
const sites = raw.sites ?? raw;
let keys = Object.keys(sites).filter((k) => {
  const s = sites[k];
  return Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lng));
});
// KAKAO_LIMIT=2로 먼저 몇 곳만 돌려 total_count가 제대로 오는지 확인하고 전량을 돌린다.
const LIMIT = Number(process.env.KAKAO_LIMIT || 0);
if (LIMIT > 0) keys = keys.slice(0, LIMIT);

console.log(`좌표 있는 지점 ${keys.length}곳 x 업종 ${CATEGORIES.length}종 x 반경 ${RADII.length}개 = ${keys.length * CATEGORIES.length * RADII.length}회 호출`);
console.log(`(개수만 받으므로 size=1 — meta.total_count를 읽는다)\n`);

const out = { collectedAt: new Date().toISOString(), radii: RADII, categories: CATEGORIES, sites: {} };
let done = 0, failed = 0;
for (const key of keys) {
  const s = sites[key];
  const lat = Number(s.lat), lng = Number(s.lng);
  const rec = { name: s.name ?? null, lat, lng, counts: {} };
  for (const c of CATEGORIES) {
    rec.counts[c.code] = {};
    for (const r of RADII) {
      try {
        rec.counts[c.code][r] = await countNear(lat, lng, c.code, r);
      } catch (e) {
        rec.counts[c.code][r] = null;
        failed++;
        if (failed <= 3) console.error(`  ! ${s.name} ${c.code} ${r}m — ${e.message}`);
      }
      await sleep(DELAY_MS);
    }
  }
  out.sites[key] = rec;
  done++;
  const f = rec.counts.FD6;
  console.log(`${String(done).padStart(3)}/${keys.length}  ${(s.name ?? key).padEnd(14)} 음식점 100m ${String(f?.[100] ?? "-").padStart(4)} · 300m ${String(f?.[300] ?? "-").padStart(4)} · 1km ${String(f?.[1000] ?? "-").padStart(5)}`);
}

writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
console.log(`\n${OUT}에 ${done}곳 저장. 실패 호출 ${failed}회.`);
