// 기존점 주소 -> 좌표. 반경별 유동인구 수집(collectSbizFloatingPopulation.mjs)의 전제다.
//
// 왜 필요한가: 2026-09-15 확인 — 후보지는 11곳 중 10곳에 lat/lng이 있는데 **기존점 41곳은
// 전부 비어 있다**(주소는 41곳 다 있다). 기존점이 산식을 학습·검증하는 표본이라, 좌표가 없으면
// 유동인구를 모아도 산식을 세울 수 없다.
//
// **운영 Firestore에 쓰지 않는다.** 결과는 로컬 파일로만 남긴다 — 실험용 기초자료를 모으는
// 단계라, 검증이 끝나기 전에 운영 문서를 건드릴 이유가 없다.
//
// 좌표를 지어내지 않는다: 카카오가 못 찾으면 그 지점은 실패로 남기고 넘어간다
// (src/lib/kakao.ts의 원칙을 그대로 따른다). 다만 그 파일이 쓰는 2단계 시도는 똑같이 한다 —
// 기존점 주소가 "601~603호", "502~504호"처럼 복수 호실이라 원본 그대로는 매칭이 실패하고,
// 첫 쉼표 앞(건물 단위 주소)으로 재시도하면 잡힌다. 상세정보만 떼는 것이지 추정이 아니다.
//
// 사용법:
//   node scripts/geocodeExistingStores.mjs
//
// 산출물: .local-tools/geocoded-sites.json (운영 자료라 git 제외)

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const OUT = ".local-tools/geocoded-sites.json";
const DELAY_MS = Number(process.env.KAKAO_DELAY_MS || 250);

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 빈 문자열을 0으로 바꾸지 않는다 — Number("")는 0이라 좌표 누락이 기니만 앞바다가 된다. */
function toCoord(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

async function geocodeExact(address) {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KEY}` } });
  if (!res.ok) throw new Error(`카카오 HTTP ${res.status}`);
  const data = await res.json();
  const doc = data?.documents?.[0];
  if (!doc) return null;
  const lat = toCoord(doc.y);
  const lng = toCoord(doc.x);
  if (lat == null || lng == null) return null;
  return {
    lat,
    lng,
    matchedAddress: doc.road_address?.address_name ?? doc.address?.address_name ?? null,
  };
}

/** 원본 그대로 -> 실패하면 첫 쉼표 앞부분으로 한 번 더. */
async function geocode(address) {
  const trimmed = address.trim();
  if (!trimmed) return null;
  const exact = await geocodeExact(trimmed);
  if (exact) return { ...exact, method: "원본" };
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx === -1) return null;
  const base = trimmed.slice(0, commaIdx).trim();
  if (!base) return null;
  await sleep(DELAY_MS);
  const fallback = await geocodeExact(base);
  return fallback ? { ...fallback, method: "쉼표앞", queried: base } : null;
}

if (!existsSync(SNAPSHOT)) {
  console.error(`${SNAPSHOT}이 없다. 먼저 node scripts/dumpValidationSnapshot.mjs 를 돌린다.`);
  process.exit(1);
}
const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { geocodedAt: null, sites: {} };

// 좌표표는 **52곳 전부**를 담아야 한다. 운영 DB에 이미 좌표가 있는 지점을 그냥 건너뛰면
// 이 파일에서 빠져버려서, 이걸 전제로 도는 수집기(유동인구·편심도)가 그 지점을 통째로
// 놓친다. 2026-09-16에 후보지 10곳이 정확히 그렇게 새고 있었다 — 조회는 건너뛰되
// **기록은 남긴다**(method: "운영DB").
const targets = [];
const fromDb = [];
for (const e of snap.existingStores ?? []) {
  const code = e.storeCode ?? e.id;
  if (e.lat && e.lng) {
    fromDb.push({ kind: "existing", code, name: e.storeName ?? "", address: e.address ?? "", lat: Number(e.lat), lng: Number(e.lng) });
    continue;
  }
  if (!e.address) continue;
  targets.push({ kind: "existing", code, name: e.storeName ?? "", address: e.address });
}
for (const c of snap.candidates ?? []) {
  const code = c.code ?? c.id;
  if (c.lat && c.lng) {
    fromDb.push({ kind: "candidate", code, name: c.name ?? "", address: c.address ?? "", lat: Number(c.lat), lng: Number(c.lng) });
    continue;
  }
  if (!c.address) continue;
  targets.push({ kind: "candidate", code, name: c.name ?? "", address: c.address });
}

// 운영 DB 좌표를 좌표표에 편입한다. 이미 주소변환으로 잡아둔 값은 덮지 않는다 —
// 그쪽은 매칭 주소·method가 같이 남아 있어 추적이 되고, 덮으면 그 이력이 사라진다.
let dbAdded = 0;
for (const d of fromDb) {
  const key = `${d.kind}:${d.code}`;
  if (out.sites[key]?.lat) continue;
  out.sites[key] = { kind: d.kind, code: d.code, name: d.name, address: d.address, lat: d.lat, lng: d.lng, method: "운영DB" };
  dbAdded++;
}
if (dbAdded) console.log(`운영 DB에 좌표가 있던 ${dbAdded}곳을 좌표표에 편입했다 (조회 안 함).\n`);

console.log(`좌표 없는 지점 ${targets.length}곳을 조회한다.\n`);

let ok = 0;
let fallbackUsed = 0;
const failures = [];

for (const t of targets) {
  const key = `${t.kind}:${t.code}`;
  if (out.sites[key]?.lat) {
    ok++;
    continue;
  }
  try {
    const r = await geocode(t.address);
    if (!r) {
      failures.push(t);
      console.log(`  ✖ ${t.name} — 못 찾음: ${t.address}`);
    } else {
      out.sites[key] = { kind: t.kind, code: t.code, name: t.name, address: t.address, ...r };
      ok++;
      if (r.method === "쉼표앞") fallbackUsed++;
      console.log(`  ${r.method === "쉼표앞" ? "△" : "✓"} ${t.name} ${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}  ${r.matchedAddress ?? ""}`);
    }
  } catch (err) {
    failures.push(t);
    console.log(`  ✖ ${t.name} — ${err.message}`);
  }
  await sleep(DELAY_MS);
}

out.geocodedAt = new Date().toISOString();
writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");

console.log(`\n조회 성공 ${ok}곳 (그중 쉼표앞 재시도 ${fallbackUsed}곳) · 실패 ${failures.length}곳 · 운영DB 편입 ${dbAdded}곳 · 좌표표 총 ${Object.keys(out.sites).length}곳 -> ${OUT}`);
if (failures.length) {
  console.log("\n실패한 곳은 주소를 손봐야 한다. 좌표를 지어내지 않았다:");
  for (const f of failures) console.log(`  ${f.code} ${f.name} | ${f.address}`);
}
