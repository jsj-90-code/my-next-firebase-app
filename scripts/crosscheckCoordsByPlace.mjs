// 좌표를 **매장명 장소검색**으로 대조한다. 주소변환은 건물을 찍지만 장소검색은 점포를 찍는다.
//
//   node scripts/crosscheckCoordsByPlace.mjs               # 미리보기
//   node scripts/crosscheckCoordsByPlace.mjs --apply       # 어긋난 곳을 장소검색 좌표로 교체
//   node scripts/crosscheckCoordsByPlace.mjs --threshold=30
//
// ── 왜 필요한가 (2026-09-16) ───────────────────────────────────────────────
// 기존점 주소가 "601~603호"처럼 복수 호실이면 주소변환이 실패해서 첫 쉼표 앞(건물 주소)으로
// 재시도한다(`geocodeExistingStores.mjs`, method "쉼표앞"). 그 15곳은 "사람이 지도를 보고
// 확인해야 한다"고 backlog에 남아 있었는데, **매장명으로 장소검색하면 기계가 대조한다.**
//
// 실제로 광주각화점이 **265m 어긋나 있었다.** 그 좌표로 유동인구 100~500m·주거인구·상권
// 중심도·편심도를 전부 수집했으니 그 매장 기초자료가 통째로 엉뚱한 지점 기준이었다.
// (로드뷰를 찍어보니 아파트 공터가 나와서 드러났다 — 자료 오류를 로드뷰가 찾아준 셈이다.)
//
// ⚠️ 좌표를 지어내지 않는다. 장소검색 결과 중 **PC방 카테고리이고 이름에 매장명이 들어간
//    것**만 인정하고, 아니면 "못 찾음"으로 남긴다. 후보지는 아직 개업 전이라 대부분 못 찾는다
//    — 그건 오류가 아니라 정상이다.
//
// ⚠️ `--apply`는 `.local-tools/geocoded-sites.json`만 고친다. **운영 Firestore는 안 건드린다.**
//    좌표가 바뀌면 그 지점의 유동·주거·편심도를 다시 수집해야 한다(아래 출력이 알려준다).

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SITES = ".local-tools/geocoded-sites.json";
const OUT = ".local-tools/coord-crosscheck.json";
const APPLY = process.argv.includes("--apply");
const thArg = process.argv.find((a) => a.startsWith("--threshold="));
const THRESHOLD = thArg ? Number(thArg.slice("--threshold=".length)) : 50;
const BRAND = "아이센스블랙라벨PC존";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 평면 근사. 수백 m 수준의 어긋남을 재는 용도라 충분하다. */
function distM(aLat, aLng, bLat, bLng) {
  const dN = (bLat - aLat) * 111320;
  const dE = (bLng - aLng) * 111320 * Math.cos((aLat * Math.PI) / 180);
  return Math.round(Math.hypot(dN, dE));
}

const file = JSON.parse(readFileSync(SITES, "utf8"));
const sites = file.sites ?? file;
const report = {};
const drift = [];

for (const [key, s] of Object.entries(sites)) {
  if (!Number.isFinite(Number(s.lat))) continue;
  const q = `${BRAND} ${s.name}`.trim();
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=5`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KEY}` } });
  if (!res.ok) { console.log(`✖ ${s.name} — 조회 실패 (${res.status})`); await sleep(300); continue; }
  const json = await res.json();
  const bare = String(s.name).replace(/\s+/g, "").replace(/\(.*\)/, "");
  const hit = (json.documents ?? []).find(
    (d) => /PC방|게임방/.test(d.category_name ?? "") && String(d.place_name).replace(/\s+/g, "").includes(bare),
  );
  if (!hit) {
    report[key] = { name: s.name, method: s.method ?? null, found: false };
  } else {
    const d = distM(Number(s.lat), Number(s.lng), Number(hit.y), Number(hit.x));
    report[key] = {
      name: s.name, method: s.method ?? null, found: true, distM: d,
      placeName: hit.place_name, placeLat: Number(hit.y), placeLng: Number(hit.x),
    };
    if (d >= THRESHOLD) {
      drift.push({ key, name: s.name, d, lat: Number(hit.y), lng: Number(hit.x) });
      console.log(`⚠ ${String(s.name).padEnd(14)} ${String(d).padStart(5)}m 어긋남  (${s.method})  -> ${hit.place_name}`);
    }
  }
  await sleep(120);
}

writeFileSync(OUT, JSON.stringify(report, null, 1), "utf8");

const found = Object.values(report).filter((r) => r.found);
const ds = found.map((r) => r.distM).sort((a, b) => a - b);
console.log(`\n대조 ${found.length}곳 / 못 찾음 ${Object.values(report).length - found.length}곳 (후보지는 개업 전이라 정상)`);
if (ds.length) console.log(`어긋남: 중앙 ${ds[Math.floor(ds.length / 2)]}m · ${THRESHOLD}m 이상 ${drift.length}곳`);

if (!drift.length) { console.log("\n교체할 좌표가 없다."); process.exit(0); }
if (!APPLY) { console.log("\n미리보기다. 교체하려면 --apply 를 붙인다."); process.exit(0); }

for (const d of drift) {
  sites[d.key] = { ...sites[d.key], lat: d.lat, lng: d.lng, method: "장소검색", replacedFrom: sites[d.key].method ?? null, driftM: d.d };
}
file.sites = sites;
file.crosscheckedAt = new Date().toISOString();
writeFileSync(SITES, JSON.stringify(file, null, 2), "utf8");

console.log(`\n${drift.length}곳 좌표를 교체했다.`);
console.log("⚠️ 이 지점들은 기초자료를 다시 모아야 한다 — 옛 좌표 기준으로 수집돼 있다:");
console.log("   유동인구  node scripts/collectSbizFloatingPopulation.mjs");
console.log("   주거인구  node scripts/collectSgisResidentPopulation.mjs");
console.log("   편심도    node scripts/collectKakaoDirectional.mjs");
console.log("   투입      각 write*ToFirestore.mjs --apply");
