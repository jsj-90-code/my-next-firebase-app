// 송도점을 모델 표본(V62·실험실)에 넣는다 (2026-09-25 밤, 사용자 결정). 동탄북광장은 그대로 제외.
//
// 사용자: "송도점은 요금 1,000원으로 해서 적용한 거니까 — 오픈 후 발생한 문제여도 그에 맞춰 데이터를 변경한 것."
//   확인: 송도 hourlyRate 1,000(경쟁점 500원 가격전쟁 대응) — 원인이 입력에 들어가 있다 → 제외할 이유가 사라짐.
//   넣어도 원래 38곳 V62 MAPE 9.0 그대로 · 1%p 넘게 움직인 매장 2곳(_timeSplitBacktest (4), INCLUDE_ONLY=20260515431). 송도 자기 오차 +20%.
// 동탄북광장은 안 넣는다: "관리 점수가 반영됐다"였지만 QSC 점검 기록이 하나도 없어 관리 점수가 가맹점 평균으로 들어간다 —
//   운영관리 문제가 입력에 없다. 넣으면 원래 38곳 중앙 7.2→8.5, 자기 오차 +31%. QSC 기록이 생기면 다시 본다.
// 문서는 지우지 않는다 — excludedFromModel만 false로, 옛 사유는 excludedReasonPrev에 남긴다.
//   node scripts/includeSongdo20260925.mjs          # 미리보기
//   node scripts/includeSongdo20260925.mjs --apply  # 쓴다 → 다음: node scripts/syncLabCollections.mjs --apply --only=existingStores && node scripts/dumpValidationSnapshot.mjs
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const CODE = "20260515431";
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

const ref = db.collection("storeEvalExistingStores").doc(CODE);
const snap = await ref.get();
if (!snap.exists) { console.log("송도점 문서 없음"); process.exit(1); }
console.log(`${snap.get("storeName")} excludedFromModel ${snap.get("excludedFromModel")} → false  (사유: ${snap.get("excludedReason")})`);
if (!APPLY) { console.log("\n미리보기다. --apply 로 쓴다."); process.exit(0); }
await ref.update({
  excludedFromModel: false,
  excludedReasonPrev: snap.get("excludedReason") ?? null,
  excludedReason: null,
  includeNote: "2026-09-25 사용자 결정 — 가격전쟁은 요금 1,000원으로 입력에 반영됨. 모델 표본에 포함(scripts/includeSongdo20260925.mjs)",
  updatedBy: "사용자 결정 2026-09-25 — 송도 모델 포함",
  updatedAt: Date.now(),
});
console.log("썼다. 다음: node scripts/syncLabCollections.mjs --apply --only=existingStores && node scripts/dumpValidationSnapshot.mjs");
process.exit(0);
