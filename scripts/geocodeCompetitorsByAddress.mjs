// 경쟁점 좌표를 **주소로** 채운다 (2026-09-16).
//
//   node scripts/geocodeCompetitorsByAddress.mjs            # 미리보기
//   node scripts/geocodeCompetitorsByAddress.mjs --apply    # Firestore에 쓴다
//   node scripts/geocodeCompetitorsByAddress.mjs --apply --lab
//
// ── 왜 이름이 아니라 주소인가 ──────────────────────────────────────────────
// 사용자(2026-09-16): "이게 가맹점이 아마 24년도인가 23년도 오픈매장부터 있을 거라고.
// 지금 기준으로는 오픈 당시에 있던 경쟁점이 없는 곳이 있다고. 상호가 바뀌었거나 다양한
// 이유로 카카오맵에 오픈 당시 있던 경쟁점이 없다는 말임."
//
// 경쟁점 자료는 **가맹점 오픈 당시 스냅샷**이고 카카오맵은 **지금**이다. 그래서 상호명으로
// 찾는 `geocodeCompetitors.mjs`는 폐점·개명한 곳을 원리적으로 못 찾는다(75곳 실패).
// **주소는 가게가 바뀌어도 그대로다.** 그 자리의 좌표를 찍으면 된다.
//
// ⚠️ 이건 "그 가게가 지금도 있다"는 뜻이 아니다. **그 자리의 좌표**일 뿐이다. 경쟁 산식은
//    오픈 당시 경쟁 상황으로 예측하고 이후 실매출과 대조하는 구조라, 그 자리 좌표면 충분하다.
//
// ⚠️ 좌표를 지어내지 않는다. 카카오가 주소를 못 찾으면 실패로 남긴다. 다만 "2층 203호,204호"
//    같은 복수 호실은 첫 쉼표 앞(건물 주소)으로 재시도한다 — 기존점에서 쓰던 방식과 같다.
//
// 산출물(미리보기): .local-tools/competitor-coords-by-address.json

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCollectionMap, needsWrite } from "./lib/diffWrite.mjs";

const SNAPSHOT = ".local-tools/validation-snapshot.json";
const OUT = ".local-tools/competitor-coords-by-address.json";
const APPLY = process.argv.includes("--apply");
const ALSO_LAB = process.argv.includes("--lab");
// 조사 거리와 이만큼 넘게 어긋나면 같은 자리로 보지 않는다. 주소가 잘못 적혔거나 동명
// 도로명을 엉뚱한 시·군에서 잡은 경우를 거른다.
const MAX_GAP = Number(process.argv.find((a) => a.startsWith("--max-gap="))?.slice(10) ?? 150);

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
const BS = String.fromCharCode(92);
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.split(BS + "n").join(String.fromCharCode(10));
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!KEY) { console.error("KAKAO_REST_API_KEY가 필요하다."); process.exit(1); }
if (APPLY && (!clientEmail || !privateKey || !projectId)) { console.error("FIREBASE_* 환경변수가 필요하다."); process.exit(1); }
if (!existsSync(SNAPSHOT)) { console.error(`${SNAPSHOT}이 없다.`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const distM = (aLat, aLng, bLat, bLng) =>
  Math.round(Math.hypot((bLat - aLat) * 111320, (bLng - aLng) * 111320 * Math.cos((aLat * Math.PI) / 180)));

/** 주소 -> 좌표. 복수 호실이면 첫 쉼표 앞으로 재시도한다(기존점과 같은 방식). */
async function geocode(address) {
  const tries = [address];
  const comma = address.indexOf(",");
  if (comma > 0) tries.push(address.slice(0, comma).trim());
  for (const q of tries) {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}`, {
      headers: { Authorization: `KakaoAK ${KEY}` },
    });
    if (!res.ok) { await sleep(300); continue; }
    const j = await res.json();
    const d = (j.documents ?? [])[0];
    if (d) return { lat: Number(d.y), lng: Number(d.x), method: q === address ? "원본" : "쉼표앞", matchedAddress: d.road_address?.address_name ?? d.address?.address_name ?? null };
    await sleep(120);
  }
  return null;
}

const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const storeByCode = new Map();
for (const s of snap.existingStores ?? []) storeByCode.set(String(s.storeCode), s);
for (const c of snap.candidates ?? []) storeByCode.set(String(c.code ?? c.id), c);

const targetsToGeocode = (snap.competitors ?? []).filter(
  (c) => c.investigationStatus !== "경쟁점없음" && !(c.lat && c.lng) && c.address && String(c.address).trim(),
);

console.log(`주소로 찾을 경쟁점 ${targetsToGeocode.length}곳\n`);

const found = [];
const failed = [];
for (const c of targetsToGeocode) {
  const r = await geocode(String(c.address).trim());
  if (!r) { failed.push({ name: c.name, address: c.address, reason: "카카오가 주소를 못 찾음" }); console.log(`  ✖ ${c.name} — ${c.address}`); continue; }
  const store = storeByCode.get(String(c.candidateCode));
  const gap = store?.lat && store?.lng && c.distanceM != null
    ? Math.abs(distM(Number(store.lat), Number(store.lng), r.lat, r.lng) - Number(c.distanceM))
    : null;
  if (gap != null && gap > MAX_GAP) {
    failed.push({ name: c.name, address: c.address, reason: `조사 거리와 ${gap}m 어긋남` });
    console.log(`  ✖ ${c.name} — 조사거리 ${c.distanceM}m인데 주소 좌표로는 ${gap}m 어긋남`);
    continue;
  }
  found.push({ id: c.id, name: c.name, candidateCode: c.candidateCode, ...r, recordedDistanceM: c.distanceM ?? null, distanceGapM: gap });
  console.log(`  ${r.method === "쉼표앞" ? "△" : "✓"} ${String(c.name).padEnd(16)} ${gap != null ? `거리 어긋남 ${gap}m` : "거리 대조 불가"}`);
  await sleep(120);
}

writeFileSync(OUT, JSON.stringify({ geocodedAt: new Date().toISOString(), found, failed }, null, 1), "utf8");
const gaps = found.map((f) => f.distanceGapM).filter((g) => g != null).sort((a, b) => a - b);
console.log(`\n찾음 ${found.length}곳 · 실패 ${failed.length}곳`);
if (gaps.length) console.log(`조사 거리와의 어긋남: 중앙 ${gaps[Math.floor(gaps.length / 2)]}m · 최대 ${gaps[gaps.length - 1]}m`);

if (!APPLY) { console.log(`\n미리보기다 -> ${OUT}. 실제로 쓰려면 --apply (실험실도 --lab).`); process.exit(0); }

if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();
for (const collectionName of ["storeEvalCompetitors", ...(ALSO_LAB ? ["storeEvalLabCompetitors"] : [])]) {
  const map = await loadCollectionMap(db, collectionName);
  let written = 0;
  for (const f of found) {
    const before = map.get(f.id);
    if (before?.lat && before?.lng) continue;
    const patch = {
      lat: f.lat, lng: f.lng,
      coordSource: `주소(${f.method})`,
      coordMatchedAddress: f.matchedAddress ?? null,
      coordDistanceGapM: f.distanceGapM ?? null,
    };
    if (!needsWrite(before, patch, { merge: true })) continue;
    await db.collection(collectionName).doc(f.id).set({ ...patch, updatedAt: Date.now() }, { merge: true });
    written++;
  }
  console.log(`[${collectionName}] ${written}곳에 썼다.`);
}
process.exit(0);
