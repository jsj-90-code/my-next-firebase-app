// 상권 분리를 **자동으로** 판정해 본다 — 자사↔경쟁점 직선이 큰 도로와 교차하는가(OSM).
//
// ⚠️ 이 파일의 결과는 **봉인물**이다. 사용자의 눈가림 판정이 다 모이기 전에 보여주면
//    사람 판정이 자동 판정을 베끼게 되고, 그러면 둘을 대조하는 의미가 사라진다.
//    산출물은 .local-tools/market-split-osm.json 하나이며 판정 목록 CSV에는 안 들어간다.
//
// ── 왜 도로 등급만으로는 안 되나 (2026-09-18 실측) ─────────────────────────────
// 인계 문서는 `highway=trunk/primary`를 후보로 적었다. 실제로 받아 보니 **한국 OSM은 도로
// 등급이 실제 폭과 잘 안 맞는다.** 사용자가 "왕복 8차선"이라고 말한 부천 상동역 사거리의
// 길주로·소향로가 `highway=tertiary`(심지어 `residential`)로 들어가 있다. trunk/primary만
// 걸렀으면 그 매장은 **큰 도로가 하나도 없는 곳**이 된다.
//
// 그래서 등급과 차선 수를 같이 본다:
//   - motorway/trunk            -> 큰 길 (등급만으로 확정)
//   - primary/secondary         -> 큰 길
//   - 그 밖에 lanes >= 4        -> 큰 길 (등급이 낮아도 폭이 넓으면 장벽이다)
// ⚠️ `lanes`는 결측이 많다. 없으면 등급으로만 판정하므로 **놓치는 쪽**으로 틀린다.
//    자동 판정이 사람과 어긋나면 여기부터 봐야 한다.
// ⚠️ 왕복 도로는 방향별로 way가 쪼개져 lanes가 절반(4~5)으로 적힌다. 8차선이 lanes=4로
//    보이는 게 정상이다 — 그래서 문턱을 4로 잡았다.
//
// 보행로·계단·골목(service)은 애초에 질의에서 뺀다. 그건 장벽이 아니라 통로다.
//
// 사용법:
//   node scripts/judgeMarketSplitByOsm.mjs          # 전부
//   node scripts/judgeMarketSplitByOsm.mjs 부천상동역점   # 몇 곳만
// 남의 공개 서버를 부른다. 지점당 한 번만 부르고 결과를 캐시에 남긴다 — 간격을 줄이지 말 것.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const CACHE = ".local-tools/osm-roads-cache.json";
const OUT = ".local-tools/market-split-osm.json";
const UA = "isens-store-eval-research/1.0 (internal trade-area study; contact jsj-90@isens.camp)";
const ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const DELAY_MS = Number(process.env.OSM_DELAY_MS || 1500);

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

