// 2km 안 PC방을 **잘림 없이** 받는다 — 카카오 적응형 격자 (2026-09-22 밤 신설)
//
// ── 왜 ────────────────────────────────────────────────────────────────────
// `collectKakaoNeighborhood.mjs`는 한 지점에 **한 번만** 묻는다. 카카오 장소 API는
// 15건 × 3쪽 = **최대 45건**이라, PC방이 빽빽한 동네에서는 목록이 잘린다:
//     전대후문 216건(인허가 기준) 중 32건 · 전대상대 201 중 40 · 수원인계 163 중 35
// 그 4곳만 경쟁점이 덜 세어지면 **그 매장만 후해진다** — 부분 적용과 같은 편향이다.
//
// ── 어떻게 ────────────────────────────────────────────────────────────────
// 한 번에 2km를 통째로 묻지 않고, **잘리면 그 구역을 넷으로 쪼개 다시 묻는다.**
// 잘리지 않을 때까지 재귀로 내려간다.
//
//     원 하나(반지름 r)  ->  반지름 0.75r 원 넷을 (±r/2, ±r/2)에 놓으면 원래 원을 덮는다
//     (제일 먼 점이 (r,0)이고 가장 가까운 중심까지 0.707r < 0.75r — 덮인다)
//
// ⚠️ **규칙은 전 지점에 똑같다** — "안 잘릴 때까지 쪼갠다". 빽빽한 곳은 저절로 더 쪼개지고
//    한산한 곳은 한 번에 끝난다. 매장마다 다른 자를 대는 게 아니다.
//
// ⚠️ **거리를 다시 잰다.** 카카오가 주는 `distance`는 **물어본 지점**에서의 거리다.
//    격자로 쪼개면 그건 매장까지의 거리가 아니다. 하버사인으로 매장 중심에서 다시 잰다.
//    (이걸 놓치면 거리 감쇠가 통째로 틀어진다.)
//
// ⚠️ 겹치게 묻기 때문에 같은 가게가 여러 번 온다. **카카오 place id로 중복을 없앤다.**
//    기존 수집기는 id를 안 담았다 — 여기서는 담는다.
//
// 산출물: .local-tools/kakao-pcbangs-grid.json
//   ⚠️ 기존 `kakao-neighborhood.json`을 **덮지 않는다.** 그 파일은 `_catchment` 등
//      여러 하네스가 근거로 쓰고 있어서, 덮으면 옛 기각 근거가 재현이 안 된다.
//
// 실행:
//   node scripts/collectKakaoPcBangsGrid.mjs            # 전체(이어받기 됨)
//   node scripts/collectKakaoPcBangsGrid.mjs --limit 3  # 3곳만 시험
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

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

/** 매장 좌표는 기존 수집물에서 가져온다 — **같은 좌표를 써야** 옛 결과와 비교가 된다. */
const SITES = ".local-tools/kakao-neighborhood.json";
const OUT = ".local-tools/kakao-pcbangs-grid.json";
const RADIUS_M = 2000;
/** 카카오 한 질의의 상한. 15건 × 3쪽. */
const PAGE_CAP = 45;
/** 재귀 깊이 한계 — 여기까지 쪼개도 잘리면 그 사실을 기록에 남긴다. */
const MAX_DEPTH = 4;
const DELAY_MS = Number(process.env.KAKAO_DELAY_MS ?? 120);

