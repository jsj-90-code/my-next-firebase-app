// 등록된 경쟁점이 **지금 지도에 실재하는지** 대조한다 (2026-09-16).
//
//   node scripts/auditCompetitorsAgainstMap.mjs
//   KAKAO_RADIUS=700 node scripts/auditCompetitorsAgainstMap.mjs
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────────
// 사용자(2026-09-16): "기존 경쟁점 데이터에 넣은 값은 내가 손으로 한 거고, 옛날 매장은
// 지금 카카오맵에 폐점해서 없는 매장도 있어서 그냥 예상치로 넣은 거라."
//
// **폐점한 경쟁점이 산식에 살아 있으면 경쟁이 과대계상된다.** 경쟁 IP가 부풀면 우리 점유율이
// 실제보다 낮게 잡히고, 그만큼 수요 축척이 왜곡된다. 그래서 "지금도 있는 가게인가"를
// 따로 확인해야 한다.
//
// ── 어떻게 대조하나 ────────────────────────────────────────────────────────
// 우리 매장 좌표를 중심으로 **반경 안의 PC방을 카카오에서 전부 긁어** 등록된 경쟁점 목록과
// 짝지어 본다. 이름으로 찾는 geocodeCompetitors.mjs와 반대 방향이다 — 이쪽이 "지도에는
// 있는데 우리 목록에 없는 가게"(누락)도 같이 잡아낸다.
//
// ⚠️ **못 찾았다고 폐점이라고 단정하지 않는다.** 이름이 바뀌었거나, 카카오에 등록이 없거나,
//    반경 밖일 수 있다. 결과는 "지도에서 확인됨 / 확인 안 됨"까지만 말하고 판단은 사람 몫이다.
//
// ⚠️ 운영 Firestore에 쓰지 않는다. 결과는 로컬 파일로만 남긴다.
//
// 산출물: .local-tools/competitor-map-audit.json

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const OUT = ".local-tools/competitor-map-audit.json";
const RADIUS = Number(process.env.KAKAO_RADIUS || 600);

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
if (!existsSync(SNAPSHOT)) { console.error(`${SNAPSHOT}이 없다.`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const distM = (aLat, aLng, bLat, bLng) =>
  Math.round(Math.hypot((bLat - aLat) * 111320, (bLng - aLng) * 111320 * Math.cos((aLat * Math.PI) / 180)));

/** 비교용으로 이름을 눌러 편다 — 공백·괄호·PC방 표기 차이를 없앤다. */
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()[\]]/g, "")
    .replace(/피시방|피씨방|pc방|pc존|pc/g, "pc");

/** 반경 안 PC방을 전부 긁는다(카테고리 CT1? 아니라 PC방은 키워드가 확실하다). */
async function fetchPcRoomsNear(lat, lng, radius) {
  const out = new Map();
  for (let page = 1; page <= 3; page++) {
    const params = new URLSearchParams({
      query: "PC방", x: String(lng), y: String(lat), radius: String(radius),
      size: "15", page: String(page), sort: "distance",
    });
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`, {
      headers: { Authorization: `KakaoAK ${KEY}` },
    });
    if (!res.ok) break;
    const j = await res.json();
    for (const d of j.documents ?? []) {
      if (!/PC방|게임방/.test(d.category_name ?? "")) continue;
      out.set(d.id, { name: d.place_name, lat: Number(d.y), lng: Number(d.x), address: d.road_address_name || d.address_name });
    }
    if (j.meta?.is_end) break;
    await sleep(120);
  }
  return [...out.values()];
}

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const storeByCode = new Map();
for (const s of snap.existingStores ?? []) storeByCode.set(String(s.storeCode), s);
for (const c of snap.candidates ?? []) storeByCode.set(String(c.code ?? c.id), c);

const byCand = new Map();
for (const c of snap.competitors ?? []) {
  if (c.investigationStatus === "경쟁점없음") continue;
  byCand.set(c.candidateCode, [...(byCand.get(c.candidateCode) ?? []), c]);
}

const report = { auditedAt: new Date().toISOString(), radiusM: RADIUS, sites: {} };
let confirmed = 0, unconfirmed = 0, extra = 0, skipped = 0;

for (const [code, comps] of byCand) {
  const store = storeByCode.get(String(code));
  if (!store?.lat || !store?.lng) { skipped += comps.length; continue; }

  const onMap = await fetchPcRoomsNear(Number(store.lat), Number(store.lng), RADIUS);
  const usedMapIdx = new Set();
  const rows = [];

  for (const c of comps) {
    const cn = norm(c.name);
    let best = null;
    onMap.forEach((m, i) => {
      const mn = norm(m.name);
      const nameHit = mn.includes(cn) || cn.includes(mn);
      if (!nameHit) return;
      const d = c.lat && c.lng ? distM(Number(c.lat), Number(c.lng), m.lat, m.lng) : null;
      const score = (d == null ? 0 : Math.max(0, 1 - d / 300)) + (mn === cn ? 1 : 0.5);
      if (!best || score > best.score) best = { i, m, d, score };
    });
    if (best) { usedMapIdx.add(best.i); confirmed++; }
    else unconfirmed++;
    rows.push({
      name: c.name,
      appliedPcCount: c.appliedPcCount ?? c.totalPcCount ?? null,
      recordedDistanceM: c.distanceM ?? null,
      onMap: Boolean(best),
      matchedName: best?.m.name ?? null,
      matchedDistFromStoredM: best?.d ?? null,
    });
  }

  // 지도에는 있는데 우리 목록에 없는 가게 — 조사 누락일 수 있다.
  const missing = onMap
    .map((m, i) => ({ m, i }))
    .filter(({ i }) => !usedMapIdx.has(i))
    .map(({ m }) => ({ name: m.name, address: m.address, distFromStoreM: distM(Number(store.lat), Number(store.lng), m.lat, m.lng) }))
    .filter((x) => x.distFromStoreM <= RADIUS)
    // 우리 매장 자신은 뺀다.
    .filter((x) => !norm(x.name).includes("아이센스") && !norm(x.name).includes("블랙라벨"));
  extra += missing.length;

  report.sites[code] = { storeName: store.storeName ?? store.name ?? null, registered: rows, notRegisteredButOnMap: missing };
  const un = rows.filter((r) => !r.onMap).length;
  console.log(
    `${String(store.storeName ?? store.name ?? code).padEnd(16)} 등록 ${String(rows.length).padStart(2)}곳 · ` +
    `지도 확인 ${String(rows.length - un).padStart(2)}곳 · 확인 안 됨 ${String(un).padStart(2)}곳` +
    (missing.length ? ` · 지도엔 있는데 목록에 없음 ${missing.length}곳` : ""),
  );
  await sleep(150);
}

writeFileSync(OUT, JSON.stringify(report, null, 1), "utf8");
console.log(`\n등록 경쟁점 중 지도에서 확인 ${confirmed}곳 · 확인 안 됨 ${unconfirmed}곳 · 좌표 없는 매장이라 건너뜀 ${skipped}곳`);
console.log(`지도엔 있는데 목록에 없는 PC방 ${extra}곳 (반경 ${RADIUS}m)`);
console.log(`\n-> ${OUT}`);
console.log("⚠️ 확인 안 됨 = 폐점이 아니다. 이름이 바뀌었거나 카카오에 등록이 없을 수도 있다. 판단은 사람 몫.");
