// 경쟁점 가동률 측정기 — 폐업 의심 경쟁점 찾기 (2026-10-07 사용자 "기존점 경쟁매장이 오픈일 시점으로 돼 있어 폐업 매장을 그대로 쓰고 있을 듯").
// 기존점 경쟁점 목록은 개점 당시 조사라 그 뒤 문 닫은 곳이 섞여 있을 수 있다. 실체 판정은 카카오가 정답(상가업소·인허가는 폐업을 못 따라옴).
// 측정 중인 경쟁점마다 우리 매장 3km 안을 상호로 검색(fillDistance.mjs와 같은 이름 닮음 규칙) + 측정기 대답 수를 같이 본다.
//   카카오에 없음 + 대답 거의 없음 → 폐업 의심(가장 강함) · 카카오에 없음 + 대답 있음 → 상호 변경이거나 IP가 다른 사업장
// 읽기만 한다. 결과: .local-tools/ping-closed-check.json
//   node scripts/pingMonitor/checkClosed.mjs [--all]   ← 기본은 기존점 경쟁점만, --all이면 후보지 경쟁점도
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const ALL = process.argv.includes("--all");
process.loadEnvFile(new URL("../../.env.local", import.meta.url));
if (!getApps().length)
  initializeApp({ credential: cert({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }) });
const db = getFirestore();
const KEY = process.env.KAKAO_REST_API_KEY;
if (!KEY) { console.error("KAKAO_REST_API_KEY가 .env.local에 필요하다."); process.exit(1); }

const snap = JSON.parse(readFileSync(".local-tools/validation-snapshot.json", "utf8"));
const ownXY = new Map([
  ...snap.existingStores.filter((s) => s.lat && s.lng).map((s) => [s.storeCode, { lat: s.lat, lng: s.lng }]),
  ...snap.candidates.filter((c) => c.lat && c.lng).map((c) => [c.code, { lat: c.lat, lng: c.lng }]),
]);
const candByName = new Map(snap.candidates.filter((c) => c.lat && c.lng).map((c) => [c.name.replace(/\s/g, ""), { lat: c.lat, lng: c.lng }]));
const ownAt = (code, name) => ownXY.get(code) ?? candByName.get(String(name ?? "").replace(/\s/g, ""));

const norm = (t) => String(t ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/pc방|pc|피시방|피씨방|피시|피씨|카페|cafe|클럽|존|zone|아레나|스토리|점$|\s+|[-_.·&/]/g, "");
const dice = (a, b) => {
  if (a.length < 2 || b.length < 2) return a && b && (a.includes(b) || b.includes(a)) ? 1 : 0;
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const A = bg(a), B = bg(b); let hit = 0;
  for (const [k, n] of A) hit += Math.min(n, B.get(k) ?? 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
};
const meters = (a, b) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};
async function search(q, at) {
  const u = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&x=${at.lng}&y=${at.lat}&radius=3000&sort=distance&size=15`;
  const r = await fetch(u, { headers: { Authorization: `KakaoAK ${KEY}` } });
  if (!r.ok) throw new Error(`카카오 ${r.status}`);
  return (await r.json()).documents ?? [];
}

const docs = (await db.collection("pingMonitorStores").get()).docs.filter(
  (d) => !d.get("isOwnStore") && d.get("ownCode") && d.get("active") !== false && (ALL || !/^N\d/.test(String(d.get("ownCode")))),
);
const rows = [];
for (const d of docs) {
  const name = d.get("name"), ownName = d.get("ownName"), own = ownAt(d.get("ownCode"), ownName);
  // 측정기 문서의 날별 합계(days: a=켜짐 합, t=잰 대수 합, n=회차) — 대답 최대치와 평균 가동률
  const days = d.get("days") ?? {};
  let a = 0, t = 0; for (const v of Object.values(days)) { a += v.a ?? 0; t += v.t ?? 0; }
  const maxAlive = Math.max(0, ...Object.values(d.get("recent") ?? {}).map((v) => v.a ?? 0), d.get("lastSample")?.alive ?? 0);
  const ping = { hasIp: !!d.get("ipRanges"), utilPct: t > 0 ? Math.round((a / t) * 1000) / 10 : null, maxAlive, pcCount: d.get("pcCount") ?? null };
  if (!own) { rows.push({ id: d.id, ownName, name, kakao: "우리 매장 좌표 없음", ping }); continue; }
  const n = norm(name), seen = new Map();
  // 2026-10-07 — "스토리피시랩"을 카카오 "스토리PC랩"으로 못 찾아 폐업으로 잘못 짚었다(사용자 지도 확인). 피시·피씨는 PC로 바꿔서도 찾는다.
  const qs = [...new Set([name, `${name} PC방`, String(name).replace(/피시|피씨/g, "PC")])];
  for (const q of qs) for (const p of await search(q, own)) seen.set(p.id, p);
  const cands = [...seen.values()]
    .filter((p) => /PC방|게임방|피씨방/.test(p.category_name))
    .map((p) => ({ place: p.place_name, addr: p.road_address_name || p.address_name, sim: Math.round(dice(norm(p.place_name), n) * 100) / 100, m: meters(own, { lat: Number(p.y), lng: Number(p.x) }) }))
    .sort((x, y) => y.sim - x.sim || x.m - y.m);
  const best = cands[0] ?? null;
  rows.push({ id: d.id, ownName, name, regDistanceM: d.get("distanceM") ?? null, kakao: best && best.sim >= 0.5 ? "있음" : "못 찾음", best, ping });
  await new Promise((s) => setTimeout(s, 60));
}
mkdirSync(".local-tools", { recursive: true });
writeFileSync(".local-tools/ping-closed-check.json", JSON.stringify(rows, null, 1));

const quiet = (r) => r.ping.hasIp && r.ping.maxAlive <= 3;
const groups = {
  "폐업 의심 (카카오 없음 + 대답 3대 이하)": rows.filter((r) => r.kakao === "못 찾음" && quiet(r)),
  "카카오 없음 + IP 없음 (측정 안 됨)": rows.filter((r) => r.kakao === "못 찾음" && !r.ping.hasIp),
  "카카오 없음 + 대답 있음 (상호 변경? IP가 다른 곳?)": rows.filter((r) => r.kakao === "못 찾음" && r.ping.hasIp && !quiet(r)),
  "카카오 있음 + 대답 3대 이하 (IP 낡음·차단?)": rows.filter((r) => r.kakao === "있음" && quiet(r)),
  "우리 매장 좌표 없음": rows.filter((r) => r.kakao === "우리 매장 좌표 없음"),
};
console.log(`측정 중 경쟁점 ${rows.length}곳 (${ALL ? "후보지 포함" : "기존점 경쟁점"}) · 카카오 있음 ${rows.filter((r) => r.kakao === "있음").length}곳\n`);
for (const [title, list] of Object.entries(groups)) {
  console.log(`■ ${title}: ${list.length}곳`);
  for (const r of list) console.log(`  ${r.ownName} | ${r.name} · 가동률 ${r.ping.utilPct ?? "-"}% · 최대 대답 ${r.ping.maxAlive}/${r.ping.pcCount ?? "?"}대 ← 카카오 근접: ${r.best ? `${r.best.place}(닮음 ${r.best.sim}, ${r.best.m}m)` : "-"}`);
}
process.exit(0);
