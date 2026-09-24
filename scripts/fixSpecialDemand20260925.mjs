// 특수수요 분류 정정 3건 (2026-09-25 새벽, 사용자 결정 — "부천 강릉 증평 3개 적용").
//
//   1. 강릉교동점(신)(20260123429): 없음/없음 → **관광유흥/높음**. 공군 18전비 5.9km라 군부대 아님. 시외·고속터미널 200m, 교동택지(술집 몰린 신흥 번화가,
//      강릉원주대 학생 소비) — 수원인계·야당과 같은 자리. 실험실 −7.8 → +2.4. V62는 관광유흥을 학습에 안 써서 무영향.
//   2. 부천상동역점(20240628416): 없음/없음 → **관광유흥/높음**. 상동역 일대 하이퍼블릭·노래방 밀집 유흥가. 실험실 −9.2 → +0.3.
//   3. 증평점(20250124422): 없음/없음 → **군부대/보통**. 37사단 사령부·13특임여단 소재지(사실). 함의 1.02라 '높음'(×2)은 과대 → 보통.
//      실험실은 강도 문에 막혀 배수 0. ⚠️ 운영 V62는 군부대를 배후수요 더미(isBackingDemandMarket)로 학습해 V62가 움직인다 — 적용 전후를 storedAccuracyParity로 잰다.
//
// 운영 컬렉션(storeEvalLocationEvaluations)에 쓰고, 실험실 복제본은 scripts/syncLabCollections.mjs --apply --only=locationEvaluations,existingStores 로 옮긴다.
//   node scripts/fixSpecialDemand20260925.mjs          # 미리보기
//   node scripts/fixSpecialDemand20260925.mjs --apply  # 실제로 쓴다

import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const UPDATED_BY = "사용자 결정 2026-09-25 — 특수수요 지리 재검토(scripts/fixSpecialDemand20260925.mjs)";
const FIXES = [
  { code: "20260123429", name: "강릉교동점(신)", type: "관광유흥", intensity: "높음", why: "군부대 아님(18전비 5.9km). 터미널 200m·교동택지 번화가" },
  { code: "20240628416", name: "부천상동역점", type: "관광유흥", intensity: "높음", why: "상동역 유흥가(하이퍼블릭·노래방 밀집)" },
  // 처음 '보통'으로 넣었다가 사용자 질문("낮음이야 보통이야?") 뒤 체크리스트(docs/special-demand-guide.md)대로 **낮음**으로 정정 — 사령부·특수부대라 외출 병사 손님이 거의 없다.
  { code: "20250124422", name: "증평점", type: "군부대", intensity: "낮음", why: "37사단 사령부·13특임여단(간부·특수부대) 소재지 — 외출 병사 상권 아님. 함의 1.02" },
];

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

let changed = 0;
for (const f of FIXES) {
  for (const col of ["storeEvalLocationEvaluations", "storeEvalExistingStores"]) {
    const ref = db.collection(col).doc(f.code);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`✗ ${f.name}(${f.code}) ${col} 문서 없음 — 건너뜀`); continue; }
    const type = snap.get("specialDemandType") ?? null, inten = snap.get("specialDemandIntensity") ?? null;
    const same = type === f.type && inten === f.intensity;
    console.log(`${same ? "=" : "→"} ${f.name.padEnd(10)} ${col.replace("storeEval", "").padEnd(20)} ${type}/${inten} → ${f.type}/${f.intensity}   ${f.why}`);
    if (same || !APPLY) continue;
    await ref.update({ specialDemandType: f.type, specialDemandIntensity: f.intensity, specialDemandPrev: `${type}/${inten}`, specialDemandNote: f.why, updatedBy: UPDATED_BY, updatedAt: Date.now() });
    changed += 1;
  }
}
console.log(APPLY ? `\n${changed}건 썼다. 다음: node scripts/syncLabCollections.mjs --apply --only=locationEvaluations,existingStores && node scripts/dumpValidationSnapshot.mjs` : "\n미리보기만 했다(--apply로 쓴다).");
process.exit(0);
