// 좌표표(.local-tools/geocoded-sites.json)를 Firestore 매장/후보지 문서에 넣는다.
//
//   node scripts/writeCoordsToFirestore.mjs            # 미리보기
//   node scripts/writeCoordsToFirestore.mjs --apply    # 실제로 쓴다
//   node scripts/writeCoordsToFirestore.mjs --apply --lab   # 실험실 복제본에도 같이
//
// ── 왜 필요한가 (2026-09-16) ───────────────────────────────────────────────
// 기존점 41곳은 Firestore에 **좌표가 하나도 없다**(주소만 있다). 그래서 지도·거리 계산이
// 필요한 일은 매번 로컬 파일(.local-tools)에 기대야 했고, 그 파일은 PC를 옮기면 사라진다.
// 좌표는 이제 주소변환 + **매장명 장소검색 대조**까지 끝난 값이라(52곳 중 37곳 대조,
// 어긋남 1곳만 교정) 운영 문서에 넣어도 될 만큼 믿을 만하다.
//
// ⚠️ 운영 산식(calc.ts / usageRevenue.ts / evaluate.ts)은 lat/lng를 **읽지 않는다**
//    (2026-09-16 확인). 넣어도 예측이 안 바뀐다 — 참고 자료다.
//
// ⚠️ 이미 좌표가 있는 문서는 **건드리지 않는다.** 후보지 10곳은 운영 DB 값이 원본이고,
//    좌표표의 그 값들은 거기서 복사해 온 것이다. 덮어쓸 이유가 없다.

import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { loadCollectionMap, needsWrite } from "./lib/diffWrite.mjs";

const SITES = ".local-tools/geocoded-sites.json";
const SNAPSHOT = ".local-tools/validation-snapshot.json";
const APPLY = process.argv.includes("--apply");
const ALSO_LAB = process.argv.includes("--lab");

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
for (const f of [SITES, SNAPSHOT]) {
  if (!existsSync(f)) { console.error(`${f}이 없다.`); process.exit(1); }
}
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const sites = JSON.parse(readFileSync(SITES, "utf8")).sites;
const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));

const existingDocId = new Map();
for (const e of snap.existingStores ?? []) existingDocId.set(String(e.storeCode ?? e.id), e.id);
const candidateDocId = new Map();
for (const c of snap.candidates ?? []) candidateDocId.set(String(c.code ?? c.id), c.id);

const targets = [
  { existing: "storeEvalExistingStores", candidate: "storeEvalCandidates", label: "운영" },
  ...(ALSO_LAB ? [{ existing: "storeEvalLabExistingStores", candidate: "storeEvalLabCandidates", label: "실험실" }] : []),
];

for (const t of targets) {
  const existingMap = await loadCollectionMap(db, t.existing);
  const candidateMap = await loadCollectionMap(db, t.candidate);
  const plan = [];
  const kept = [];

  for (const [key, s] of Object.entries(sites)) {
    if (!Number.isFinite(Number(s.lat)) || !Number.isFinite(Number(s.lng))) continue;
    const [kind, code] = key.split(":");
    const isCandidate = kind === "candidate";
    const docId = isCandidate ? candidateDocId.get(String(code)) : existingDocId.get(String(code));
    if (!docId) continue;
    const map = isCandidate ? candidateMap : existingMap;
    const before = map.get(docId);
    // 이미 좌표가 있으면 그대로 둔다 — 운영 DB 값이 원본인 지점들이다.
    if (before?.lat && before?.lng) { kept.push(s.name); continue; }
    const patch = {
      lat: Number(s.lat), lng: Number(s.lng),
      coordSource: s.method ?? null,                 // 원본 / 쉼표앞 / 장소검색 / 운영DB
      coordMatchedAddress: s.matchedAddress ?? null, // 주소변환이 실제로 잡은 주소
    };
    plan.push({
      name: s.name,
      collection: isCandidate ? t.candidate : t.existing,
      docId, patch,
      changed: needsWrite(before, patch, { merge: true }),
    });
  }

  const toWrite = plan.filter((p) => p.changed);
  console.log(`\n[${t.label}] 좌표 없던 곳 ${plan.length}곳 · 쓸 것 ${toWrite.length}곳 · 이미 있어 건드리지 않음 ${kept.length}곳`);
  const bySource = {};
  for (const p of toWrite) bySource[p.patch.coordSource ?? "?"] = (bySource[p.patch.coordSource ?? "?"] ?? 0) + 1;
  for (const [k, n] of Object.entries(bySource)) console.log(`   출처 ${k}: ${n}곳`);

  if (!APPLY) continue;
  let written = 0;
  for (const p of toWrite) { await db.collection(p.collection).doc(p.docId).set({ ...p.patch, updatedAt: Date.now() }, { merge: true }); written++; }
  console.log(`   -> ${written}곳에 썼다.`);
}

if (!APPLY) console.log("\n미리보기다. 실제로 쓰려면 --apply (실험실에도 넣으려면 --lab) 를 붙인다.");
process.exit(0);
