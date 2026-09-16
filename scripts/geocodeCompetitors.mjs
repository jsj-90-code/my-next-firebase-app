// 경쟁점 좌표 — 상호명으로 카카오에서 찾는다 (2026-09-17).
//
// 왜 필요한가: 동선 방해("상권 주요동선에 경쟁점이 껴서 방해가 되는지")와 간판·출입구를
// 재려면 **방위**가 필요한데, 경쟁점은 거리(distanceM)만 있고 좌표가 49/225(22%)뿐이다.
// 상호명은 225/225 전부 있으니 그걸로 찾는다.
//
// ── 좌표를 지어내지 않는다 ──────────────────────────────────────────────
// 카카오가 못 찾거나 확신이 안 서면 **실패로 남기고 넘어간다**(src/lib/kakao.ts의 원칙).
// 확신의 근거는 두 가지다:
//   1) 이름이 맞는가 — 공백·괄호·지점 접미사를 걷어내고 비교
//   2) **거리가 맞는가** — 저장된 distanceM과 카카오가 준 거리가 얼마나 어긋나는지
//      이게 결정적이다. 같은 이름 PC방이 여러 곳이어도 거리로 가려낼 수 있다.
//
// ── 채점표가 이미 있다 ──────────────────────────────────────────────────
// 49곳은 카카오에서 직접 수집해 좌표가 들어 있다. **그 49곳을 먼저 맞혀 보고**
// 정확도를 잰 다음에 나머지 176곳을 믿는다. 검증 없이 176곳을 채우지 않는다.
//
// **운영 Firestore에 쓰지 않는다.** 결과는 로컬 파일로만 남긴다.
//
// 사용법:
//   node scripts/geocodeCompetitors.mjs            (전량)
//   KAKAO_LIMIT=30 node scripts/geocodeCompetitors.mjs
//
// 산출물: .local-tools/competitor-coords.json (운영 자료라 git 제외)

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const SITES = ".local-tools/geocoded-sites.json";
const OUT = ".local-tools/competitor-coords.json";
const DELAY_MS = Number(process.env.KAKAO_DELAY_MS || 120);

