// 문경시청점 주거 상권 반경 2km → 1km 되돌림 (2026-09-25 저녁, 사용자 결정 — 인계 7번 "되돌려").
//
// 왜: 반경 2km는 "2km 안에 다른 PC방 상권이 없다"는 사실 규칙인데 문경은 1.4~1.5km에 경쟁 4곳이 있어 규칙에 안 맞는다.
//     09-24에 사용자가 "결과를 알고 넣은 것"이라 자백한 예외였고, 경쟁도 2km로 세면 −13으로 터졌다(인계 (20)). 예외를 두면 규칙이 무너진다.
// 어떻게: 문서를 지우지 않는다(데이터 삭제 금지). residentRadiusM을 1000으로 쓰고 note에 되돌린 사유를 남긴다 —
//     읽는 쪽(labInput residentRadiusByCodeFromDocs)은 1500·2000만 받으므로 1000은 무시돼 기본 1km가 된다.
//     scripts/writeLabResidentRadius.mjs FACTS에서도 문경 줄을 뺐다(다시 돌려도 2000으로 안 돌아가게).
//   node scripts/revertLabResidentRadius20260925.mjs          # 미리보기
//   node scripts/revertLabResidentRadius20260925.mjs --apply  # 쓴다 → 다음: node scripts/dumpValidationSnapshot.mjs
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const COLLECTION = "storeEvalLabResidentRadius";
const ID = "existing:20240530413";
const NOTE = "2026-09-25 사용자 결정으로 2km → 1km 되돌림. 1.4~1.5km에 경쟁 4곳이 있어 '2km 안 다른 PC방 상권 없음' 규칙에 안 맞음(09-24 '결과 알고 넣음' 예외였음). 1000은 읽는 쪽이 무시 → 기본 1km.";

function loadEnvLocal() {
  let text;
  try { text = readFileSync(new URL("../.env.local", import.meta.url), "utf8"); } catch { return; }
  for (const line of text.split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvLocal();
const BS = String.fromCharCode(92);
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.split(BS + "n").join(String.fromCharCode(10));
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!clientEmail || !privateKey || !projectId) { console.error(".env.local에 FIREBASE_CLIENT_EMAIL · FIREBASE_PRIVATE_KEY · NEXT_PUBLIC_FIREBASE_PROJECT_ID가 필요하다."); process.exit(1); }
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

const ref = db.collection(COLLECTION).doc(ID);
const snap = await ref.get();
if (!snap.exists) { console.log(`✗ ${ID} 문서 없음 — 이미 없으면 기본 1km다. 할 일 없음`); process.exit(0); }
console.log(`${snap.get("name")} 반경 ${snap.get("residentRadiusM")}m → 1000(무시됨 = 1km)  note: ${String(snap.get("note")).slice(0, 60)}…`);
if (!APPLY) { console.log("\n미리보기다. 실제로 쓰려면 --apply 를 붙인다."); process.exit(0); }
await ref.update({ residentRadiusM: 1000, residentRadiusPrev: snap.get("residentRadiusM") ?? null, note: NOTE, confirmedBy: "사용자 2026-09-25 저녁 — 되돌림", confirmedAt: "2026-09-25", updatedAt: Date.now() });
console.log("썼다. 다음: node scripts/dumpValidationSnapshot.mjs");
process.exit(0);
