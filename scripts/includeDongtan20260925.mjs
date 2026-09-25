// 동탄북광장점 — QSC 대체값(가맹점 최하 평균) 넣고 모델 표본에 포함 (2026-09-25 밤, 사용자 지시).
//
// 사용자: "동탄북광장점 QSC 점수 가맹점 최하 점수 넣어주고 관리점수에 적용해줘. 그리고 산식 반영하면 되잖아."
//   동탄은 "오픈 후 운영관리 문제"로 모델에서 빠져 있었는데 QSC 점검 기록이 하나도 없어 관리 점수가 가맹점 평균으로 들어갔다 —
//   운영관리 문제가 입력에 없었다. 가맹점 최하 QSC 평균(구미산동 73.9 — 오픈 점검 제외, 관리 점수와 같은 규칙)을 **대체 기록**으로 넣어
//   관리 점수에 반영하고, 그러면 원인이 입력에 들어가므로 모델 제외를 푼다.
// 대체 기록은 form에 "대체값"을 적어 실측과 구분한다. 실제 점검 기록이 생기면 이 줄을 지우고 실측으로 바꿀 것.
// 쓰는 곳: storeEvalQscScores(운영) · storeEvalLabQscScores(실험실) — writeQscScoresToFirestore.mjs와 같은 문서 모양. 기존 문서가 있으면 안 덮는다.
//          storeEvalExistingStores/20250124421 excludedFromModel → false (옛 사유는 excludedReasonPrev).
//   node scripts/includeDongtan20260925.mjs          # 미리보기
//   node scripts/includeDongtan20260925.mjs --apply  # 쓴다 → 다음: node scripts/syncLabCollections.mjs --apply --only=existingStores && node scripts/dumpValidationSnapshot.mjs
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const CODE = "20250124421";
const MIN_QSC = 73.9; // 구미산동점 QSC 평균(7건, 오픈 점검 제외) — 2026-09-25 스냅샷 기준 가맹점 최하
const DOC = {
  storeCode: CODE, storeName: "동탄북광장점", openedAt: "2025-01-24",
  records: [{ date: "2025.07.01", score: MIN_QSC, form: "대체값 — 사용자 지시 2026-09-25: 점검 기록 없음, 가맹점 최하 QSC 평균(구미산동 73.9)" }],
  source: "사용자 지시 대체값(scripts/includeDongtan20260925.mjs)", collectedAt: "2026-09-25",
};

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
if (!clientEmail || !privateKey || !projectId) { console.error(".env.local에 서비스 계정이 필요하다."); process.exit(1); }
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();

for (const col of ["storeEvalQscScores", "storeEvalLabQscScores"]) {
  const ref = db.collection(col).doc(CODE);
  const snap = await ref.get();
  if (snap.exists) { console.log(`= ${col}: 이미 문서가 있다(${(snap.get("records") ?? []).length}건) — 안 덮는다`); continue; }
  console.log(`→ ${col}: 대체 기록 1건(${MIN_QSC}점) 추가`);
  if (APPLY) await ref.set(DOC);
}
const sref = db.collection("storeEvalExistingStores").doc(CODE);
const s = await sref.get();
console.log(`→ ${s.get("storeName")} excludedFromModel ${s.get("excludedFromModel")} → false (사유: ${s.get("excludedReason")})`);
if (APPLY) await sref.update({
  excludedFromModel: false, excludedReasonPrev: s.get("excludedReason") ?? null, excludedReason: null,
  includeNote: "2026-09-25 사용자 지시 — 운영관리 문제를 QSC 대체값(가맹점 최하 73.9)으로 관리 점수에 반영하고 모델 표본에 포함",
  updatedBy: "사용자 결정 2026-09-25 — 동탄 모델 포함", updatedAt: Date.now(),
});
console.log(APPLY ? "\n썼다. 다음: node scripts/syncLabCollections.mjs --apply --only=existingStores && node scripts/dumpValidationSnapshot.mjs" : "\n미리보기다. --apply 로 쓴다.");
process.exit(0);