async function overpass(q, tries = 3) {
  let last = null;
  for (let t = 0; t < tries; t++) {
    for (const ep of ENDPOINTS) {
      try {
        const r = await fetch(ep, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" },
          body: new URLSearchParams({ data: q }),
          signal: AbortSignal.timeout(120000),
        });
        const txt = await r.text();
        if (!r.ok) { last = `HTTP ${r.status} @${ep}`; continue; }
        return JSON.parse(txt);
      } catch (e) { last = `${e.message} @${ep}`; }
      await new Promise((res) => setTimeout(res, DELAY_MS));
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new Error(last ?? "unknown");
}

function haversine(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** 두 선분이 실제로 가로지르는가. 300m 규모에서 위경도를 평면으로 봐도 왜곡은 무시할 수준이다. */
function segCross(p1, p2, p3, p4) {
  const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const A = { x: p1.lng, y: p1.lat }, B = { x: p2.lng, y: p2.lat };
  const C = { x: p3.lng, y: p3.lat }, D = { x: p4.lng, y: p4.lat };
  const d1 = side(C, D, A), d2 = side(C, D, B), d3 = side(A, B, C), d4 = side(A, B, D);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 이 도로가 "건너기 어려운 큰 길"인가. 위 주석의 규칙을 그대로 옮긴 것이다. */
export function isBigRoad(tags) {
  const h = tags.highway;
  const lanes = Number(tags.lanes ?? 0);
  if (["motorway", "trunk", "primary", "secondary"].includes(h)) {
    return { big: true, why: lanes ? `${h} lanes=${lanes}` : h };
  }
  if (lanes >= 4) return { big: true, why: `${h} lanes=${lanes}` };
  return { big: false, why: null };
}

async function roadsAround(lat, lng, radiusM) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)},${radiusM}`;
  if (cache[key]) return cache[key];
  const q = `[out:json][timeout:90];way(around:${radiusM},${lat},${lng})[highway]`
    + `[highway!~"^(footway|path|steps|pedestrian|cycleway|track|service|corridor|bridleway|platform|construction|proposed|escape|raceway)$"];`
    + `out tags geom;`;
  const j = await overpass(q);
  cache[key] = j.elements
    .filter((e) => e.type === "way" && e.geometry?.length > 1)
    .map((w) => ({ tags: w.tags ?? {}, geom: w.geometry.map((g) => ({ lat: g.lat, lng: g.lon })) }));
  writeFileSync(CACHE, JSON.stringify(cache), "utf8");
  await new Promise((r) => setTimeout(r, DELAY_MS));
  return cache[key];
}

function crossings(store, rival, ways) {
  const byName = new Map();
  for (const w of ways) {
    const big = isBigRoad(w.tags);
    if (!big.big) continue;
    for (let i = 0; i + 1 < w.geom.length; i++) {
      if (segCross(store, rival, w.geom[i], w.geom[i + 1])) {
        const name = w.tags.name ?? "(무명)";
        // 왕복 도로는 방향별로 way가 쪼개진다 — 같은 이름은 한 번만 센다.
        if (!byName.has(name)) byName.set(name, { name, why: big.why });
        break;
      }
    }
  }
  return [...byName.values()];
}

const byCode = new Map();
for (const c of snap.competitors) {
  if (!byCode.has(c.candidateCode)) byCode.set(c.candidateCode, []);
  byCode.get(c.candidateCode).push(c);
}

const only = process.argv.slice(2);
const stores = snap.existingStores
  .filter((s) => !s.excludedFromModel && s.actualMonthlyRevenueAvg && s.lat != null && s.lng != null)
  .filter((s) => !only.length || only.includes(s.storeName));

const out = [];
let done = 0, failed = 0;
for (const st of stores) {
  const code = st.originCandidateCode ?? st.storeCode;
  const rivals = (byCode.get(code) ?? [])
    .filter((c) => c.investigationStatus !== "경쟁점없음")
    .filter((c) => Number(c.appliedPcCount ?? c.totalPcCount ?? 0) > 0)
    .filter((c) => c.lat != null && c.lng != null);
  if (!rivals.length) continue;
  const far = Math.max(300, ...rivals.map((c) => haversine(st, c)));
  let ways;
  try {
    ways = await roadsAround(st.lat, st.lng, Math.ceil(far) + 120);
  } catch (e) {
    console.log(`  ✗ ${st.storeName} — ${e.message}`);
    failed++;
    continue;
  }
  for (const c of rivals) {
    const hit = crossings(st, c, ways);
    out.push({
      매장명: st.storeName,
      경쟁점명: c.name,
      거리m: Math.round(haversine(st, c)),
      자동판정: hit.length ? "길건너" : "같은편",
      가로지른도로: hit.map((h) => `${h.name}(${h.why})`),
    });
  }
  done++;
  console.log(`  ✓ ${st.storeName} — 경쟁점 ${rivals.length}곳 · 도로 ${ways.length}개 (${done}/${stores.length})`);
}

writeFileSync(OUT, JSON.stringify({ madeAt: new Date().toISOString(), rows: out }, null, 1), "utf8");
const cross = out.filter((r) => r.자동판정 === "길건너").length;
console.log(`\n판정 ${out.length}쌍 · 매장 ${done}곳 (실패 ${failed}곳) -> ${OUT}`);
console.log(`  길건너 ${cross}쌍 (${((cross / out.length) * 100).toFixed(0)}%) · 같은편 ${out.length - cross}쌍`);
console.log(`  ⚠️ 봉인물이다. 사람 판정이 다 모이기 전에 열어 보이지 말 것.`);
