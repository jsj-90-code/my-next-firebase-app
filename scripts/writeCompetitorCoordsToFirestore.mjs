// 상호명으로 찾은 경쟁점 좌표를 Firestore에 넣는다.
//
//   node scripts/writeCompetitorCoordsToFirestore.mjs                 # 미리보기
//   node scripts/writeCompetitorCoordsToFirestore.mjs --apply         # 실제로 쓴다
//   node scripts/writeCompetitorCoordsToFirestore.mjs --apply --lab   # 실험실 복제본에도
//   node scripts/writeCompetitorCoordsToFirestore.mjs --min-confidence=0.9 --max-gap=30
//
// 입력: .local-tools/competitor-coords.json (geocodeCompetitors.mjs 산출물)
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────────
// 경쟁점은 거리(distanceM)만 있고 **좌표가 49/225(22%)뿐**이었다. 그래서 "붐비는 쪽과
// 우리 사이에 경쟁점이 껴 있나" 같은 방위가 필요한 항목을 접을 수밖에 없었다.
// 상호명은 225곳 전부 있으니 카카오 장소검색으로 찾는다.
//
// ── 좌표를 지어내지 않는다 ─────────────────────────────────────────────────
// 두 가지를 다 만족해야 넣는다:
//   1) 이름·거리로 낸 confidence가 기준 이상
//   2) **현장조사 거리와 카카오 좌표로 잰 거리의 어긋남**이 기준 이하
//
// 2)가 진짜 검증이다. distanceM은 현장조사에서 나왔고 카카오 좌표는 전혀 다른 출처라,
// 둘이 맞으면 같은 가게를 가리킨다는 독립적인 증거가 된다. 2026-09-16 실측으로 새로 찾은
// 101곳의 어긋남이 중앙 6m · 90퍼센타일 18m · 최대 87m였다.
//
// ⚠️ geocodeCompetitors.mjs의 "채점표 45곳 어긋남 0m"는 **정확도가 아니다.** 그 49곳도
//    같은 카카오 검색으로 모은 값이라 재현된 것뿐이다. 진짜 검증은 위 2)다.
//
// ⚠️ 운영 산식은 lat/lng를 읽지 않는다(2026-09-16 확인). 넣어도 예측이 안 바뀐다.
// ⚠️ 이미 좌표가 있는 문서는 건드리지 않는다.

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCollectionMap, needsWrite } from "./lib/diffWrite.mjs";

const DATA = ".local-tools/competitor-coords.json";
const SNAPSHOT = ".local-tools/validation-snapshot.json";
const APPLY = process.argv.includes("--apply");
const ALSO_LAB = process.argv.includes("--lab");
const numArg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.slice(name.length + 3)) : dflt;
};
const MIN_CONF = numArg("min-confidence", 0.85);
const MAX_GAP = numArg("max-gap", 50);

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

const BS = String.fromCharCode(92);
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.split(BS + "n").join(String.fromCharCode(10));
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!clientEmail || !privateKey || !projectId) {
  console.error("FIREBASE_* 환경변수가 .env.local에 필요하다.");
  process.exit(1);
}
for (const f of [DATA, SNAPSHOT]) {
  if (!existsSync(f)) { console.error(`${f}이 없다. geocodeCompetitors.mjs 먼저.`); process.exit(1); }
}
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const items = JSON.parse(readFileSync(DATA, "utf8")).items;
const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));

// 경쟁점 문서 id 찾기 — 후보지코드 + 상호명으로 짝짓는다.
const docIdByPair = new Map();
for (const c of snap.competitors ?? []) {
  docIdByPair.set(`${c.candidateCode}|${c.name}`, c.id);
}

const targets = [
  { collection: "storeEvalCompetitors", label: "운영" },
  ...(ALSO_LAB ? [{ collection: "storeEvalLabCompetitors", label: "실험실" }] : []),
];

const rejected = { noCoord: 0, lowConfidence: 0, bigGap: 0, hadCoords: 0, noDoc: 0 };
const accepted = [];

for (const it of Object.values(items)) {
  if (it.hadCoords) { rejected.hadCoords++; continue; }
  if (!(it.lat && it.lng)) { rejected.noCoord++; continue; }
  if ((it.confidence ?? 0) < MIN_CONF) { rejected.lowConfidence++; continue; }
  if (it.distanceGapM == null || it.distanceGapM > MAX_GAP) { rejected.bigGap++; continue; }
  const docId = docIdByPair.get(`${it.candidateCode}|${it.name}`);
  if (!docId) { rejected.noDoc++; continue; }
  accepted.push({ it, docId });
}

console.log(`\n기준: confidence ≥ ${MIN_CONF} · 현장조사 거리와의 어긋남 ≤ ${MAX_GAP}m`);
console.log(`넣을 곳 ${accepted.length}곳`);
console.log(`  뺀 것 — 이미 좌표 있음 ${rejected.hadCoords} · 못 찾음 ${rejected.noCoord} · 신뢰도 미달 ${rejected.lowConfidence} · 거리 어긋남 ${rejected.bigGap} · 문서 못 찾음 ${rejected.noDoc}`);
const gaps = accepted.map((a) => a.it.distanceGapM).sort((x, y) => x - y);
if (gaps.length) console.log(`  넣을 것들의 어긋남: 중앙 ${gaps[Math.floor(gaps.length / 2)]}m · 최대 ${gaps[gaps.length - 1]}m`);
console.log("\n예시 3곳:");
for (const a of accepted.slice(0, 3)) {
  console.log(`  ${a.it.name} -> ${a.it.matchedName} · 조사거리 ${a.it.recordedDistanceM}m vs 지도거리 ${a.it.matchedDistanceM}m (어긋남 ${a.it.distanceGapM}m)`);
}

for (const t of targets) {
  const map = await loadCollectionMap(db, t.collection);
  const plan = [];
  for (const a of accepted) {
    const before = map.get(a.docId);
    if (before?.lat && before?.lng) continue;
    const patch = {
      lat: Number(a.it.lat), lng: Number(a.it.lng),
      coordSource: "장소검색",
      coordMatchedName: a.it.matchedName ?? null,
      coordConfidence: a.it.confidence ?? null,
      coordDistanceGapM: a.it.distanceGapM ?? null,
    };
    if (needsWrite(before, patch, { merge: true })) plan.push({ docId: a.docId, patch });
  }
  console.log(`\n[${t.label}] 쓸 것 ${plan.length}곳`);
  if (!APPLY) continue;
  let written = 0;
  for (const p of plan) { await db.collection(t.collection).doc(p.docId).set({ ...p.patch, updatedAt: Date.now() }, { merge: true }); written++; }
  console.log(`   -> ${written}곳에 썼다.`);
}

if (!APPLY) console.log("\n미리보기다. 실제로 쓰려면 --apply (실험실에도 넣으려면 --lab) 를 붙인다.");
process.exit(0);
