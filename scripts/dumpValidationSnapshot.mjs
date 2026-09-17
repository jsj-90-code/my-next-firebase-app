// 검증 스냅샷 덤프 — storedAccuracyParity / weightsCandidateParity / competitorMonotonicity
// 세 테스트가 읽는 `.local-tools/validation-snapshot.json`을 운영 Firestore에서 다시 뜬다.
//
// 2026-09-15에 집 PC에서 재작성했다. 원래 .local-tools/ 안에 있었는데 그 폴더는 gitignore라
// PC를 옮기면 안 따라와서, 회사 PC 무인모드가 낡은 스냅샷 위에서 테스트 5건을 헛되이 붉혔다.
// 그래서 도구는 git에 두고 산출물(운영 자료)만 .local-tools/에 남긴다.
// (기존 스냅샷의 top-level 키/문서 모양을 그대로 맞춘다 — 테스트가 그 모양에 의존한다).
//
//   node scripts/dumpValidationSnapshot.mjs
//
// 읽기 전용이다. 쓰기는 하지 않는다. 문서 약 1,200건을 읽는다.
import { readFileSync, writeFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnvLocal() {
  let text;
  try {
    text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvLocal();

const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
// .env.local의 키는 한 줄에 "\n" 이스케이프로 들어 있다. 정규식 대신 split/join을 쓴다 —
// 셸 heredoc으로 이 파일을 쓰면 백슬래시가 먹혀 조용히 깨진다(2026-09-15에 실제로 겪음).
const BS = String.fromCharCode(92);
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.split(BS + "n").join(String.fromCharCode(10));
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!clientEmail || !privateKey || !projectId) {
  console.error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / NEXT_PUBLIC_FIREBASE_PROJECT_ID가 .env.local에 필요합니다.");
  process.exit(1);
}

const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);

async function dumpCollection(name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

const [candidates, results, existingStores, competitors, locationEvaluations, sales, labQscScores, settingsDoc, accuracyDoc] =
  await Promise.all([
    dumpCollection("storeEvalCandidates"),
    dumpCollection("storeEvalResults"),
    dumpCollection("storeEvalExistingStores"),
    dumpCollection("storeEvalCompetitors"),
    dumpCollection("storeEvalLocationEvaluations"),
    dumpCollection("storeEvalExistingStoreSales"),
    // 실험실 QSC 점검 기록(관리 점수의 원자료). **운영 컬렉션이 아니지만 여기 담는다** —
    // 원본은 `.local-tools/qsc-scores.json`인데 그 파일이 gitignore라 PC를 옮기면 안 따라온다.
    // 없으면 하네스는 관리 4.00으로, 화면은 QSC 값으로 돌아 **성적이 조용히 갈라진다**
    // (2026-09-17: 하네스가 운영 자료를 뜨고 화면은 실험실 자료를 읽어 실제로 갈라져 있었다).
    dumpCollection("storeEvalLabQscScores"),
    db.collection("storeEvalSettings").doc("current").get(),
    db.collection("storeEvalSystemStatus").doc("accuracy").get(),
  ]);

const snapshot = {
  fetchedAt: new Date().toISOString(),
  candidates,
  results,
  existingStores,
  competitors,
  locationEvaluations,
  sales,
  labQscScores,
  settings: settingsDoc.exists ? settingsDoc.data() : null,
  storedAccuracy: accuracyDoc.exists ? accuracyDoc.data() : null,
};

writeFileSync(new URL("../.local-tools/validation-snapshot.json", import.meta.url), JSON.stringify(snapshot, null, 2), "utf8");
const total = candidates.length + results.length + existingStores.length + competitors.length + locationEvaluations.length + sales.length + labQscScores.length;
console.log(`후보지 ${candidates.length} · 결과 ${results.length} · 기존점 ${existingStores.length} · 경쟁점 ${competitors.length} · 입지평가 ${locationEvaluations.length} · 월매출 ${sales.length} · 실험실QSC ${labQscScores.length} (총 ${total}건 읽음)`);
console.log("저장된 적중률:", JSON.stringify(snapshot.storedAccuracy && {
  modelVersion: snapshot.storedAccuracy.modelVersion,
  sampleCount: snapshot.storedAccuracy.sampleCount,
  MAPE: snapshot.storedAccuracy.meanAbsoluteErrorPct,
  updatedAt: new Date(snapshot.storedAccuracy.updatedAt).toISOString(),
}));
process.exit(0);