const args = process.argv.slice(2);
const argValue = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : Infinity;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
/** 중심에서 동/북으로 m미터 옮긴 좌표. 수백 m 규모라 평면 근사로 충분하다. */
function offset(lat, lng, eastM, northM) {
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.cos(lat * Math.PI / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

let calls = 0;
async function call(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    calls++;
    if (res.ok) return res.json();
    if (res.status === 429) { await sleep(1200 * (attempt + 1)); continue; }
    const text = await res.text().catch(() => "");
    throw new Error(`카카오 요청 실패 (${res.status}): ${text.slice(0, 160)}`);
  }
  return null;
}

/** 한 원을 훑는다. 3쪽까지 받고, total_count가 더 크면 잘린 것이다. */
async function queryCircle(lat, lng, radius) {
  const docs = [];
  let total = null;
  for (let page = 1; page <= 3; page++) {
    const params = new URLSearchParams({
      query: "PC방", x: String(lng), y: String(lat),
      radius: String(Math.round(radius)), size: "15", page: String(page), sort: "distance",
    });
    const json = await call(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`);
    if (!json) break;
    total = Number(json?.meta?.total_count ?? total);
    for (const d of json?.documents ?? []) {
      docs.push({
        id: d.id ?? null,
        name: d.place_name ?? null,
        category: d.category_name ?? null,
        lat: Number(d.y), lng: Number(d.x),
        address: d.road_address_name || d.address_name || null,
      });
    }
    if (json?.meta?.is_end) break;
    await sleep(DELAY_MS);
  }
  return { total, docs, truncated: total != null && total > PAGE_CAP };
}

/**
 * 잘리면 넷으로 쪼개 다시 묻는다. 결과는 out(Map)에 id로 모은다.
 * 반환값은 "이 가지 어딘가에서 끝내 잘렸는가".
 */
async function collectCircle(lat, lng, radius, depth, out) {
  const { docs, truncated } = await queryCircle(lat, lng, radius);
  for (const d of docs) if (d.id) out.set(d.id, d);
  if (!truncated) return false;
  if (depth >= MAX_DEPTH) return true;                 // 더 못 쪼갠다 — 사실대로 남긴다
  const half = radius / 2, sub = radius * 0.75;
  let stillTruncated = false;
  for (const [ex, ny] of [[-half, -half], [-half, half], [half, -half], [half, half]]) {
    const c = offset(lat, lng, ex, ny);
    await sleep(DELAY_MS);
    if (await collectCircle(c.lat, c.lng, sub, depth + 1, out)) stillTruncated = true;
  }
  return stillTruncated;
}

const main = async () => {
  if (!existsSync(SITES)) {
    console.error(`${SITES}가 없다 — 매장 좌표를 거기서 읽는다.`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(SITES, "utf8"));
  const sites = raw.sites ?? raw;
  const keys = Object.keys(sites).filter((k) => Number.isFinite(Number(sites[k]?.lat)));
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { sites: {} };
  const result = prev.sites ?? {};

  console.log(`지점 ${keys.length}곳 · 반경 ${RADIUS_M}m · 잘리면 넷으로 쪼갠다(최대 ${MAX_DEPTH}단)`);
  let done = 0;
  for (const key of keys) {
    if (done >= LIMIT) break;
    done++;
    if (result[key]) { console.log(`  건너뜀(이미 있음) ${sites[key].name}`); continue; }
    const s = sites[key];
    const lat = Number(s.lat), lng = Number(s.lng);
    const before = calls;
    const bag = new Map();
    let stillTruncated = false;
    try {
      stillTruncated = await collectCircle(lat, lng, RADIUS_M, 0, bag);
    } catch (e) {
      console.error(`  ${s.name}: ${e.message}`);
      continue;
    }
    // ⚠️ 거리를 **매장 중심에서** 다시 잰다. 카카오가 준 distance는 물어본 지점 기준이다.
    const docs = [...bag.values()]
      .map((d) => ({ ...d, distanceM: Math.round(distanceM(lat, lng, d.lat, d.lng)) }))
      .filter((d) => d.distanceM <= RADIUS_M)
      .sort((a, b) => a.distanceM - b.distanceM);
    result[key] = {
      kind: s.kind ?? null, code: s.code ?? null, name: s.name ?? null, lat, lng,
      pcRooms: { total: docs.length, docs, truncated: stillTruncated },
    };
    const old = (s.pcRooms?.docs ?? []).length;
    console.log(`  ${String(s.name ?? key).padEnd(18)}${String(docs.length).padStart(4)}건`
      + ` (전 ${String(old).padStart(3)}건) · 질의 ${calls - before}회${stillTruncated ? " ⚠️여전히 잘림" : ""}`);
    mkdirSync(".local-tools", { recursive: true });
    writeFileSync(OUT, JSON.stringify({
      collectedAt: new Date().toISOString(),
      source: "카카오 장소 키워드검색 'PC방' · 적응형 격자(잘리면 4분할)",
      radiusM: RADIUS_M, maxDepth: MAX_DEPTH, sites: result,
    }, null, 0));
    await sleep(DELAY_MS);
  }
  const all = Object.values(result);
  const tr = all.filter((x) => x.pcRooms.truncated).length;
  console.log(`\n저장 ${OUT}`);
  console.log(`  지점 ${all.length}곳 · PC방 총 ${all.reduce((a, b) => a + b.pcRooms.docs.length, 0)}건 · 카카오 질의 ${calls}회`);
  console.log(`  끝내 잘린 지점 ${tr}곳${tr ? " — MAX_DEPTH를 올리거나 그 지점은 하한으로 읽어라" : ""}`);
  console.log(`  ⚠️ 거리는 **매장 중심 기준으로 다시 잰 값**이다. 카카오가 준 distance가 아니다.`);
};

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
