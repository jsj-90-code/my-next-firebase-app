// 경쟁점 가동률 측정기 — 거리(distanceM)가 빈 경쟁점을 카카오 장소 검색으로 찾아 채운다(2026-10-07 사용자 "거리 공백인 곳 값 넣어줘").
// 우리 매장 좌표(스냅샷 기존점·후보지) 주변 3km 안에서 상호로 검색 → "PC방" 업종이고 이름이 닮은 곳 중 가장 가까운 곳.
// 직선거리(m)와 그 장소 도로명주소(주소 칸이 비어 있을 때만)를 쓴다. 이름이 안 닮으면 비워 두고 목록에 남긴다.
//   node scripts/pingMonitor/fillDistance.mjs            ← 미리보기(.local-tools/ping-distance-plan.json)
//   node scripts/pingMonitor/fillDistance.mjs --apply    ← 쓰기
import { readFileSync, writeFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
if (!getApps().length)
  initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\n/g, "\n") }) });
const db = getFirestore();
const KEY = process.env.KAKAO_REST_API_KEY;
const snap = JSON.parse(readFileSync(".local-tools/validation-snapshot.json", "utf8"));
const ownXY = new Map([
  ...snap.existingStores.filter((s) => s.lat && s.lng).map((s) => [s.storeCode, { lat: s.lat, lng: s.lng }]),
  ...snap.candidates.filter((c) => c.lat && c.lng).map((c) => [c.code, { lat: c.lat, lng: c.lng }]),
]);
// 개점해 기존점 코드가 새로 생긴 매장은 스냅샷 기존점에 좌표가 없다 → 같은 이름의 후보지 좌표(평택소사벌 N009).
const candByName = new Map(snap.candidates.filter((c) => c.lat && c.lng).map((c) => [c.name.replace(/s/g, ""), { lat: c.lat, lng: c.lng }]));
const ownAt = (code, name) => ownXY.get(code) ?? candByName.get(String(name ?? "").replace(/s/g, ""));
// 이름 닮음이 낮아도 같은 매장인 곳 — 영어/한글 표기 차이(2026-10-07 사람이 확인). "우리매장|등록 이름" → 카카오 장소명.
const SAME_PLACE = {
  "부경대점|NU": "NUPC방 부경대점",
  "남악점|OX PC": "OXPC 무안남악점",
  "검단사거리점|긱스타": "geekstar pc cafe 검단점",
  "김포구래점|카사": "까사PC클럽",
  "발산역점|HERA PC": "헤라PC",
  "발산역점|3 pop PC": "쓰리팝",
};
// 지점이 여럿이라 어느 곳인지 못 가리는 곳 — 비워 둔다.
const HOLD = new Set(["평택소사벌점|뉴블랙 PC"]);

const meters = (a, b) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};
const norm = (t) => String(t ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/pc방|pc|피시방|피씨방|피시|피씨|카페|cafe|클럽|존|zone|아레나|스토리|점$|\s+|[-_.·&/]/g, "");
const dice = (a, b) => {
  if (a.length < 2 || b.length < 2) return a && b && (a.includes(b) || b.includes(a)) ? 1 : 0;
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const A = bg(a), B = bg(b); let hit = 0;
  for (const [k, n] of A) hit += Math.min(n, B.get(k) ?? 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
};
async function search(q, at) {
  const u = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&x=${at.lng}&y=${at.lat}&radius=3000&sort=distance&size=15`;
  const r = await fetch(u, { headers: { Authorization: `KakaoAK ${KEY}` } });
  if (!r.ok) throw new Error(`카카오 ${r.status}`);
  return (await r.json()).documents ?? [];
}

const docs = (await db.collection("pingMonitorStores").get()).docs;
const blank = docs.filter((d) => !d.get("isOwnStore") && d.get("distanceM") == null && d.get("ownCode") && d.get("name") !== "tset");
const plan = [];
for (const d of blank) {
  const name = d.get("name"), own = ownAt(d.get("ownCode"), d.get("ownName"));
  if (!own) { plan.push({ id: d.id, ownName: d.get("ownName"), name, result: "우리 매장 좌표 없음" }); continue; }
  const n = norm(name);
  const seen = new Map();
  for (const q of [name, `${name} PC방`]) for (const p of await search(q, own)) seen.set(p.id, p);
  const cands = [...seen.values()]
    .filter((p) => /PC방|게임방|피씨방/.test(p.category_name))
    .map((p) => ({ place: p.place_name, addr: p.road_address_name || p.address_name, sim: Math.round(dice(norm(p.place_name), n) * 100) / 100, distanceM: meters(own, { lat: Number(p.y), lng: Number(p.x) }) }))
    .sort((a, b) => b.sim - a.sim || a.distanceM - b.distanceM);
  const forced = SAME_PLACE[`${d.get("ownName")}|${name}`];
  const best = forced ? cands.find((c) => c.place === forced) : cands[0];
  const ok = best && !HOLD.has(`${d.get("ownName")}|${name}`) && (forced || best.sim >= 0.5);
  plan.push({ id: d.id, ownName: d.get("ownName"), name, result: ok ? "찾음" : "못 찾음", best: best ?? null, others: cands.slice(1, 3), hadAddress: !!d.get("address") });
  await new Promise((s) => setTimeout(s, 60));
}
writeFileSync(".local-tools/ping-distance-plan.json", JSON.stringify(plan, null, 1));
for (const p of plan) console.log(`[${p.result}] ${p.ownName} | ${p.name} ← ${p.best ? `${p.best.place} · ${p.best.distanceM}m · 닮음 ${p.best.sim} · ${p.best.addr}` : "-"}`);
if (APPLY) {
  let n = 0;
  for (const p of plan.filter((x) => x.result === "찾음")) {
    await db.doc(`pingMonitorStores/${p.id}`).update({
      distanceM: p.best.distanceM,
      ...(p.hadAddress ? {} : { address: p.best.addr }),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "script:fillDistance",
    });
    n++;
  }
  console.log(`${n}곳 썼다.`);
}