function loadEnvLocal() {
  let text;
  try { text = readFileSync(new URL("../.env.local", import.meta.url), "utf8"); } catch { return; }
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
for (const f of [SNAPSHOT, SITES]) {
  if (!existsSync(f)) { console.error(`${f}가 없다.`); process.exit(1); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 이름을 비교용으로 정규화 — 공백·괄호·점 표기를 걷어낸다. */
function norm(s) {
  return String(s ?? "")
    .replace(/\(.*?\)/g, "")
    .replace(/[\s·・.,\-_']/g, "")
    .replace(/(피시|PC|pc)방?/g, "pc")
    .toLowerCase();
}
/** 두 이름이 얼마나 겹치나 (0~1). 한쪽이 다른 쪽을 품으면 1에 가깝다. */
function nameScore(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const short = x.length < y.length ? x : y, long = x.length < y.length ? y : x;
  let hit = 0;
  for (const ch of new Set(short)) if (long.includes(ch)) hit++;
  return (hit / new Set(short).size) * 0.7;
}
const R_EARTH = 6371000;
function haversine(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}

async function searchKeyword(lat, lng, keyword, radiusM) {
  const params = new URLSearchParams({
    query: keyword, x: String(lng), y: String(lat), radius: String(Math.min(20000, Math.max(200, radiusM))),
    sort: "distance", size: "15",
  });
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?${params}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KEY}` } });
    if (res.ok) return (await res.json())?.documents ?? [];
    if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
    return [];
  }
  return [];
}

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const rawSites = JSON.parse(readFileSync(SITES, "utf8"));
const sites = rawSites.sites ?? rawSites;

// 기준점 좌표 — 기존점과 **후보지 둘 다** 모은다.
// 후보지를 넣는 이유: 좌표가 이미 있는 경쟁점 49곳이 전부 후보지 소속이라(카카오 수집은
// 후보지 기능이다) **채점표가 거기 있다.** 기존점만 보면 채점을 못 한다.
const originOf = new Map();
for (const [k, v] of Object.entries(sites)) {
  if (!Number.isFinite(Number(v?.lat))) continue;
  const code = k.includes(":") ? k.slice(k.indexOf(":") + 1) : k;
  originOf.set(code, { lat: Number(v.lat), lng: Number(v.lng), name: v.name });
}
for (const cand of snap.candidates ?? []) {
  const code = cand.candidateCode ?? cand.code;
  if (!code || originOf.has(code)) continue;
  if (!Number.isFinite(Number(cand.lat))) continue;
  originOf.set(code, { lat: Number(cand.lat), lng: Number(cand.lng), name: cand.name ?? null });
}

let comps = snap.competitors.filter((c) => c.investigationStatus !== "경쟁점없음" && c.name && originOf.has(c.candidateCode));
const LIMIT = Number(process.env.KAKAO_LIMIT || 0);
if (LIMIT > 0) comps = comps.slice(0, LIMIT);

console.log(`경쟁점 ${comps.length}곳 (기존점 좌표를 아는 것만) · 이미 좌표 있는 곳 ${comps.filter((c) => c.lat != null).length}곳이 채점표다\n`);

const out = { collectedAt: new Date().toISOString(), items: {} };
let found = 0, missed = 0;
const scored = []; // 채점표 — 이미 좌표를 아는 곳에서 내 방식이 맞히는지

for (const c of comps) {
  const o = originOf.get(c.candidateCode);
  const recorded = c.distanceM == null ? null : Number(c.distanceM);
  // 저장된 거리보다 넉넉히 잡되 최소 1km. 거리를 모르면 2km.
  const radius = recorded == null ? 2000 : Math.max(1000, recorded * 3);
  // 상호명만으로는 카카오가 못 찾는 경우가 많다("라이또PC", "보보스PC존" 등 73/168이 무응답).
  // 업종어를 붙여 몇 번 더 물어본다. 지어내는 게 아니라 **같은 가게를 다른 말로 찾는 것**이다.
  const bare = String(c.name).replace(/\s*(PC방|피시방|pc방|PC|피시)\s*$/i, "").trim();
  const queries = [...new Set([c.name, `${c.name} PC방`, bare && bare !== c.name ? `${bare} PC방` : null].filter(Boolean))];
  const docs = [];
  const seen = new Set();
  for (const q of queries) {
    for (const d of await searchKeyword(o.lat, o.lng, q, radius)) {
      if (d.id && seen.has(d.id)) continue;
      if (d.id) seen.add(d.id);
      docs.push(d);
    }
    await sleep(DELAY_MS);
    if (docs.length >= 10) break; // 충분히 모였으면 더 안 부른다
  }

  let best = null;
  for (const d of docs) {
    const lat = Number(d.y), lng = Number(d.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const dist = haversine(o.lat, o.lng, lat, lng);
    const ns = nameScore(c.name, d.place_name);
    // 거리 일치도 — 저장된 거리와 얼마나 맞나. 거리를 모르면 감점 없이 이름만 본다.
    const dgap = recorded == null ? 0 : Math.abs(dist - recorded);
    const dScore = recorded == null ? 0.5 : Math.max(0, 1 - dgap / Math.max(150, recorded * 0.5));
    const total = ns * 0.55 + dScore * 0.45;
    if (!best || total > best.total) best = { lat, lng, dist, dgap, ns, dScore, total, placeName: d.place_name, id: d.id };
  }

  // 확신이 안 서면 버린다. 이름이 어지간히 맞거나(0.85+) 거리가 잘 맞아야(0.6+) 한다.
  const ok = best != null && best.ns >= 0.5 && (best.ns >= 0.85 || best.dScore >= 0.6) && best.total >= 0.6;
  const rec = {
    candidateCode: c.candidateCode, name: c.name, recordedDistanceM: recorded,
    lat: ok ? best.lat : null, lng: ok ? best.lng : null,
    matchedName: ok ? best.placeName : null, matchedDistanceM: ok ? Math.round(best.dist) : null,
    nameScore: best ? Number(best.ns.toFixed(3)) : null,
    distanceGapM: best && recorded != null ? Math.round(best.dgap) : null,
    confidence: best ? Number(best.total.toFixed(3)) : null,
    hadCoords: c.lat != null,
  };
  if (ok) found++; else missed++;
  // 채점 — 이미 좌표가 있던 곳은 내 결과와 얼마나 떨어졌나
  if (c.lat != null && Number.isFinite(Number(c.lat)) && ok) {
    scored.push({ name: c.name, offM: Math.round(haversine(Number(c.lat), Number(c.lng), best.lat, best.lng)) });
  }
  out.items[c.id ?? `${c.candidateCode}:${c.name}`] = rec;
}

writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
console.log(`찾음 ${found}곳 · 못 찾음 ${missed}곳 (${Math.round(found / comps.length * 100)}%)`);

if (scored.length) {
  const offs = scored.map((s) => s.offM).sort((a, b) => a - b);
  const within = (m) => offs.filter((v) => v <= m).length;
  console.log(`\n[채점] 이미 좌표가 있던 ${scored.length}곳과 대조`);
  console.log(`  중앙 어긋남 ${offs[Math.floor(offs.length / 2)]}m · 최대 ${offs[offs.length - 1]}m`);
  console.log(`  20m 안 ${within(20)}곳 · 50m 안 ${within(50)}곳 · 100m 안 ${within(100)}곳 · 200m 초과 ${offs.length - within(200)}곳`);
  const bad = scored.filter((s) => s.offM > 200).slice(0, 5);
  if (bad.length) console.log(`  크게 어긋난 곳: ${bad.map((b) => `${b.name} ${b.offM}m`).join(" · ")}`);
  console.log(`  -> 이 정확도가 나쁘면 나머지 곳의 좌표도 믿으면 안 된다.`);
} else {
  console.log(`\n⚠️ 채점할 표본이 없다 — 이미 좌표가 있던 곳을 못 찾았다는 뜻이라 결과를 믿지 마라.`);
}
console.log(`\n${OUT}에 저장.`);
